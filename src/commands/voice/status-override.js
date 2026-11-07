const Discord = require('discord.js');
const { scheduleWelcome } = require('../../handlers/functions/voiceChannelStatusManager');

module.exports = async (client, interaction) => {
    const perms = await client.checkUserPerms({ flags: [Discord.PermissionsBitField.Flags.ManageGuild], perms: [Discord.PermissionsBitField.Flags.ManageGuild] }, interaction);
    if (perms === false) return;
    const channel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
    if (!channel || channel.type !== Discord.ChannelType.GuildVoice) return interaction.editReply({ content: '❌ Sélectionne un salon vocal ou rejoins-en un.' });
    const mode = interaction.options.getString('mode', true);
    const message = interaction.options.getString('message');
    try {
        const result = await scheduleWelcome(client, channel, null, { force: mode === 'force', message, explicit: true });
        if (!result) return interaction.editReply({ content: '⚠️ Aucun overlay n’a été écrit : vérifie que le salon est occupé, que les messages de bienvenue sont activés et que les quiet hours ne bloquent pas la demande.' });
        return interaction.editReply({ content: `✅ Overlay ${mode === 'force' ? 'forcé' : 'configuré'} déclenché pour ${channel}.` });
    } catch (error) {
        return interaction.editReply({ content: `⚠️ Discord n’a pas accepté l’overlay immédiatement pour ${channel}. Vérifie les permissions et réessaie.` });
    }
};
