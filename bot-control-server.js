const http = require("node:http");

const BOT_CONTROL_HOST = "127.0.0.1";
const BOT_CONTROL_PORT = 5001;

function startBotControlServer({
  projectPath,
  pid = process.pid,
  host = BOT_CONTROL_HOST,
  port = BOT_CONTROL_PORT,
}) {
  const server = http.createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      service: "discord-voice-bot",
      projectPath,
      pid,
    }));
  });

  return new Promise((resolve, reject) => {
    const handleInitialError = (error) => {
      if (error.code === "EADDRINUSE") {
        const duplicateError = new Error(
          `Discord Botはすでに起動しています（${host}:${port}）。`,
        );
        duplicateError.code = "BOT_ALREADY_RUNNING";
        reject(duplicateError);
        return;
      }
      reject(error);
    };

    server.once("error", handleInitialError);
    server.listen(port, host, () => {
      server.off("error", handleInitialError);
      resolve(server);
    });
  });
}

function stopBotControlServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

module.exports = {
  BOT_CONTROL_HOST,
  BOT_CONTROL_PORT,
  startBotControlServer,
  stopBotControlServer,
};
