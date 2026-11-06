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
const stabilityTimers = new Map();
const welcomeBatches = new Map();
const recentWrites = new Map();
const recentWriteHistory = new Map();

function operationId() {
    return crypto.randomUUID();
}

function scheduleStabilityCheck(client, channelId, dueAt) {
    const previous = stabilityTimers.get(channelId);
    if (previous) clearTimeout(previous);
    const delay = Math.max(0, dueAt - Date.now());
    const timer = setTimeout(() => {
        if (stabilityTimers.get(channelId) !== timer) return;
        stabilityTimers.delete(channelId);
        syncChannel(client, channelId, { type: 'stability' }).catch(() => null);
    }, delay);
    stabilityTimers.set(channelId, timer);
}

function clearStabilityCheck(channelId) {
    const timer = stabilityTimers.get(channelId);
    if (timer) clearTimeout(timer);
    stabilityTimers.delete(channelId);
}

function rememberRecentWrite(channelId, write) {
    recentWrites.set(channelId, write);
    const history = (recentWriteHistory.get(channelId) || [])
        .filter(entry => entry.expiresAt >= Date.now());
    history.push(write);
    recentWriteHistory.set(channelId, history.slice(-8));
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
    if (typeof client.isFeatureEnabled === 'function' &&
        !(await client.isFeatureEnabled('voiceChannelStatus', channel.guild.id))) return null;
    if (options.type === 'reconcile' && !options.statusObserved &&
        !await observeCurrentVoiceStatus(client, channel)) return null;
    const pendingState = await getState(channel.guild.id, channel.id);
    if (pendingState.resetRequestPending || pendingState.syncStatus === 'resetPending') {
        const retryAt = pendingState.nextRetryAt && new Date(pendingState.nextRetryAt).getTime();
        if (pendingState.emptySessionId && !pendingState.resetRequestPending) {
            if (channel.members.size > 0) {
                // A member returned during the grace period: cancel only the
                // empty-session reset, never a separately requested reset.
                return updateState(pendingState, { emptySessionId: null, emptyResetAt: null, syncStatus: 'idle', nextRetryAt: null });
            }
            if (retryAt && retryAt > Date.now()) return pendingState;
            const pendingConfig = await getEffectiveConfig(channel.guild.id, channel.parentId, channel.id);
            return resetEmptyChannel(client, channel, pendingConfig, pendingState);
        }
        if (!retryAt || retryAt <= Date.now()) return forceReset(client, channel);
        return pendingState;
    }
    return withQueue(channelId, async () => {
        const config = await getEffectiveConfig(channel.guild.id, channel.parentId, channel.id);
        let state = await getState(channel.guild.id, channel.id);
        if (!config.enabled) return state;
        if (!options.force && state.nextRetryAt && Date.now() < new Date(state.nextRetryAt).getTime()) return state;
        const members = channel.members;
        // Empty-session reset has priority over welcome overlays. Otherwise an
        // overlay could keep the previous session's lock alive until expiry.
        if (config.resetOnEmpty && members.size === 0) return resetEmptyChannel(client, channel, config, state);
        // Quiet hours suppress automatic status updates, not cleanup of the
        // session that just ended.
        if (isQuietHours(config) && !options.force) return state;
        if (state.welcomeOverlay?.active && !options.overlay) return state;

        const activities = collectActivities(channel);
        const resolutionConfig = { ...config, voiceMemberCount: members.size };
        // Evaluate candidates without the previous stale value. Only an
        // activity that can actually produce an automatic status refreshes
        // lastActivityAt; a game is not eligible when game mode is `none` or
        // when it does not pass the configured threshold.
        const candidateDecision = resolveStatus({
            activities,
            config: resolutionConfig,
            state: { ...state, lastActivityAt: null, lastResolvedValue: null },
            voiceMemberCount: members.size,
        });
        const noCandidateSources = new Set(['disabled', 'manual', 'empty', 'default', 'empty-stale']);
        if (candidateDecision.value && !noCandidateSources.has(candidateDecision.source)) {
            state = await updateState(state, { lastActivityAt: new Date() });
        }
        const decision = resolveStatus({
            activities,
            config: resolutionConfig,
            state,
            voiceMemberCount: members.size,
        });
        const nextValue = decision.value || null;
        if (decision.source === 'manual') {
            clearStabilityCheck(channel.id);
            if (state.pendingCandidateActive) {
                state = await updateState(state, {
                    pendingCandidateActive: false,
                    pendingCandidateValue: null,
                    pendingCandidateSource: null,
                    pendingCandidateFingerprint: null,
                    pendingCandidateSince: null,
                });
            }
            return state;
        }
        const debounceMs = Math.max(0, Number(config.debounceSeconds || 0) * 1000);
        const needsAutomaticWrite = nextValue !== state.currentDiscordValue;
        if (!options.force && !options.overlay && debounceMs > 0 && needsAutomaticWrite) {
            const sameCandidate = state.pendingCandidateActive &&
                state.pendingCandidateValue === nextValue &&
                state.pendingCandidateSource === decision.source;
            if (!sameCandidate) {
                const since = new Date();
                state = await updateState(state, {
                    pendingCandidateActive: true,
                    pendingCandidateValue: nextValue,
                    pendingCandidateSource: decision.source,
                    pendingCandidateFingerprint: decision.fingerprint,
                    pendingCandidateSince: since,
                });
                scheduleStabilityCheck(client, channel.id, since.getTime() + debounceMs);
                return state;
            }
            const pendingSince = state.pendingCandidateSince && new Date(state.pendingCandidateSince).getTime();
            const stableAt = (pendingSince || Date.now()) + debounceMs;
            if (Date.now() < stableAt) {
                scheduleStabilityCheck(client, channel.id, stableAt);
                return state;
            }
            const minWriteAt = state.lastWriteAt &&
                new Date(state.lastWriteAt).getTime() + Number(config.minUpdateIntervalSeconds || 0) * 1000;
            if (minWriteAt && minWriteAt > Date.now()) {
                scheduleStabilityCheck(client, channel.id, minWriteAt);
                return state;
            }
            clearStabilityCheck(channel.id);
        } else if (!needsAutomaticWrite && state.pendingCandidateActive) {
            clearStabilityCheck(channel.id);
            state = await updateState(state, {
                pendingCandidateActive: false,
                pendingCandidateValue: null,
                pendingCandidateSource: null,
                pendingCandidateFingerprint: null,
                pendingCandidateSince: null,
            });
        }
        if (!options.force && nextValue === state.lastBotValue && nextValue === state.currentDiscordValue) return state;
        if (!options.force && state.lastWriteAt && Date.now() - new Date(state.lastWriteAt).getTime() < Number(config.minUpdateIntervalSeconds || 0) * 1000) return state;
        const lock = await acquireWriteLock(channel.guild.id, channel.id, options.type || 'sync');
        if (!lock) return state;
        state = lock.state;
        const id = lock.id;
        try {
            await writeVoiceStatus(client, channel, nextValue);
            rememberRecentWrite(channel.id, { value: nextValue, operationId: id, expiresAt: Date.now() + 120000 });
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
                pendingCandidateActive: false,
                pendingCandidateValue: null,
                pendingCandidateSource: null,
                pendingCandidateFingerprint: null,
                pendingCandidateSince: null,
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

async function readActualVoiceStatus(client, channel) {
    if (client.rest?.get) {
        try {
            const payload = await client.rest.get(`/channels/${channel.id}`);
            if (Object.prototype.hasOwnProperty.call(payload || {}, 'status')) return payload.status ?? null;
            if (Object.prototype.hasOwnProperty.call(payload || {}, 'voice_status')) return payload.voice_status ?? null;
        } catch (_) {
            return undefined;
        }
    }
    if (Object.prototype.hasOwnProperty.call(channel, 'status')) return channel.status ?? null;
    return undefined;
}

async function observeCurrentVoiceStatus(client, channel) {
    return withQueue(channel.id, async () => {
        // Keep the REST read in the same queue as writes. A presence update
        // cannot then race this observation with an in-flight status write.
        const actualStatus = await readActualVoiceStatus(client, channel);
        if (actualStatus === undefined) return false;
        const state = await getState(channel.guild.id, channel.id);
        const hasPreviousObservation = Boolean(
            state.lastObservedAt || state.currentDiscordValue !== null || state.manualLocked,
        );
        const matchesKnownBotValue = state.lastBotValue === actualStatus &&
            state.currentDiscordValue === actualStatus &&
            state.lastBotWriteAt;
        const matchesActiveWelcome = state.welcomeOverlay?.active &&
            state.currentDiscordValue === actualStatus;
        const isInitialEmptyObservation = actualStatus === null &&
            state.currentDiscordValue === null &&
            !state.lastBotWriteAt &&
            !state.manualLocked;
        const manuallyLocked = Boolean(state.manualLocked) ||
            (!matchesKnownBotValue && !matchesActiveWelcome && !isInitialEmptyObservation &&
                channel.members.size > 0 && hasPreviousObservation);
        await updateState(state, {
            currentDiscordValue: actualStatus,
            lastObservedAt: new Date(),
            manualLocked: manuallyLocked,
            manualValue: manuallyLocked ? actualStatus : null,
            manualObservedAt: manuallyLocked ? new Date() : state.manualObservedAt,
            source: manuallyLocked ? 'manual' : state.source,
            syncStatus: state.syncStatus === 'resetPending' ? 'resetPending' : 'idle',
        });
        return true;
    });
}

function scheduleWelcomeRestore(client, channelId, operationId, expiresAt) {
    const key = `welcome:${channelId}`;
    const previousTimer = timers.get(key);
    if (previousTimer) clearTimeout(previousTimer);
    const delay = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    const timer = setTimeout(() => {
        if (timers.get(key) !== timer) return;
        timers.delete(key);
        restoreWelcome(client, channelId, operationId).catch(() => null);
    }, delay);
    timers.set(key, timer);
}

async function resetEmptyChannel(client, channel, config, state) {
    if (!config.resetOnEmpty) return state;
    if (state.source === 'empty' && !state.currentDiscordValue && !state.manualLocked && !state.welcomeOverlay?.active && !state.emptySessionId) return state;
    const sessionId = state.emptySessionId || operationId();
    const deadline = state.emptyResetAt
        ? new Date(state.emptyResetAt)
        : new Date(Date.now() + Math.max(0, Number(config.emptyResetDelaySeconds || 0) * 1000));
    await updateState(state, {
        emptySessionId: sessionId,
        emptyResetAt: deadline,
        pendingCandidateActive: false,
        pendingCandidateValue: null,
        pendingCandidateSource: null,
        pendingCandidateFingerprint: null,
        pendingCandidateSince: null,
        syncStatus: 'resetPending',
    });
    const delay = Math.max(0, deadline.getTime() - Date.now());
    await new Promise(resolve => setTimeout(resolve, delay));
    const refreshed = await getState(channel.guild.id, channel.id);
    if (refreshed.emptySessionId !== sessionId) return refreshed;
    if (channel.members.size > 0) {
        return updateState(refreshed, { emptySessionId: null, emptyResetAt: null, syncStatus: 'idle', nextRetryAt: null });
    }
    const lock = await acquireWriteLock(channel.guild.id, channel.id, 'reset-empty');
    if (!lock) return refreshed;
    const stateWithLock = lock.state;
    const id = lock.id;
    try {
        await writeVoiceStatus(client, channel, null);
        rememberRecentWrite(channel.id, { value: null, operationId: id, expiresAt: Date.now() + 120000 });
        return updateState(stateWithLock, {
            currentDiscordValue: null,
            lastBotValue: null,
            lastResolvedValue: null,
            source: 'empty',
            manualLocked: false,
            manualValue: null,
            manualObservedAt: null,
            lastActivityFingerprint: null,
            pendingCandidateActive: false,
            pendingCandidateValue: null,
            pendingCandidateSource: null,
            pendingCandidateFingerprint: null,
            pendingCandidateSince: null,
            emptySessionId: null,
            emptyResetAt: null,
            resetRequestPending: false,
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
        await updateState(stateWithLock, {
            syncStatus: 'resetPending',
            failureCount: (stateWithLock.failureCount || 0) + 1,
            nextRetryAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** Math.min(stateWithLock.failureCount || 0, 8))),
            writeLock: null,
        });
        throw error;
    }
}

async function runWelcome(client, channel, users, options = {}) {
    return withQueue(channel.id, async () => {
        const config = await getEffectiveConfig(channel.guild.id, channel.parentId, channel.id);
        if (!config.enabled || (!config.welcomeOverlay?.enabled && !options.force) || (isQuietHours(config) && !options.force)) return null;
        const queuedUsers = Array.isArray(users) ? users : [];
        const automaticBatch = !options.force && !options.message;
        const currentMembers = queuedUsers.filter(user => {
            const userId = user?.id || user?.user?.id || user?.userId;
            return userId && channel.members.has(userId);
        });
        // The batch runs after a delay, so the original joiners may no longer
        // be present. Never recreate a status on an empty channel after its
        // empty-session reset has completed.
        if (!channel.members.size || (automaticBatch && queuedUsers.length && !currentMembers.length)) return null;
        users = automaticBatch && currentMembers.length ? currentMembers : queuedUsers;
        const state = await getState(channel.guild.id, channel.id);
        if (state.resetRequestPending || (state.syncStatus === 'resetPending' && !state.emptySessionId)) return state;
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
        const lock = await acquireWriteLock(channel.guild.id, channel.id, 'welcome');
        if (!lock) return state;
        const lockedState = lock.state;
        if (lockedState.resetRequestPending || (lockedState.syncStatus === 'resetPending' && !lockedState.emptySessionId)) {
            await updateState(lockedState, { writeLock: null });
            return lockedState;
        }
        const activeOverlay = lockedState.welcomeOverlay?.active;
        const original = activeOverlay
            ? lockedState.welcomeOverlay.originalValue
            : lockedState.currentDiscordValue;
        const originalSource = activeOverlay
            ? lockedState.welcomeOverlay.originalSource
            : lockedState.source;
        const originalFingerprint = activeOverlay
            ? lockedState.welcomeOverlay.originalFingerprint
            : lockedState.lastActivityFingerprint;
        const id = operationId();
        try {
            await writeVoiceStatus(client, channel, value);
            rememberRecentWrite(channel.id, { value, operationId: id, expiresAt: Date.now() + 120000 });
            await updateState(lockedState, { welcomeOverlay: { active: true, originalValue: original, originalSource, overlayValue: value, startedAt: new Date(), expiresAt: new Date(Date.now() + config.welcomeOverlay.durationSeconds * 1000), originalFingerprint, operationId: id }, currentDiscordValue: value, lastBotValue: value, lastBotWriteId: id, lastBotWriteAt: new Date(), lastWriteAt: new Date(), writeLock: null, syncStatus: 'idle' });
        } catch (error) {
            await updateState(lockedState, { writeLock: null, syncStatus: 'error', failureCount: (lockedState.failureCount || 0) + 1 });
            throw error;
        }
        const durationSeconds = options.durationSeconds || config.welcomeOverlay.durationSeconds;
        scheduleWelcomeRestore(client, channel.id, id, Date.now() + durationSeconds * 1000);
        return lockedState;
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
        try {
            await writeVoiceStatus(client, channel, null);
            rememberRecentWrite(channel.id, { value: null, operationId: id, expiresAt: Date.now() + 120000 });
            return updateState(state, {
                currentDiscordValue: null,
                lastBotValue: null,
                lastResolvedValue: null,
                source: 'empty',
                manualLocked: false,
                manualValue: null,
                manualObservedAt: null,
                emptySessionId: null,
                emptyResetAt: null,
                resetRequestPending: false,
                lastActivityAt: null,
                lastActivityFingerprint: null,
                pendingCandidateActive: false,
                pendingCandidateValue: null,
                pendingCandidateSource: null,
                pendingCandidateFingerprint: null,
                pendingCandidateSince: null,
                welcomeOverlay: { active: false },
                syncStatus: 'idle',
                writeLock: null,
                lastBotWriteId: id,
                lastBotWriteAt: new Date(),
                lastWriteAt: new Date(),
                failureCount: 0,
                nextRetryAt: null,
            });
        } catch (error) {
            await updateState(state, {
                // Keep the requested reset as a durable operation. Ordinary
                // synchronization must not consume it while the channel is
                // still manually locked.
                syncStatus: 'resetPending',
                resetRequestPending: true,
                emptySessionId: null,
                failureCount: (state.failureCount || 0) + 1,
                nextRetryAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** Math.min(state.failureCount || 0, 8))),
                writeLock: null,
            });
            throw error;
        }
    });
}

async function restoreWelcome(client, channelId, expectedOperationId) {
    let restored = false;
    let resetDeferred = false;
    const result = await withQueue(channelId, async () => {
        const channel = client.channels.cache.get(channelId);
        if (!channel) return null;
        const lock = await acquireWriteLock(channel.guild.id, channel.id, 'welcome-restore');
        if (!lock) return getState(channel.guild.id, channel.id);
        const state = lock.state;
        if (state.resetRequestPending || (state.syncStatus === 'resetPending' && !state.emptySessionId)) {
            resetDeferred = true;
            return updateState(state, { welcomeOverlay: { active: false }, writeLock: null });
        }
        if (!state.welcomeOverlay?.active || (expectedOperationId && state.welcomeOverlay.operationId !== expectedOperationId)) {
            return updateState(state, { writeLock: null, syncStatus: 'idle' });
        }
        if (state.currentDiscordValue !== state.welcomeOverlay.overlayValue) return updateState(state, { welcomeOverlay: { active: false }, writeLock: null, syncStatus: 'idle' });
        try {
            await writeVoiceStatus(client, channel, state.welcomeOverlay.originalValue);
            const id = operationId();
            rememberRecentWrite(channel.id, { value: state.welcomeOverlay.originalValue, operationId: id, expiresAt: Date.now() + 120000 });
            const restoredState = await updateState(state, { currentDiscordValue: state.welcomeOverlay.originalValue, lastBotValue: state.welcomeOverlay.originalValue, source: state.welcomeOverlay.originalSource || 'unknown', lastBotWriteId: id, lastBotWriteAt: new Date(), lastWriteAt: new Date(), welcomeOverlay: { active: false }, writeLock: null, syncStatus: 'idle' });
            restored = true;
            return restoredState;
        } catch (error) {
            await updateState(state, { writeLock: null, syncStatus: 'error', failureCount: (state.failureCount || 0) + 1 });
            throw error;
        }
    });
    if (restored) {
        await syncChannel(client, channelId, { force: true, type: 'welcome-expired' }).catch(() => null);
    } else if (resetDeferred) {
        await syncChannel(client, channelId, { type: 'welcome-expired' }).catch(() => null);
    }
    return result;
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
    const observedState = await withQueue(channel.id, async () => {
        const state = await getState(channel.guild.id, channel.id);
        const recentWrite = recentWrites.get(channel.id);
        if (recentWrite && recentWrite.expiresAt < Date.now()) recentWrites.delete(channel.id);
        const activeWrite = recentWrites.get(channel.id);
        const history = (recentWriteHistory.get(channel.id) || [])
            .filter(entry => entry.expiresAt >= Date.now());
        recentWriteHistory.set(channel.id, history);
        const echoedWrite = [...history].reverse().find(entry => entry.value === status);
        const isRecentBotWrite = echoedWrite ||
            (state.lastBotValue === status && state.lastBotWriteAt && Date.now() - new Date(state.lastBotWriteAt).getTime() < 120000);
        if (isRecentBotWrite) return updateState(state, {
            // An older gateway echo is still a bot event, but must not roll
            // the observed value back over a newer queued write.
            currentDiscordValue: echoedWrite && activeWrite?.operationId !== echoedWrite.operationId
                ? state.currentDiscordValue
                : status,
            lastObservedAt: new Date(),
            syncStatus: state.syncStatus === 'resetPending' ? 'resetPending' : 'idle',
        });
        const manuallySet = channel.members.size > 0;
        const overlayWasChangedByHuman = state.welcomeOverlay?.active &&
            status !== state.welcomeOverlay.overlayValue;
        return updateState(state, {
            currentDiscordValue: status,
            lastObservedAt: new Date(),
            // A human clear is still a manual value. Keep the lock until an
            // explicit reset, otherwise the next activity update recreates it.
            manualLocked: manuallySet,
            manualValue: manuallySet ? status : null,
            manualObservedAt: manuallySet ? new Date() : null,
            source: manuallySet ? 'manual' : 'empty',
            ...(overlayWasChangedByHuman ? {
                // The overlay remains active, but its restoration target now
                // becomes the value chosen by the human during the overlay.
                welcomeOverlay: {
                    ...state.welcomeOverlay,
                    originalValue: status,
                    originalSource: 'manual',
                    originalFingerprint: null,
                },
            } : {}),
            syncStatus: state.syncStatus === 'resetPending' ? 'resetPending' : 'idle',
        });
    });
    return observedState;
}

async function reconcile(client) {
    const tasks = [];
    for (const guild of client.guilds.cache.values()) {
        if (typeof client.isFeatureEnabled === 'function' &&
            !(await client.isFeatureEnabled('voiceChannelStatus', guild.id))) continue;
        for (const channel of guild.channels.cache.values()) {
            if (channel.type !== Discord.ChannelType.GuildVoice) continue;
            tasks.push((async () => {
                const config = await getEffectiveConfig(guild.id, channel.parentId, channel.id);
                if (!config.enabled) return;
                // Reconciliation must never overwrite a status changed while
                // the process was offline without first observing Discord.
                if (!await observeCurrentVoiceStatus(client, channel)) return;
                const state = await getState(guild.id, channel.id);
                if (state.welcomeOverlay?.active) {
                    const expiresAt = state.welcomeOverlay.expiresAt && new Date(state.welcomeOverlay.expiresAt).getTime();
                    if (!expiresAt || expiresAt <= Date.now()) {
                        await restoreWelcome(client, channel.id, state.welcomeOverlay.operationId).catch(() => null);
                    } else if (expiresAt && state.welcomeOverlay.operationId) {
                        scheduleWelcomeRestore(client, channel.id, state.welcomeOverlay.operationId, expiresAt);
                    }
                }
                await syncChannel(client, channel.id, { type: 'reconcile', statusObserved: true });
            })().catch(() => null));
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
