package app.petkol.notes;

import android.content.Context;
import android.util.Log;

/** Thin Java wrapper around libpetkol_whisper.so (whisper.cpp). Not thread-safe: callers serialize. */
final class WhisperLib {
    private static final String TAG = "PetkolWhisper";

    private static boolean libLoaded = false;
    private static boolean backendOk = false;
    private static String loadError = null;

    private WhisperLib() {}

    /** Loads the native library and registers ggml backends. Safe to call repeatedly. */
    static synchronized boolean init(Context context) {
        if (libLoaded) return backendOk;
        try {
            System.loadLibrary("petkol_whisper");
            libLoaded = true;
            backendOk = nativeInit(context.getApplicationInfo().nativeLibraryDir);
            Log.i(TAG, "native library loaded, backend ok=" + backendOk);
        } catch (Throwable t) {
            loadError = t.toString();
            Log.e(TAG, "failed to load native library", t);
        }
        return backendOk;
    }

    static boolean isAvailable() {
        return libLoaded && backendOk;
    }

    static String systemInfo() {
        if (!libLoaded) return "native library not loaded: " + loadError;
        if (!backendOk) return "ggml CPU backend not available";
        return nativeSystemInfo();
    }

    static native boolean nativeInit(String nativeLibDir);
    static native String nativeSystemInfo();
    static native long nativeLoad(String path, boolean flashAttn);
    static native void nativeFree(long ctx);
    static native byte[] nativeTranscribe(long ctx, float[] audio, String language, String prompt, int threads);
}
