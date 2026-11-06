const families = new Map();

function registerActivityFamily(family) {
    if (!family?.id || typeof family.resolve !== 'function') throw new TypeError('An activity family requires an id and resolve function');
    families.set(family.id, family);
    return () => families.delete(family.id);
}

function getActivityFamily(id) {
    return families.get(id) || null;
}

function listActivityFamilies() {
    return [...families.values()];
}

function resolveRegisteredFamilies(activities, config, context = {}) {
    return (config.activityFamilies || [])
        .filter(id => id !== 'media' && id !== 'game')
        .map(id => ({ family: getActivityFamily(id), id }))
        .filter(entry => entry.family)
        .map(({ family, id }) => {
            try {
                const decision = family.resolve({ activities, config, ...context });
                return decision ? { ...decision, family: decision.family || id } : null;
            } catch (error) {
                return { family: id, error: { code: 'FAMILY_RESOLUTION_FAILED', retryable: false, message: error.message } };
            }
        })
        .filter(Boolean);
}

module.exports = {
    getActivityFamily,
    listActivityFamilies,
    registerActivityFamily,
    resolveRegisteredFamilies,
};
