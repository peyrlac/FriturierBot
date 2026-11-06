const crypto = require('crypto');
const Discord = require('discord.js');
const VoiceChannelStatusState = require('../../database/models/voiceChannelStatusState');
const {
    collectActivities,
    getEffectiveConfig,
    resolveStatus,
} = require('./voiceChannelStatus');

const queues = new Map();
const timers = new Map();
const welcomeBatches = new Map();
const recentWrites = new Map();

function operationId() {
    return crypto.randomUUID();
}

function getChannel(client, guildId, channelId) {
    return client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
}

async function writeVoiceStatus(client, channel, status) {
    if (!channel?.id || !client?.rest?.put) throw new Error('Discord REST client unavailable');
    await client.rest.put(`/channels/${channel.id}/voice-status`, { body: { status: status || null } });
}

async function getState(guildId, channelId) {
    return VoiceChannelStatusState.findOneAndUpdate(
        { guildId, channelId },
        { $setOnInsert: { guildId, channelId } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
    );
}

async function updateState(state, values) {
    Object.assign(state, values);
    return state.save();
}

async function acquireWriteLock(guildId, channelId, operationType) {
    const id = operationId();
    const now = new Date();
    try {
        const state = await VoiceChannelStatusState.findOneAndUpdate(
            {
                guildId,
                channelId,
                $or: [
                    { writeLock: null },
                    { 'writeLock.expiresAt': { $lte: now } },
                    { writeLock: { $exists: false } },
                ],
            },
            {
                $set: {
                    syncStatus: 'pending',
                    writeLock: { operationId: id, operationType, startedAt: now, expiresAt: new Date(now.getTime() + 30000) },
                },
                $setOnInsert: { guildId, channelId },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        return state?.writeLock?.operationId === id ? { state, id } : null;
    } catch (error) {
        if (error?.code === 11000) return null;
        throw error;
    }
}

function isQuietHours(config, now = new Date()) {
    if (!config.quietHours?.enabled || !config.quietHours.ranges?.length) return false;
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: config.quietHours.timezone || 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hour12: false });
    const current = formatter.format(now);
    return config.quietHours.ranges.some(range => {
        if (!range?.start || !range?.end) return false;
        return range.start <= range.end ? current >= range.start && current < range.end : current >= range.start || current < range.end;
    });
}

function withQueue(channelId, task) {
    const previous = queues.get(channelId) || Promise.resolve();
    const next = previous.catch(() => null).then(task).finally(() => {
        if (queues.get(channelId) === next) queues.delete(channelId);
    });
    queues.set(channelId, next);
    return next;
}

async function syncChannel(client, channelId, options = {}) {
    const channel = client.channels.cache.get(channelId);
    if (!channel?.guild || channel.type !== Discord.ChannelType.GuildVoice) return null;
    return withQueue(channelId, async () => {
        const config = await getEffectiveConfig(channel.guild.id, channel.parentId, channel.id);
        let state = await getState(channel.guild.id, channel.id);
        if (!config.enabled) return state;
        if (!options.force && state.nextRetryAt && Date.now() < new Date(state.nextRetryAt).getTime()) return state;
        if (isQuietHours(config) && !options.force) return state;
        const members = channel.members;
        if (config.resetOnEmpty && members.size === 0 && !options.overlay) return resetEmptyChannel(client, channel, config, state);

        const decision = resolveStatus({
            activities: collectActivities(channel),
            config: { ...config, voiceMemberCount: members.size },
            state,
            voiceMemberCount: members.size,
        });
        const nextValue = decision.value || null;
        if (decision.source === 'manual') return state;
        if (!options.force && nextValue === state.lastBotValue && nextValue === state.currentDiscordValue) return state;
        if (!options.force && state.lastWriteAt && Date.now() - new Date(state.lastWriteAt).getTime() < Number(config.minUpdateIntervalSeconds || 0) * 1000) return state;
        const lock = await acquireWriteLock(channel.guild.id, channel.id, options.type || 'sync');
        if (!lock) return state;
        state = lock.state;
        const id = lock.id;
        try {
            await writeVoiceStatus(client, channel, nextValue);
            recentWrites.set(channel.id, { value: nextValue, operationId: id, expiresAt: Date.now() + 120000 });
            await updateState(state, {
                currentDiscordValue: nextValue,
                lastBotValue: nextValue,
                lastBotWriteId: id,
                lastBotWriteAt: new Date(),
                lastResolvedValue: nextValue,
                source: decision.source,
                lastWriteAt: new Date(),
                lastObservedAt: new Date(),
                lastActivityFingerprint: decision.fingerprint,
                syncStatus: 'idle',
                writeLock: null,
                failureCount: 0,
                nextRetryAt: null,
            });
        } catch (error) {
            await updateState(state, { syncStatus: 'error', failureCount: (state.failureCount || 0) + 1, nextRetryAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** Math.min(state.failureCount || 0, 8))), writeLock: null });
            error.channelStatusChannelId = channel.id;
            throw error;
        }
        return state;
    });
}

async function resetEmptyChannel(client, channel, config, state) {
    if (!config.resetOnEmpty) return state;
    if (state.source === 'empty' && !state.currentDiscordValue && !state.manualLocked && !state.welcomeOverlay?.active && !state.emptySessionId) return state;
    const sessionId = operationId();
    await updateState(state, { emptySessionId: sessionId, syncStatus: 'resetPending' });
    const delay = Math.max(0, Number(config.emptyResetDelaySeconds || 0) * 1000);
    await new Promise(resolve => setTimeout(resolve, delay));
    const refreshed = await getState(channel.guild.id, channel.id);
    if (channel.members.size > 0 || refreshed.emptySessionId !== sessionId) return refreshed;
    const lock = await acquireWriteLock(channel.guild.id, channel.id, 'reset-empty');
    if (!lock) return refreshed;
    const stateWithLock = lock.state;
    const id = lock.id;
    try {
        await writeVoiceStatus(client, channel, null);
        recentWrites.set(channel.id, { value: null, operationId: id, expiresAt: Date.now() + 120000 });
        return updateState(stateWithLock, {
            currentDiscordValue: null,
            lastBotValue: null,
            lastResolvedValue: null,
            source: 'empty',
            manualLocked: false,
            manualValue: null,
            manualObservedAt: null,
            lastActivityFingerprint: null,
            emptySessionId: null,
            syncStatus: 'idle',
            writeLock: null,
            welcomeOverlay: { active: false },
            lastBotWriteId: id,
            lastBotWriteAt: new Date(),
            lastWriteAt: new Date(),
            lastObservedAt: new Date(),
            failureCount: 0,
            nextRetryAt: null,
        });
    } catch (error) {
        await updateState(stateWithLock, { syncStatus: 'resetPending', failureCount: (stateWithLock.failureCount || 0) + 1, writeLock: null });
        throw error;
    }
}

async function runWelcome(client, channel, users, options = {}) {
    return withQueue(channel.id, async () => {
        const config = await getEffectiveConfig(channel.guild.id, channel.parentId, channel.id);
        if (!config.enabled || (!config.welcomeOverlay?.enabled && !options.force) || (isQuietHours(config) && !options.force)) return null;
        const state = await getState(channel.guild.id, channel.id);
        const templates = (options.message ? [options.message] : config.welcomeOverlay.templates || []).filter(Boolean);
        if (!templates.length) return state;
        const template = templates[Math.floor(Math.random() * templates.length)];
        const names = users.map(user => user?.displayName || user?.user?.username || user?.username).filter(Boolean);
        const visibleNames = names.length > 3 ? [] : names;
        const value = template
            .replaceAll('{user}', visibleNames[0] || 'tout le monde')
            .replaceAll('{users}', visibleNames.join(', ') || 'tout le monde')
            .replaceAll('{username}', users[0]?.user?.username || users[0]?.username || 'ami')
            .replaceAll('{channel}', channel.name)
            .replaceAll('{count}', String(names.length || 1))
            .slice(0, 500);
        const original = state.currentDiscordValue;
        const id = operationId();
        await writeVoiceStatus(client, channel, value);
        recentWrites.set(channel.id, { value, operationId: id, expiresAt: Date.now() + 120000 });
        await updateState(state, { welcomeOverlay: { active: true, originalValue: original, originalSource: state.source, overlayValue: value, startedAt: new Date(), expiresAt: new Date(Date.now() + config.welcomeOverlay.durationSeconds * 1000), originalFingerprint: state.lastActivityFingerprint, operationId: id }, currentDiscordValue: value, lastBotValue: value, lastBotWriteId: id, lastBotWriteAt: new Date(), lastWriteAt: new Date() });
        const durationSeconds = options.durationSeconds || config.welcomeOverlay.durationSeconds;
        const timer = setTimeout(() => restoreWelcome(client, channel.id, id).catch(() => null), durationSeconds * 1000);
        timers.set(`welcome:${channel.id}`, timer);
        return state;
    });
}

function scheduleWelcome(client, channel, user, options = {}) {
    if (options.force || options.message) return runWelcome(client, channel, user ? [user] : [], options);
    const current = welcomeBatches.get(channel.id) || { users: [], timer: null };
    if (user) current.users.push(user);
    if (current.timer) clearTimeout(current.timer);
    current.timer = setTimeout(() => {
        welcomeBatches.delete(channel.id);
        runWelcome(client, channel, current.users).catch(() => null);
    }, 1500);
    welcomeBatches.set(channel.id, current);
    return Promise.resolve(null);
}

async function forceReset(client, channel) {
    if (!channel?.guild) return null;
    return withQueue(channel.id, async () => {
        const lock = await acquireWriteLock(channel.guild.id, channel.id, 'reset');
        if (!lock) return getState(channel.guild.id, channel.id);
        const state = lock.state;
        const id = lock.id;
        await writeVoiceStatus(client, channel, null);
        recentWrites.set(channel.id, { value: null, operationId: id, expiresAt: Date.now() + 120000 });
        return updateState(state, {
            currentDiscordValue: null,
            lastBotValue: null,
            lastResolvedValue: null,
            source: 'empty',
            manualLocked: false,
            manualValue: null,
            manualObservedAt: null,
            lastActivityFingerprint: null,
            emptySessionId: null,
            welcomeOverlay: { active: false },
            syncStatus: 'idle',
            writeLock: null,
            lastBotWriteId: id,
            lastBotWriteAt: new Date(),
            lastWriteAt: new Date(),
            lastObservedAt: new Date(),
            failureCount: 0,
            nextRetryAt: null,
        });
    });
}

async function restoreWelcome(client, channelId, expectedOperationId) {
    return withQueue(channelId, async () => {
        const channel = client.channels.cache.get(channelId);
        if (!channel) return null;
        const state = await getState(channel.guild.id, channel.id);
        if (!state.welcomeOverlay?.active || state.welcomeOverlay.operationId !== expectedOperationId) return state;
        if (state.currentDiscordValue !== state.welcomeOverlay.overlayValue) return updateState(state, { welcomeOverlay: { active: false } });
        await writeVoiceStatus(client, channel, state.welcomeOverlay.originalValue);
        recentWrites.set(channel.id, { value: state.welcomeOverlay.originalValue, operationId: operationId(), expiresAt: Date.now() + 120000 });
        return updateState(state, { currentDiscordValue: state.welcomeOverlay.originalValue, lastBotValue: state.welcomeOverlay.originalValue, source: state.welcomeOverlay.originalSource || 'unknown', lastBotWriteId: operationId(), lastBotWriteAt: new Date(), lastWriteAt: new Date(), welcomeOverlay: { active: false } });
    });
}

async function handleVoiceStateUpdate(client, oldState, newState) {
    const ids = new Set([oldState?.channelId, newState?.channelId].filter(Boolean));
    for (const channelId of ids) {
        await syncChannel(client, channelId, { type: 'voice-state' }).catch(() => null);
    }
    const joinedChannel = newState?.channelId && newState.channelId !== oldState?.channelId;
    if (joinedChannel && !newState.member?.user?.bot && newState.channel?.type === Discord.ChannelType.GuildVoice) {
        await scheduleWelcome(client, newState.channel, newState.member).catch(() => null);
    }
}

async function handlePresenceUpdate(client, oldPresence, newPresence) {
    const channelId = newPresence?.member?.voice?.channelId || oldPresence?.member?.voice?.channelId;
    if (channelId) await syncChannel(client, channelId, { type: 'presence' }).catch(() => null);
}

async function observeVoiceStatus(client, channelOrPayload, statusValue) {
    const channelId = typeof channelOrPayload === 'string'
        ? channelOrPayload
        : channelOrPayload?.id || channelOrPayload?.channelId || channelOrPayload?.channel_id;
    const status = statusValue ?? channelOrPayload?.status ?? null;
    const channel = channelId ? client.channels.cache.get(channelId) : null;
    if (!channel?.guild) return null;
    return withQueue(channel.id, async () => {
        const state = await getState(channel.guild.id, channel.id);
        const recentWrite = recentWrites.get(channel.id);
        if (recentWrite && recentWrite.expiresAt < Date.now()) recentWrites.delete(channel.id);
        const activeWrite = recentWrites.get(channel.id);
        const isRecentBotWrite = (activeWrite && activeWrite.value === status) || (state.lastBotValue === status && state.lastBotWriteAt && Date.now() - new Date(state.lastBotWriteAt).getTime() < 120000);
        if (isRecentBotWrite) return updateState(state, { currentDiscordValue: status, lastObservedAt: new Date(), syncStatus: 'idle' });
        return updateState(state, {
            currentDiscordValue: status,
            lastObservedAt: new Date(),
            manualLocked: channel.members.size > 0,
            manualValue: status,
            manualObservedAt: new Date(),
            source: 'manual',
            syncStatus: 'idle',
        });
    });
}

async function reconcile(client) {
    const tasks = [];
    for (const guild of client.guilds.cache.values()) {
        for (const channel of guild.channels.cache.values()) {
            if (channel.type === Discord.ChannelType.GuildVoice) tasks.push(syncChannel(client, channel.id, { type: 'reconcile' }).catch(() => null));
        }
    }
    await Promise.all(tasks);
}

module.exports = {
    handlePresenceUpdate,
    handleVoiceStateUpdate,
    observeVoiceStatus,
    reconcile,
    resetEmptyChannel,
    forceReset,
    restoreWelcome,
    scheduleWelcome,
    syncChannel,
    writeVoiceStatus,
};
