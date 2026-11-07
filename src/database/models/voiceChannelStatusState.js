const mongoose = require('mongoose');

const OverlaySchema = new mongoose.Schema({
    active: { type: Boolean, default: false },
    originalValue: { type: String, default: null },
    originalSource: { type: String, default: null },
    overlayValue: { type: String, default: null },
    startedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    originalFingerprint: { type: String, default: null },
    operationId: { type: String, default: null },
}, { _id: false });

const WriteLockSchema = new mongoose.Schema({
    operationId: { type: String, default: null },
    operationType: { type: String, default: null },
    startedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
}, { _id: false });

const Schema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    effectiveConfigVersion: { type: Number, default: 1 },
    currentDiscordValue: { type: String, default: null },
    lastBotValue: { type: String, default: null },
    lastBotWriteId: { type: String, default: null },
    lastBotWriteAt: { type: Date, default: null },
    lastResolvedValue: { type: String, default: null },
    source: { type: String, default: 'unknown' },
    manualLocked: { type: Boolean, default: false },
    manualValue: { type: String, default: null },
    manualObservedAt: { type: Date, default: null },
    lastWriteAt: { type: Date, default: null },
    lastObservedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: null },
    lastActivityFingerprint: { type: String, default: null },
    pendingCandidateActive: { type: Boolean, default: false },
    pendingCandidateValue: { type: String, default: null },
    pendingCandidateSource: { type: String, default: null },
    pendingCandidateFingerprint: { type: String, default: null },
    pendingCandidateSince: { type: Date, default: null },
    emptySessionId: { type: String, default: null },
    emptyResetAt: { type: Date, default: null },
    resetRequestPending: { type: Boolean, default: false },
    syncStatus: { type: String, enum: ['idle', 'pending', 'resetPending', 'error'], default: 'idle' },
    writeLock: { type: WriteLockSchema, default: null },
    welcomeOverlay: { type: OverlaySchema, default: () => ({}) },
    failureCount: { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: null },
}, { timestamps: true, minimize: false });

Schema.index({ guildId: 1, channelId: 1 }, { unique: true });

module.exports = mongoose.model('voiceChannelStatusState', Schema);
