package app.petkol.notes;

import android.os.Bundle;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;

/**
 * Ozen operations on Bundles, shared by the in-process path and the ":asr" process (AsrService).
 * Results always carry "rssKB"/"peakRssKB" of the process that ran them.
 */
final class OzenOps {
    private static final String TAG = "PetkolOzen";
    static final int LOAD = 1, RUN = 2, UNLOAD = 3;

    private OzenOps() {}

    static Bundle handle(OzenRunner ozen, int what, Bundle a) {
        Bundle out = new Bundle();
        try {
            switch (what) {
                case LOAD: load(ozen, a, out); break;
                case RUN: run(ozen, a, out); break;
                case UNLOAD: ozen.close(); out.putBoolean("ok", true); break;
                default: throw new IllegalArgumentException("unknown op " + what);
            }
        } catch (IllegalArgumentException e) {
            out.putString("error", e.getMessage());
            out.putString("code", "BAD_ARGS");
        } catch (IllegalStateException e) {
            out.putString("error", e.getMessage());
            out.putString("code", "NOT_LOADED");
        } catch (Throwable t) {
            Log.e(TAG, "op " + what, t);
            out.putString("error", t.toString());
            out.putString("code", "FAILED");
            if (what == LOAD) ozen.close();
        }
        long[] rss = PetkolNativePlugin.procRssKB();
        out.putLong("rssKB", rss[0]);
        out.putLong("peakRssKB", rss[1]);
        return out;
    }

    private static void load(OzenRunner ozen, Bundle a, Bundle out) throws Exception {
        long t0 = System.currentTimeMillis();
        ozen.load(a.getString("dir"), a.getInt("threads", 4), a.getBoolean("xnnpack", false),
                a.getBoolean("lowMem", true), a.getString("memOpts"), a.getBoolean("staged", false),
                a.getString("variant", "auto"));
        out.putBoolean("ok", true);
        out.putLong("ms", System.currentTimeMillis() - t0);
        out.putString("encoder", ozen.encoderFile);
        out.putString("decoder", ozen.decoderFile);
        out.putString("providers", ozen.providers);
        out.putBoolean("staged", ozen.isStaged());
    }

    private static void run(OzenRunner ozen, Bundle a, Bundle out) throws Exception {
        if (!ozen.isLoaded()) throw new IllegalStateException("no model loaded");
        byte[] features = a.getByteArray("features");
        String path = a.getString("featuresPath");
        if (features == null && path != null) features = readAll(new File(path));
        if (features == null) throw new IllegalArgumentException("features missing");
        long t0 = System.currentTimeMillis();
        int[] ids = ozen.run(features, a.getInt("maxTokens", 220));
        out.putIntArray("tokens", ids);
        out.putLong("ms", System.currentTimeMillis() - t0);
        out.putLong("encMs", ozen.lastEncMs);
        out.putLong("decMs", ozen.lastDecMs);
        out.putLong("sessionMs", ozen.lastSessionMs);
    }

    static byte[] readAll(File f) throws Exception {
        byte[] b = new byte[(int) f.length()];
        try (FileInputStream in = new FileInputStream(f)) {
            int off = 0, r;
            while (off < b.length && (r = in.read(b, off, b.length - off)) > 0) off += r;
        }
        return b;
    }
}
