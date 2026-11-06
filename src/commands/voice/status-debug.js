const Discord = require('discord.js');
const { collectActivities, getEffectiveConfig, resolveStatus } = require('../../handlers/functions/voiceChannelStatus');
const VoiceChannelStatusState = require('../../database/models/voiceChannelStatusState');

module.exports = async (client, interaction) => {
    const perms = await client.checkUserPerms({ flags: [Discord.PermissionsBitField.Flags.ManageGuild], perms: [Discord.PermissionsBitField.Flags.ManageGuild] }, interaction);
    if (perms === false) return;
    const channel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
    if (!channel || channel.type !== Discord.ChannelType.GuildVoice) return interaction.editReply({ content: '❌ Sélectionne un salon vocal ou rejoins-en un.' });
    const config = await getEffectiveConfig(channel.guild.id, channel.parentId, channel.id);
    const state = await VoiceChannelStatusState.findOne({ guildId: channel.guild.id, channelId: channel.id }).lean();
    const decision = resolveStatus({ activities: collectActivities(channel), config: { ...config, voiceMemberCount: channel.members.size }, state: state || {}, voiceMemberCount: channel.members.size });
    return interaction.editReply({ content: ````json\n${JSON.stringify({ channel: channel.name, members: channel.members.size, decision, state, config }, null, 2).slice(0, 1900)}\n```` });
};
