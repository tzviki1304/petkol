package app.petkol.notes;

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
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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

@CapacitorPlugin(name = "PetkolNative")
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

    // whisper state (written only on whisperExec)
    private volatile long whisperCtx = 0;
    private volatile String whisperPath = null;
    private volatile int whisperThreads = defaultThreads();

    // keep offscreen WebViews alive while printing
    private final List<WebView> printing = new ArrayList<>();

    @Override
    public void load() {
        whisperExec.execute(() -> WhisperLib.init(getContext()));
    }

    @Override
    protected void handleOnDestroy() {
        whisperExec.execute(this::freeWhisper);
        ozenExec.execute(ozen::close);
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

    @PluginMethod
    public void ozenLoad(final PluginCall call) {
        final String dir = call.getString("dir");
        final Integer threads = call.getInt("threads");
        final boolean xnnpack = Boolean.TRUE.equals(call.getBoolean("xnnpack", OZEN_XNNPACK_DEFAULT));
        if (dir == null || dir.isEmpty()) {
            call.reject("dir is required", "BAD_ARGS");
            return;
        }
        ozenExec.execute(() -> {
            JSObject ret = new JSObject();
            long t0 = System.currentTimeMillis();
            try {
                int n = (threads != null && threads > 0) ? threads : defaultThreads();
                ozen.load(dir, n, xnnpack);
                ret.put("ok", true);
                ret.put("encoder", ozen.encoderFile);
                ret.put("providers", ozen.providers);
            } catch (Throwable t) {
                Log.e(TAG, "ozenLoad", t);
                ozen.close();
                ret.put("ok", false);
                ret.put("error", t.toString());
            }
            ret.put("ms", System.currentTimeMillis() - t0);
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
                if (!ozen.isLoaded()) {
                    call.reject("no model loaded", "NOT_LOADED");
                    return;
                }
                byte[] bytes = Base64.decode(features, Base64.DEFAULT);
                long t0 = System.currentTimeMillis();
                int[] ids = ozen.run(bytes, maxTokens);
                long ms = System.currentTimeMillis() - t0;
                JSArray tokens = new JSArray();
                for (int id : ids) tokens.put(id);
                JSObject ret = new JSObject();
                ret.put("tokens", tokens);
                ret.put("ms", ms);
                call.resolve(ret);
            } catch (IllegalArgumentException e) {
                call.reject(e.getMessage(), "BAD_ARGS");
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
            call.resolve();
        });
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
        call.resolve(ret);
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
