package app.wendu.reader;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * 接收「用其他应用打开」(ACTION_VIEW) 和「分享」(ACTION_SEND) 进来的文件，读成文字交给网页层。
 * 微信传出的文件是 content:// 地址，MIME 常常不准，是不是 md 由网页层按扩展名和内容判断。
 */
@CapacitorPlugin(name = "IncomingFile")
public class IncomingFilePlugin extends Plugin {

    private static final int MAX_BYTES = 5 * 1024 * 1024;

    private JSObject pending;

    @Override
    public void load() {
        Intent intent = getActivity().getIntent();
        JSObject file = readIntent(intent);
        if (file != null) {
            pending = file;
            // 清掉已处理的 intent，避免页面重建时重复导入
            getActivity().setIntent(new Intent(Intent.ACTION_MAIN));
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        JSObject file = readIntent(intent);
        if (file == null) return;
        if (hasListeners("fileReceived")) {
            notifyListeners("fileReceived", file);
        } else {
            pending = file;
        }
    }

    @PluginMethod
    public void takePending(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("file", pending);
        pending = null;
        call.resolve(ret);
    }

    private JSObject readIntent(Intent intent) {
        if (intent == null) return null;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (uri == null) {
                CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
                if (text == null) return null;
                JSObject file = new JSObject();
                file.put("name", "");
                file.put("mimeType", intent.getType() == null ? "text/plain" : intent.getType());
                file.put("text", text.toString());
                return file;
            }
        } else {
            return null;
        }
        if (uri == null) return null;

        JSObject file = new JSObject();
        ContentResolver resolver = getContext().getContentResolver();
        file.put("name", displayName(resolver, uri));
        String type = intent.getType() != null ? intent.getType() : resolver.getType(uri);
        file.put("mimeType", type == null ? "" : type);
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) throw new Exception("无法打开文件");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                if (out.size() > MAX_BYTES) throw new Exception("文件超过 5 MB");
            }
            file.put("text", new String(out.toByteArray(), StandardCharsets.UTF_8));
        } catch (Exception e) {
            file.put("text", "");
            file.put("error", e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
        }
        return file;
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    String name = c.getString(0);
                    if (name != null) return name;
                }
            } catch (Exception ignored) {
                // 有些 App 不支持查询文件名，退回用路径最后一段
            }
        }
        String last = uri.getLastPathSegment();
        return last == null ? "" : last;
    }
}
