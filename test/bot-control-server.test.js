const test = require("node:test");
const assert = require("node:assert/strict");

const {
  startBotControlServer,
  stopBotControlServer,
} = require("../bot-control-server");

test("control server reports the running bot identity", async (t) => {
  const server = await startBotControlServer({
    projectPath: "/tmp/voice-bot-test",
    pid: 12345,
    port: 0,
  });
  t.after(() => stopBotControlServer(server));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "discord-voice-bot",
    projectPath: "/tmp/voice-bot-test",
    pid: 12345,
  });
});

test("a second bot cannot claim the same control port", async (t) => {
  const firstServer = await startBotControlServer({
    projectPath: "/tmp/voice-bot-test",
    port: 0,
  });
  t.after(() => stopBotControlServer(firstServer));

  const address = firstServer.address();
  await assert.rejects(
    startBotControlServer({
      projectPath: "/tmp/voice-bot-test",
      port: address.port,
    }),
    (error) => error.code === "BOT_ALREADY_RUNNING",
  );
});
