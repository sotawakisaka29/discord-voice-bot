function hasNonBotMember(members) {
  if (!members || typeof members.some !== "function") return false;
  return members.some((member) => !member.user?.bot);
}

function shouldDisconnectFromEmptyChannel({
  oldChannelId,
  newChannelId,
  connectedChannelId,
  members,
}) {
  return Boolean(
    connectedChannelId
    && oldChannelId === connectedChannelId
    && newChannelId !== connectedChannelId
    && members
    && !hasNonBotMember(members)
  );
}

module.exports = {
  hasNonBotMember,
  shouldDisconnectFromEmptyChannel,
};
