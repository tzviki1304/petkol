package app.petkol.notes;

import android.content.Context;
import android.os.Build;
import android.util.AttributeSet;

import com.getcapacitor.CapacitorWebView;

/**
 * Capacitor's WebView, except that while recording or background work runs (ServiceBus.keepAlive)
 * it keeps reporting itself as visible: Chromium then does not treat the page as hidden
 * (no background timer throttling) and the renderer process keeps its important binding,
 * so the JS transcription loop keeps running with the screen off or another app in front.
 */
public class PetkolWebView extends CapacitorWebView {
    private int realVisibility = VISIBLE;

    public PetkolWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        realVisibility = visibility;
        super.onWindowVisibilityChanged(ServiceBus.keepAlive() ? VISIBLE : visibility);
    }

    /** Re-applies visibility and renderer priority after ServiceBus.keepAlive() changed. Main thread. */
    void refreshKeepAlive() {
        boolean keep = ServiceBus.keepAlive();
        super.onWindowVisibilityChanged(keep ? VISIBLE : realVisibility);
        if (Build.VERSION.SDK_INT >= 26) {
            // waivedWhenNotVisible=false: renderer stays important even when not visible
            setRendererPriorityPolicy(RENDERER_PRIORITY_IMPORTANT, !keep);
        }
    }
}
