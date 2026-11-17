package io.github.leexeo.cage.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import cagemobile.AndroidUpdate;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

final class AppUpdate {
    private static final int ALLOW_INSTALL = 43, INSTALL = 44;
    private static final long INTERVAL = TimeUnit.HOURS.toMillis(12);
    private final Activity activity;
    private final SharedPreferences preferences;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final String current;
    private boolean resumed, checking, manual;
    private Runnable deferred;
    private File ready;
    private String readyVersion;
    private ProgressDialog progress;
    private AlertDialog prompt;

    AppUpdate(Activity activity, Bundle saved) {
        this.activity = activity;
        preferences = activity.getSharedPreferences("app-updates", Activity.MODE_PRIVATE);
        try {
            current = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            throw new IllegalStateException(e);
        }
        if (saved != null && saved.getString("update-apk", "").matches("[a-f0-9]{64}\\.apk")) {
            ready = new File(new File(activity.getCacheDir(), "updates"), saved.getString("update-apk"));
            readyVersion = saved.getString("update-version");
        }
    }

    String currentVersion() { return "development".equals(current) ? "development build" : current; }

    void saveState(Bundle state) {
        if (ready != null) {
            state.putString("update-apk", ready.getName());
            state.putString("update-version", readyVersion);
        }
    }

    void pause() { resumed = false; }
    void resume() {
        resumed = true;
        if (ready != null && (current.equals(readyVersion) || !ready.isFile() ||
                System.currentTimeMillis() - ready.lastModified() >= INTERVAL)) ready = null;
        if (deferred != null) {
            Runnable action = deferred;
            deferred = null;
            action.run();
        } else if (ready == null) check(false);
    }

    void check(boolean requested) {
        if ("development".equals(current)) {
            if (requested) message("Update local development builds with the build tools.");
            return;
        }
        if (progress != null || (prompt != null && prompt.isShowing())) return;
        if (requested && ready != null && ready.isFile()) { offerInstall(); return; }
        if (requested) {
            manual = true;
            message("Checking for updates…");
        }
        if (checking) return;
        long now = System.currentTimeMillis();
        long elapsed = now - preferences.getLong("checked-at", 0);
        if (!requested && elapsed >= 0 && elapsed < INTERVAL) return;
        preferences.edit().putLong("checked-at", now).apply();
        checking = true;
        worker.execute(() -> {
            try {
                File[] files = new File(activity.getCacheDir(), "updates").listFiles();
                if (files != null) for (File file : files)
                    if (now - file.lastModified() > TimeUnit.DAYS.toMillis(1)) file.delete();
                AndroidUpdate update = UpdateDownload.check(current);
                deliver(() -> {
                    checking = false;
                    boolean report = manual;
                    manual = false;
                    if (update == null) {
                        if (report) message("You already have the latest version on this channel.");
                        return;
                    }
                    prompt = new AlertDialog.Builder(activity)
                            .setTitle("New version found " + update.version())
                            .setMessage("Current version " + current + ". Android confirms the installation after the download.")
                            .setNegativeButton("Later", null)
                            .setPositiveButton("Download update", (d, w) -> download(update)).show();
                });
            } catch (Exception e) {
                deliver(() -> {
                    checking = false;
                    if (manual) failure("Update check failed", e);
                    manual = false;
                });
            }
        });
    }

    @SuppressWarnings("deprecation")
    private void download(AndroidUpdate update) {
        ProgressDialog dialog = new ProgressDialog(activity);
        progress = dialog;
        progress.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
        progress.setTitle("Downloading " + update.version());
        progress.setMax(100);
        progress.setCanceledOnTouchOutside(false);
        Future<?> task = worker.submit(() -> {
            try {
                File file = UpdateDownload.fetch(activity, update, value -> activity.runOnUiThread(() -> {
                    if (progress == dialog) dialog.setProgress(value);
                }));
                deliver(() -> {
                    if (progress != dialog) return;
                    finishDownload();
                    ready = file;
                    readyVersion = update.version();
                    install();
                });
            } catch (Exception e) {
                deliver(() -> {
                    if (progress != dialog) return;
                    finishDownload();
                    failure("Update download failed", e);
                });
            }
        });
        dialog.setOnCancelListener(d -> {
            task.cancel(true);
            progress = null;
        });
        dialog.setButton(ProgressDialog.BUTTON_NEGATIVE, "Cancel", (d, which) -> dialog.cancel());
        dialog.show();
    }

    private void finishDownload() {
        if (progress != null) { progress.dismiss(); progress = null; }
    }

    private void offerInstall() {
        prompt = new AlertDialog.Builder(activity).setTitle("Install " + readyVersion)
                .setMessage("The update was downloaded and verified.")
                .setNegativeButton("Later", null)
                .setPositiveButton("Continue installation", (d, w) -> install()).show();
    }

    @SuppressWarnings("deprecation")
    private void install() {
        if (ready == null || !ready.isFile()) {
            ready = null;
            message("The update file was cleaned up; check for updates again.");
            return;
        }
        try {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                prompt = new AlertDialog.Builder(activity).setTitle("Allow app updates to install")
                        .setMessage("Turn on \"Allow from this source\" in system settings, then come back to confirm the installation.")
                        .setNegativeButton("Later", null)
                        .setPositiveButton("Open settings", (d, w) -> openPermissionSettings()).show();
                return;
            }
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".updates", ready);
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION).putExtra(Intent.EXTRA_RETURN_RESULT, true);
            activity.startActivityForResult(intent, INSTALL);
        } catch (RuntimeException e) {
            message("Cannot open the system installer; download the update from the website.");
        }
    }

    private void openPermissionSettings() {
        try {
            activity.startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())), ALLOW_INSTALL);
        } catch (RuntimeException e) {
            message("Allow Cage to install unknown apps in system settings, then continue from \"Check for updates\".");
        }
    }

    boolean onResult(int code, int result) {
        if (code == ALLOW_INSTALL) {
            if (activity.getPackageManager().canRequestPackageInstalls()) install();
            else message("The install permission is not on; you can continue later from \"Check for updates\".");
            return true;
        }
        if (code == INSTALL) {
            if (result == Activity.RESULT_OK) {
                if (ready != null) ready.delete();
                ready = null;
            } else message("The update is not installed yet; you can retry later from \"Check for updates\".");
            return true;
        }
        return false;
    }

    private void deliver(Runnable action) {
        activity.runOnUiThread(() -> {
            if (activity.isDestroyed() || activity.isFinishing()) return;
            if (resumed) action.run(); else deferred = action;
        });
    }

    private void message(String text) { Toast.makeText(activity, text, Toast.LENGTH_LONG).show(); }

    private void failure(String title, Exception e) {
        String detail = e.getMessage();
        if (detail == null || !detail.matches("[\\p{Lu}].{0,100}")) detail = "Check the network connection and try again.";
        prompt = new AlertDialog.Builder(activity).setTitle(title).setMessage(detail)
                .setPositiveButton("Got it", null).show();
    }

    void close() {
        worker.shutdownNow();
        if (prompt != null) prompt.dismiss();
        finishDownload();
        deferred = null;
    }
}
