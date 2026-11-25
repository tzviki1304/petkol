package app.petkol.notes;

import android.annotation.SuppressLint;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 16 kHz mono PCM16 recorder that writes raw little-endian chunk files (chunk-00001.pcm, ...).
 * Each chunk is cut at the quietest 300 ms window between minChunkSec and chunkSec.
 */
final class Recorder {
    private static final String TAG = "PetkolRec";
    static final int RATE = 16000;
    private static final int FRAME = RATE / 10;          // 100 ms reads
    private static final int LEVEL_EVERY = RATE / 4;     // recLevel ~4/s
    private static final int WIN = RATE * 3 / 10;        // 300 ms silence window
    private static final int HOP = RATE / 20;            // 50 ms hop
    private static final int MIN_LAST = RATE * 3 / 10;   // drop a final tail shorter than 300 ms

    final File dir;
    private final int chunkSamples, minSamples;
    private final short[] buf;
    private int bufLen = 0;
    private int index = 0;
    private volatile long totalSamples = 0;
    private final List<String> files = new ArrayList<>();
    private AudioRecord rec;
    private Thread thread;
    private volatile boolean running = false;
    private volatile String error = null;

    Recorder(File dir, double chunkSec, double minChunkSec) {
        this.dir = dir;
        chunkSec = Math.max(1, Math.min(30, chunkSec));
        minChunkSec = Math.max(0.5, Math.min(chunkSec, minChunkSec));
        chunkSamples = (int) Math.round(chunkSec * RATE);
        minSamples = (int) Math.round(minChunkSec * RATE);
        buf = new short[chunkSamples + FRAME];
    }

    @SuppressLint("MissingPermission")
    void start() throws Exception {
        if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("cannot create " + dir);
        int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        if (min <= 0) throw new Exception("16 kHz mono PCM16 not supported (" + min + ")");
        rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, Math.max(min, RATE * 2));
        if (rec.getState() != AudioRecord.STATE_INITIALIZED) {
            rec.release();
            rec = null;
            throw new Exception("AudioRecord init failed");
        }
        rec.startRecording();
        if (rec.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
            rec.release();
            rec = null;
            throw new Exception("AudioRecord did not start (microphone busy?)");
        }
        running = true;
        thread = new Thread(this::loop, "petkol-rec");
        thread.setPriority(Thread.MAX_PRIORITY);
        thread.start();
    }

    double seconds() { return totalSamples / (double) RATE; }

    synchronized List<String> files() { return new ArrayList<>(files); }

    String error() { return error; }

    /** Stops, writes the last chunk, releases the microphone. Blocking (call off the main thread). */
    List<String> stop() {
        running = false;
        if (thread != null) {
            try { thread.join(5000); } catch (InterruptedException ignored) {}
        }
        if (bufLen >= MIN_LAST) writeChunk(bufLen);
        bufLen = 0;
        return files();
    }

    private void loop() {
        short[] frame = new short[FRAME];
        double levelSum = 0;
        int levelN = 0;
        try {
            while (running) {
                int n = rec.read(frame, 0, FRAME);
                if (n < 0) {
                    error = "AudioRecord.read error " + n;
                    Log.e(TAG, error);
                    break;
                }
                if (n == 0) continue;
                System.arraycopy(frame, 0, buf, bufLen, n);
                bufLen += n;
                totalSamples += n;
                for (int i = 0; i < n; i++) levelSum += (double) frame[i] * frame[i];
                levelN += n;
                if (levelN >= LEVEL_EVERY) {
                    double rms = Math.sqrt(levelSum / levelN) / 32768.0;
                    double db = 20 * Math.log10(Math.max(rms, 1e-6));
                    double level = Math.max(0, Math.min(1, (db + 60) / 60)); // -60 dBFS..0 dBFS -> 0..1
                    JSObject ev = new JSObject();
                    ev.put("level", Math.round(level * 1000) / 1000.0);
                    ev.put("seconds", Math.round(seconds() * 10) / 10.0);
                    ServiceBus.emit("recLevel", ev);
                    levelSum = 0;
                    levelN = 0;
                }
                if (bufLen >= chunkSamples) {
                    int cut = findCut();
                    writeChunk(cut);
                    System.arraycopy(buf, cut, buf, 0, bufLen - cut);
                    bufLen -= cut;
                }
            }
        } catch (Throwable t) {
            error = t.toString();
            Log.e(TAG, "recording loop", t);
        } finally {
            running = false;
            try { rec.stop(); } catch (Exception ignored) {}
            rec.release();
        }
    }

    /** Center of the quietest 300 ms window in [minSamples, chunkSamples]; hard cut if the range is empty. */
    private int findCut() {
        int from = minSamples, to = chunkSamples - WIN;
        if (from > to) return chunkSamples;
        int nBlocks = (chunkSamples - from) / HOP;
        double[] e = new double[nBlocks];
        for (int b = 0; b < nBlocks; b++) {
            double s = 0;
            int off = from + b * HOP;
            for (int i = off; i < off + HOP; i++) s += (double) buf[i] * buf[i];
            e[b] = s;
        }
        int per = WIN / HOP;
        int best = 0;
        double bestE = Double.MAX_VALUE;
        for (int b = 0; b + per <= nBlocks; b++) {
            double s = 0;
            for (int k = 0; k < per; k++) s += e[b + k];
            if (s <= bestE) { bestE = s; best = b; } // ties: prefer the later (longer) cut
        }
        return from + best * HOP + WIN / 2;
    }

    private void writeChunk(int samples) {
        index++;
        String name = String.format(Locale.ROOT, "chunk-%05d.pcm", index);
        File out = new File(dir, name);
        File tmp = new File(dir, name + ".tmp");
        ByteBuffer bb = ByteBuffer.allocate(samples * 2).order(ByteOrder.LITTLE_ENDIAN);
        bb.asShortBuffer().put(buf, 0, samples);
        try (FileOutputStream fos = new FileOutputStream(tmp)) {
            fos.write(bb.array());
            fos.getFD().sync();
        } catch (Exception e) {
            Log.e(TAG, "write " + name, e);
            error = "write failed: " + e.getMessage();
            return;
        }
        if (!tmp.renameTo(out)) {
            error = "rename failed: " + name;
            return;
        }
        synchronized (this) { files.add(out.getAbsolutePath()); }
        JSObject ev = new JSObject();
        ev.put("file", out.getAbsolutePath());
        ev.put("index", index);
        ev.put("seconds", Math.round(seconds() * 10) / 10.0);
        ev.put("chunkSeconds", Math.round(samples / (double) RATE * 100) / 100.0);
        ServiceBus.emit("recChunk", ev);
        Log.i(TAG, "chunk " + name + " " + samples + " samples");
    }

    static JSArray toArray(List<String> l) {
        JSArray a = new JSArray();
        for (String s : l) a.put(s);
        return a;
    }
}
