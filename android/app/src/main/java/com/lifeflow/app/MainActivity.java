package com.lifeflow.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins: Gmail IMAP/SMTP for Google app passwords, and the
        // on-device media library scanner (Music/Movies modules).
        registerPlugin(MailBridgePlugin.class);
        registerPlugin(MediaLibraryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
