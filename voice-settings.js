const LEGACY_VOICE_IDS = new Map([
  ["wskiso", "wakiso"],
]);

function normalizeVoiceId(voiceId) {
  return LEGACY_VOICE_IDS.get(voiceId) || voiceId;
}

function createUserVoiceKey(guildId, userId) {
  if (!guildId || !userId) return null;
  return `${guildId}:${userId}`;
}

function deserializeUserVoiceSettings(value) {
  const settings = new Map();
  if (!value || typeof value !== "object" || Array.isArray(value)) return settings;

  for (const [guildId, guildSettings] of Object.entries(value)) {
    if (!guildSettings || typeof guildSettings !== "object" || Array.isArray(guildSettings)) {
      continue;
    }

    for (const [userId, voiceId] of Object.entries(guildSettings)) {
      if (typeof voiceId !== "string") continue;
      settings.set(createUserVoiceKey(guildId, userId), normalizeVoiceId(voiceId));
    }
  }

  return settings;
}

function serializeUserVoiceSettings(settings) {
  const result = {};
  for (const [key, voiceId] of settings) {
    const separatorIndex = key.indexOf(":");
    if (separatorIndex < 1 || typeof voiceId !== "string") continue;

    const guildId = key.slice(0, separatorIndex);
    const userId = key.slice(separatorIndex + 1);
    if (!userId) continue;

    result[guildId] ||= {};
    result[guildId][userId] = normalizeVoiceId(voiceId);
  }
  return result;
}

function getUserVoiceId(settings, guildId, userId) {
  const key = createUserVoiceKey(guildId, userId);
  return key ? settings.get(key) : undefined;
}

function setUserVoiceId(settings, guildId, userId, voiceId) {
  const key = createUserVoiceKey(guildId, userId);
  if (!key) throw new Error("サーバーIDとユーザーIDが必要です。");
  settings.set(key, normalizeVoiceId(voiceId));
}

module.exports = {
  createUserVoiceKey,
  deserializeUserVoiceSettings,
  getUserVoiceId,
  serializeUserVoiceSettings,
  setUserVoiceId,
};
