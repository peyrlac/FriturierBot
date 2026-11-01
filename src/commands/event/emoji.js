const Discord = require('discord.js');
const { model: AnnouncementChannels } = require('../../database/models/announcement-channels');

module.exports = async (client, interaction) => {
    try {
        if (!interaction.channel?.isThread()) {
            return interaction.editReply({
                content: 'Cette commande doit être utilisée dans le thread de ton événement.'
            });
        }

        const emoji = interaction.options.getString('emoji', true).trim();
        if (!emoji || emoji.length > 32 || /\s/.test(emoji)) {
            return interaction.editReply({
                content: 'Fournis un emoji valide, sans espace, de 32 caractères maximum.'
            });
        }

        const data = await AnnouncementChannels.findOne({
            Guild: interaction.guildId,
            'EventThreads.threadId': interaction.channel.id
        });
        const eventThread = data?.EventThreads?.find(thread => thread.threadId === interaction.channel.id);

        if (!eventThread) {
            return interaction.editReply({
                content: 'Aucun événement associé à ce thread.'
            });
        }

        const event = await interaction.guild.scheduledEvents.fetch(eventThread.eventId).catch(() => null);
        if (!event) {
            return interaction.editReply({
                content: 'Événement introuvable sur Discord.'
            });
        }

        if (event.creatorId !== interaction.user.id) {
            return interaction.editReply({
                content: 'Seul le créateur de l’événement peut modifier son emoji.'
            });
        }

        await interaction.channel.setName(`${emoji}・${event.name}`);
        await AnnouncementChannels.updateOne(
            {
                Guild: interaction.guildId,
                'EventThreads.threadId': interaction.channel.id
            },
            {
                $set: {
                    'EventThreads.$.emojiOverride': emoji
                }
            }
        );

        return interaction.editReply({
            content: `Emoji du thread remplacé par ${emoji}.`
        });
    } catch (error) {
        console.error('Erreur lors de la modification de l’emoji de l’événement:', error);
        return interaction.editReply({
            content: 'Impossible de modifier l’emoji du thread pour le moment.'
        });
    }
};
