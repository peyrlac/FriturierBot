const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeConfig, normalizeActivity, normalizeGameId, resolveStatus } = require('../src/handlers/functions/voiceChannelStatus');
const { registerActivityFamily } = require('../src/handlers/functions/voiceChannelStatusRegistry');

test('normalizes game ids consistently', () => {
    assert.equal(normalizeGameId('League of Legends'), 'league-of-legends');
    assert.equal(normalizeGameId('Échecs & stratégie'), 'echecs-strategie');
});

test('manual status has priority over automatic activity', () => {
    const result = resolveStatus({
        config: mergeConfig({ enabled: true, gameStatusMode: 'priority' }),
        state: { manualLocked: true, manualValue: 'Réunion' },
        activities: [{ family: 'game', title: 'Minecraft', gameId: 'minecraft', userId: '1' }],
    });
    assert.equal(result.value, 'Réunion');
    assert.equal(result.source, 'manual');
});

test('game thresholds are applied before weights', () => {
    const result = resolveStatus({
        config: mergeConfig({
            enabled: true,
            gameStatusMode: 'priority',
            gameThreshold: { minMembers: 2, minShare: 0.5 },
            gameWeights: { '*': 1, valorant: 10 },
        }),
        voiceMemberCount: 3,
        activities: [
            { family: 'game', title: 'Valorant', gameId: 'valorant', userId: '1' },
            { family: 'game', title: 'Minecraft', gameId: 'minecraft', userId: '2' },
            { family: 'game', title: 'Minecraft', gameId: 'minecraft', userId: '3' },
        ],
    });
    assert.equal(result.value, '🎮 Minecraft · 2');
});

test('game mode none does not add a generic status', () => {
    const result = resolveStatus({
        config: mergeConfig({ enabled: true, gameStatusMode: 'none' }),
        activities: [
            { family: 'game', title: 'Minecraft', gameId: 'minecraft', userId: '1' },
            { family: 'game', title: 'Minecraft', gameId: 'minecraft', userId: '2' },
        ],
    });
    assert.equal(result.value, null);
});

test('media status prefers titles', () => {
    const result = resolveStatus({
        config: mergeConfig({ enabled: true, activityPriority: 'media-first' }),
        activities: [{ family: 'media', provider: 'netflix', title: 'The Office', userId: '1' }],
    });
    assert.equal(result.value, 'The Office');
    assert.equal(result.source, 'media');
});

test('recognizes PreMiD as the media provider', () => {
    const activity = normalizeActivity({ name: 'PreMiD', details: 'Interstellar', type: 3 }, { id: '1' });
    assert.equal(activity.family, 'media');
    assert.equal(activity.provider, 'premid');
    assert.equal(activity.title, 'Interstellar');
});

test('custom activity families can be registered without changing the resolver', () => {
    const unregister = registerActivityFamily({
        id: 'podcast',
        resolve: () => ({ value: '🎧 The Daily', priority: 10 }),
    });
    const result = resolveStatus({
        config: mergeConfig({ enabled: true, activityFamilies: ['podcast'] }),
        activities: [],
    });
    unregister();
    assert.equal(result.value, '🎧 The Daily');
    assert.equal(result.source, 'podcast');
});

test('vocation defaults are applied before explicit overrides', () => {
    const config = mergeConfig({ vocation: 'cinema' }, { activityPriority: 'mixed' });
    assert.equal(config.activityPriority, 'mixed');
    assert.deepEqual(config.activityFamilies, ['media']);
    assert.equal(config.gameStatusMode, 'none');
});
