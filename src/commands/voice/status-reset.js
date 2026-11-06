const Discord = require('discord.js');
const { forceReset } = require('../../handlers/functions/voiceChannelStatusManager');

module.exports = async (client, interaction) => {
    const perms = await client.checkUserPerms({ flags: [Discord.PermissionsBitField.Flags.ManageGuild], perms: [Discord.PermissionsBitField.Flags.ManageGuild] }, interaction);
    if (perms === false) return;
    const channel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
    if (!channel || channel.type !== Discord.ChannelType.GuildVoice) return interaction.editReply({ content: '❌ Sélectionne un salon vocal ou rejoins-en un.' });
    await forceReset(client, channel);
    return interaction.editReply({ content: `✅ Statut et verrou réinitialisés pour ${channel}.` });
};
