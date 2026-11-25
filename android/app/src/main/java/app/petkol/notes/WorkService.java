package app.petkol.notes;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * Keep-alive foreground service for slow background work done in JS (transcription):
 * holds a partial wake lock and shows an ongoing notification with optional progress.
 */
public class WorkService extends Service {
    private static final String TAG = "PetkolWork";
    static final String ACTION_START = "app.petkol.notes.WORK_START";
    static final String ACTION_STOP = "app.petkol.notes.WORK_STOP";

    private static volatile boolean running = false;
    private static volatile String title = "פתקול";
    private static volatile String text = null;
    private static volatile int progress = -1, max = 0;
    private PowerManager.WakeLock wakeLock;

    static boolean isRunning() { return running; }

    static void start(Context ctx, String t, String tx) {
        title = t != null ? t : "פתקול";
        text = tx;
        progress = -1;
        max = 0;
        Intent i = new Intent(ctx, WorkService.class).setAction(ACTION_START);
        androidx.core.content.ContextCompat.startForegroundService(ctx, i);
    }

    /** Updates the notification; null arguments keep their previous value. */
    static void update(Context ctx, String tx, Integer p, Integer m) {
        if (tx != null) text = tx;
        if (p != null) progress = p;
        if (m != null) max = m;
        if (!running) return;
        try {
            ctx.getSystemService(NotificationManager.class).notify(Notifs.ID_WORK, build(ctx));
        } catch (Exception e) {
            Log.w(TAG, "notify failed", e);
        }
    }

    static void stop(Context ctx) {
        ctx.startService(new Intent(ctx, WorkService.class).setAction(ACTION_STOP));
    }

    static Notification build(Context ctx) {
        NotificationCompat.Builder b = Notifs.base(ctx, Notifs.CH_WORK).setContentTitle(title);
        if (text != null && !text.isEmpty()) b.setContentText(text);
        if (max > 0 && progress >= 0) b.setProgress(max, Math.min(progress, max), false);
        else if (progress == -2) b.setProgress(0, 0, true);
        return b.build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_START.equals(action)) {
            try {
                Notifs.startForeground(this, Notifs.ID_WORK, build(this), false);
            } catch (Throwable t) {
                Log.e(TAG, "startForeground failed", t);
                stopSelf();
                return START_NOT_STICKY;
            }
            running = true;
            if (wakeLock == null) wakeLock = Notifs.wakeLock(this, "work");
            ServiceBus.setWorkActive(true);
        } else {
            // ACTION_STOP, or a system restart with no work: stop
            shutdown();
        }
        return START_NOT_STICKY;
    }

    private void shutdown() {
        running = false;
        ServiceBus.setWorkActive(false);
        Notifs.release(wakeLock);
        wakeLock = null;
        try { stopForeground(STOP_FOREGROUND_REMOVE); } catch (Throwable ignored) {}
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        ServiceBus.setWorkActive(false);
        Notifs.release(wakeLock);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
