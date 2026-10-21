const test = require("node:test");
const assert = require("node:assert/strict");

const {
  hasNonBotMember,
  shouldDisconnectFromEmptyChannel,
} = require("../voice-channel-state");

function members(...botFlags) {
  return botFlags.map((bot) => ({ user: { bot } }));
}

test("non-bot members keep the voice connection alive", () => {
  assert.equal(hasNonBotMember(members(true, false)), true);
  assert.equal(shouldDisconnectFromEmptyChannel({
    oldChannelId: "connected",
    newChannelId: null,
    connectedChannelId: "connected",
    members: members(true, false),
  }), false);
});

test("the bot disconnects when only bots remain after a departure", () => {
  assert.equal(hasNonBotMember(members(true, true)), false);
  assert.equal(shouldDisconnectFromEmptyChannel({
    oldChannelId: "connected",
    newChannelId: null,
    connectedChannelId: "connected",
    members: members(true),
  }), true);
});

test("changes outside the connected channel do not disconnect the bot", () => {
  assert.equal(shouldDisconnectFromEmptyChannel({
    oldChannelId: "other",
    newChannelId: null,
    connectedChannelId: "connected",
    members: members(true),
  }), false);
  assert.equal(shouldDisconnectFromEmptyChannel({
    oldChannelId: null,
    newChannelId: "connected",
    connectedChannelId: "connected",
    members: members(true),
  }), false);
});
