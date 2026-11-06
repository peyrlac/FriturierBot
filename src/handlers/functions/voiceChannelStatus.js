const crypto = require('crypto');
const VoiceChannelStatusConfig = require('../../database/models/voiceChannelStatusConfig');
const VoiceChannelStatusState = require('../../database/models/voiceChannelStatusState');
const { resolveRegisteredFamilies } = require('./voiceChannelStatusRegistry');

const DEFAULT_CONFIG = {
    enabled: false,
    vocation: 'general',
    mode: 'hybrid',
    mediaEnabled: true,
    providers: ['premid', 'youtube', 'netflix', 'twitch', 'spotify'],
    activityFamilies: ['media', 'game'],
    activityPriority: 'dominant',
    gameStatusMode: 'none',
    genericStatus: null,
    gameThreshold: { minMembers: 2, minShare: 0.5, shareDenominator: 'activeMembers' },
    gameWeights: { '*': 1 },
    maxSummaryItems: 3,
    aggregationMode: 'summary',
    defaultStatus: null,
    clearWhenNoActivity: true,
    resetOnEmpty: true,
    emptyResetDelaySeconds: 5,
    staleAfterSeconds: 120,
    debounceSeconds: 10,
    minUpdateIntervalSeconds: 30,
    statusRotationSeconds: 30,
    allowBotOverride: false,
    quietHours: { enabled: false, timezone: 'Europe/Brussels', ranges: [] },
    welcomeOverlay: {
        enabled: false,
        durationSeconds: 12,
        templates: [],
        selectionMode: 'random',
        avoidImmediateRepeat: true,
        welcomeAggregationMode: 'group',
        maxGroupedUsers: 3,
        restoreManualStatus: true,
    },
};

const MEDIA_PROVIDERS = new Set(['premid', 'youtube', 'netflix', 'twitch', 'spotify']);

const VOCATION_DEFAULTS = {
    gaming: { activityPriority: 'dominant', gameStatusMode: 'priority', mediaEnabled: false },
    cinema: { activityPriority: 'media-first', activityFamilies: ['media'], gameStatusMode: 'none' },
    music: { activityPriority: 'media-first', providers: ['spotify'], activityFamilies: ['media'], gameStatusMode: 'none' },
    chill: { activityPriority: 'media-first', statusRotationSeconds: 60 },
    work: { activityFamilies: ['media'], gameStatusMode: 'none', clearWhenNoActivity: true, statusRotationSeconds: 0 },
    general: {},
    custom: {},
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function mergeConfig(...configs) {
    // Les configurations sont fusionnées dans l'ordre guild -> catégorie -> salon.
    // La dernière vocation déclarée est donc la plus spécifique et doit fournir
    // ses valeurs par défaut avant l'application des overrides finaux.
    const vocation = [...configs].reverse().find(config => config?.vocation)?.vocation || DEFAULT_CONFIG.vocation;
    const result = { ...clone(DEFAULT_CONFIG), ...(VOCATION_DEFAULTS[vocation] || {}) };
    for (const config of configs.filter(Boolean)) {
        for (const [key, value] of Object.entries(config)) {
            if (value === undefined) continue;
            if (value === null) {
                delete result[key];
            } else if (Array.isArray(value)) {
                result[key] = [...value];
            } else if (value && typeof value === 'object' && !('$date' in value)) {
                result[key] = { ...(result[key] || {}), ...value };
            } else {
                result[key] = value;
            }
        }
    }
    return result;
}

function normalizeGameId(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function fingerprint(value) {
    return crypto.createHash('sha1').update(JSON.stringify(value)).digest('hex');
}

function normalizeActivity(activity, member) {
    if (!activity) return null;
    const name = activity.name || activity.details || activity.state;
    if (!name) return null;
    const provider = String(activity.provider || activity.name || '').toLowerCase();
    const mediaProvider = provider === 'premid' || provider.includes('premid')
        ? 'premid'
        : provider || String(name).toLowerCase();
    const isKnownMedia = MEDIA_PROVIDERS.has(mediaProvider) || activity.family === 'media';
    // PreMiD peut publier sa Rich Presence avec le type Discord `0` (Playing).
    // Le fournisseur explicite doit donc primer sur le type brut de l'activité.
    const isGame = !isKnownMedia && (activity.type === 0 || activity.type === 'PLAYING' || activity.family === 'game');
    const family = isGame ? 'game' : (isKnownMedia ? 'media' : null);
    if (!family) return null;
    const title = family === 'game'
        ? (activity.title || activity.name || name)
        : (activity.title || activity.details || activity.state || name);
    return {
        userId: member?.id || activity.userId || null,
        family,
        provider: mediaProvider,
        providerLabel: activity.providerLabel || activity.service || activity.name || mediaProvider,
        title,
        gameId: family === 'game' ? normalizeGameId(activity.title || activity.name || name) : null,
        startedAt: activity.createdAt || null,
        observedAt: new Date(),
    };
}

function collectActivities(channel) {
    const activities = [];
    for (const member of channel?.members?.values?.() || []) {
        for (const activity of member.presence?.activities || member.presence?.clientStatus?.activities || []) {
            const normalized = normalizeActivity(activity, member);
            if (normalized) {
                activities.push({ ...normalized, rawActivity: activity, member });
            } else {
                // Une activité inconnue doit rester disponible pour une famille
                // enregistrée par extension. Le cœur ne tente simplement pas de
                // la sélectionner comme jeu ou média.
                activities.push({
                    ...activity,
                    rawActivity: activity,
                    userId: member.id,
                    member,
                    family: activity.family || null,
                });
            }
        }
    }
    return activities;
}

function getWeight(gameId, weights = {}) {
    const value = Number(weights[gameId] ?? weights['*'] ?? 1);
    return Number.isFinite(value) && value >= 0 ? value : 1;
}

function groupGames(activities, config) {
    const groups = new Map();
    for (const activity of activities.filter(item => item.family === 'game' && item.gameId)) {
        const current = groups.get(activity.gameId) || { gameId: activity.gameId, title: activity.title, participants: new Set(), activities: [] };
        if (activity.userId) current.participants.add(activity.userId);
        current.activities.push(activity);
        groups.set(activity.gameId, current);
    }

    const activeMembers = new Set(activities
        .filter(item => item.userId && (item.family === 'game' || item.family === 'media'))
        .map(item => item.userId)).size;
    const voiceMembers = config.voiceMemberCount || activeMembers;
    const threshold = config.gameThreshold || DEFAULT_CONFIG.gameThreshold;
    return [...groups.values()]
        .map(group => ({
            ...group,
            participantCount: group.participants.size,
            weight: getWeight(group.gameId, config.gameWeights),
            score: group.participants.size * getWeight(group.gameId, config.gameWeights),
            share: group.participants.size / Math.max(1, threshold.shareDenominator === 'voiceMembers' ? voiceMembers : activeMembers),
        }))
        .filter(group => group.participantCount >= threshold.minMembers && group.share >= threshold.minShare && group.weight > 0)
        .sort((a, b) => b.score - a.score || b.participantCount - a.participantCount || b.weight - a.weight || a.gameId.localeCompare(b.gameId));
}

function renderMedia(activities) {
    const titles = [...new Set(activities.filter(item => item.family === 'media').map(item => item.title).filter(Boolean))];
    return titles.length ? titles.slice(0, 3).join(' · ').slice(0, 500) : null;
}

function resolveStatus({ activities = [], config = DEFAULT_CONFIG, state = {}, voiceMemberCount = 0, now = new Date() }) {
    const effective = mergeConfig(config, { voiceMemberCount });
    if (!effective.enabled) return { value: null, source: 'disabled', fingerprint: null };
    if (state.manualLocked) return { value: state.manualValue, source: 'manual', fingerprint: fingerprint(['manual', state.manualValue]) };

    const mediaActivities = effective.mediaEnabled && effective.activityFamilies.includes('media')
        ? activities.filter(activity => activity.family === 'media' && effective.providers.includes(activity.provider))
        : [];
    const mediaValue = renderMedia(mediaActivities);
    const games = effective.activityFamilies.includes('game') ? groupGames(activities, effective) : [];
    let gameValue = null;
    if (games.length && effective.gameStatusMode === 'priority') gameValue = `🎮 ${games[0].title}${games[0].participantCount > 1 ? ` · ${games[0].participantCount}` : ''}`.slice(0, 500);
    if (games.length && effective.gameStatusMode === 'generic') gameValue = (effective.genericStatus || '🎮 Multigaming').slice(0, 500);
    if (games.length && effective.gameStatusMode === 'summary') gameValue = games.slice(0, effective.maxSummaryItems).map(game => game.title).join(' | ').slice(0, 500);
    const gameMemberCount = new Set(games.flatMap(game => [...game.participants])).size;
    const mediaMemberCount = new Set(mediaActivities.map(activity => activity.userId).filter(Boolean)).size;

    const registeredDecisions = resolveRegisteredFamilies(activities, effective, {
        state,
        rawActivities: activities.map(activity => activity.rawActivity || activity),
    });
    const registeredDecision = registeredDecisions
        .filter(decision => decision.value || decision.status)
        .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0];

    let value = null;
    let source = 'empty';
    if (effective.activityPriority === 'game-first' && gameValue) [value, source] = [gameValue, 'game'];
    else if (effective.activityPriority === 'media-first' && mediaValue) [value, source] = [mediaValue, 'media'];
    else if (effective.activityPriority === 'mixed' && mediaValue && gameValue) [value, source] = [`${gameValue} · ${mediaValue}`, 'mixed'];
    else if (effective.activityPriority === 'dominant' && mediaValue && gameValue) {
        [value, source] = gameMemberCount >= mediaMemberCount
            ? [gameValue, 'game']
            : [mediaValue, 'media'];
    }
    else if (gameValue || mediaValue) [value, source] = [gameValue || mediaValue, gameValue ? 'game' : 'media'];
    else if (registeredDecision) [value, source] = [registeredDecision.value || registeredDecision.status, registeredDecision.family];
    else if (effective.defaultStatus) [value, source] = [effective.defaultStatus, 'default'];
    else if (state.lastResolvedValue && !effective.clearWhenNoActivity && state.lastActivityAt && now - new Date(state.lastActivityAt) < effective.staleAfterSeconds * 1000) [value, source] = [state.lastResolvedValue, 'empty-stale'];

    const finalValue = value ? String(value).slice(0, 500) : null;
    return { value: finalValue, source, fingerprint: finalValue ? fingerprint([source, finalValue]) : null, games, mediaActivities, gameMemberCount, mediaMemberCount };
}

async function getEffectiveConfig(guildId, categoryId, channelId) {
    const docs = await VoiceChannelStatusConfig.find({ guildId, targetId: { $in: [guildId, categoryId, channelId].filter(Boolean) } }).lean();
    const byScope = scope => docs.find(doc => doc.scope === scope && doc.targetId === (scope === 'guild' ? guildId : scope === 'category' ? categoryId : channelId));
    const patch = doc => {
        if (!doc) return null;
        const overrides = doc.overrides instanceof Map ? Object.fromEntries(doc.overrides) : doc.overrides;
        return overrides && Object.keys(overrides).length ? overrides : doc;
    };
    return mergeConfig(patch(byScope('guild')), patch(byScope('category')), patch(byScope('channel')));
}

function createState(guildId, channelId) {
    return new VoiceChannelStatusState({ guildId, channelId });
}

module.exports = {
    DEFAULT_CONFIG,
    collectActivities,
    getEffectiveConfig,
    mergeConfig,
    normalizeActivity,
    normalizeGameId,
    resolveStatus,
    createState,
};
