package app.petkol.notes;

import android.util.Log;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

/**
 * Ozen-v1 (Whisper-style encoder/decoder, Optimum ONNX export) on ONNX Runtime.
 * Encoder: input_features [1,80,3000] -> last_hidden_state [1,1500,512].
 * Decoder: decoder_model_merged.onnx with use_cache_branch; greedy argmax.
 * In "staged" mode no session stays resident: each run creates the encoder session, runs it,
 * closes it, then does the same for the decoder, so peak memory is max(encoder, decoder).
 * Not thread-safe: callers serialize.
 */
final class OzenRunner {
    private static final String TAG = "PetkolOzen";
    static final int START_TOKEN = 1;
    static final int EOS_TOKEN = 2;
    static final int N_MELS = 80, N_FRAMES = 3000;

    private OrtEnvironment env; // created on first load: loading libonnxruntime is deferred until it is needed
    private OrtSession encoder, decoder;   // resident sessions (not staged)
    private final List<String> pastNames = new ArrayList<>();   // past_key_values.{i}.{decoder|encoder}.{key|value}
    private int nHeads = 8, headDim = 64;

    // configuration of the current load
    private String encPath, decPath;
    private int threads = 4;
    private boolean xnnpack, lowMem, staged;
    private String memOpts;

    String encoderFile, decoderFile;
    String providers = "";

    // timings of the last run (ms)
    long lastEncMs, lastDecMs, lastSessionMs;

    boolean isLoaded() {
        return staged ? encPath != null : (encoder != null && decoder != null);
    }

    boolean isStaged() { return staged; }

    /**
     * @param variant "auto" (int8 pair if present, else fp32/fp16), "int8" or "fp32"
     * @param memOpts optional override, comma list of noarena,nopattern,noprepack; null = derive from lowMem
     */
    void load(String dir, int threads, boolean xnnpack, boolean lowMem, String memOpts,
              boolean staged, String variant) throws OrtException {
        close();
        if (env == null) env = OrtEnvironment.getEnvironment();
        try { env.setTelemetry(false); } catch (Throwable ignored) {}
        File onnx = new File(dir, "onnx");
        if (!onnx.isDirectory()) onnx = new File(dir); // also accept the onnx folder itself
        File[] files = pickFiles(onnx, variant == null ? "auto" : variant);
        if (files == null) throw new IllegalArgumentException("model files not found in " + onnx);

        this.encPath = files[0].getPath();
        this.decPath = files[1].getPath();
        this.threads = threads;
        this.xnnpack = xnnpack;
        this.lowMem = lowMem;
        this.memOpts = memOpts;
        this.staged = staged;
        encoderFile = files[0].getName();
        decoderFile = files[1].getName();

        StringBuilder prov = new StringBuilder();
        if (staged) {
            // read decoder input names/shapes once, then drop the session again
            OrtSession d = createSession(decPath, prov);
            readDecoderInfo(d);
            d.close();
            prov.append(" (staged)");
        } else {
            encoder = createSession(encPath, prov);
            prov.append(" / ");
            decoder = createSession(decPath, prov);
            readDecoderInfo(decoder);
        }
        providers = prov.toString();
        Log.i(TAG, "loaded " + encoderFile + " + " + decoderFile + " threads=" + threads + " lowMem=" + lowMem
                + " staged=" + staged + " providers=" + providers + " pasts=" + pastNames.size()
                + " heads=" + nHeads + " dim=" + headDim);
    }

    /** {encoder, decoder} or null. */
    private static File[] pickFiles(File onnx, String variant) {
        File encI8 = new File(onnx, "encoder_model_int8.onnx");
        File decI8 = new File(onnx, "decoder_model_merged_int8.onnx");
        File enc = new File(onnx, "encoder_model.onnx");
        if (!enc.isFile()) enc = new File(onnx, "encoder_model_fp16.onnx");
        File dec = new File(onnx, "decoder_model_merged.onnx");
        boolean haveI8 = encI8.isFile() && decI8.isFile();
        boolean haveF = enc.isFile() && dec.isFile();
        switch (variant) {
            case "int8": return haveI8 ? new File[]{encI8, decI8} : null;
            case "fp32": return haveF ? new File[]{enc, dec} : null;
            default:
                if (haveI8) return new File[]{encI8, decI8};
                return haveF ? new File[]{enc, dec} : null;
        }
    }

    private void readDecoderInfo(OrtSession d) throws OrtException {
        pastNames.clear();
        for (String n : d.getInputNames()) {
            if (n.startsWith("past_key_values.")) pastNames.add(n);
        }
        try {
            ai.onnxruntime.TensorInfo ti = (ai.onnxruntime.TensorInfo) d.getInputInfo().get(pastNames.get(0)).getInfo();
            long[] shape = ti.getShape(); // [batch, heads, past_len, head_dim]
            if (shape.length == 4 && shape[1] > 0) nHeads = (int) shape[1];
            if (shape.length == 4 && shape[3] > 0) headDim = (int) shape[3];
        } catch (Exception e) {
            Log.w(TAG, "cannot read past kv shape, using defaults", e);
        }
    }

    private OrtSession createSession(String path, StringBuilder prov) throws OrtException {
        if (xnnpack) {
            OrtSession.SessionOptions so = baseOptions();
            try {
                // ORT's and XNNPACK's thread pools would otherwise spin against each other
                so.addConfigEntry("session.intra_op.allow_spinning", "0");
                Map<String, String> xo = new HashMap<>();
                xo.put("intra_op_num_threads", String.valueOf(threads));
                so.addXnnpack(xo);
                OrtSession s = env.createSession(path, so);
                if (prov != null) prov.append("xnnpack+cpu");
                return s;
            } catch (Throwable t) {
                Log.w(TAG, "XNNPACK unavailable for " + path + ", falling back to CPU EP: " + t);
                so.close();
            }
        }
        OrtSession s = env.createSession(path, baseOptions());
        if (prov != null) prov.append("cpu");
        return s;
    }

    private OrtSession.SessionOptions baseOptions() throws OrtException {
        OrtSession.SessionOptions so = new OrtSession.SessionOptions();
        String opts = memOpts != null ? memOpts : (lowMem ? "noarena,nopattern,noprepack" : "");
        // No CPU arena / memory-pattern pre-planning: buffers are freed as soon as they are
        // dead instead of being kept in a grow-only arena. Lower peak RSS on 2 GB devices.
        if (opts.contains("noarena")) so.setCPUArenaAllocator(false);
        if (opts.contains("nopattern")) so.setMemoryPatternOptimization(false);
        // No pre-packed (duplicated) GEMM weights: less memory.
        if (opts.contains("noprepack")) so.addConfigEntry("session.disable_prepacking", "1");
        so.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        so.setIntraOpNumThreads(threads);
        so.setInterOpNumThreads(1);
        so.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL);
        return so;
    }

    /** features: little-endian float32 bytes of shape [1,80,3000]. Returns generated ids without start/eos. */
    int[] run(byte[] features, int maxTokens) throws OrtException {
        if (!isLoaded()) throw new IllegalStateException("not loaded");
        int n = features.length / 4;
        if (n != N_MELS * N_FRAMES) {
            throw new IllegalArgumentException("features must be 1x80x3000 float32, got " + n + " floats");
        }
        lastEncMs = lastDecMs = lastSessionMs = 0;
        List<Integer> out = new ArrayList<>();
        List<AutoCloseable> toClose = new ArrayList<>();
        OrtSession enc = null, dec = null;
        OrtSession.Result encRes = null, firstRes = null, prevRes = null;
        try {
            // ---- encoder
            long ts = System.currentTimeMillis();
            enc = staged ? createSession(encPath, null) : encoder;
            lastSessionMs += System.currentTimeMillis() - ts;

            long t0 = System.currentTimeMillis();
            ByteBuffer bb = ByteBuffer.allocateDirect(features.length).order(ByteOrder.nativeOrder());
            bb.asFloatBuffer().put(ByteBuffer.wrap(features).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer());
            OnnxTensor feat = OnnxTensor.createTensor(env, bb.asFloatBuffer(), new long[]{1, N_MELS, N_FRAMES});
            Map<String, OnnxTensor> encIn = new HashMap<>();
            encIn.put(enc.getInputNames().iterator().next(), feat);
            encRes = enc.run(encIn);
            feat.close();
            OnnxTensor hidden = (OnnxTensor) encRes.get(0);
            lastEncMs = System.currentTimeMillis() - t0;

            if (staged) {
                // keep only the hidden state (1500x512 floats), free everything else of the encoder
                long[] hShape = hidden.getInfo().getShape();
                FloatBuffer src = hidden.getFloatBuffer();
                ByteBuffer hb = ByteBuffer.allocateDirect(src.remaining() * 4).order(ByteOrder.nativeOrder());
                hb.asFloatBuffer().put(src);
                encRes.close();
                encRes = null;
                enc.close();
                enc = null;
                hidden = OnnxTensor.createTensor(env, hb.asFloatBuffer(), hShape);
                toClose.add(hidden);
                ts = System.currentTimeMillis();
                dec = createSession(decPath, null);
                lastSessionMs += System.currentTimeMillis() - ts;
            } else {
                dec = decoder;
            }

            // ---- decoder
            long t1 = System.currentTimeMillis();
            OnnxTensor empty = OnnxTensor.createTensor(env,
                    ByteBuffer.allocateDirect(0).order(ByteOrder.nativeOrder()).asFloatBuffer(),
                    new long[]{1, nHeads, 0, headDim});
            toClose.add(empty);
            OnnxTensor cacheFalse = OnnxTensor.createTensor(env, new boolean[]{false});
            OnnxTensor cacheTrue = OnnxTensor.createTensor(env, new boolean[]{true});
            toClose.add(cacheFalse);
            toClose.add(cacheTrue);
            Set<String> decInputs = dec.getInputNames();

            int token = START_TOKEN;
            for (int step = 0; step < maxTokens; step++) {
                Map<String, OnnxTensor> in = new HashMap<>();
                OnnxTensor ids = OnnxTensor.createTensor(env, LongBuffer.wrap(new long[]{token}), new long[]{1, 1});
                in.put("input_ids", ids);
                if (decInputs.contains("encoder_hidden_states")) in.put("encoder_hidden_states", hidden);
                if (decInputs.contains("use_cache_branch")) in.put("use_cache_branch", step == 0 ? cacheFalse : cacheTrue);
                for (String p : pastNames) {
                    if (step == 0) {
                        in.put(p, empty);
                    } else {
                        String present = p.replace("past_key_values.", "present.");
                        boolean isEnc = p.contains(".encoder.");
                        OrtSession.Result src = isEnc ? firstRes : prevRes;
                        in.put(p, (OnnxTensor) src.get(present).get());
                    }
                }
                OrtSession.Result res = dec.run(in);
                ids.close();

                OnnxTensor logits = (OnnxTensor) res.get("logits").get();
                long[] shape = logits.getInfo().getShape();
                int vocab = (int) shape[2];
                int seq = (int) shape[1];
                FloatBuffer lf = logits.getFloatBuffer();
                int base = (seq - 1) * vocab;
                int best = 0;
                float bestV = Float.NEGATIVE_INFINITY;
                for (int v = 0; v < vocab; v++) {
                    float x = lf.get(base + v);
                    if (x > bestV) { bestV = x; best = v; }
                }

                if (step == 0) {
                    firstRes = res;           // keeps encoder kv (and step-0 decoder kv)
                } else if (prevRes != firstRes) {
                    prevRes.close();
                }
                prevRes = res;

                if (best == EOS_TOKEN) break;
                out.add(best);
                token = best;
            }
            lastDecMs = System.currentTimeMillis() - t1;
            Log.i(TAG, "encoder " + lastEncMs + " ms, decoder " + lastDecMs + " ms, sessions " + lastSessionMs
                    + " ms, " + out.size() + " tokens");
        } finally {
            if (prevRes != null && prevRes != firstRes) prevRes.close();
            if (firstRes != null) firstRes.close();
            if (encRes != null) encRes.close();
            for (AutoCloseable c : toClose) {
                try { c.close(); } catch (Exception ignored) {}
            }
            if (staged) {
                try { if (enc != null) enc.close(); } catch (Exception ignored) {}
                try { if (dec != null) dec.close(); } catch (Exception ignored) {}
            }
        }
        int[] r = new int[out.size()];
        for (int i = 0; i < r.length; i++) r[i] = out.get(i);
        return r;
    }

    void close() {
        try { if (encoder != null) encoder.close(); } catch (Exception ignored) {}
        try { if (decoder != null) decoder.close(); } catch (Exception ignored) {}
        encoder = null;
        decoder = null;
        encPath = decPath = null;
        encoderFile = decoderFile = null;
        staged = false;
    }
}
