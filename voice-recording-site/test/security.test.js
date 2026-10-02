import test from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, sanitizeParticipantName, secureStringEqual, verifySessionToken } from "../src/security.js";

test("participant names are normalized without losing Japanese characters", () => {
  assert.deepEqual(sanitizeParticipantName("  山田　太郎  "), { displayName: "山田 太郎", folderName: "山田 太郎" });
  assert.equal(sanitizeParticipantName("../someone"), null);
  assert.equal(sanitizeParticipantName(""), null);
});

test("constant-time comparison returns the expected result", async () => {
  assert.equal(await secureStringEqual("invite-a", "invite-a"), true);
  assert.equal(await secureStringEqual("invite-a", "invite-b"), false);
});

test("signed sessions can be verified and tampering is rejected", async () => {
  const secret = "test-secret-that-is-long-enough";
  const payload = { sessionId: "session", folder: "name/session", exp: Math.floor(Date.now() / 1000) + 60 };
  const token = await createSessionToken(payload, secret);
  assert.deepEqual(await verifySessionToken(token, secret), payload);
  assert.equal(await verifySessionToken(`${token}x`, secret), null);
});
