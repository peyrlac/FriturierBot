const Discord = require('discord.js');
const { forceReset } = require('../../handlers/functions/voiceChannelStatusManager');

module.exports = async (client, interaction) => {
    const perms = await client.checkUserPerms({ flags: [Discord.PermissionsBitField.Flags.ManageGuild], perms: [Discord.PermissionsBitField.Flags.ManageGuild] }, interaction);
    if (perms === false) return;
    const channel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
    if (!channel || channel.type !== Discord.ChannelType.GuildVoice) return interaction.editReply({ content: '❌ Sélectionne un salon vocal ou rejoins-en un.' });
    try {
        const result = await forceReset(client, channel);
        if (!result) return interaction.editReply({ content: `⏳ Une autre synchronisation est déjà en cours pour ${channel}. Le reset sera repris automatiquement.` });
        return interaction.editReply({ content: `✅ Statut et verrou réinitialisés pour ${channel}.` });
    } catch (error) {
        // forceReset conserve la demande en base et la réconciliation la
        // reprendra après le backoff. Ne laisse pas l'exception devenir une
        // promesse non gérée après le deferReply de la commande.
        return interaction.editReply({ content: `⚠️ Discord n’a pas accepté le reset immédiatement pour ${channel}. La demande reste enregistrée et sera retentée automatiquement.` });
    }
};
