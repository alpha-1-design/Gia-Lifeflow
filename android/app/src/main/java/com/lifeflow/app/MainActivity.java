package com.lifeflow.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugin: Gmail IMAP/SMTP for Google app passwords.
        registerPlugin(MailBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
