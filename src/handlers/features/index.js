const defaultRegistry = require('./registry');

function hasOwn(value, key) {
    return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function createFeatureManager({
    registry = defaultRegistry,
    readGuild = async () => ({}),
    readGlobal = async () => ({}),
    writeGuild = async value => value,
    writeGlobal = async value => value,
    logger = console,
} = {}) {
    const definitions = registry || {};
    const guildCache = new Map();
    let globalCache;

    function definitionFor(feature) {
        const definition = definitions[feature];
        if (!definition) throw new Error(`Unknown feature: ${feature}`);
        return definition;
    }

    function defaultState(feature) {
        const definition = definitionFor(feature);
        return {
            feature,
            enabled: definition.defaultEnabled !== false,
            source: 'default',
        };
    }

    async function safeRead(reader, label, fallback) {
        try {
            return await reader() || fallback;
        } catch (error) {
            logger.warn?.(`[features] failed to read ${label}: ${error.message}`);
            return fallback;
        }
    }

    async function getGlobalDocument() {
        if (globalCache !== undefined) return globalCache;
        globalCache = await safeRead(readGlobal, 'global state', {});
        return globalCache;
    }

    async function getFeatureState(feature, guildId) {
        const definition = definitionFor(feature);
        if (definition.alwaysOn) {
            return { feature, enabled: true, source: 'default' };
        }

        const cacheKey = `${guildId || 'global'}:${feature}`;
        if (guildCache.has(cacheKey)) return guildCache.get(cacheKey);

        const globalDocument = await getGlobalDocument();
        const globalFeatures = globalDocument.Features || {};
        if (hasOwn(globalFeatures, feature)) {
            const state = { feature, enabled: globalFeatures[feature] === true, source: 'global' };
            guildCache.set(cacheKey, state);
            return state;
        }

        const guildDocument = await safeRead(() => readGuild(guildId), `guild state ${guildId}`, {});
        const guildFeatures = guildDocument.Features || {};
        if (hasOwn(guildFeatures, feature)) {
            const state = { feature, enabled: guildFeatures[feature] === true, source: 'guild' };
            guildCache.set(cacheKey, state);
            return state;
        }

        const state = { ...defaultState(feature) };
        guildCache.set(cacheKey, state);
        return state;
    }

    function invalidateGuild(guildId, feature) {
        if (feature) guildCache.delete(`${guildId || 'global'}:${feature}`);
        else for (const key of guildCache.keys()) if (key.startsWith(`${guildId || 'global'}:`)) guildCache.delete(key);
    }

    async function updateDocument(reader, writer, feature, enabled, metadata = {}) {
        const document = await reader() || {};
        const features = { ...(document.Features || {}) };
        if (enabled === null) delete features[feature];
        else features[feature] = enabled === true;
        return writer({ ...document, Features: features }, metadata);
    }

    return {
        registry: definitions,
        hasFeature: feature => typeof feature === 'string' && hasOwn(definitions, feature),
        getAvailableFeatures: () => Object.values(definitions),
        getFeatureDefinition: feature => definitionFor(feature),
        getFeatureState,
        isFeatureEnabled: async (feature, guildId) => (await getFeatureState(feature, guildId)).enabled,
        async setGuildFeature(feature, guildId, enabled) {
            definitionFor(feature);
            const result = await updateDocument(() => readGuild(guildId), document => writeGuild(document, guildId), feature, enabled);
            invalidateGuild(guildId, feature);
            return result;
        },
        async resetGuildFeature(feature, guildId) {
            definitionFor(feature);
            const result = await updateDocument(() => readGuild(guildId), document => writeGuild(document, guildId), feature, null);
            invalidateGuild(guildId, feature);
            return result;
        },
        async setGlobalFeature(feature, enabled, metadata) {
            definitionFor(feature);
            const result = await updateDocument(readGlobal, writeGlobal, feature, enabled, metadata);
            globalCache = undefined;
            guildCache.clear();
            return result;
        },
        async resetGlobalFeature(feature, metadata) {
            definitionFor(feature);
            const result = await updateDocument(readGlobal, writeGlobal, feature, null, metadata);
            globalCache = undefined;
            guildCache.clear();
            return result;
        },
        invalidateGuild,
        invalidateAll: () => { globalCache = undefined; guildCache.clear(); },
    };
}

function installFeatureManager(client, options) {
    const manager = createFeatureManager(options);
    client.features = manager;
    client.isFeatureEnabled = manager.isFeatureEnabled;
    client.getFeatureState = manager.getFeatureState;
    client.requireFeature = async (interaction, feature) => {
        // Commands and context menus are not necessarily backed by a feature
        // entry (for example the "Mettre en spoiler" context menu). They must
        // remain executable instead of passing their display name to
        // definitionFor(), which would throw "Unknown feature".
        if (!manager.hasFeature(feature)) {
            return true;
        }

        const state = await manager.getFeatureState(feature, interaction?.guild?.id);
        if (state.enabled) return true;

        const definition = manager.getFeatureDefinition(feature);
        const labelKey = definition.labelKey || `features.${feature}.label`;
        const label = typeof client.t === 'function'
            ? await client.t(interaction, labelKey)
            : feature;
        const key = state.source === 'global' ? 'features.globallyDisabled' : 'features.guildDisabled';
        if (typeof client.errNormal === 'function') {
            await client.errNormal({ key, variables: { feature: label }, type: 'ephemeral' }, interaction);
        }
        return false;
    };
    return manager;
}

module.exports = {
    createFeatureManager,
    installFeatureManager,
    FEATURE_REGISTRY: defaultRegistry,
};
