require("dotenv").config();

const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const run = promisify(execFile);
const voice = process.env.MACOS_TTS_VOICE || "com.apple.voice.compact.ja-JP.Kyoko";

async function main() {
  const tmpDir = path.join(__dirname, "tmp");
  const aiffPath = path.join(tmpDir, "tts-test.aiff");
  const mp3Path = path.join(tmpDir, "tts-test.mp3");

  await fs.mkdir(tmpDir, { recursive: true });
  await run("swift", [
    path.join(__dirname, "scripts", "macos-tts.swift"),
    voice,
    "こんにちは、音声テストです。",
    aiffPath,
  ]);
  await run("ffmpeg", ["-i", aiffPath, "-q:a", "4", "-y", mp3Path]);
  await fs.rm(aiffPath);
  console.log(`音声を生成しました: ${mp3Path}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
