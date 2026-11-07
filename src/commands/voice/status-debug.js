const Discord = require('discord.js');
const { collectActivities, getEffectiveConfig, resolveStatus } = require('../../handlers/functions/voiceChannelStatus');
const VoiceChannelStatusState = require('../../database/models/voiceChannelStatusState');

module.exports = async (client, interaction) => {
    const perms = await client.checkUserPerms({ flags: [Discord.PermissionsBitField.Flags.ManageGuild], perms: [Discord.PermissionsBitField.Flags.ManageGuild] }, interaction);
    if (perms === false) return;
    const channel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
    if (!channel || channel.type !== Discord.ChannelType.GuildVoice) return interaction.editReply({ content: '❌ Sélectionne un salon vocal ou rejoins-en un.' });
    let config;
    let state;
    let decision;
    try {
        config = await getEffectiveConfig(channel.guild.id, channel.parentId, channel.id);
        state = await VoiceChannelStatusState.findOne({ guildId: channel.guild.id, channelId: channel.id }).lean();
        decision = resolveStatus({ activities: collectActivities(channel), config: { ...config, voiceMemberCount: channel.members.size }, state: state || {}, voiceMemberCount: channel.members.size });
    } catch (error) {
        return interaction.editReply({ content: '❌ Impossible de lire la configuration ou l’état MongoDB de ce salon.' });
    }
    const seen = new WeakSet();
    const payload = JSON.stringify({
        channel: channel.name,
        members: channel.members.size,
        decision,
        state,
        config,
    }, (key, value) => {
        if (key === 'member') return undefined;
        if (value instanceof Set) return [...value];
        if (value && typeof value === 'object') {
            if (seen.has(value)) return '[Circular]';
            seen.add(value);
        }
        return value;
    }, 2).slice(0, 1800);
    return interaction.editReply({ content: ['```json', payload, '```'].join('\n') });
};
