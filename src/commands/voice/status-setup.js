const Discord = require('discord.js');
const VoiceChannelStatusConfig = require('../../database/models/voiceChannelStatusConfig');
const { normalizeGameId } = require('../../handlers/functions/voiceChannelStatus');
const { syncChannel } = require('../../handlers/functions/voiceChannelStatusManager');

function parseQuietRanges(value) {
    if (value === null) return null;
    const ranges = String(value).split('||').map(item => item.trim()).filter(Boolean);
    const pattern = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
    if (ranges.some(range => !pattern.test(range))) return null;
    return ranges.map(range => {
        const [start, end] = range.split('-');
        return { start, end };
    });
}

module.exports = async (client, interaction) => {
    const perms = await client.checkUserPerms({
        flags: [Discord.PermissionsBitField.Flags.ManageGuild],
        perms: [Discord.PermissionsBitField.Flags.ManageGuild],
    }, interaction);
    if (perms === false) return;

    const scope = interaction.options.getString('scope', true);
    const target = interaction.options.getChannel('target');
    const current = interaction.member?.voice?.channel;
    const targetId = scope === 'guild' ? interaction.guild.id : target?.id || (scope === 'category' ? current?.parentId : current?.id);
    if (!targetId) return interaction.editReply({ content: '❌ Une cible est nécessaire pour ce niveau de configuration.' });
    if (scope === 'category' && target && target.type !== Discord.ChannelType.GuildCategory) return interaction.editReply({ content: '❌ La cible doit être une catégorie.' });
    if (scope === 'channel' && target && target.type !== Discord.ChannelType.GuildVoice) return interaction.editReply({ content: '❌ La cible doit être un salon vocal.' });

    const metadata = {
        guildId: interaction.guild.id,
        scope,
        targetId,
        categoryId: scope === 'category' ? targetId : target?.parentId || current?.parentId || null,
        channelId: scope === 'channel' ? targetId : null,
        updatedBy: interaction.user.id,
    };
    const existingConfig = await VoiceChannelStatusConfig.findOne({ guildId: interaction.guild.id, scope, targetId }).lean();
    const existingOverrides = existingConfig?.overrides instanceof Map
        ? Object.fromEntries(existingConfig.overrides)
        : existingConfig?.overrides || {};
    const update = { ...existingOverrides };
    const enabled = interaction.options.getBoolean('enabled');
    const vocation = interaction.options.getString('vocation');
    const gameStatusMode = interaction.options.getString('game-mode');
    const genericStatus = interaction.options.getString('generic-status');
    const welcomeEnabled = interaction.options.getBoolean('welcome-enabled');
    const welcomeTemplates = interaction.options.getString('welcome-templates');
    const gameWeights = interaction.options.getString('game-weights');
    const activityPriority = interaction.options.getString('activity-priority');
    const gameShare = interaction.options.getNumber('game-share');
    const resetOnEmpty = interaction.options.getBoolean('reset-on-empty');
    const minMembers = interaction.options.getInteger('game-threshold');
    const clearNoActivity = interaction.options.getBoolean('clear-no-activity');
    const shareDenominator = interaction.options.getString('share-denominator');
    const defaultStatus = interaction.options.getString('default-status');
    const minUpdateInterval = interaction.options.getInteger('min-update-interval');
    const quietEnabled = interaction.options.getBoolean('quiet-enabled');
    const quietRangesInput = interaction.options.getString('quiet-ranges');
    const quietTimezone = interaction.options.getString('quiet-timezone');
    if (enabled !== null) update.enabled = enabled;
    else if (!existingConfig) update.enabled = true;
    if (vocation) update.vocation = vocation;
    if (gameStatusMode) update.gameStatusMode = gameStatusMode;
    if (genericStatus !== null) update.genericStatus = genericStatus;
    if (welcomeEnabled !== null) update.welcomeOverlay = { ...(update.welcomeOverlay || {}), enabled: welcomeEnabled };
    if (welcomeTemplates !== null) update.welcomeOverlay = { ...(update.welcomeOverlay || {}), templates: welcomeTemplates.split('||').map(value => value.trim()).filter(Boolean) };
    if (gameWeights !== null) {
        update.gameWeights = {};
        for (const entry of gameWeights.split('||')) {
            const [game, weight] = entry.split('=').map(value => value.trim());
            const numericWeight = Number(weight);
            const gameId = game === '*' ? '*' : normalizeGameId(game);
            if (gameId && Number.isFinite(numericWeight) && numericWeight >= 0) update.gameWeights[gameId] = numericWeight;
        }
    }
    if (activityPriority) update.activityPriority = activityPriority;
    if (gameShare !== null) update.gameThreshold = { ...(update.gameThreshold || {}), minShare: gameShare };
    if (shareDenominator) update.gameThreshold = { ...(update.gameThreshold || {}), shareDenominator };
    if (resetOnEmpty !== null) update.resetOnEmpty = resetOnEmpty;
    if (minMembers) update.gameThreshold = { ...(update.gameThreshold || {}), minMembers };
    if (clearNoActivity !== null) update.clearWhenNoActivity = clearNoActivity;
    if (defaultStatus !== null) update.defaultStatus = defaultStatus;
    if (minUpdateInterval !== null) update.minUpdateIntervalSeconds = minUpdateInterval;
    if (quietEnabled !== null || quietRangesInput !== null || quietTimezone !== null) {
        const quietHours = { ...(update.quietHours || {}) };
        if (quietEnabled !== null) quietHours.enabled = quietEnabled;
        if (quietTimezone !== null) {
            try {
                new Intl.DateTimeFormat('en-GB', { timeZone: quietTimezone }).format();
            } catch {
                return interaction.editReply({ content: '❌ Fuseau horaire invalide. Utilise un identifiant IANA, par exemple `Europe/Brussels`.' });
            }
            quietHours.timezone = quietTimezone;
        }
        if (quietRangesInput !== null) {
            const ranges = parseQuietRanges(quietRangesInput);
            if (!ranges) return interaction.editReply({ content: '❌ Format invalide. Utilise `HH:MM-HH:MM||HH:MM-HH:MM`.' });
            quietHours.ranges = ranges;
        }
        update.quietHours = quietHours;
    }
    await VoiceChannelStatusConfig.findOneAndUpdate(
        { guildId: interaction.guild.id, scope, targetId },
        { $set: { ...metadata, overrides: update }, $setOnInsert: { createdBy: interaction.user.id } },
        { upsert: true, new: true, setDefaultsOnInsert: false },
    );
    const targets = scope === 'channel'
        ? [targetId]
        : interaction.guild.channels.cache
            .filter(channel => channel.type === Discord.ChannelType.GuildVoice && (scope === 'guild' || channel.parentId === targetId))
            .map(channel => channel.id);
    const syncResults = await Promise.allSettled(targets.map(channelId => syncChannel(client, channelId, { force: true, type: 'setup' })));
    const failures = syncResults.filter(result => result.status === 'rejected');
    if (failures.length) {
        return interaction.editReply({ content: `⚠️ Configuration enregistrée, mais la synchronisation a échoué pour ${failures.length} salon(s). Vérifie la permission Discord **Set Voice Channel Status**.` });
    }
    return interaction.editReply({ content: `✅ Configuration du statut vocal enregistrée au niveau **${scope}** et synchronisation lancée pour ${targets.length} salon(s).` });
};
