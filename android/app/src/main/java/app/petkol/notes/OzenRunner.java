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
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

/**
 * Ozen-v1 (Whisper-style encoder/decoder, Optimum ONNX export) on ONNX Runtime.
 * Encoder: input_features [1,80,3000] -> last_hidden_state [1,1500,512].
 * Decoder: decoder_model_merged.onnx with use_cache_branch; greedy argmax.
 * Not thread-safe: callers serialize.
 */
final class OzenRunner {
    private static final String TAG = "PetkolOzen";
    static final int START_TOKEN = 1;
    static final int EOS_TOKEN = 2;
    static final int N_MELS = 80, N_FRAMES = 3000;

    private OrtEnvironment env; // created on first load: loading libonnxruntime is deferred until it is needed
    private OrtSession encoder, decoder;
    private final List<String> pastNames = new ArrayList<>();   // past_key_values.{i}.{decoder|encoder}.{key|value}
    private int nHeads = 8, headDim = 64;
    String encoderFile;
    String providers = "";

    boolean isLoaded() {
        return encoder != null && decoder != null;
    }

    void load(String dir, int threads, boolean xnnpack) throws OrtException {
        close();
        if (env == null) env = OrtEnvironment.getEnvironment();
        try { env.setTelemetry(false); } catch (Throwable ignored) {}
        File onnx = new File(dir, "onnx");
        if (!onnx.isDirectory()) onnx = new File(dir); // also accept the onnx folder itself
        File enc = new File(onnx, "encoder_model.onnx");
        if (!enc.isFile()) enc = new File(onnx, "encoder_model_fp16.onnx");
        File dec = new File(onnx, "decoder_model_merged.onnx");
        if (!enc.isFile() || !dec.isFile()) {
            throw new IllegalArgumentException("model files not found in " + onnx);
        }
        StringBuilder prov = new StringBuilder();
        encoder = createSession(enc.getPath(), threads, xnnpack, prov);
        prov.append(" / ");
        decoder = createSession(dec.getPath(), threads, xnnpack, prov);
        encoderFile = enc.getName();
        providers = prov.toString();

        pastNames.clear();
        for (String n : decoder.getInputNames()) {
            if (n.startsWith("past_key_values.")) pastNames.add(n);
        }
        try {
            ai.onnxruntime.TensorInfo ti = (ai.onnxruntime.TensorInfo) decoder.getInputInfo().get(pastNames.get(0)).getInfo();
            long[] shape = ti.getShape(); // [batch, heads, past_len, head_dim]
            if (shape.length == 4 && shape[1] > 0) nHeads = (int) shape[1];
            if (shape.length == 4 && shape[3] > 0) headDim = (int) shape[3];
        } catch (Exception e) {
            Log.w(TAG, "cannot read past kv shape, using defaults", e);
        }
        Log.i(TAG, "loaded " + enc.getName() + " + " + dec.getName() + " threads=" + threads
                + " providers=" + providers + " pasts=" + pastNames.size() + " heads=" + nHeads + " dim=" + headDim);
    }

    private OrtSession createSession(String path, int threads, boolean xnnpack, StringBuilder prov) throws OrtException {
        if (xnnpack) {
            OrtSession.SessionOptions so = baseOptions(threads);
            try {
                // ORT's and XNNPACK's thread pools would otherwise spin against each other
                so.addConfigEntry("session.intra_op.allow_spinning", "0");
                Map<String, String> xo = new HashMap<>();
                xo.put("intra_op_num_threads", String.valueOf(threads));
                so.addXnnpack(xo);
                OrtSession s = env.createSession(path, so);
                prov.append("xnnpack+cpu");
                return s;
            } catch (Throwable t) {
                Log.w(TAG, "XNNPACK unavailable for " + path + ", falling back to CPU EP: " + t);
                so.close();
            }
        }
        OrtSession s = env.createSession(path, baseOptions(threads));
        prov.append("cpu");
        return s;
    }

    private static OrtSession.SessionOptions baseOptions(int threads) throws OrtException {
        OrtSession.SessionOptions so = new OrtSession.SessionOptions();
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
        ByteBuffer bb = ByteBuffer.allocateDirect(features.length).order(ByteOrder.nativeOrder());
        bb.asFloatBuffer().put(ByteBuffer.wrap(features).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer());

        List<Integer> out = new ArrayList<>();
        List<AutoCloseable> toClose = new ArrayList<>();
        OrtSession.Result encRes = null, firstRes = null, prevRes = null;
        try {
            long t0 = System.currentTimeMillis();
            OnnxTensor feat = OnnxTensor.createTensor(env, bb.asFloatBuffer(), new long[]{1, N_MELS, N_FRAMES});
            toClose.add(feat);
            Map<String, OnnxTensor> encIn = new HashMap<>();
            encIn.put(encoder.getInputNames().iterator().next(), feat);
            encRes = encoder.run(encIn);
            OnnxTensor hidden = (OnnxTensor) encRes.get(0);
            long t1 = System.currentTimeMillis();

            OnnxTensor empty = OnnxTensor.createTensor(env,
                    ByteBuffer.allocateDirect(0).order(ByteOrder.nativeOrder()).asFloatBuffer(),
                    new long[]{1, nHeads, 0, headDim});
            toClose.add(empty);
            OnnxTensor cacheFalse = OnnxTensor.createTensor(env, new boolean[]{false});
            OnnxTensor cacheTrue = OnnxTensor.createTensor(env, new boolean[]{true});
            toClose.add(cacheFalse);
            toClose.add(cacheTrue);
            Set<String> decInputs = decoder.getInputNames();

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
                OrtSession.Result res = decoder.run(in);
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
            long t2 = System.currentTimeMillis();
            Log.i(TAG, "encoder " + (t1 - t0) + " ms, decoder " + (t2 - t1) + " ms, " + out.size() + " tokens");
        } finally {
            if (prevRes != null && prevRes != firstRes) prevRes.close();
            if (firstRes != null) firstRes.close();
            if (encRes != null) encRes.close();
            for (AutoCloseable c : toClose) {
                try { c.close(); } catch (Exception ignored) {}
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
        encoderFile = null;
    }
}
