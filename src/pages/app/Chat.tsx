import { ArrowLeft, Copy, MessagesSquare, Plus, Send, Shield, Trash2, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import PageHeader from "@/components/app/PageHeader";
import { useCollection, useSetting, put, remove, type Chat, type Message } from "@/lib/db";
import { decryptFrom, encryptFor, generateIdentity, sharedSecret, type Identity, type EncryptedEnvelope } from "@/lib/crypto";
import { relativeTime, uid } from "@/lib/format";

const EMPTY_IDENTITY = null as Identity | null;
const STUN = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

interface Invite {
  v: number;
  name: string;
  pub: string;
  kind: "offer" | "answer";
  sdp: string;
}

function encodeInvite(inv: Invite): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(inv))));
}
function decodeInvite(s: string): Invite {
  return JSON.parse(decodeURIComponent(escape(atob(s.trim()))));
}

function waitForIce(pc: RTCPeerConnection, timeout = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const t = setTimeout(() => resolve(), timeout);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(t);
        resolve();
      }
    });
  });
}

export default function Chat() {
  const chats = useCollection<Chat>("chats");
  const messages = useCollection<Message>("messages");
  const [identity, setIdentity] = useSetting<Identity | null>("chatIdentity", EMPTY_IDENTITY);
  const [view, setView] = useState<"home" | "room">("home");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [inviteText, setInviteText] = useState("");
  const [peerName, setPeerName] = useState("");
  const [peerPub, setPeerPub] = useState("");
  const [phase, setPhase] = useState<"idle" | "offer-created" | "waiting-answer" | "connecting" | "connected" | "closed">("idle");
  const [input, setInput] = useState("");
  const [paste, setPaste] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const secretRef = useRef<Uint8Array | null>(null);

  const roomMessages = useMemo(
    () => (roomId ? messages.filter((m) => m.chatId === roomId).sort((a, b) => a.ts - b.ts) : []),
    [messages, roomId],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [roomMessages.length]);

  const cleanup = useCallback(() => {
    try {
      dcRef.current?.close();
      pcRef.current?.close();
    } catch {
      /* already closed */
    }
    pcRef.current = null;
    dcRef.current = null;
    secretRef.current = null;
    setPhase((p) => (p === "connected" || p === "connecting" ? "closed" : p));
  }, []);

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const ensureIdentity = async (): Promise<Identity> => {
    if (identity) return identity;
    const id = await generateIdentity();
    setIdentity(id);
    return id;
  };

  const wireChannel = (dc: RTCDataChannel, secret: Uint8Array) => {
    dcRef.current = dc;
    secretRef.current = secret;
    dc.onopen = () => {
      setPhase("connected");
      toast("Encrypted channel established");
    };
    dc.onclose = () => setPhase("closed");
    dc.onmessage = (e) => {
      const raw = typeof e.data === "string" ? e.data : String(e.data);
      void (async () => {
        try {
          const parsed = JSON.parse(raw) as { t: string; env?: EncryptedEnvelope; name?: string };
          if (parsed.t === "m" && parsed.env && roomId) {
            const text = await decryptFrom(secret, parsed.env);
            await put<Message>("messages", {
              id: uid(),
              chatId: roomId,
              direction: "received",
              text,
              ts: Date.now(),
              status: "delivered",
            });
            const chat = chats.find((c) => c.id === roomId);
            if (chat) await put<Chat>("chats", { ...chat, lastMessage: text });
          }
        } catch {
          /* drop unreadable frames */
        }
      })();
    };
  };

  const createRoom = async () => {
    const me = await ensureIdentity();
    const pc = new RTCPeerConnection(STUN);
    pcRef.current = pc;
    const dc = pc.createDataChannel("lf");
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIce(pc);
    const inv: Invite = {
      v: 1,
      name: me.publicKey.slice(0, 6),
      pub: me.publicKey,
      kind: "offer",
      sdp: pc.localDescription?.sdp ?? "",
    };
    const chatId = uid();
    await put<Chat>("chats", { id: chatId, name: "Direct channel", createdAt: Date.now() });
    setRoomId(chatId);
    setView("room");
    setInviteText(encodeInvite(inv));
    setPhase("offer-created");
    setPeerName("peer");
  };

  const acceptAnswer = async () => {
    if (!paste.trim() || !pcRef.current || !roomId) return;
    try {
      const inv = decodeInvite(paste);
      if (inv.kind !== "answer") throw new Error("That's not an answer");
      const me = identity;
      if (!me) return;
      await pcRef.current.setRemoteDescription({ type: "answer", sdp: inv.sdp });
      setPeerPub(inv.pub);
      setPeerName(inv.name);
      setPhase("connecting");
      const secret = await sharedSecret(me, inv.pub);
      const dc = pcRef.current.createDataChannel("lf");
      wireChannel(dc, secret);
      const chat = chats.find((c) => c.id === roomId);
      if (chat) await put<Chat>("chats", { ...chat, name: inv.name, peer: inv.pub });
    } catch {
      toast("Could not read the answer — copy the full code from your peer");
    }
  };

  const joinRoom = async () => {
    if (!paste.trim()) return;
    let inv: Invite;
    try {
      inv = decodeInvite(paste);
      if (inv.kind !== "offer") throw new Error("Not an offer");
    } catch {
      toast("That invite code is invalid");
      return;
    }
    const me = await ensureIdentity();
    setPeerPub(inv.pub);
    setPeerName(inv.name);

    const pc = new RTCPeerConnection(STUN);
    pcRef.current = pc;
    pc.ondatachannel = (e) => {
      void (async () => {
        const secret = await sharedSecret(me, inv.pub);
        wireChannel(e.channel, secret);
      })();
    };
    await pc.setRemoteDescription({ type: "offer", sdp: inv.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIce(pc);
    const answerInv: Invite = {
      v: 1,
      name: me.publicKey.slice(0, 6),
      pub: me.publicKey,
      kind: "answer",
      sdp: pc.localDescription?.sdp ?? "",
    };
    setInviteText(encodeInvite(answerInv));
    setPhase("waiting-answer");

    // Room record for the joiner.
    const chatId = uid();
    await put<Chat>("chats", {
      id: chatId,
      name: inv.name,
      peer: inv.pub,
      createdAt: Date.now(),
    });
    setRoomId(chatId);
    setView("room");
  };

  const send = async () => {
    const text = input.trim();
    if (!text || !dcRef.current || dcRef.current.readyState !== "open" || !secretRef.current || !roomId) return;
    const env = await encryptFor(secretRef.current, text);
    dcRef.current.send(JSON.stringify({ t: "m", env }));
    const msg: Message = {
      id: uid(),
      chatId: roomId,
      direction: "sent",
      text,
      ts: Date.now(),
      status: "sent",
    };
    await put<Message>("messages", msg);
    const chat = chats.find((c) => c.id === roomId);
    if (chat) await put<Chat>("chats", { ...chat, lastMessage: text });
    setInput("");
  };

  const openRoom = (c: Chat) => {
    setRoomId(c.id);
    setView("room");
    setPhase("closed");
  };

  const leaveRoom = () => {
    cleanup();
    setInviteText("");
    setPaste("");
    setRoomId(null);
    setView("home");
  };

  const deleteChat = async (c: Chat) => {
    if (c.id === roomId) leaveRoom();
    for (const m of messages.filter((m) => m.chatId === c.id)) await remove("messages", m.id);
    await remove("chats", c.id);
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  };

  /* ------------------------------ render ------------------------------ */

  if (view === "room" && roomId) {
    const chat = chats.find((c) => c.id === roomId);
    return (
      <div className="flex h-full flex-col">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={leaveRoom}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <p className="text-sm font-semibold">{chat?.name ?? "Direct channel"}</p>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Shield className="h-3 w-3" />
                {phase === "connected" ? "Encrypted · connected" : phase === "connecting" ? "Negotiating…" : phase === "offer-created" ? "Waiting for your peer's answer" : phase === "waiting-answer" ? "Send the answer code to your peer" : "Disconnected"}
              </p>
            </div>
          </div>
          {phase !== "connected" && inviteText && (
            <button
              type="button"
              onClick={() => void copy(inviteText)}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
            >
              <Copy className="h-3 w-3" /> Copy {phase === "offer-created" ? "invite" : "answer"}
            </button>
          )}
        </div>

        {(phase === "offer-created" || phase === "waiting-answer") && (
          <div className="mb-4 rounded-md border border-dashed p-4">
            <p className="text-xs text-muted-foreground">
              {phase === "offer-created"
                ? "Copy this invite and send it to your peer out-of-band (chat app, email, QR…). They paste it in their Lifeflow Chat → Join."
                : "Paste this answer back to your peer — they enter it in their open invite."}
            </p>
            <div className="mt-3 flex gap-2">
              <input
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder={phase === "offer-created" ? "Paste your peer's answer…" : "Peer will paste here…"}
                className="min-w-0 flex-1 rounded-md border bg-transparent px-3 py-2 font-mono text-[11px] outline-none focus:border-foreground/40"
              />
              {phase === "offer-created" && (
                <button
                  type="button"
                  onClick={() => void acceptAnswer()}
                  disabled={!paste.trim()}
                  className="rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  Connect
                </button>
              )}
            </div>
          </div>
        )}

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-md border bg-card p-4"
        >
          {roomMessages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Shield className="h-6 w-6 text-muted-foreground/40" />
              <p className="mt-3 max-w-xs text-xs leading-relaxed text-muted-foreground">
                End-to-end encrypted. Not even Lifeflow's infrastructure can read these messages — they
                travel directly between the two devices.
              </p>
            </div>
          )}
          {roomMessages.map((m) => (
            <div key={m.id} className={`flex ${m.direction === "sent" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-md px-3 py-2 text-sm leading-relaxed ${
                  m.direction === "sent"
                    ? "bg-foreground text-background"
                    : "border bg-background text-foreground"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p className={`mt-1 text-[10px] ${m.direction === "sent" ? "text-background/60" : "text-muted-foreground"}`}>
                  {relativeTime(m.ts)} · {m.status}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={phase === "connected" ? "Type a message…" : "Waiting for the channel…"}
            disabled={phase !== "connected"}
            className="min-w-0 flex-1 rounded-md border bg-transparent px-3 py-2.5 text-sm outline-none focus:border-foreground/40 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={phase !== "connected" || !input.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-md bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Private"
        title="Chat"
        description="Peer-to-peer, end-to-end encrypted conversations. No server, no cloud, no history retained anywhere but your devices."
        actions={
          <button
            type="button"
            onClick={() => void createRoom()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New channel
          </button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="quiet-card p-5">
          <p className="microlabel">Join a channel</p>
          <p className="mt-1 mb-3 text-xs text-muted-foreground">
            Paste an invite code from someone running Lifeflow. No accounts, no server.
          </p>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste the invite code…"
            rows={4}
            className="w-full resize-none rounded-md border bg-transparent p-3 font-mono text-[11px] leading-relaxed outline-none focus:border-foreground/40"
          />
          <button
            type="button"
            onClick={() => void joinRoom()}
            disabled={!paste.trim()}
            className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Users className="h-4 w-4" /> Join channel
          </button>
        </div>

        <div className="quiet-card p-5">
          <p className="microlabel">Past channels</p>
          <p className="mt-1 mb-3 text-xs text-muted-foreground">
            History stays in your local store until you delete it.
          </p>
          {chats.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No channels yet. Create one, or join with a code.
            </p>
          ) : (
            <div className="space-y-1.5">
              {chats.map((c) => (
                <div key={c.id} className="group flex items-center gap-3 rounded-md border p-3">
                  <button type="button" onClick={() => openRoom(c)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {c.lastMessage || "No messages yet"}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteChat(c)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-start gap-2 rounded-md border border-dashed p-4">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Every message is sealed with XSalsa20-Poly1305 using an X25519 shared secret derived from each
          device's ephemeral keys, then sent over an encrypted WebRTC data channel. Signaling (invite/answer)
          happens by copy-paste — your channel never touches a rendezvous server.
        </p>
      </div>
    </div>
  );
}
