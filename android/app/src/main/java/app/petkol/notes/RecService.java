package app.petkol.notes;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

/** Foreground service (type microphone) that owns the Recorder, so recording survives screen-off/background. */
public class RecService extends Service {
    private static final String TAG = "PetkolRec";
    static final String ACTION_START = "app.petkol.notes.REC_START";
    static final String ACTION_STOP = "app.petkol.notes.REC_STOP";

    private static volatile Recorder recorder;
    private static volatile List<String> lastFiles = new ArrayList<>();
    private static volatile double lastSeconds = 0;
    private static volatile String lastDir = null;
    private PowerManager.WakeLock wakeLock;
    private boolean stopping = false;

    static boolean isRecording() { return recorder != null; }

    static JSObject status() {
        Recorder r = recorder;
        JSObject o = new JSObject();
        o.put("recording", r != null);
        o.put("seconds", Math.round((r != null ? r.seconds() : lastSeconds) * 10) / 10.0);
        String dir = r != null ? r.dir.getAbsolutePath() : lastDir;
        if (dir != null) o.put("dir", dir);
        o.put("files", Recorder.toArray(r != null ? r.files() : lastFiles));
        return o;
    }

    static Intent startIntent(Context ctx, String dir, double chunkSec, double minChunkSec) {
        return new Intent(ctx, RecService.class).setAction(ACTION_START)
                .putExtra("dir", dir).putExtra("chunkSec", chunkSec).putExtra("minChunkSec", minChunkSec);
    }

    static Intent stopIntent(Context ctx) {
        return new Intent(ctx, RecService.class).setAction(ACTION_STOP);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_START.equals(action)) {
            try {
                Notifs.startForeground(this, Notifs.ID_REC, buildNotification(), true);
            } catch (Throwable t) {
                Log.e(TAG, "startForeground failed", t);
                ServiceBus.reportRecStart("cannot start foreground service: " + t);
                stopSelf();
                return START_NOT_STICKY;
            }
            if (recorder != null) {
                ServiceBus.reportRecStart("ALREADY_RECORDING");
                return START_NOT_STICKY;
            }
            try {
                Recorder r = new Recorder(new File(intent.getStringExtra("dir")),
                        intent.getDoubleExtra("chunkSec", 28), intent.getDoubleExtra("minChunkSec", 12));
                r.start();
                recorder = r;
                stopping = false;
                wakeLock = Notifs.wakeLock(this, "rec");
                ServiceBus.setRecActive(true);
                ServiceBus.reportRecStart(null);
                Log.i(TAG, "recording to " + r.dir);
            } catch (Throwable t) {
                Log.e(TAG, "recorder start failed", t);
                ServiceBus.reportRecStart(t.getMessage() != null ? t.getMessage() : t.toString());
                shutdown();
            }
        } else if (ACTION_STOP.equals(action)) {
            stopRecording();
        } else {
            // restarted by the system without a recording session: nothing to do
            if (recorder == null) shutdown();
        }
        return START_NOT_STICKY;
    }

    private void stopRecording() {
        final Recorder r = recorder;
        if (r == null) {
            shutdown();
            return;
        }
        if (stopping) return;
        stopping = true;
        new Thread(() -> {
            List<String> files = r.stop();
            lastFiles = files;
            lastSeconds = r.seconds();
            lastDir = r.dir.getAbsolutePath();
            recorder = null;
            JSObject ev = new JSObject();
            ev.put("files", Recorder.toArray(files));
            ev.put("seconds", Math.round(lastSeconds * 10) / 10.0);
            if (r.error() != null) ev.put("error", r.error());
            ServiceBus.emit("recStopped", ev);
            Log.i(TAG, "stopped: " + files.size() + " chunks, " + lastSeconds + " s");
            new android.os.Handler(getMainLooper()).post(this::shutdown);
        }, "petkol-rec-stop").start();
    }

    private void shutdown() {
        ServiceBus.setRecActive(false);
        Notifs.release(wakeLock);
        wakeLock = null;
        try { stopForeground(STOP_FOREGROUND_REMOVE); } catch (Throwable ignored) {}
        stopSelf();
    }

    private Notification buildNotification() {
        PendingIntent stop = PendingIntent.getService(this, 1, stopIntent(this),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return Notifs.base(this, Notifs.CH_REC)
                .setContentTitle("פתקול מקליט…")
                .setUsesChronometer(true)
                .setShowWhen(true)
                .setWhen(System.currentTimeMillis())
                .addAction(new NotificationCompat.Action(0, "עצירה", stop))
                .build();
    }

    @Override
    public void onDestroy() {
        // Service killed while recording (e.g. app removed): finish the files we have.
        final Recorder r = recorder;
        if (r != null && !stopping) {
            recorder = null;
            lastFiles = r.stop();
            lastSeconds = r.seconds();
            lastDir = r.dir.getAbsolutePath();
            JSObject ev = new JSObject();
            ev.put("files", Recorder.toArray(lastFiles));
            ev.put("seconds", Math.round(lastSeconds * 10) / 10.0);
            ServiceBus.emit("recStopped", ev);
        }
        ServiceBus.setRecActive(false);
        Notifs.release(wakeLock);
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
