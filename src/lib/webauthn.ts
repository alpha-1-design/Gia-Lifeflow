/**
 * Lifeflow device lock.
 *
 * In the browser build this uses WebAuthn (biometrics / PIN / passkey). In the
 * native Android build it uses the OS BiometricPrompt through
 * @capgo/capacitor-native-biometric, which also falls back to the device
 * PIN/pattern/password. Nothing is stored remotely: the credential lives in
 * the platform authenticator, and the app only keeps a reference to it
 * locally.
 */
import { Capacitor } from "@capacitor/core";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";

export interface PasskeyRecord {
  credentialId: string; // base64url, or "native-biometric" on native builds
  challenge: string; // base64url
}

/** True when running inside the native Android/iOS app (Capacitor). */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/** Whether the user can gate the app behind device security. */
export async function isDeviceSecurityAvailable(): Promise<boolean> {
  if (isNativePlatform()) {
    try {
      const r = await NativeBiometric.isAvailable({ useFallback: true });
      return r.isAvailable;
    } catch {
      return false;
    }
  }
  return isWebAuthnSupported();
}

/**
 * Enables device security. Native: verifies the device already has biometrics
 * or a PIN enrolled. Web: registers a passkey with the platform authenticator.
 */
export async function enrollDeviceSecurity(displayName: string): Promise<PasskeyRecord> {
  if (isNativePlatform()) {
    const r = await NativeBiometric.isAvailable({ useFallback: true });
    if (!r.isAvailable) {
      throw new Error("No biometrics or PIN is set up on this device yet");
    }
    return { credentialId: "native-biometric", challenge: "" };
  }
  return createPasskey(displayName);
}

/** Unlocks the app with the OS prompt (native) or the passkey (web). */
export async function unlockDeviceSecurity(record: PasskeyRecord): Promise<boolean> {
  if (isNativePlatform()) {
    try {
      await NativeBiometric.verifyIdentity({
        reason: "Unlock Lifeflow and your private data",
        title: "Unlock Lifeflow",
        subtitle: "Use your device security",
        useFallback: true,
      });
      return true;
    } catch {
      return false;
    }
  }
  return unlockWithPasskey(record);
}

function toB64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    !!navigator.credentials &&
    !!window.PublicKeyCredential &&
    window.isSecureContext !== false
  );
}

/** Registers a passkey on the device (biometric / PIN / passkey prompt). */
export async function createPasskey(displayName: string): Promise<PasskeyRecord> {
  if (!isWebAuthnSupported()) throw new Error("WebAuthn is not available in this context");
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: challenge as unknown as BufferSource,
      rp: { id: window.location.hostname, name: "Lifeflow" },
      user: {
        id: userId as unknown as BufferSource,
        name: displayName || "lifeflow",
        displayName: displayName || "Lifeflow user",
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        userVerification: "preferred",
        residentKey: "preferred",
      },
      timeout: 60000,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;

  if (!cred) throw new Error("Passkey creation was cancelled");
  return { credentialId: toB64url(cred.rawId), challenge: toB64url(challenge) };
}

/** Asks the platform authenticator to verify the user. */
export async function unlockWithPasskey(record: PasskeyRecord): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: challenge as unknown as BufferSource,
        allowCredentials: [
          { type: "public-key", id: fromB64url(record.credentialId) as unknown as BufferSource },
        ],
        userVerification: "preferred",
        timeout: 60000,
      },
    });
    return !!cred;
  } catch {
    return false;
  }
}
