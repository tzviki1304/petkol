package app.petkol.notes;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Message;
import android.os.Messenger;
import android.util.Log;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Blocking client for AsrService (the ":asr" process). Call only from one background thread
 * (the plugin's ozen executor). If the process dies, the pending call throws AsrDiedException
 * and the next call starts a fresh process (the model must be loaded again).
 */
final class AsrClient {
    private static final String TAG = "PetkolAsr";

    static final class AsrDiedException extends Exception {
        AsrDiedException(String m) { super(m); }
    }

    private final Context ctx;
    private final Messenger replyTo;
    private final Object lock = new Object();
    private Messenger service;
    private IBinder binder;
    private boolean bound;
    private CountDownLatch connectLatch;
    private CountDownLatch replyLatch;
    private Bundle reply;
    private int requestId = 0;
    private boolean died;
    /** True once a model was loaded in the current process instance. */
    volatile boolean loaded;

    private final IBinder.DeathRecipient death = () -> {
        Log.w(TAG, "asr process died");
        onDied();
    };

    private final ServiceConnection conn = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder b) {
            synchronized (lock) {
                binder = b;
                service = new Messenger(b);
                try { b.linkToDeath(death, 0); } catch (Exception e) { Log.w(TAG, "linkToDeath", e); }
                if (connectLatch != null) connectLatch.countDown();
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) { onDied(); }

        @Override
        public void onBindingDied(ComponentName name) { onDied(); }

        @Override
        public void onNullBinding(ComponentName name) { onDied(); }
    };

    AsrClient(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        HandlerThread t = new HandlerThread("asr-replies");
        t.start();
        replyTo = new Messenger(new Handler(t.getLooper(), m -> {
            synchronized (lock) {
                if (m.arg1 == requestId && replyLatch != null) {
                    reply = m.getData();
                    replyLatch.countDown();
                }
            }
            return true;
        }));
    }

    private void onDied() {
        synchronized (lock) {
            died = true;
            loaded = false;
            service = null;
            binder = null;
            if (bound) {
                try { ctx.unbindService(conn); } catch (Exception ignored) {}
                bound = false;
            }
            if (replyLatch != null) replyLatch.countDown();
            if (connectLatch != null) connectLatch.countDown();
        }
    }

    private Messenger ensureConnected() throws Exception {
        CountDownLatch latch;
        synchronized (lock) {
            if (service != null && binder != null && binder.isBinderAlive()) return service;
            if (bound) {
                try { ctx.unbindService(conn); } catch (Exception ignored) {}
                bound = false;
            }
            died = false;
            connectLatch = latch = new CountDownLatch(1);
            bound = ctx.bindService(new Intent(ctx, AsrService.class), conn, Context.BIND_AUTO_CREATE);
            if (!bound) throw new Exception("cannot bind ASR service");
        }
        if (!latch.await(20, TimeUnit.SECONDS)) throw new Exception("ASR service did not start");
        synchronized (lock) {
            if (service == null) throw new AsrDiedException("ASR process died while starting");
            return service;
        }
    }

    /** Sends an op and waits for its reply (no timeout: a run can take minutes on slow devices). */
    Bundle call(int what, Bundle args) throws Exception {
        Messenger s = ensureConnected();
        CountDownLatch latch;
        int id;
        synchronized (lock) {
            id = ++requestId;
            reply = null;
            replyLatch = latch = new CountDownLatch(1);
        }
        Message m = Message.obtain(null, what);
        m.arg1 = id;
        m.setData(args);
        m.replyTo = replyTo;
        try {
            s.send(m);
        } catch (Exception e) {
            onDied();
            throw new AsrDiedException("ASR process is gone: " + e);
        }
        latch.await();
        synchronized (lock) {
            replyLatch = null;
            if (reply == null || died) throw new AsrDiedException("ASR process was killed (probably low memory)");
            return reply;
        }
    }

    /** Unbinds: the ":asr" process exits and returns all its memory. */
    void release() {
        synchronized (lock) {
            loaded = false;
            if (binder != null) {
                try { binder.unlinkToDeath(death, 0); } catch (Exception ignored) {}
            }
            if (bound) {
                try { ctx.unbindService(conn); } catch (Exception ignored) {}
                bound = false;
            }
            service = null;
            binder = null;
        }
    }
}
