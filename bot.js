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
  PermissionFlagsBits,
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
const run = promisify(execFile);
const playbackQueues = new Map();
const speechGenerationChains = new Map();
const voiceProfilesPath = path.join(__dirname, "voices.json");
const guildVoiceSettingsPath = path.join(__dirname, "data", "guild-voices.json");
const tempDir = path.join(__dirname, "tmp");
let voiceProfiles = new Map();
let guildVoiceIds = new Map();

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
  new SlashCommandBuilder()
    .setName("voices")
    .setDescription("利用できる声の一覧を表示します。"),
  new SlashCommandBuilder()
    .setName("setvoice")
    .setDescription("このサーバーで使う声を切り替えます。")
    .addStringOption((option) =>
      option
        .setName("voice")
        .setDescription("voices.json に登録した声のID")
        .setRequired(true),
    ),
].map((command) => command.toJSON());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on("error", (error) => {
  console.error("Discord client error:", error);
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

async function loadVoiceProfiles() {
  const contents = await fs.readFile(voiceProfilesPath, "utf8");
  const profiles = JSON.parse(contents).voices;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    throw new Error("voices.json に少なくとも1つの声を登録してください。");
  }

  for (const profile of profiles) {
    if (!profile.id || !profile.label || !profile.engine) {
      throw new Error("voices.json の各プロフィールには id、label、engine が必要です。");
    }

    if (profile.engine === "gpt-sovits") {
      const requiredFields = ["apiUrl", "referenceAudioPath", "promptText", "promptLanguage"];
      const missingFields = requiredFields.filter((field) => !profile[field]);
      if (missingFields.length > 0) {
        throw new Error(`GPT-SoVITSプロフィール「${profile.id}」に ${missingFields.join("、")} が設定されていません。`);
      }

      const apiUrl = new URL(profile.apiUrl);
      if (!['127.0.0.1', 'localhost', '::1'].includes(apiUrl.hostname)) {
        throw new Error(`GPT-SoVITSプロフィール「${profile.id}」の apiUrl はローカルアドレスにしてください。`);
      }
    }

    if (profile.engine === "style-bert-vits2") {
      if (!profile.apiUrl) {
        throw new Error(`Style-Bert-VITS2プロフィール「${profile.id}」に apiUrl が設定されていません。`);
      }

      const apiUrl = new URL(profile.apiUrl);
      if (!['127.0.0.1', 'localhost', '::1'].includes(apiUrl.hostname)) {
        throw new Error(`Style-Bert-VITS2プロフィール「${profile.id}」の apiUrl はローカルアドレスにしてください。`);
      }
    }
  }

  voiceProfiles = new Map(profiles.map((profile) => [profile.id, profile]));
}

async function loadGuildVoiceSettings() {
  await fs.mkdir(path.dirname(guildVoiceSettingsPath), { recursive: true });
  try {
    const contents = await fs.readFile(guildVoiceSettingsPath, "utf8");
    guildVoiceIds = new Map(Object.entries(JSON.parse(contents)));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function saveGuildVoiceSettings() {
  await fs.writeFile(
    guildVoiceSettingsPath,
    `${JSON.stringify(Object.fromEntries(guildVoiceIds), null, 2)}\n`,
  );
}

function getSelectedVoice(guildId) {
  return voiceProfiles.get(guildVoiceIds.get(guildId)) || voiceProfiles.values().next().value;
}

async function generateMacOsSpeech(voice, text, outputPath) {
  const aiffPath = outputPath.replace(/\.mp3$/, ".aiff");
  try {
    await run("swift", [
      path.join(__dirname, "scripts", "macos-tts.swift"),
      voice.macosVoice,
      text,
      aiffPath,
    ]);
    await run("ffmpeg", ["-i", aiffPath, "-q:a", "4", "-y", outputPath]);
  } finally {
    await fs.rm(aiffPath, { force: true });
  }
}

async function generateGptSoVitsSpeech(voice, text, outputPath) {
  const requestUrl = new URL(voice.apiUrl);
  requestUrl.search = new URLSearchParams({
    text,
    text_lang: voice.textLanguage || "ja",
    ref_audio_path: voice.referenceAudioPath,
    prompt_text: voice.promptText,
    prompt_lang: voice.promptLanguage,
    media_type: "wav",
    text_split_method: "cut5",
  }).toString();

  const response = await fetch(requestUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GPT-SoVITS API error (${response.status}): ${detail.slice(0, 500)}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("audio") && !contentType.includes("octet-stream")) {
    throw new Error(`GPT-SoVITS API returned an unexpected content type: ${contentType}`);
  }

  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

async function generateStyleBertVits2Speech(voice, text, outputPath) {
  const requestUrl = new URL(voice.apiUrl);
  requestUrl.search = new URLSearchParams({ text }).toString();

  const response = await fetch(requestUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Style-Bert-VITS2 API error (${response.status}): ${detail.slice(0, 500)}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("audio") && !contentType.includes("octet-stream")) {
    throw new Error(`Style-Bert-VITS2 API returned an unexpected content type: ${contentType}`);
  }

  await fs.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
}

async function generateSpeech(voice, text, outputPath) {
  if (voice.engine === "macos") {
    await generateMacOsSpeech(voice, text, outputPath.replace(/\.wav$/, ".mp3"));
    return outputPath.replace(/\.wav$/, ".mp3");
  }

  if (voice.engine === "gpt-sovits") {
    await generateGptSoVitsSpeech(voice, text, outputPath);
    return outputPath;
  }

  if (voice.engine === "style-bert-vits2") {
    await generateStyleBertVits2Speech(voice, text, outputPath);
    return outputPath;
  }

  throw new Error(`未対応の音声エンジンです: ${voice.engine}`);
}

function enqueueGeneratedSpeech(guildId, voice, text) {
  const previous = speechGenerationChains.get(guildId) || Promise.resolve();
  const task = previous.catch(() => undefined).then(async () => {
    const basePath = path.join(tempDir, randomUUID());
    const outputPath = `${basePath}.wav`;
    let generatedPath;

    try {
      await fs.mkdir(tempDir, { recursive: true });
      generatedPath = await generateSpeech(voice, text, outputPath);
      return enqueueAudio(guildId, {
        filePath: generatedPath,
        cleanup: () => fs.rm(generatedPath, { force: true }),
      });
    } catch (error) {
      await fs.rm(outputPath, { force: true });
      if (generatedPath && generatedPath !== outputPath) {
        await fs.rm(generatedPath, { force: true });
      }
      throw error;
    }
  });

  speechGenerationChains.set(guildId, task);
  task.finally(() => {
    if (speechGenerationChains.get(guildId) === task) {
      speechGenerationChains.delete(guildId);
    }
  }).catch(() => undefined);
  return task;
}

client.once(Events.ClientReady, async (readyClient) => {
  await loadVoiceProfiles();
  await loadGuildVoiceSettings();
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(
    Routes.applicationGuildCommands(readyClient.user.id, guildId),
    { body: commands },
  );
  console.log(`${readyClient.user.tag} としてログインしました。`);
  console.log("テストサーバーへスラッシュコマンドを登録しました。");
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply("Pong!");
    return;
  }

  if (interaction.commandName === "voices") {
    const selectedVoice = getSelectedVoice(interaction.guildId);
    const list = [...voiceProfiles.values()]
      .map((voice) => `${voice.id === selectedVoice.id ? "•" : " "} ${voice.id} — ${voice.label}`)
      .join("\n");
    await interaction.reply({
      content: `利用できる声:\n${list}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "setvoice") {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: "この操作にはサーバーの管理権限が必要です。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const voiceId = interaction.options.getString("voice", true);
    const voice = voiceProfiles.get(voiceId);
    if (!voice) {
      await interaction.reply({
        content: "その声は登録されていません。/voices で一覧を確認してください。",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    guildVoiceIds.set(interaction.guildId, voiceId);
    await saveGuildVoiceSettings();
    await interaction.reply({
      content: `読み上げる声を「${voice.label}」に切り替えました。`,
      flags: MessageFlags.Ephemeral,
    });
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

    const selectedVoice = getSelectedVoice(interaction.guildId);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const text = interaction.options.getString("text", true);

    try {
      const position = await enqueueGeneratedSpeech(interaction.guildId, selectedVoice, text);
      await interaction.editReply(
        position === 1 ? "読み上げます。" : `読み上げを待ち行列の${position}番目に追加しました。`,
      );
    } catch (error) {
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

client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild() || message.author.bot) return;

  const text = message.content.trim();
  if (!text || text.length > 500) return;
  if (!getVoiceConnection(message.guildId)) return;

  const selectedVoice = getSelectedVoice(message.guildId);
  try {
    await enqueueGeneratedSpeech(message.guildId, selectedVoice, text);
  } catch (error) {
    console.error("Chat message speech generation failed:", error);
  }
});

client.login(token);
