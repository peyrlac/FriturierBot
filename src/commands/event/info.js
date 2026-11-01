const Discord = require('discord.js');
const { getEventContext, getEventCreator, getCalendarLinks } = require('./utils');

module.exports = async (client, interaction) => {
    try {
        const context = await getEventContext(client, interaction);
        if (!context) return interaction.editReply({ content: 'Aucun événement associé à ce thread.' });

        const { event, eventThread } = context;
        const creator = await getEventCreator(client, event);
        const links = getCalendarLinks(event);
        const location = event.entityMetadata?.location || 'Non précisé';
        const start = `<t:${Math.floor(event.scheduledStartTimestamp / 1000)}:F>`;
        const end = event.scheduledEndTimestamp
            ? `<t:${Math.floor(event.scheduledEndTimestamp / 1000)}:F>`
            : 'Non précisée';

        const row = new Discord.ActionRowBuilder().addComponents(
            new Discord.ButtonBuilder().setLabel('Ajouter à Google Agenda').setStyle(Discord.ButtonStyle.Link).setURL(links.google),
            new Discord.ButtonBuilder().setLabel('Ajouter à Outlook').setStyle(Discord.ButtonStyle.Link).setURL(links.outlook)
        );
        if (eventThread.calendarAttachmentUrl) {
            row.addComponents(
                new Discord.ButtonBuilder()
                    .setLabel("Télécharger l'ical")
                    .setEmoji('📅')
                    .setStyle(Discord.ButtonStyle.Link)
                    .setURL(eventThread.calendarAttachmentUrl)
            );
        }

        return interaction.editReply({
            content: [
                `**${event.name}**`,
                `📅 Début : ${start}`,
                `🏁 Fin : ${end}`,
                `📍 Lieu : ${location}`,
                `👤 Créateur : <@${event.creatorId}>${creator ? ` (${creator.globalName || creator.username})` : ''}`,
                `🔗 Discord : ${event.url || 'Lien indisponible'}`
            ].join('\n'),
            components: [row]
        });
    } catch (error) {
        console.error('Erreur lors de l’affichage des informations de l’événement:', error);
        return interaction.editReply({ content: 'Impossible de récupérer les informations de l’événement.' });
    }
};
