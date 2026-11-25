package app.petkol.notes;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.print.PdfPrintHelper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.provider.Settings;
import android.util.Base64;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(
        name = "PetkolNative",
        permissions = {
                @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO}),
                @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
        })
public class PetkolNativePlugin extends Plugin {
    private static final String TAG = "PetkolNative";

    /** All whisper work runs here, one call at a time. */
    private final ExecutorService whisperExec = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "petkol-whisper");
        t.setDaemon(true);
        return t;
    });
    /** All Ozen (ONNX Runtime) work runs here, one call at a time. */
    private final ExecutorService ozenExec = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "petkol-ozen");
        t.setDaemon(true);
        return t;
    });
    private final OzenRunner ozen = new OzenRunner();
    /** Misc. file I/O, independent of whisper so it never waits behind a transcription. */
    private final ExecutorService ioExec = Executors.newCachedThreadPool();
    private final Handler main = new Handler(Looper.getMainLooper());

    /** Default for ozenLoad's optional "xnnpack" flag: the CPU EP measured ~2x faster on Ozen. */
    private static final boolean OZEN_XNNPACK_DEFAULT = false;
    /** Default for ozenLoad's optional "lowMem" flag (no ORT arena, memory patterns or weight prepacking). */
    private static final boolean OZEN_LOWMEM_DEFAULT = true;

    // whisper state (written only on whisperExec)
    private volatile long whisperCtx = 0;
    private volatile String whisperPath = null;
    private volatile int whisperThreads = defaultThreads();

    // keep offscreen WebViews alive while printing
    private final List<WebView> printing = new ArrayList<>();

    @Override
    public void load() {
        // Background services -> JS events, and WebView keep-alive while they run. Cheap, no native libs.
        ServiceBus.setListener(this::onServiceEvent);
        ServiceBus.setKeepAliveChanged(() -> {
            if (getBridge() != null && getBridge().getWebView() instanceof PetkolWebView) {
                ((PetkolWebView) getBridge().getWebView()).refreshKeepAlive();
            }
        });
        // Native libraries (whisper.cpp, ONNX Runtime) load lazily, on the first dictation,
        // so the notes app always opens even if a speech engine cannot run on a device.
    }

    @Override
    protected void handleOnDestroy() {
        whisperExec.execute(this::freeWhisper);
        ozenExec.execute(() -> { ozen.close(); if (asr != null) asr.release(); });
        super.handleOnDestroy();
    }

    private static int defaultThreads() {
        return Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors()));
    }

    // ---------------------------------------------------------------- whisper

    @PluginMethod
    public void whisperLoad(final PluginCall call) {
        final String path = call.getString("path");
        final Integer threads = call.getInt("threads");
        if (path == null || path.isEmpty()) {
            call.reject("path is required", "BAD_ARGS");
            return;
        }
        whisperExec.execute(() -> {
            JSObject ret = new JSObject();
            try {
                if (!WhisperLib.init(getContext())) {
                    ret.put("ok", false);
                    ret.put("error", WhisperLib.systemInfo());
                    call.resolve(ret);
                    return;
                }
                whisperThreads = (threads != null && threads > 0) ? threads : defaultThreads();
                if (whisperCtx != 0 && path.equals(whisperPath)) {
                    ret.put("ok", true);
                    call.resolve(ret);
                    return;
                }
                freeWhisper();
                File f = new File(path);
                if (!f.isFile()) {
                    ret.put("ok", false);
                    ret.put("error", "file not found: " + path);
                    call.resolve(ret);
                    return;
                }
                long t0 = System.currentTimeMillis();
                long ctx = WhisperLib.nativeLoad(path, true);
                if (ctx == 0) {
                    ret.put("ok", false);
                    ret.put("error", "whisper failed to load model");
                } else {
                    whisperCtx = ctx;
                    whisperPath = path;
                    ret.put("ok", true);
                    Log.i(TAG, "model loaded in " + (System.currentTimeMillis() - t0) + " ms: " + path);
                }
                call.resolve(ret);
            } catch (Throwable t) {
                Log.e(TAG, "whisperLoad", t);
                ret.put("ok", false);
                ret.put("error", t.toString());
                call.resolve(ret);
            }
        });
    }

    @PluginMethod
    public void whisperTranscribe(final PluginCall call) {
        final String audio = call.getString("audio");
        final String language = call.getString("language", "he");
        final String prompt = call.getString("prompt", "");
        if (audio == null) {
            call.reject("audio is required", "BAD_ARGS");
            return;
        }
        whisperExec.execute(() -> {
            try {
                if (whisperCtx == 0) {
                    call.reject("no model loaded", "NOT_LOADED");
                    return;
                }
                byte[] bytes = Base64.decode(audio, Base64.DEFAULT);
                float[] samples = new float[bytes.length / 4];
                ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(samples);
                long t0 = System.currentTimeMillis();
                byte[] out = WhisperLib.nativeTranscribe(whisperCtx, samples, language, prompt, whisperThreads);
                long ms = System.currentTimeMillis() - t0;
                if (out == null) {
                    call.reject("transcription failed", "FAILED");
                    return;
                }
                String text = new String(out, StandardCharsets.UTF_8).trim();
                Log.i(TAG, "transcribed " + samples.length / 16 + " ms of audio in " + ms + " ms");
                JSObject ret = new JSObject();
                ret.put("text", text);
                ret.put("ms", ms);
                call.resolve(ret);
            } catch (Throwable t) {
                Log.e(TAG, "whisperTranscribe", t);
                call.reject(t.toString(), "FAILED");
            }
        });
    }

    @PluginMethod
    public void whisperUnload(final PluginCall call) {
        whisperExec.execute(() -> {
            freeWhisper();
            call.resolve();
        });
    }

    @PluginMethod
    public void whisperInfo(final PluginCall call) {
        whisperExec.execute(() -> {
            WhisperLib.init(getContext());
            JSObject ret = new JSObject();
            ret.put("loaded", whisperCtx != 0);
            if (whisperPath != null) ret.put("path", whisperPath);
            ret.put("system", WhisperLib.systemInfo());
            call.resolve(ret);
        });
    }

    private void freeWhisper() {
        long ctx = whisperCtx;
        whisperCtx = 0;
        whisperPath = null;
        if (ctx != 0) WhisperLib.nativeFree(ctx);
    }

    // ---------------------------------------------------------------- Ozen (ONNX Runtime)
    // Runs in the ":asr" process (AsrService) by default, so a low-memory kill takes down only
    // that process and the call rejects with ASR_DIED; process:false runs it in the app process.

    private AsrClient asr;              // only touched on ozenExec
    private boolean ozenInProcess = false;

    private AsrClient asr() {
        if (asr == null) asr = new AsrClient(getContext());
        return asr;
    }

    private static JSObject bundleToJs(android.os.Bundle b) {
        JSObject o = new JSObject();
        for (String k : b.keySet()) {
            Object v = b.get(k);
            if ("rssKB".equals(k)) { o.put("rssMB", ((Long) v) / 1024); continue; }
            if ("peakRssKB".equals(k)) { o.put("peakRssMB", ((Long) v) / 1024); continue; }
            if ("code".equals(k)) continue;
            if (v instanceof int[]) {
                JSArray a = new JSArray();
                for (int x : (int[]) v) a.put(x);
                o.put(k, a);
            } else {
                o.put(k, v);
            }
        }
        return o;
    }

    @PluginMethod
    public void ozenLoad(final PluginCall call) {
        final String dir = call.getString("dir");
        if (dir == null || dir.isEmpty()) {
            call.reject("dir is required", "BAD_ARGS");
            return;
        }
        final Integer threads = call.getInt("threads");
        final android.os.Bundle args = new android.os.Bundle();
        args.putString("dir", dir);
        args.putInt("threads", (threads != null && threads > 0) ? threads : defaultThreads());
        args.putBoolean("xnnpack", Boolean.TRUE.equals(call.getBoolean("xnnpack", OZEN_XNNPACK_DEFAULT)));
        args.putBoolean("lowMem", Boolean.TRUE.equals(call.getBoolean("lowMem", OZEN_LOWMEM_DEFAULT)));
        args.putString("memOpts", call.getString("memOpts"));
        args.putBoolean("staged", Boolean.TRUE.equals(call.getBoolean("staged", false)));
        args.putString("variant", call.getString("variant", "auto"));
        final boolean inProcess = Boolean.FALSE.equals(call.getBoolean("process", true));
        ozenExec.execute(() -> {
            long t0 = System.currentTimeMillis();
            android.os.Bundle out;
            try {
                // drop whatever is loaded (in either place) before loading again
                ozen.close();
                if (asr != null) asr.release();
                ozenInProcess = inProcess;
                if (inProcess) {
                    out = OzenOps.handle(ozen, OzenOps.LOAD, args);
                } else {
                    out = asr().call(OzenOps.LOAD, args);
                    asr().loaded = out.getBoolean("ok", false);
                }
            } catch (AsrClient.AsrDiedException e) {
                out = new android.os.Bundle();
                out.putBoolean("ok", false);
                out.putString("error", e.getMessage());
                out.putString("errorCode", "ASR_DIED");
            } catch (Throwable t) {
                Log.e(TAG, "ozenLoad", t);
                out = new android.os.Bundle();
                out.putBoolean("ok", false);
                out.putString("error", t.toString());
            }
            JSObject ret = bundleToJs(out);
            if (!ret.has("ok")) ret.put("ok", false);
            ret.put("ms", System.currentTimeMillis() - t0);
            ret.put("process", inProcess ? "app" : "asr");
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void ozenRun(final PluginCall call) {
        final String features = call.getString("features");
        final int maxTokens = call.getInt("maxTokens", 220);
        if (features == null) {
            call.reject("features is required", "BAD_ARGS");
            return;
        }
        ozenExec.execute(() -> {
            try {
                byte[] bytes = Base64.decode(features, Base64.DEFAULT);
                android.os.Bundle args = new android.os.Bundle();
                args.putInt("maxTokens", maxTokens);
                android.os.Bundle out;
                long t0 = System.currentTimeMillis();
                if (ozenInProcess) {
                    if (!ozen.isLoaded()) { call.reject("no model loaded", "NOT_LOADED"); return; }
                    args.putByteArray("features", bytes);
                    out = OzenOps.handle(ozen, OzenOps.RUN, args);
                } else {
                    if (asr == null || !asr.loaded) { call.reject("no model loaded", "NOT_LOADED"); return; }
                    // ~1 MB: passed as a file, binder transactions are limited to 1 MB
                    File f = new File(getContext().getCacheDir(), "asr-features.bin");
                    try (java.io.FileOutputStream fos = new java.io.FileOutputStream(f)) { fos.write(bytes); }
                    args.putString("featuresPath", f.getAbsolutePath());
                    out = asr.call(OzenOps.RUN, args);
                }
                String code = out.getString("code");
                if (code != null) {
                    call.reject(out.getString("error", "failed"), code);
                    return;
                }
                JSObject ret = bundleToJs(out);
                ret.put("roundTripMs", System.currentTimeMillis() - t0);
                call.resolve(ret);
            } catch (AsrClient.AsrDiedException e) {
                Log.w(TAG, "ozenRun: " + e.getMessage());
                call.reject(e.getMessage(), "ASR_DIED");
            } catch (Throwable t) {
                Log.e(TAG, "ozenRun", t);
                call.reject(t.toString(), "FAILED");
            }
        });
    }

    @PluginMethod
    public void ozenUnload(final PluginCall call) {
        ozenExec.execute(() -> {
            ozen.close();
            if (asr != null) asr.release(); // the ":asr" process exits and frees everything
            call.resolve();
        });
    }

    // ---------------------------------------------------------------- why did the app die last time

    private static String exitReason(int r) {
        switch (r) {
            case 3: return "low_memory";               // REASON_LOW_MEMORY
            case 4: return "crash";                    // REASON_CRASH
            case 5: return "crash_native";             // REASON_CRASH_NATIVE
            case 6: return "anr";                      // REASON_ANR
            case 2: return "signaled";                 // REASON_SIGNALED
            case 1: return "exit_self";                // REASON_EXIT_SELF
            case 10: return "user_requested";          // REASON_USER_REQUESTED
            case 11: return "user_stopped";            // REASON_USER_STOPPED
            case 9: return "excessive_resource_usage"; // REASON_EXCESSIVE_RESOURCE_USAGE
            case 12: return "dependency_died";         // REASON_DEPENDENCY_DIED
            case 14: return "freezer";                 // REASON_FREEZER (API 33+)
            case 8: return "permission_change";        // REASON_PERMISSION_CHANGE
            case 7: return "initialization_failure";   // REASON_INITIALIZATION_FAILURE
            case 13: return "other";                   // REASON_OTHER
            case 15: return "package_state_change";    // REASON_PACKAGE_STATE_CHANGE (API 33+)
            case 16: return "package_updated";         // REASON_PACKAGE_UPDATED (API 33+)
            default: return "unknown";                 // REASON_UNKNOWN (0) and anything newer
        }
    }

    @PluginMethod
    public void lastExit(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT < 30) {
            ret.put("reason", "unknown");
            ret.put("isNew", false);
            call.resolve(ret);
            return;
        }
        try {
            ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            // Newest first. Skip WebView renderer (isolated/sandboxed) processes, which are also
            // listed under our package: only the app process and ":asr" matter.
            String pkg = getContext().getPackageName();
            List<android.app.ApplicationExitInfo> list = new ArrayList<>();
            for (android.app.ApplicationExitInfo x : am.getHistoricalProcessExitReasons(pkg, 0, 16)) {
                String pn = x.getProcessName();
                if (pn != null && (pn.equals(pkg) || pn.startsWith(pkg + ":"))) { list.add(x); break; }
            }
            android.content.SharedPreferences prefs =
                    getContext().getSharedPreferences("petkol_native", Context.MODE_PRIVATE);
            long lastSeen = prefs.getLong("lastExitSeen", 0);
            if (list == null || list.isEmpty()) {
                ret.put("reason", "unknown");
                ret.put("isNew", false);
            } else {
                android.app.ApplicationExitInfo e = list.get(0);
                ret.put("reason", exitReason(e.getReason()));
                if (e.getDescription() != null) ret.put("description", e.getDescription());
                ret.put("timestamp", e.getTimestamp());
                ret.put("pssMB", e.getPss() / 1024);
                ret.put("rssMB", e.getRss() / 1024);
                ret.put("status", e.getStatus());
                ret.put("processName", e.getProcessName());
                ret.put("importance", e.getImportance());
                boolean isNew = e.getTimestamp() > lastSeen;
                ret.put("isNew", isNew);
                if (isNew) prefs.edit().putLong("lastExitSeen", e.getTimestamp()).apply();
            }
        } catch (Throwable t) {
            Log.w(TAG, "lastExit", t);
            ret.put("reason", "unknown");
            ret.put("isNew", false);
            ret.put("description", t.toString());
        }
        call.resolve(ret);
    }

    // ---------------------------------------------------------------- background recording

    private final List<PluginCall> pendingRecStops = new ArrayList<>();

    @PluginMethod
    public void recStart(final PluginCall call) {
        if (call.getString("dir") == null) {
            call.reject("dir is required", "BAD_ARGS");
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "recPermissionCallback");
            return;
        }
        doRecStart(call);
    }

    @PermissionCallback
    private void recPermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) doRecStart(call);
        else call.reject("microphone permission denied", "NO_PERMISSION");
    }

    private void doRecStart(final PluginCall call) {
        if (RecService.isRecording()) {
            call.reject("already recording", "ALREADY_RECORDING");
            return;
        }
        final String dir = call.getString("dir");
        final double chunkSec = call.getDouble("chunkSec", 28.0);
        final double minChunkSec = call.getDouble("minChunkSec", 12.0);
        final boolean[] done = {false};
        final Runnable timeout = () -> {
            if (done[0]) return;
            done[0] = true;
            ServiceBus.recStartResult = null;
            call.reject("recording service did not start", "FAILED");
        };
        ServiceBus.recStartResult = (err) -> main.post(() -> {
            if (done[0]) return;
            done[0] = true;
            main.removeCallbacks(timeout);
            if (err == null) {
                JSObject ret = new JSObject();
                ret.put("ok", true);
                call.resolve(ret);
            } else if ("ALREADY_RECORDING".equals(err)) {
                call.reject("already recording", "ALREADY_RECORDING");
            } else {
                call.reject(err, "FAILED");
            }
        });
        try {
            androidx.core.content.ContextCompat.startForegroundService(getContext(),
                    RecService.startIntent(getContext(), dir, chunkSec, minChunkSec));
            main.postDelayed(timeout, 8000);
        } catch (Throwable t) {
            done[0] = true;
            ServiceBus.recStartResult = null;
            Log.e(TAG, "recStart", t);
            call.reject("cannot start recording service: " + t, fgsErrorCode(t));
        }
    }

    @PluginMethod
    public void recStop(final PluginCall call) {
        if (!RecService.isRecording()) {
            JSObject st = RecService.status();
            JSObject ret = new JSObject();
            ret.put("files", st.opt("files"));
            ret.put("seconds", st.opt("seconds"));
            call.resolve(ret);
            return;
        }
        synchronized (pendingRecStops) { pendingRecStops.add(call); }
        try {
            getContext().startService(RecService.stopIntent(getContext()));
        } catch (Throwable t) {
            synchronized (pendingRecStops) { pendingRecStops.remove(call); }
            call.reject("cannot stop recording: " + t, "FAILED");
        }
    }

    /** Android 12+ refuses to start foreground services while the app is in the background. */
    private static String fgsErrorCode(Throwable t) {
        return t.getClass().getName().contains("ForegroundServiceStartNotAllowed") ? "IN_BACKGROUND" : "FAILED";
    }

    @PluginMethod
    public void recStatus(PluginCall call) {
        call.resolve(RecService.status());
    }

    /** Called (main thread) for every service event before it goes to JS listeners. */
    private void onServiceEvent(String name, JSObject data) {
        if ("recStopped".equals(name)) {
            List<PluginCall> calls;
            synchronized (pendingRecStops) {
                calls = new ArrayList<>(pendingRecStops);
                pendingRecStops.clear();
            }
            for (PluginCall c : calls) {
                JSObject ret = new JSObject();
                ret.put("files", data.opt("files"));
                ret.put("seconds", data.opt("seconds"));
                c.resolve(ret);
            }
        }
        notifyListeners(name, data);
    }

    // ---------------------------------------------------------------- background work keep-alive

    @PluginMethod
    public void workStart(PluginCall call) {
        try {
            WorkService.start(getContext(), call.getString("title", "פתקול"), call.getString("text"));
            call.resolve();
        } catch (Throwable t) {
            Log.e(TAG, "workStart", t);
            call.reject("cannot start work service: " + t, fgsErrorCode(t));
        }
    }

    @PluginMethod
    public void workUpdate(PluginCall call) {
        WorkService.update(getContext(), call.getString("text"), call.getInt("progress"), call.getInt("max"));
        call.resolve();
    }

    @PluginMethod
    public void workStop(PluginCall call) {
        try {
            if (WorkService.isRunning()) WorkService.stop(getContext());
        } catch (Throwable t) {
            Log.w(TAG, "workStop", t);
        }
        call.resolve();
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(ret);
    }

    private boolean ignoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < 23) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        JSObject ret = new JSObject();
        boolean ignoring = ignoringBatteryOptimizations();
        ret.put("ignoring", ignoring);
        boolean opened = false;
        if (!ignoring) {
            try {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(i);
                opened = true;
            } catch (Exception e) {
                try {
                    getActivity().startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                    opened = true;
                } catch (Exception ignored) {}
            }
        }
        ret.put("opened", opened);
        call.resolve(ret);
    }

    // ---------------------------------------------------------------- PDF

    @SuppressLint("SetJavaScriptEnabled")
    @PluginMethod
    public void htmlToPdf(final PluginCall call) {
        final String html = call.getString("html");
        String name = call.getString("fileName", "document.pdf");
        if (html == null) {
            call.reject("html is required", "BAD_ARGS");
            return;
        }
        name = name.replaceAll("[\\\\/:*?\"<>|\\u0000-\\u001f]", "_").trim();
        if (name.isEmpty()) name = "document.pdf";
        if (!name.toLowerCase(Locale.ROOT).endsWith(".pdf")) name += ".pdf";
        final File out = new File(getContext().getCacheDir(), name);

        main.post(() -> {
            final WebView wv = new WebView(getContext());
            printing.add(wv);
            final boolean[] done = {false};
            final Runnable[] timeout = new Runnable[1];

            final PdfPrintHelper.Callback cb = new PdfPrintHelper.Callback() {
                @Override
                public void onSuccess(File file) {
                    finish();
                    JSObject ret = new JSObject();
                    ret.put("path", file.getAbsolutePath());
                    call.resolve(ret);
                }

                @Override
                public void onFailure(String message) {
                    finish();
                    call.reject(message, "PDF_FAILED");
                }

                private void finish() {
                    done[0] = true;
                    main.removeCallbacks(timeout[0]);
                    printing.remove(wv);
                    main.post(wv::destroy);
                }
            };
            timeout[0] = () -> { if (!done[0]) cb.onFailure("timeout"); };
            main.postDelayed(timeout[0], 60_000);

            WebSettings s = wv.getSettings();
            s.setJavaScriptEnabled(true);
            s.setAllowFileAccess(true);
            s.setBlockNetworkLoads(true);
            s.setTextZoom(100);
            wv.setWebViewClient(new WebViewClient() {
                private boolean started = false;

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return true; // never navigate away
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    if (started || done[0]) return;
                    started = true;
                    // small grace period for fonts/images to settle
                    main.postDelayed(() -> {
                        if (done[0]) return;
                        try {
                            PrintDocumentAdapter adapter = wv.createPrintDocumentAdapter("petkol");
                            PrintAttributes attrs = new PrintAttributes.Builder()
                                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                    .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                                    .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                    .build();
                            PdfPrintHelper.print(adapter, attrs, out, cb);
                        } catch (Throwable t) {
                            Log.e(TAG, "htmlToPdf", t);
                            cb.onFailure(t.toString());
                        }
                    }, 400);
                }
            });
            // A4 at 96 dpi, so the page lays out at print width even offscreen
            int w = 794, h = 1123;
            wv.measure(android.view.View.MeasureSpec.makeMeasureSpec(w, android.view.View.MeasureSpec.EXACTLY),
                    android.view.View.MeasureSpec.makeMeasureSpec(h, android.view.View.MeasureSpec.EXACTLY));
            wv.layout(0, 0, w, h);
            wv.loadDataWithBaseURL("file:///android_asset/public/", html, "text/html", "UTF-8", null);
        });
    }

    // ---------------------------------------------------------------- APK install

    private boolean canInstall() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return getContext().getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    @PluginMethod
    public void canInstallApks(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", canInstall());
        call.resolve(ret);
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String path = call.getString("path");
        if (path == null) {
            call.reject("path is required", "BAD_ARGS");
            return;
        }
        File apk = new File(path);
        if (!apk.isFile()) {
            call.reject("file not found: " + path, "NOT_FOUND");
            return;
        }
        Activity activity = getActivity();
        if (!canInstall()) {
            try {
                Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                activity.startActivity(i);
            } catch (Exception e) {
                Log.w(TAG, "cannot open unknown-sources settings", e);
            }
            call.reject("install permission missing", "NO_PERMISSION");
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", apk);
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(i);
            call.resolve();
        } catch (IllegalArgumentException e) {
            call.reject("file is outside the FileProvider paths: " + e.getMessage(), "BAD_PATH");
        } catch (ActivityNotFoundException e) {
            call.reject("no installer available", "FAILED");
        }
    }

    // ---------------------------------------------------------------- device / fonts / files

    @PluginMethod
    public void deviceInfo(PluginCall call) {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(mi);
        JSObject ret = new JSObject();
        ret.put("totalRamMB", mi.totalMem / (1024 * 1024));
        ret.put("availRamMB", mi.availMem / (1024 * 1024));
        ret.put("cores", Runtime.getRuntime().availableProcessors());
        ret.put("abi", Build.SUPPORTED_ABIS.length > 0 ? Build.SUPPORTED_ABIS[0] : "");
        ret.put("manufacturer", Build.MANUFACTURER);
        ret.put("model", Build.MODEL);
        ret.put("sdk", Build.VERSION.SDK_INT);
        ret.put("lowRam", am.isLowRamDevice());
        ret.put("memClassMB", am.getMemoryClass());
        ret.put("largeMemClassMB", am.getLargeMemoryClass());
        long[] rss = procRssKB();
        ret.put("appRssMB", rss[0] / 1024);
        ret.put("appPeakRssMB", rss[1] / 1024);
        ret.put("ignoringBatteryOptimizations", ignoringBatteryOptimizations());
        try {
            android.content.pm.PackageInfo wv = Build.VERSION.SDK_INT >= 26 ? WebView.getCurrentWebViewPackage() : null;
            if (wv != null) ret.put("webView", wv.packageName + " " + wv.versionName);
        } catch (Throwable ignored) {}
        call.resolve(ret);
    }

    /** {VmRSS, VmHWM} of this process in kB (native + Java + mapped model pages). */
    static long[] procRssKB() {
        long[] r = {0, 0};
        try (java.io.BufferedReader br = new java.io.BufferedReader(new java.io.FileReader("/proc/self/status"))) {
            String line;
            while ((line = br.readLine()) != null) {
                if (line.startsWith("VmRSS:")) r[0] = Long.parseLong(line.replaceAll("[^0-9]", ""));
                else if (line.startsWith("VmHWM:")) r[1] = Long.parseLong(line.replaceAll("[^0-9]", ""));
            }
        } catch (Exception ignored) {}
        return r;
    }

    @PluginMethod
    public void listSystemFonts(PluginCall call) {
        Map<String, String> found = new LinkedHashMap<>();
        for (String dir : new String[]{"/system/fonts", "/product/fonts"}) {
            File[] files = new File(dir).listFiles();
            if (files == null) continue;
            Arrays.sort(files);
            for (File f : files) {
                String n = f.getName();
                String lower = n.toLowerCase(Locale.ROOT);
                if (!f.isFile() || !(lower.endsWith(".ttf") || lower.endsWith(".otf"))) continue;
                String name = n.substring(0, n.length() - 4);
                if (!found.containsKey(name)) found.put(name, f.getAbsolutePath());
            }
        }
        JSArray fonts = new JSArray();
        for (Map.Entry<String, String> e : found.entrySet()) {
            JSObject o = new JSObject();
            o.put("name", e.getKey());
            o.put("file", e.getValue());
            fonts.put(o);
        }
        JSObject ret = new JSObject();
        ret.put("fonts", fonts);
        call.resolve(ret);
    }

    @PluginMethod
    public void readFileBase64(final PluginCall call) {
        final String path = call.getString("path");
        if (path == null) {
            call.reject("path is required", "BAD_ARGS");
            return;
        }
        ioExec.execute(() -> {
            try (InputStream in = new FileInputStream(path)) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[64 * 1024];
                int r;
                while ((r = in.read(buf)) > 0) bos.write(buf, 0, r);
                JSObject ret = new JSObject();
                ret.put("data", Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP));
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.toString(), "READ_FAILED");
            }
        });
    }

    @PluginMethod
    public void keepScreenOn(final PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", true));
        final Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }
}
