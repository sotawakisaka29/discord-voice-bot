const URL_PATTERN = /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.)[^\s<>{}\[\]"'`\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:\/[^\s<>{}\[\]"'`\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]*)?/giu;

function replaceUrls(text) {
  return text.replace(URL_PATTERN, "URL");
}

function createMessageSpeechText(message) {
  const parts = [];
  const content = replaceUrls(message.content || "").trim();

  if (content) parts.push(content);
  if (message.attachments?.size > 0) parts.push("添付ファイル");

  return parts.join(" ");
}

function createVoiceStateSpeechText({
  oldChannelId,
  newChannelId,
  connectedChannelId,
  displayName,
  isBot,
}) {
  if (!connectedChannelId || !displayName || isBot || oldChannelId === newChannelId) return "";

  if (newChannelId === connectedChannelId) {
    return `${displayName}が入室しました`;
  }

  if (oldChannelId === connectedChannelId) {
    return `${displayName}が退室しました`;
  }

  return "";
}

module.exports = {
  createMessageSpeechText,
  createVoiceStateSpeechText,
  replaceUrls,
};
