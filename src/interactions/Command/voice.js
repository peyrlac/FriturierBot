const { CommandInteraction, Client } = require('discord.js');
const { SlashCommandBuilder } = require('discord.js');
const Discord = require('discord.js');
const { getCommandMetadata } = require('../../handlers/i18n');

module.exports = {
    data: new SlashCommandBuilder()
        .setName(getCommandMetadata('commandMetadata.voice.name'))
        .setDescription(getCommandMetadata('commandMetadata.voice.description'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('help')
                .setDescription(getCommandMetadata('commandMetadata.voice.subcommands.help.description'))
        ).addSubcommand(subcommand =>
            subcommand
                .setName('limit')
                .setDescription(getCommandMetadata('commandMetadata.voice.subcommands.limit.description'))
                .addNumberOption(option => option.setName('limit').setDescription(getCommandMetadata('commandMetadata.voice.subcommands.limit.options.limit.description')).setMinValue(1).setMaxValue(99).setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('lock')
                .setDescription(getCommandMetadata('commandMetadata.voice.subcommands.lock.description'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('rename')
                .setDescription(getCommandMetadata('commandMetadata.voice.subcommands.rename.description'))
                .addStringOption(option => option.setName('name').setDescription(getCommandMetadata('commandMetadata.voice.subcommands.rename.options.name.description')).setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('unlock')
                .setDescription(getCommandMetadata('commandMetadata.voice.subcommands.unlock.description'))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status-setup')
                .setDescription('Configure le statut automatique du salon vocal')
                .addStringOption(option => option.setName('scope').setDescription('Niveau de configuration').setRequired(true).addChoices(
                    { name: 'Salon', value: 'channel' },
                    { name: 'Catégorie', value: 'category' },
                    { name: 'Serveur', value: 'guild' },
                ))
                .addChannelOption(option => option.setName('target').setDescription('Salon ou catégorie cible').setRequired(false))
                .addBooleanOption(option => option.setName('enabled').setDescription('Activer le moteur').setRequired(false))
                .addStringOption(option => option.setName('vocation').setDescription('Vocation du salon').setRequired(false).addChoices(
                    { name: 'Gaming', value: 'gaming' },
                    { name: 'Chill', value: 'chill' },
                    { name: 'Travail', value: 'work' },
                    { name: 'Cinéma', value: 'cinema' },
                    { name: 'Musique', value: 'music' },
                    { name: 'Général', value: 'general' },
                    { name: 'Personnalisé', value: 'custom' },
                ))
                .addStringOption(option => option.setName('game-mode').setDescription('Affichage des jeux').setRequired(false).addChoices(
                    { name: 'Jeu prioritaire', value: 'priority' },
                    { name: 'Aucun', value: 'none' },
                    { name: 'Texte générique', value: 'generic' },
                    { name: 'Résumé', value: 'summary' },
                ))
                .addStringOption(option => option.setName('generic-status').setDescription('Texte du mode générique').setRequired(false))
                .addBooleanOption(option => option.setName('welcome-enabled').setDescription('Activer les messages de bienvenue').setRequired(false))
                .addStringOption(option => option.setName('welcome-templates').setDescription('Phrases séparées par ||').setRequired(false))
                .addStringOption(option => option.setName('game-weights').setDescription('Poids jeu=valeur séparés par ||').setRequired(false))
                .addStringOption(option => option.setName('activity-priority').setDescription('Priorité entre jeux et médias').setRequired(false).addChoices(
                    { name: 'Dominante', value: 'dominant' },
                    { name: 'Média', value: 'media-first' },
                    { name: 'Jeu', value: 'game-first' },
                    { name: 'Mixte', value: 'mixed' },
                ))
                .addNumberOption(option => option.setName('game-share').setDescription('Part minimale des membres actifs').setMinValue(0).setMaxValue(1).setRequired(false))
                .addBooleanOption(option => option.setName('reset-on-empty').setDescription('Réinitialiser quand le salon est vide').setRequired(false))
                .addIntegerOption(option => option.setName('game-threshold').setDescription('Nombre minimum de joueurs par jeu').setMinValue(1).setMaxValue(99).setRequired(false))
                .addBooleanOption(option => option.setName('clear-no-activity').setDescription('Effacer lorsqu’il n’y a plus d’activité').setRequired(false))
                .addStringOption(option => option.setName('share-denominator').setDescription('Base de calcul du seuil de jeu').setRequired(false).addChoices(
                    { name: 'Membres actifs', value: 'activeMembers' },
                    { name: 'Membres du salon', value: 'voiceMembers' },
                ))
                .addStringOption(option => option.setName('default-status').setDescription('Statut de secours sans activité').setRequired(false))
                .addIntegerOption(option => option.setName('min-update-interval').setDescription('Intervalle minimal entre écritures (secondes)').setMinValue(0).setMaxValue(3600).setRequired(false))
                .addBooleanOption(option => option.setName('quiet-enabled').setDescription('Activer les plages silencieuses').setRequired(false))
                .addStringOption(option => option.setName('quiet-ranges').setDescription('Plages HH:MM-HH:MM séparées par ||').setRequired(false))
                .addStringOption(option => option.setName('quiet-timezone').setDescription('Fuseau IANA des plages silencieuses').setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status-debug')
                .setDescription('Affiche la décision du statut vocal')
                .addChannelOption(option => option.setName('channel').setDescription('Salon vocal à inspecter').setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status-reset')
                .setDescription('Réinitialise le statut et le verrou du salon')
                .addChannelOption(option => option.setName('channel').setDescription('Salon vocal à réinitialiser').setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status-override')
                .setDescription('Déclenche un overlay événementiel')
                .addStringOption(option => option.setName('mode').setDescription('Mode de l’overlay').setRequired(true).addChoices(
                    { name: 'Configuration', value: 'default' },
                    { name: 'Forcé', value: 'force' },
                ))
                .addStringOption(option => option.setName('message').setDescription('Message temporaire optionnel').setRequired(false))
                .addChannelOption(option => option.setName('channel').setDescription('Salon vocal cible').setRequired(false))
        )
    ,

    localizationKey: 'commandMetadata.voice',

    /** 
     * @param {Client} client
     * @param {CommandInteraction} interaction
     * @param {String[]} args
     */

    run: async (client, interaction, args) => {
        await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
        client.loadSubcommands(client, interaction, args);
    },
};

 
