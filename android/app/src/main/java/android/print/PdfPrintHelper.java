package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

import java.io.File;

/**
 * Drives a PrintDocumentAdapter (e.g. from WebView.createPrintDocumentAdapter) straight into a PDF file,
 * without the system print dialog. Lives in package android.print to reach the package-private
 * constructors of LayoutResultCallback / WriteResultCallback. Must be called on the main thread.
 */
public final class PdfPrintHelper {

    public interface Callback {
        void onSuccess(File file);
        void onFailure(String message);
    }

    private PdfPrintHelper() {}

    public static void print(final PrintDocumentAdapter adapter, final PrintAttributes attributes,
                             final File out, final Callback callback) {
        adapter.onStart();
        adapter.onLayout(null, attributes, new CancellationSignal(), new PrintDocumentAdapter.LayoutResultCallback() {
            @Override
            public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                final ParcelFileDescriptor pfd;
                try {
                    if (out.exists()) out.delete();
                    pfd = ParcelFileDescriptor.open(out, ParcelFileDescriptor.MODE_CREATE
                            | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE);
                } catch (Exception e) {
                    adapter.onFinish();
                    callback.onFailure("cannot open output: " + e.getMessage());
                    return;
                }
                adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, pfd, new CancellationSignal(),
                        new PrintDocumentAdapter.WriteResultCallback() {
                            @Override
                            public void onWriteFinished(PageRange[] pages) {
                                closeQuietly(pfd);
                                adapter.onFinish();
                                if (out.length() > 0) callback.onSuccess(out);
                                else callback.onFailure("empty PDF");
                            }

                            @Override
                            public void onWriteFailed(CharSequence error) {
                                closeQuietly(pfd);
                                adapter.onFinish();
                                callback.onFailure("write failed: " + error);
                            }

                            @Override
                            public void onWriteCancelled() {
                                closeQuietly(pfd);
                                adapter.onFinish();
                                callback.onFailure("write cancelled");
                            }
                        });
            }

            @Override
            public void onLayoutFailed(CharSequence error) {
                adapter.onFinish();
                callback.onFailure("layout failed: " + error);
            }

            @Override
            public void onLayoutCancelled() {
                adapter.onFinish();
                callback.onFailure("layout cancelled");
            }
        }, null);
    }

    private static void closeQuietly(ParcelFileDescriptor pfd) {
        try { pfd.close(); } catch (Exception ignored) {}
    }
}
