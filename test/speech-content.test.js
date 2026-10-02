const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createMessageSpeechText,
  createVoiceStateSpeechText,
  replaceUrls,
} = require("../speech-content");

test("URL schemes, www links, and bare domains are replaced", () => {
  assert.equal(
    replaceUrls("https://example.com/a?q=1と www.example.net、discord.gg/example"),
    "URLと URL、URL",
  );
});

test("message text and attachments are combined for speech", () => {
  assert.equal(
    createMessageSpeechText({
      content: "資料は https://example.com/file です",
      attachments: new Map([["1", {}]]),
    }),
    "資料は URL です 添付ファイル",
  );
  assert.equal(
    createMessageSpeechText({ content: "", attachments: new Map([["1", {}]]) }),
    "添付ファイル",
  );
});

test("voice state changes are announced only for the connected channel", () => {
  const base = {
    connectedChannelId: "connected",
    displayName: "テストさん",
    isBot: false,
  };

  assert.equal(
    createVoiceStateSpeechText({ ...base, oldChannelId: null, newChannelId: "connected" }),
    "テストさんが入室しました",
  );
  assert.equal(
    createVoiceStateSpeechText({ ...base, oldChannelId: "connected", newChannelId: null }),
    "テストさんが退室しました",
  );
  assert.equal(
    createVoiceStateSpeechText({ ...base, oldChannelId: "other", newChannelId: null }),
    "",
  );
  assert.equal(
    createVoiceStateSpeechText({ ...base, oldChannelId: null, newChannelId: "connected", isBot: true }),
    "",
  );
});
