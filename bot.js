require("dotenv").config();

const {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const {
  entersState,
  joinVoiceChannel,
  VoiceConnectionStatus,
} = require("@discordjs/voice");

const token = process.env.DISCORD_BOT_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

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

  if (interaction.commandName !== "join") return;

  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    await interaction.reply({
      content: "先にボイスチャンネルへ参加してください。",
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
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
