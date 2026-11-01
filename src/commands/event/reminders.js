const { model: AnnouncementChannels } = require('../../database/models/announcement-channels');
module.exports = async (client, interaction) => {
    try {
        if (!interaction.channel?.isThread()) {
            return interaction.editReply({ content: 'Cette commande doit être utilisée dans le thread de l’événement.' });
        }

        const data = await AnnouncementChannels.findOne({
            Guild: interaction.guildId,
            'EventThreads.threadId': interaction.channel.id
        });
        const eventThread = data?.EventThreads?.find(item => item.threadId === interaction.channel.id);
        if (!eventThread) return interaction.editReply({ content: 'Aucun événement associé à ce thread.' });

        const event = await interaction.guild.scheduledEvents.fetch(eventThread.eventId).catch(() => null);
        if (!event) return interaction.editReply({ content: 'Événement introuvable sur Discord.' });
        if (event.creatorId !== interaction.user.id) {
            return interaction.editReply({ content: 'Seul le créateur de l’événement peut gérer ses rappels.' });
        }

        const reminder = interaction.options.getString('reminder', true);
        const action = interaction.options.getString('action', true);
        const reminderDelays = {
            month: 30 * 24 * 60 * 60 * 1000,
            week: 7 * 24 * 60 * 60 * 1000,
            day: 24 * 60 * 60 * 1000
        };
        const reminderLabels = { month: '1 mois', week: '1 semaine', day: '1 jour' };
        const reminderTimestamp = event.scheduledStartTimestamp - reminderDelays[reminder];

        if (action !== 'disable' && Date.now() >= reminderTimestamp) {
            return interaction.editReply({
                content: `Le rappel « ${reminderLabels[reminder]} avant » est déjà passé ; il ne peut pas être réactivé ou réinitialisé.`
            });
        }

        const current = eventThread.sentReminders || {};
        const sentReminders = ['month', 'week', 'day'].reduce((result, type) => {
            const existing = current[type];
            result[type] = typeof existing === 'object'
                ? { sent: existing.sent === true, timestamp: existing.timestamp || null }
                : { sent: existing === true, timestamp: null };
            return result;
        }, {});

        sentReminders[reminder] = action === 'disable'
            ? { sent: true, timestamp: Date.now() }
            : { sent: false, timestamp: null };

        await AnnouncementChannels.updateOne(
            { Guild: interaction.guildId, 'EventThreads.threadId': interaction.channel.id },
            { $set: { 'EventThreads.$.sentReminders': sentReminders } }
        );

        const actionLabel = action === 'disable' ? 'désactivé' : action === 'reset' ? 'réinitialisé' : 'activé';
        return interaction.editReply({ content: `Le rappel « ${reminderLabels[reminder]} avant » est ${actionLabel}.` });
    } catch (error) {
        console.error('Erreur lors de la gestion des rappels:', error);
        return interaction.editReply({ content: 'Impossible de modifier les rappels pour le moment.' });
    }
};
