const Discord = require('discord.js');
const { scheduleWelcome } = require('../../handlers/functions/voiceChannelStatusManager');

module.exports = async (client, interaction) => {
    const perms = await client.checkUserPerms({ flags: [Discord.PermissionsBitField.Flags.ManageGuild], perms: [Discord.PermissionsBitField.Flags.ManageGuild] }, interaction);
    if (perms === false) return;
    const channel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
    if (!channel || channel.type !== Discord.ChannelType.GuildVoice) return interaction.editReply({ content: '❌ Sélectionne un salon vocal ou rejoins-en un.' });
    const mode = interaction.options.getString('mode', true);
    const message = interaction.options.getString('message');
    await scheduleWelcome(client, channel, interaction.member, { force: mode === 'force', message });
    return interaction.editReply({ content: `✅ Overlay ${mode === 'force' ? 'forcé' : 'configuré'} déclenché pour ${channel}.` });
};
