const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export function sanitizeParticipantName(value) {
  if (typeof value !== "string") return null;
  const displayName = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (displayName.length < 1 || [...displayName].length > 40) return null;
  if (/[\u0000-\u001f\u007f/\\]/u.test(displayName)) return null;
  const folderName = displayName.replace(/[<>:"|?*]/gu, "-").replace(/[. ]+$/u, "");
  if (!folderName) return null;
  return { displayName, folderName };
}

export async function secureStringEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return equalBytes(new Uint8Array(leftDigest), new Uint8Array(rightDigest));
}

export async function createSessionToken(payload, secret) {
  const encodedPayload = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = bytesToBase64Url(await hmac(secret, encodedPayload));
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token, secret) {
  if (typeof token !== "string" || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const expected = await hmac(secret, parts[0]);
    const actual = base64UrlToBytes(parts[1]);
    if (!equalBytes(expected, actual)) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.folder !== "string" || typeof payload.sessionId !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}
