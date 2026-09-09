import os

import truststore

truststore.inject_into_ssl()

import discord
from dotenv import load_dotenv


load_dotenv()
token = os.getenv("DISCORD_BOT_TOKEN")
guild_id = os.getenv("DISCORD_GUILD_ID")

if not token:
    raise RuntimeError("DISCORD_BOT_TOKEN が .env に設定されていません。")
if not guild_id:
    raise RuntimeError("DISCORD_GUILD_ID が .env に設定されていません。")

intents = discord.Intents.default()
bot = discord.Bot(intents=intents, debug_guilds=[int(guild_id)])


@bot.event
async def on_ready():
    print(f"{bot.user} としてログインしました。")


@bot.slash_command(name="ping", description="Botの応答を確認します。")
async def ping(ctx: discord.ApplicationContext):
    await ctx.respond("Pong!")


bot.run(token)
