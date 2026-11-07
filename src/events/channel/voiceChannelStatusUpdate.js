const { observeVoiceStatus } = require('../../handlers/functions/voiceChannelStatusManager');

module.exports = async (client, channel, status) => {
    await observeVoiceStatus(client, channel, status);
};
