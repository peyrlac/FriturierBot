const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveStatus } = require('../src/handlers/functions/voiceChannelStatus');
const { registerActivityFamily } = require('../src/handlers/functions/voiceChannelStatusRegistry');

test('une famille enregistrée peut résoudre une activité brute inconnue', () => {
    const unregister = registerActivityFamily({
        id: 'podcast',
        resolve: ({ rawActivities }) => {
            const activity = rawActivities.find(item => item.name === 'PodcastApp');
            return activity ? { value: `🎙️ ${activity.details}`, priority: 10 } : null;
        },
    });

    try {
        const decision = resolveStatus({
            activities: [{ name: 'PodcastApp', details: 'Épisode 42', type: 0 }],
            config: {
                enabled: true,
                activityFamilies: ['podcast'],
                clearWhenNoActivity: true,
            },
        });

        assert.equal(decision.value, '🎙️ Épisode 42');
        assert.equal(decision.source, 'podcast');
    } finally {
        unregister();
    }
});
