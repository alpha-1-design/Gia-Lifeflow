package com.lifeflow.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

import java.util.Properties;

import javax.mail.BodyPart;
import javax.mail.Folder;
import javax.mail.Message;
import javax.mail.Multipart;
import javax.mail.Session;
import javax.mail.Store;
import javax.mail.Transport;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;

/**
 * MailBridge — lets the Lifeflow WebView use a Google app password over
 * IMAP/SMTP (the only way app passwords work). Used only in the native build;
 * the browser build talks to the Gmail REST API with OAuth instead.
 */
@CapacitorPlugin(name = "MailBridge")
public class MailBridgePlugin extends Plugin {

    @PluginMethod
    public void send(PluginCall call) {
        final String host = call.getString("host");
        final int port = call.getInt("port", 465);
        final String user = call.getString("user");
        final String pass = call.getString("pass");
        final String to = call.getString("to");
        final String subject = call.getString("subject", "");
        final String body = call.getString("body", "");

        if (host == null || user == null || pass == null || to == null) {
            call.reject("Missing required arguments");
            return;
        }

        Thread worker = new Thread(() -> {
            try {
                Properties props = new Properties();
                props.put("mail.smtps.host", host);
                props.put("mail.smtps.port", String.valueOf(port));
                props.put("mail.smtps.auth", "true");
                props.put("mail.smtps.connectiontimeout", "15000");
                props.put("mail.smtps.timeout", "20000");

                Session session = Session.getInstance(props);
                MimeMessage msg = new MimeMessage(session);
                msg.setFrom(new InternetAddress(user));
                msg.setRecipients(Message.RecipientType.TO, InternetAddress.parse(to, false));
                msg.setSubject(subject == null ? "" : subject, "UTF-8");
                msg.setText(body == null ? "" : body, "UTF-8");

                Transport transport = session.getTransport("smtps");
                try {
                    transport.connect(host, port, user, pass);
                    transport.sendMessage(msg, msg.getAllRecipients());
                } finally {
                    transport.close();
                }
                call.resolve(new JSObject().put("ok", true));
            } catch (Exception e) {
                call.reject("SMTP send failed: " + safeMessage(e));
            }
        });
        worker.start();
    }

    @PluginMethod
    public void fetchInbox(PluginCall call) {
        final String host = call.getString("host");
        final int port = call.getInt("port", 993);
        final String user = call.getString("user");
        final String pass = call.getString("pass");
        final int max = call.getInt("max", 20);

        if (host == null || user == null || pass == null) {
            call.reject("Missing required arguments");
            return;
        }

        Thread worker = new Thread(() -> {
            Store store = null;
            try {
                Properties props = new Properties();
                props.put("mail.imaps.host", host);
                props.put("mail.imaps.port", String.valueOf(port));
                props.put("mail.imaps.connectiontimeout", "15000");
                props.put("mail.imaps.timeout", "20000");

                Session session = Session.getInstance(props);
                store = session.getStore("imaps");
                store.connect(host, port, user, pass);

                Folder inbox = store.getFolder("INBOX");
                inbox.open(Folder.READ_ONLY);
                try {
                    int count = inbox.getMessageCount();
                    int take = Math.min(max, Math.max(0, count));
                    Message[] messages = inbox.getMessages(count - take + 1, count);

                    JSONArray arr = new JSONArray();
                    for (Message m : messages) {
                        JSObject item = new JSObject();
                        item.put("id", String.valueOf(m.getMessageNumber()));
                        item.put("from", fromString(m));
                        item.put("subject", m.getSubject() == null ? "" : m.getSubject());
                        item.put("date", m.getReceivedDate() != null
                                ? m.getReceivedDate().getTime()
                                : m.getSentDate() != null ? m.getSentDate().getTime() : System.currentTimeMillis());
                        String content = extractText(m);
                        item.put("body", content.length() > 60000 ? content.substring(0, 60000) : content);
                        item.put("snippet", content.length() > 200 ? content.substring(0, 200) : content);
                        arr.put(item);
                    }

                    JSObject result = new JSObject();
                    result.put("count", take);
                    result.put("messages", arr);
                    call.resolve(result);
                } finally {
                    inbox.close(false);
                }
            } catch (Exception e) {
                call.reject("IMAP fetch failed: " + safeMessage(e));
            } finally {
                if (store != null) {
                    try {
                        store.close();
                    } catch (Exception ignored) {
                        // best effort
                    }
                }
            }
        });
        worker.start();
    }

    private static String fromString(Message m) {
        try {
            if (m.getFrom() != null && m.getFrom().length > 0 && m.getFrom()[0] != null) {
                return m.getFrom()[0].toString();
            }
        } catch (Exception ignored) {
            // fall through
        }
        return "";
    }

    private static String extractText(Message m) {
        try {
            Object content = m.getContent();
            if (content instanceof String) {
                return (String) content;
            }
            if (content instanceof Multipart) {
                Multipart mp = (Multipart) content;
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < mp.getCount(); i++) {
                    BodyPart bp = mp.getBodyPart(i);
                    if (bp.isMimeType("text/plain")) {
                        Object c = bp.getContent();
                        if (c instanceof String) {
                            sb.append((String) c);
                        }
                        break;
                    } else if (bp.isMimeType("text/html")) {
                        Object c = bp.getContent();
                        if (c instanceof String) {
                            sb.append(stripHtml((String) c));
                        }
                        break;
                    }
                }
                return sb.toString();
            }
        } catch (Exception ignored) {
            // best effort body extraction
        }
        return "";
    }

    private static String stripHtml(String html) {
        return html.replaceAll("(?s)<[^>]*>", " ").replaceAll("\\s+", " ").trim();
    }

    private static String safeMessage(Exception e) {
        String m = e.getMessage();
        return m == null || m.isEmpty() ? e.getClass().getSimpleName() : m;
    }
}
