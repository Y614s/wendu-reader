package app.wendu.reader;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 应用内插件必须在 super.onCreate 之前注册
        registerPlugin(IncomingFilePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
