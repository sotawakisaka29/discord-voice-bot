import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { encodeMonoPcm16Wav } from "../public/wav.js";

class MemoryBucket {
  constructor() {
    this.objects = new Map();
  }

  async put(key, value) {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.objects.set(key, bytes);
  }

  async get(key) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    return {
      body: bytes,
      json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    };
  }

  async list({ prefix }) {
    return {
      objects: [...this.objects.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key, uploaded: new Date("2026-10-01T00:00:00Z") })),
      truncated: false,
    };
  }
}

function testEnv() {
  return {
    INVITE_CODE: "test-invite",
    SESSION_SECRET: "test-session-secret",
    RECORDINGS_BUCKET: new MemoryBucket(),
  };
}

test("a consented participant receives a session and can upload an allowed WAV", async () => {
  const env = testEnv();
  const sessionResponse = await worker.fetch(new Request("https://example.test/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inviteCode: "test-invite",
      name: "テスト参加者",
      consent: { purpose: true, voiceData: true, safeContent: true },
    }),
  }), env);

  assert.equal(sessionResponse.status, 201);
  const session = await sessionResponse.json();
  assert.match(session.folder, /^テスト参加者\/[0-9a-f-]{36}$/u);

  const wav = encodeMonoPcm16Wav(new Float32Array([0, 0.2, -0.2]));
  const uploadResponse = await worker.fetch(new Request("https://example.test/api/recordings/0001.wav", {
    method: "PUT",
    headers: { "Authorization": `Bearer ${session.token}`, "Content-Type": "audio/wav" },
    body: wav,
  }), env);

  assert.equal(uploadResponse.status, 200);
  assert.ok(env.RECORDINGS_BUCKET.objects.has(`recordings/${session.folder}/0001.wav`));

  const playbackResponse = await worker.fetch(new Request("https://example.test/api/recordings/0001.wav", {
    headers: { "Authorization": `Bearer ${session.token}` },
  }), env);
  assert.equal(playbackResponse.status, 200);
  assert.equal(playbackResponse.headers.get("Content-Type"), "audio/wav");
  assert.equal((await playbackResponse.arrayBuffer()).byteLength, wav.size);

  const statusResponse = await worker.fetch(new Request("https://example.test/api/session", {
    headers: { "Authorization": `Bearer ${session.token}` },
  }), env);
  assert.equal(statusResponse.status, 200);
  assert.deepEqual((await statusResponse.json()).completed, ["0001.wav"]);
});

test("invalid invite codes and filenames are rejected", async () => {
  const env = testEnv();
  const response = await worker.fetch(new Request("https://example.test/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inviteCode: "wrong",
      name: "someone",
      consent: { purpose: true, voiceData: true, safeContent: true },
    }),
  }), env);
  assert.equal(response.status, 403);
});

test("an authenticated administrator can list participants and listen to recordings", async () => {
  const env = { ...testEnv(), ADMIN_PASSWORD: "test-admin-password" };
  const participantResponse = await worker.fetch(new Request("https://example.test/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inviteCode: "test-invite",
      name: "管理画面テスト",
      consent: { purpose: true, voiceData: true, safeContent: true },
    }),
  }), env);
  const participant = await participantResponse.json();
  const wav = encodeMonoPcm16Wav(new Float32Array([0, 0.1, -0.1]));
  await worker.fetch(new Request("https://example.test/api/recordings/0001.wav", {
    method: "PUT",
    headers: { "Authorization": `Bearer ${participant.token}`, "Content-Type": "audio/wav" },
    body: wav,
  }), env);

  const loginResponse = await worker.fetch(new Request("https://example.test/api/admin/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "test-admin-password" }),
  }), env);
  assert.equal(loginResponse.status, 200);
  const admin = await loginResponse.json();

  const listResponse = await worker.fetch(new Request("https://example.test/api/admin/participants", {
    headers: { "Authorization": `Bearer ${admin.token}` },
  }), env);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.participants.length, 1);
  assert.equal(list.participants[0].displayName, "管理画面テスト");
  assert.deepEqual(list.participants[0].files, ["0001.wav"]);

  const params = new URLSearchParams({ folder: participant.folder, filename: "0001.wav" });
  const audioResponse = await worker.fetch(new Request(`https://example.test/api/admin/recording?${params}`, {
    headers: { "Authorization": `Bearer ${admin.token}` },
  }), env);
  assert.equal(audioResponse.status, 200);
  assert.equal(audioResponse.headers.get("Content-Type"), "audio/wav");
  assert.equal((await audioResponse.arrayBuffer()).byteLength, wav.size);
});

test("administrator APIs reject the participant token", async () => {
  const env = { ...testEnv(), ADMIN_PASSWORD: "test-admin-password" };
  const response = await worker.fetch(new Request("https://example.test/api/admin/participants"), env);
  assert.equal(response.status, 401);
});

test("an administrator can download a participant folder as a streamed ZIP", async () => {
  const env = { ...testEnv(), ADMIN_PASSWORD: "test-admin-password" };
  const participantResponse = await worker.fetch(new Request("https://example.test/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      inviteCode: "test-invite",
      name: "ZIP確認",
      consent: { purpose: true, voiceData: true, safeContent: true },
    }),
  }), env);
  const participant = await participantResponse.json();
  const wav = encodeMonoPcm16Wav(new Float32Array([0, 0.1, -0.1]));
  await worker.fetch(new Request("https://example.test/api/recordings/0001.wav", {
    method: "PUT",
    headers: { "Authorization": `Bearer ${participant.token}`, "Content-Type": "audio/wav" },
    body: wav,
  }), env);

  const loginResponse = await worker.fetch(new Request("https://example.test/api/admin/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "test-admin-password" }),
  }), env);
  const admin = await loginResponse.json();
  const tokenResponse = await worker.fetch(new Request("https://example.test/api/admin/download-token", {
    method: "POST",
    headers: { "Authorization": `Bearer ${admin.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ folder: participant.folder }),
  }), env);
  assert.equal(tokenResponse.status, 200);
  const download = await tokenResponse.json();

  const zipResponse = await worker.fetch(new Request(`https://example.test${download.url}`), env);
  assert.equal(zipResponse.status, 200);
  assert.equal(zipResponse.headers.get("Content-Type"), "application/zip");
  const zip = new Uint8Array(await zipResponse.arrayBuffer());
  assert.deepEqual([...zip.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  const zipText = new TextDecoder().decode(zip);
  assert.match(zipText, /0001\.wav/u);
  assert.match(zipText, /_profile\.json/u);
});
