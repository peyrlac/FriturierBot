const test = require('node:test');
const assert = require('node:assert/strict');

const { mergeConfig } = require('../src/handlers/functions/voiceChannelStatus');

test('les defaults de vocation viennent du scope le plus spécifique', () => {
    const effective = mergeConfig(
        { vocation: 'general', enabled: true },
        { vocation: 'gaming' },
    );

    assert.equal(effective.vocation, 'gaming');
    assert.equal(effective.gameStatusMode, 'priority');
    assert.equal(effective.mediaEnabled, false);
});

test('les overrides explicites du scope spécifique restent prioritaires sur les defaults', () => {
    const effective = mergeConfig(
        { vocation: 'general', enabled: true },
        { vocation: 'gaming', mediaEnabled: true, gameStatusMode: 'summary' },
    );

    assert.equal(effective.vocation, 'gaming');
    assert.equal(effective.mediaEnabled, true);
    assert.equal(effective.gameStatusMode, 'summary');
});
