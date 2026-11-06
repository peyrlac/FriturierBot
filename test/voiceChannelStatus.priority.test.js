const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveStatus } = require('../src/handlers/functions/voiceChannelStatus');

test('la priorité dominante choisit la famille avec le plus de membres éligibles', () => {
    const decision = resolveStatus({
        activities: [
            { family: 'game', gameId: 'minecraft', title: 'Minecraft', userId: 'game-1' },
            { family: 'game', gameId: 'minecraft', title: 'Minecraft', userId: 'game-2' },
            { family: 'media', provider: 'spotify', title: 'Titre 1', userId: 'media-1' },
            { family: 'media', provider: 'spotify', title: 'Titre 2', userId: 'media-2' },
            { family: 'media', provider: 'spotify', title: 'Titre 3', userId: 'media-3' },
        ],
        config: {
            enabled: true,
            activityFamilies: ['game', 'media'],
            activityPriority: 'dominant',
            gameStatusMode: 'priority',
            providers: ['spotify'],
            gameThreshold: { minMembers: 2, minShare: 0 },
        },
    });

    assert.equal(decision.source, 'media');
    assert.equal(decision.mediaMemberCount, 3);
    assert.equal(decision.gameMemberCount, 2);
});
