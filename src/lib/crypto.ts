/**
 * Lifeflow crypto — libsodium (X25519 + secretbox).
 *
 * Used by the P2P chat: each participant has an ephemeral identity; messages
 * are sealed with a shared secret derived from the two public keys, then
 * encrypted with crypto_secretbox_easy (XSalsa20-Poly1305). Keys and secrets
 * never leave this device.
 */
import sodium from "libsodium-wrappers";

let readyPromise: Promise<void> | null = null;
function ready(): Promise<void> {
  if (!readyPromise) readyPromise = sodium.ready;
  return readyPromise;
}

const B64 = sodium.base64_variants.ORIGINAL;

export interface Identity {
  publicKey: string; // base64
  secretKey: string; // base64 — keep private
}

export interface EncryptedEnvelope {
  n: string; // base64 nonce
  c: string; // base64 ciphertext
}

export function isCryptoSupported(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.getRandomValues !== "undefined";
}

export async function generateIdentity(): Promise<Identity> {
  await ready();
  const kp = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_base64(kp.publicKey, B64),
    secretKey: sodium.to_base64(kp.privateKey, B64),
  };
}

/** Shared secret between my identity and a peer's public key. */
export async function sharedSecret(me: Identity, peerPublicKey: string): Promise<Uint8Array> {
  await ready();
  return sodium.crypto_box_beforenm(
    sodium.from_base64(peerPublicKey, B64),
    sodium.from_base64(me.secretKey, B64),
  );
}

export async function encryptFor(secret: Uint8Array, text: string): Promise<EncryptedEnvelope> {
  await ready();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(sodium.from_string(text), nonce, secret);
  return {
    n: sodium.to_base64(nonce, B64),
    c: sodium.to_base64(cipher, B64),
  };
}

export async function decryptFrom(secret: Uint8Array, env: EncryptedEnvelope): Promise<string> {
  await ready();
  const plain = sodium.crypto_secretbox_open_easy(
    sodium.from_base64(env.c, B64),
    sodium.from_base64(env.n, B64),
    secret,
  );
  return sodium.to_string(plain);
}

/** Unauthenticated random bytes for challenges/ids. */
export function randomB64(bytes = 24): string {
  return sodium.to_base64(sodium.randombytes_buf(bytes), B64);
}
