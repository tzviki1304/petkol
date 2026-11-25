package app.petkol.notes;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/** Notification channels, builders and wake locks shared by the background services. */
final class Notifs {
    static final String CH_REC = "petkol_rec";
    static final String CH_WORK = "petkol_work";
    static final int ID_REC = 7101;
    static final int ID_WORK = 7102;

    private Notifs() {}

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_REC) == null) {
            NotificationChannel c = new NotificationChannel(CH_REC, "הקלטה", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("מוצג בזמן שפתקול מקליט");
            c.setShowBadge(false);
            c.setSound(null, null);
            nm.createNotificationChannel(c);
        }
        if (nm.getNotificationChannel(CH_WORK) == null) {
            NotificationChannel c = new NotificationChannel(CH_WORK, "תמלול ברקע", NotificationManager.IMPORTANCE_LOW);
            c.setDescription("מוצג בזמן שפתקול מתמלל ברקע");
            c.setShowBadge(false);
            c.setSound(null, null);
            nm.createNotificationChannel(c);
        }
    }

    static PendingIntent openApp(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class)
                .setAction(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static NotificationCompat.Builder base(Context ctx, String channel) {
        ensureChannels(ctx);
        return new NotificationCompat.Builder(ctx, channel)
                .setSmallIcon(R.drawable.ic_stat_petkol)
                .setContentIntent(openApp(ctx))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setShowWhen(false)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
    }

    /** startForeground with the right type for each API level. */
    static void startForeground(Service s, int id, Notification n, boolean microphone) {
        if (Build.VERSION.SDK_INT >= 34) {
            s.startForeground(id, n, microphone ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                    : ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else if (Build.VERSION.SDK_INT >= 30 && microphone) {
            s.startForeground(id, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
        } else {
            s.startForeground(id, n);
        }
    }

    static PowerManager.WakeLock wakeLock(Context ctx, String tag) {
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "petkol:" + tag);
            wl.setReferenceCounted(false);
            wl.acquire(6L * 60 * 60 * 1000); // safety cap: 6 h
            return wl;
        } catch (Exception e) {
            Log.w("PetkolNative", "wake lock failed", e);
            return null;
        }
    }

    static void release(PowerManager.WakeLock wl) {
        try { if (wl != null && wl.isHeld()) wl.release(); } catch (Exception ignored) {}
    }
}
