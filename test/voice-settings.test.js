const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deserializeUserVoiceSettings,
  getUserVoiceId,
  serializeUserVoiceSettings,
  setUserVoiceId,
} = require("../voice-settings");

test("voice selections are isolated by guild and user", () => {
  const settings = new Map();
  setUserVoiceId(settings, "guild-1", "user-a", "wakiso");
  setUserVoiceId(settings, "guild-1", "user-b", "yucchin");
  setUserVoiceId(settings, "guild-2", "user-a", "kyoko");

  assert.equal(getUserVoiceId(settings, "guild-1", "user-a"), "wakiso");
  assert.equal(getUserVoiceId(settings, "guild-1", "user-b"), "yucchin");
  assert.equal(getUserVoiceId(settings, "guild-2", "user-a"), "kyoko");
  assert.equal(getUserVoiceId(settings, "guild-2", "user-b"), undefined);
});

test("user voice settings round-trip as nested JSON", () => {
  const settings = deserializeUserVoiceSettings({
    "guild-1": { "user-a": "wakiso", "user-b": "yucchin" },
  });

  assert.deepEqual(serializeUserVoiceSettings(settings), {
    "guild-1": { "user-a": "wakiso", "user-b": "yucchin" },
  });
});

test("legacy wskiso ID is migrated while loading", () => {
  const settings = deserializeUserVoiceSettings({
    "guild-1": { "user-a": "wskiso" },
  });

  assert.equal(getUserVoiceId(settings, "guild-1", "user-a"), "wakiso");
});
