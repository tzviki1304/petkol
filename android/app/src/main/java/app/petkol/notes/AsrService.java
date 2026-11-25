package app.petkol.notes;

import android.app.Service;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Message;
import android.os.Messenger;
import android.os.Process;
import android.os.RemoteException;
import android.util.Log;

/**
 * Runs Ozen (ONNX Runtime) in its own process (":asr", see the manifest). If the system kills it
 * for memory, only this process dies: the UI process survives and the plugin rejects with ASR_DIED.
 * One worker thread, so requests are serialized.
 */
public class AsrService extends Service {
    private static final String TAG = "PetkolAsr";

    private HandlerThread worker;
    private Messenger messenger;
    private final OzenRunner ozen = new OzenRunner();

    @Override
    public void onCreate() {
        super.onCreate();
        worker = new HandlerThread("asr-worker");
        worker.start();
        messenger = new Messenger(new Handler(worker.getLooper(), this::handle));
        Log.i(TAG, "asr process started, pid " + Process.myPid());
    }

    private boolean handle(Message m) {
        Bundle out = OzenOps.handle(ozen, m.what, m.getData());
        if (m.replyTo != null) {
            Message r = Message.obtain(null, m.what);
            r.arg1 = m.arg1; // request id
            r.setData(out);
            try {
                m.replyTo.send(r);
            } catch (RemoteException e) {
                Log.w(TAG, "client gone", e);
            }
        }
        return true;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return messenger.getBinder();
    }

    @Override
    public boolean onUnbind(Intent intent) {
        stopSelf();
        return false;
    }

    @Override
    public void onDestroy() {
        Log.i(TAG, "asr process exiting");
        super.onDestroy();
        // Dedicated process: exit right away so the model's native memory and the runtime go back to the system.
        Process.killProcess(Process.myPid());
    }
}
