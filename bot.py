import os

import truststore

truststore.inject_into_ssl()

import discord
from dotenv import load_dotenv


load_dotenv()
token = os.getenv("DISCORD_BOT_TOKEN")

if not token:
    raise RuntimeError("DISCORD_BOT_TOKEN が .env に設定されていません。")

intents = discord.Intents.default()
bot = discord.Bot(intents=intents)


@bot.event
async def on_ready():
    print(f"{bot.user} としてログインしました。")


bot.run(token)
