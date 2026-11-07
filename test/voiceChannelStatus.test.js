const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_CONFIG,
    mergeConfig,
    normalizeActivity,
    normalizeGameId,
    resolveStatus,
} = require('../src/handlers/functions/voiceChannelStatus');
const { registerActivityFamily } = require('../src/handlers/functions/voiceChannelStatusRegistry');

function enabledConfig(overrides = {}) {
    return mergeConfig({ enabled: true, ...overrides });
}

function game(name, userId) {
    return {
        family: 'game',
        title: name,
        gameId: normalizeGameId(name),
        userId,
    };
}

function media(title, userId, provider = 'premid') {
    return { family: 'media', title, provider, userId };
}

test('applies the most specific vocation defaults before explicit options', () => {
    const config = mergeConfig(
        { vocation: 'general', enabled: true },
        { vocation: 'gaming' },
    );

    assert.equal(config.vocation, 'gaming');
    assert.equal(config.gameStatusMode, 'priority');
    assert.equal(config.mediaEnabled, false);
});

test('recognizes a PreMiD rich presence published as a Playing activity', () => {
    const activity = normalizeActivity({
        name: 'PreMiD',
        details: 'Interstellar',
        type: 0,
    }, { id: 'user-1' });

    assert.equal(activity.family, 'media');
    assert.equal(activity.provider, 'premid');
    assert.equal(activity.title, 'Interstellar');
});

test('uses the game name instead of Rich Presence details for game titles', () => {
    const activity = normalizeActivity({
        name: 'Minecraft',
        details: 'Exploring a cave',
        type: 0,
    }, { id: 'user-1' });

    assert.equal(activity.family, 'game');
    assert.equal(activity.title, 'Minecraft');
});

test('selects the dominant family by eligible member count', () => {
    const config = enabledConfig({
        activityPriority: 'dominant',
        gameStatusMode: 'priority',
        gameThreshold: { minMembers: 2, minShare: 0 },
    });
    const activities = [
        game('Minecraft', 'g1'),
        game('Minecraft', 'g2'),
        media('Spotify - Track', 'm1'),
        media('Spotify - Track', 'm2'),
        media('Spotify - Track', 'm3'),
    ];

    const decision = resolveStatus({ activities, config, voiceMemberCount: 5 });
    assert.equal(decision.source, 'media');
});

test('keeps a manual status untouched while automation is resolving activities', () => {
    const config = enabledConfig({
        gameStatusMode: 'priority',
        allowBotOverride: false,
    });
    const decision = resolveStatus({
        activities: [game('Minecraft', 'user-1')],
        config,
        state: { manualLocked: true, manualValue: '🛠️ Statut choisi par un ami' },
        voiceMemberCount: 1,
    });

    assert.equal(decision.source, 'manual');
    assert.equal(decision.value, '🛠️ Statut choisi par un ami');
});

test('does not keep an old automatic value alive without eligible activity', () => {
    const config = enabledConfig({
        clearWhenNoActivity: false,
        staleAfterSeconds: 120,
    });
    const decision = resolveStatus({
        activities: [],
        config,
        state: {
            lastResolvedValue: '🎵 Ancien morceau',
            lastActivityAt: new Date(Date.now() - 121000),
        },
        voiceMemberCount: 1,
    });

    assert.equal(decision.value, null);
    assert.equal(decision.source, 'empty');
});

test('preserves the wildcard game weight', () => {
    const config = enabledConfig({
        gameStatusMode: 'priority',
        gameThreshold: { minMembers: 1, minShare: 0 },
        gameWeights: { '*': 0, minecraft: 2 },
    });
    const activities = [game('Minecraft', 'g1'), game('Other Game', 'g2')];
    const decision = resolveStatus({ activities, config, voiceMemberCount: 2 });

    assert.match(decision.value, /Minecraft/);
});

test('limits the final mixed status after composing game and media values', () => {
    const longGame = game('G'.repeat(300), 'g1');
    const longMedia = media('M'.repeat(300), 'm1');
    const config = enabledConfig({
        activityPriority: 'mixed',
        gameStatusMode: 'priority',
        gameThreshold: { minMembers: 1, minShare: 0 },
    });
    const decision = resolveStatus({ activities: [longGame, longMedia], config, voiceMemberCount: 2 });

    assert.ok(decision.value.length <= 500);
});

test('allows a registered family to provide a configured-priority status', () => {
    const unregister = registerActivityFamily({
        id: 'podcast',
        resolve: () => ({ value: '🎙️ Podcast en cours', priority: 10 }),
    });
    try {
        const config = enabledConfig({
            activityFamilies: ['podcast'],
            activityPriority: 'configured',
        });
        const decision = resolveStatus({
            activities: [{ family: 'podcast', userId: 'user-1' }],
            config,
        });
        assert.equal(decision.source, 'podcast');
        assert.equal(decision.value, '🎙️ Podcast en cours');
    } finally {
        unregister();
    }
});

assert.ok(DEFAULT_CONFIG);
