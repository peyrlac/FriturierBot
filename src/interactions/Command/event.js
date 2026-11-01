const { CommandInteraction, Client } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const Discord = require('discord.js');
const { getCommandMetadata } = require('../../handlers/i18n');

module.exports = {
    data: new SlashCommandBuilder()
        .setName(getCommandMetadata('commandMetadata.event.name'))
        .setDescription(getCommandMetadata('commandMetadata.event.description'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('help')
                .setDescription(getCommandMetadata('commandMetadata.event.subcommands.help.description'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('participants')
                .setDescription(getCommandMetadata('commandMetadata.event.subcommands.participants.description'))
                .addStringOption(option => 
                    option
                        .setName('event_id')
                        .setDescription(getCommandMetadata('commandMetadata.event.subcommands.participants.options.event_id.description'))
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Afficher les informations et les liens calendrier de ton événement')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('sync')
                .setDescription('Synchroniser le message et les calendriers de ton événement')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reminders')
                .setDescription('Gérer les rappels de ton événement')
                .addStringOption(option =>
                    option
                        .setName('reminder')
                        .setDescription('Rappel à gérer')
                        .setRequired(true)
                        .addChoices(
                            { name: '1 mois avant', value: 'month' },
                            { name: '1 semaine avant', value: 'week' },
                            { name: '1 jour avant', value: 'day' }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName('action')
                        .setDescription('Action à effectuer')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Activer', value: 'enable' },
                            { name: 'Désactiver', value: 'disable' },
                            { name: 'Réinitialiser', value: 'reset' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('emoji')
                .setDescription('Remplacer l’emoji du thread de ton événement (créateur uniquement)')
                .addStringOption(option =>
                    option
                        .setName('emoji')
                        .setDescription('Emoji ou emoji personnalisé à utiliser')
                        .setRequired(true)
                )
        ),

    /** 
     * @param {Client} client
     * @param {CommandInteraction} interaction
     * @param {String[]} args
     */

    localizationKey: 'commandMetadata.event',

    run: async (client, interaction, args) => {
        await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
        return client.loadSubcommands(client, interaction, args);
    },
};
