const { handlePresenceUpdate } = require('../../handlers/functions/voiceChannelStatusManager');

module.exports = async (client, oldPresence, newPresence) => {
    await handlePresenceUpdate(client, oldPresence, newPresence);
};
