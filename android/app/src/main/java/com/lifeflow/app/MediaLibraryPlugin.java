package com.lifeflow.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * MediaLibrary — lets the Music and Movies modules discover media that is
 * already on the device (via MediaStore) and copy it into the app's private
 * storage for offline playback. Everything stays on the device.
 */
@CapacitorPlugin(
    name = "MediaLibrary",
    permissions = {
        @Permission(
            alias = "media",
            strings = {
                Manifest.permission.READ_MEDIA_AUDIO,
                Manifest.permission.READ_MEDIA_VIDEO,
                Manifest.permission.READ_EXTERNAL_STORAGE
            }
        )
    }
)
public class MediaLibraryPlugin extends Plugin {

    @PluginMethod
    public void scan(PluginCall call) {
        if (getPermissionState("media") != PermissionState.GRANTED) {
            requestPermissionForAlias("media", call, "scanCallback");
            return;
        }
        scanCallback(call);
    }

    @PluginMethod
    public void scanCallback(PluginCall call) {
        if (getPermissionState("media") != PermissionState.GRANTED) {
            call.reject("Media permission denied");
            return;
        }
        final String kind = call.getString("kind", "audio");
        Thread worker = new Thread(() -> {
            try {
                JSArray items = new JSArray();
                final boolean video = "video".equals(kind);
                final Uri collection;
                final String[] projection;
                if (video) {
                    collection = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                            ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                            : MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
                    projection = new String[]{
                            MediaStore.Video.Media._ID,
                            MediaStore.Video.Media.DISPLAY_NAME,
                            MediaStore.Video.Media.DURATION,
                            MediaStore.Video.Media.SIZE,
                            MediaStore.Video.Media.MIME_TYPE
                    };
                } else {
                    collection = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                            ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
                            : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
                    projection = new String[]{
                            MediaStore.Audio.Media._ID,
                            MediaStore.Audio.Media.DISPLAY_NAME,
                            MediaStore.Audio.Media.ARTIST,
                            MediaStore.Audio.Media.ALBUM,
                            MediaStore.Audio.Media.DURATION,
                            MediaStore.Audio.Media.SIZE,
                            MediaStore.Audio.Media.MIME_TYPE
                    };
                }

                ContentResolver resolver = getContext().getContentResolver();
                Cursor cursor = resolver.query(collection, projection, null, null,
                        MediaStore.MediaColumns.DATE_ADDED + " DESC");
                if (cursor != null) {
                    try {
                        int idCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns._ID);
                        int nameCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME);
                        int durCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DURATION);
                        int sizeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE);
                        int mimeCol = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE);
                        int artistCol = video ? -1 : cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST);
                        int albumCol = video ? -1 : cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM);

                        while (cursor.moveToNext()) {
                            long id = cursor.getLong(idCol);
                            JSObject item = new JSObject();
                            item.put("id", String.valueOf(id));
                            item.put("name", cursor.getString(nameCol));
                            item.put("duration", cursor.getLong(durCol) / 1000.0);
                            item.put("size", cursor.getLong(sizeCol));
                            item.put("mime", cursor.getString(mimeCol));
                            item.put("artist", artistCol >= 0 && !cursor.isNull(artistCol) ? cursor.getString(artistCol) : "");
                            item.put("album", albumCol >= 0 && !cursor.isNull(albumCol) ? cursor.getString(albumCol) : "");
                            item.put("uri", ContentUris.withAppendedId(collection, id).toString());
                            items.put(item);
                        }
                    } finally {
                        cursor.close();
                    }
                }

                JSObject result = new JSObject();
                result.put("items", items);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Media scan failed: " + e.getMessage());
            }
        });
        worker.start();
    }

    @PluginMethod
    public void copyToApp(PluginCall call) {
        final String uriStr = call.getString("uri");
        final String name = call.getString("name", "file");
        if (uriStr == null) {
            call.reject("Missing uri");
            return;
        }
        Thread worker = new Thread(() -> {
            try {
                Uri uri = Uri.parse(uriStr);
                ContentResolver resolver = getContext().getContentResolver();
                File dir = new File(getContext().getCacheDir(), "media");
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("Cannot create media cache dir");
                    return;
                }
                File out = new File(dir, sanitize(name));
                InputStream in = resolver.openInputStream(uri);
                if (in == null) {
                    call.reject("Cannot open " + uriStr);
                    return;
                }
                try (InputStream stream = in; OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = stream.read(buf)) != -1) os.write(buf, 0, n);
                }
                JSObject result = new JSObject();
                result.put("path", out.getAbsolutePath());
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Copy failed: " + e.getMessage());
            }
        });
        worker.start();
    }

    private static String sanitize(String name) {
        return name == null || name.isEmpty() ? "file" : name.replaceAll("[^a-zA-Z0-9._-]", "_");
    }
}
