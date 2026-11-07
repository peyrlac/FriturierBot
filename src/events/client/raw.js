const Discord = require('discord.js');
const { observeVoiceStatus } = require('../../handlers/functions/voiceChannelStatusManager');

const VOICE_CHANNEL_STATUS_UPDATE = 'VOICE_CHANNEL_STATUS_UPDATE';

module.exports = async (client, d) => {
    client.player.updateVoiceState(d);

    if (d?.t !== VOICE_CHANNEL_STATUS_UPDATE) return;

    const payload = d.d || {};
    const channelId = payload.channel_id || payload.channelId || payload.id;
    const channel = channelId ? client.channels.cache.get(channelId) : null;
    if (!channel?.guild) return;
    if (typeof client.isFeatureEnabled === 'function' &&
        !(await client.isFeatureEnabled('voiceChannelStatus', channel.guild.id))) return;

    try {
        await observeVoiceStatus(client, channelId, payload.status ?? payload.voice_status ?? payload.voiceStatus ?? null);
    } catch (error) {
        // Une observation gateway est best-effort : elle ne doit pas créer de
        // promesse non gérée ni empêcher le traitement des autres paquets.
        console.error('[Voice Channel Status] Failed to observe gateway status update:', error);
    }
}

 
