const mongoose = require('mongoose');

const GameThresholdSchema = new mongoose.Schema({
    minMembers: { type: Number, default: 2, min: 1 },
    minShare: { type: Number, default: 0.5, min: 0, max: 1 },
    shareDenominator: { type: String, enum: ['activeMembers', 'voiceMembers'], default: 'activeMembers' },
}, { _id: false });

const QuietHoursSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    timezone: { type: String, default: 'Europe/Brussels' },
    ranges: { type: [mongoose.Schema.Types.Mixed], default: [] },
}, { _id: false });

const WelcomeOverlaySchema = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    durationSeconds: { type: Number, default: 12, min: 10, max: 15 },
    templates: { type: [String], default: [] },
    selectionMode: { type: String, enum: ['random'], default: 'random' },
    avoidImmediateRepeat: { type: Boolean, default: true },
    welcomeAggregationMode: { type: String, enum: ['latest', 'group', 'generic'], default: 'group' },
    maxGroupedUsers: { type: Number, default: 3, min: 1, max: 3 },
    restoreManualStatus: { type: Boolean, default: true },
}, { _id: false });

const Schema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    scope: { type: String, enum: ['guild', 'category', 'channel'], required: true },
    targetId: { type: String, required: true },
    categoryId: { type: String, default: null },
    channelId: { type: String, default: null },
    overrides: { type: Map, of: mongoose.Schema.Types.Mixed, default: () => ({}) },
    enabled: { type: Boolean, default: true },
    vocation: { type: String, enum: ['gaming', 'chill', 'work', 'cinema', 'music', 'general', 'custom'], default: 'general' },
    mode: { type: String, enum: ['automatic', 'manual', 'hybrid'], default: 'hybrid' },
    mediaEnabled: { type: Boolean, default: true },
    providers: { type: [String], default: ['premid', 'youtube', 'netflix', 'twitch', 'spotify'] },
    activityFamilies: { type: [String], default: ['media', 'game'] },
    activityPriority: { type: String, enum: ['media-first', 'game-first', 'dominant', 'mixed', 'configured'], default: 'dominant' },
    gameStatusMode: { type: String, enum: ['priority', 'none', 'generic', 'summary'], default: 'none' },
    genericStatus: { type: String, default: null },
    gameThreshold: { type: GameThresholdSchema, default: () => ({}) },
    gameWeights: { type: Map, of: Number, default: () => ({ '*': 1 }) },
    maxSummaryItems: { type: Number, default: 3, min: 1, max: 10 },
    aggregationMode: { type: String, enum: ['first', 'count', 'summary', 'custom'], default: 'summary' },
    defaultStatus: { type: String, default: null },
    clearWhenNoActivity: { type: Boolean, default: true },
    resetOnEmpty: { type: Boolean, default: true },
    emptyResetDelaySeconds: { type: Number, default: 5, min: 0, max: 300 },
    staleAfterSeconds: { type: Number, default: 120, min: 0 },
    debounceSeconds: { type: Number, default: 10, min: 0 },
    minUpdateIntervalSeconds: { type: Number, default: 30, min: 0 },
    statusRotationSeconds: { type: Number, default: 30, min: 0 },
    allowBotOverride: { type: Boolean, default: false },
    quietHours: { type: QuietHoursSchema, default: () => ({}) },
    welcomeOverlay: { type: WelcomeOverlaySchema, default: () => ({}) },
    createdBy: { type: String, default: null },
    updatedBy: { type: String, default: null },
}, { timestamps: true, minimize: false });

Schema.index({ guildId: 1, scope: 1, targetId: 1 }, { unique: true });

module.exports = mongoose.model('voiceChannelStatusConfig', Schema);
