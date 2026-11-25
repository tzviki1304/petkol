package app.petkol.notes;

import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;

import java.util.function.Consumer;

/** Glue between the background services and the Capacitor plugin (which may not exist while a service runs). */
final class ServiceBus {
    interface Listener {
        void onEvent(String name, JSObject data);
    }

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static volatile Listener listener;
    private static volatile Runnable keepAliveChanged;
    private static volatile boolean recActive, workActive;

    /** One-shot callback for the pending recStart call: null = ok, else error message. */
    static volatile Consumer<String> recStartResult;

    private ServiceBus() {}

    static void setListener(Listener l) { listener = l; }
    static void setKeepAliveChanged(Runnable r) { keepAliveChanged = r; }

    static void emit(String name, JSObject data) {
        final Listener l = listener;
        if (l != null) MAIN.post(() -> l.onEvent(name, data));
    }

    static void reportRecStart(String error) {
        Consumer<String> c = recStartResult;
        recStartResult = null;
        if (c != null) c.accept(error);
    }

    /** True while recording or background work runs: the WebView must keep executing JS. */
    static boolean keepAlive() { return recActive || workActive; }

    static void setRecActive(boolean on) { recActive = on; fireKeepAlive(); }
    static void setWorkActive(boolean on) { workActive = on; fireKeepAlive(); }

    private static void fireKeepAlive() {
        final Runnable r = keepAliveChanged;
        if (r != null) MAIN.post(r);
    }
}
