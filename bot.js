require("dotenv").config();

const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
} = require("@discordjs/voice");

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const macosVoice = process.env.MACOS_TTS_VOICE || "com.apple.voice.compact.ja-JP.Kyoko";
const run = promisify(execFile);
const playbackQueues = new Map();

if (!token) {
  throw new Error("DISCORD_BOT_TOKEN が .env に設定されていません。");
}
if (!guildId) {
  throw new Error("DISCORD_GUILD_ID が .env に設定されていません。");
}

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Botの応答を確認します。"),
  new SlashCommandBuilder()
    .setName("join")
    .setDescription("あなたが参加中のボイスチャンネルへ接続します。"),
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription("ボイスチャンネルから退出します。"),
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("固定のテスト音を再生します。"),
  new SlashCommandBuilder()
    .setName("say")
    .setDescription("入力した文章を読み上げます。")
    .addStringOption((option) =>
      option
        .setName("text")
        .setDescription("読み上げる文章")
        .setRequired(true),
    ),
].map((command) => command.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

function createPlaybackQueue(guildId) {
  const player = createAudioPlayer({
    behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
  });
  const queue = { guildId, player, entries: [], current: null, subscription: null };

  player.on(AudioPlayerStatus.Idle, () => advanceQueue(queue));
  player.on("error", (error) => {
    console.error("Audio playback failed:", error);
    advanceQueue(queue);
  });
  playbackQueues.set(guildId, queue);
  return queue;
}

function getPlaybackQueue(guildId) {
  return playbackQueues.get(guildId) || createPlaybackQueue(guildId);
}

function startNext(queue) {
  if (queue.current || playbackQueues.get(queue.guildId) !== queue) return;

  const next = queue.entries.shift();
  if (!next) return;

  const connection = getVoiceConnection(queue.guildId);
  if (!connection) {
    Promise.resolve(next.cleanup?.()).catch(console.error);
    startNext(queue);
    return;
  }

  queue.current = next;
  queue.subscription?.unsubscribe();
  queue.subscription = connection.subscribe(queue.player);
  queue.player.play(createAudioResource(next.filePath));
}

function advanceQueue(queue) {
  if (playbackQueues.get(queue.guildId) !== queue) return;

  const finished = queue.current;
  queue.current = null;
  Promise.resolve(finished?.cleanup?.())
    .catch((error) => console.error("Audio cleanup failed:", error))
    .finally(() => startNext(queue));
}

function enqueueAudio(guildId, entry) {
  const queue = getPlaybackQueue(guildId);
  const position = queue.entries.length + (queue.current ? 1 : 0) + 1;
  queue.entries.push(entry);
  startNext(queue);
  return position;
}

function clearPlaybackQueue(guildId) {
  const queue = playbackQueues.get(guildId);
  if (!queue) return;

  playbackQueues.delete(guildId);
  queue.player.stop(true);
  queue.subscription?.unsubscribe();
  for (const entry of [queue.current, ...queue.entries]) {
    Promise.resolve(entry?.cleanup?.()).catch(console.error);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(
    Routes.applicationGuildCommands(readyClient.user.id, guildId),
    { body: commands },
  );
  console.log(`${readyClient.user.tag} としてログインしました。`);
  console.log("テストサーバーへ /ping と /join を登録しました。");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("Pong!");
    return;
  }

  if (interaction.commandName === "leave") {
    const connection = getVoiceConnection(interaction.guildId);
    if (!connection) {
      await interaction.reply({
        content: "ボイスチャンネルには接続していません。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    clearPlaybackQueue(interaction.guildId);
    connection.destroy();
    await interaction.reply({
      content: "ボイスチャンネルから退出しました。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "play") {
    const connection = getVoiceConnection(interaction.guildId);
    if (!connection) {
      await interaction.reply({
        content: "先に /join でボイスチャンネルへ接続してください。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const position = enqueueAudio(interaction.guildId, {
      filePath: path.join(__dirname, "assets", "test.mp3"),
    });

    await interaction.reply({
      content: position === 1 ? "テスト音を再生します。" : `テスト音を待ち行列の${position}番目に追加しました。`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "say") {
    const connection = getVoiceConnection(interaction.guildId);
    if (!connection) {
      await interaction.reply({
        content: "先に /join でボイスチャンネルへ接続してください。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const text = interaction.options.getString("text", true);
    const tempDir = path.join(__dirname, "tmp");
    const basePath = path.join(tempDir, randomUUID());
    const aiffPath = `${basePath}.aiff`;
    const mp3Path = `${basePath}.mp3`;

    try {
      await fs.mkdir(tempDir, { recursive: true });
      await run("swift", [
        path.join(__dirname, "scripts", "macos-tts.swift"),
        macosVoice,
        text,
        aiffPath,
      ]);
      await run("ffmpeg", ["-i", aiffPath, "-q:a", "4", "-y", mp3Path]);
      await fs.rm(aiffPath, { force: true });

      const position = enqueueAudio(interaction.guildId, {
        filePath: mp3Path,
        cleanup: () => fs.rm(mp3Path, { force: true }),
      });
      await interaction.editReply(
        position === 1 ? "読み上げます。" : `読み上げを待ち行列の${position}番目に追加しました。`,
      );
    } catch (error) {
      await fs.rm(aiffPath, { force: true });
      await fs.rm(mp3Path, { force: true });
      console.error("Text-to-speech generation failed:", error);
      await interaction.editReply("音声の生成または再生に失敗しました。");
    }
    return;
  }

  if (interaction.commandName !== "join") return;

  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    await interaction.reply({
      content: "先にボイスチャンネルへ参加してください。",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guildId,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    await interaction.editReply("ボイスチャンネルへ接続しました。");
  } catch (error) {
    connection.destroy();
    console.error("Voice connection failed:", error);
    await interaction.editReply("接続に失敗しました。BotのConnect権限を確認してください。");
  }
});

client.login(token);
