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

    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    const subscription = connection.subscribe(player);
    const resource = createAudioResource(path.join(__dirname, "assets", "test.mp3"));

    player.once(AudioPlayerStatus.Idle, () => subscription?.unsubscribe());
    player.on("error", (error) => console.error("Audio playback failed:", error));
    player.play(resource);

    await interaction.reply({
      content: "テスト音を再生します。",
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

      const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
      });
      const subscription = connection.subscribe(player);
      const cleanup = async () => {
        subscription?.unsubscribe();
        await fs.rm(mp3Path, { force: true });
      };

      player.once(AudioPlayerStatus.Idle, cleanup);
      player.once("error", async (error) => {
        console.error("Text-to-speech playback failed:", error);
        await cleanup();
      });
      player.play(createAudioResource(mp3Path));
      await interaction.editReply("読み上げます。");
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
