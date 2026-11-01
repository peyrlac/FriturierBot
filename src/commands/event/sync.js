const { getEventContext, syncEventMessage } = require('./utils');

module.exports = async (client, interaction) => {
    try {
        const context = await getEventContext(client, interaction);
        if (!context) return interaction.editReply({ content: 'Aucun événement associé à ce thread.' });
        if (context.event.creatorId !== interaction.user.id) {
            return interaction.editReply({ content: 'Seul le créateur de l’événement peut le synchroniser.' });
        }
        await syncEventMessage(client, context);
        return interaction.editReply({ content: 'Événement, message épinglé et calendriers synchronisés.' });
    } catch (error) {
        console.error('Erreur lors de la synchronisation de l’événement:', error);
        return interaction.editReply({ content: 'La synchronisation a échoué. Vérifie les permissions et le channel d’upload.' });
    }
};
