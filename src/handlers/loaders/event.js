const fs = require('fs');
const logger = require('../logger');
const Discord = require('discord.js');

module.exports = (client) => {

    const eventFeatures = {
        messageUpdate: 'triggers',
        messageDelete: 'triggers',
        messageReactionAdd: 'triggers',
        messageReactionRemove: 'triggers',
        voiceStateUpdate: ['voiceCleanup', 'voiceChannelStatus'],
        presenceUpdate: 'voiceChannelStatus',
        voiceChannelStatusUpdate: 'voiceChannelStatus',
        guildMemberAdd: 'welcome',
    };

    const bindEvent = (event, eventName) => async (...args) => {
        const feature = eventFeatures[eventName];
        const guildId = args[0]?.guild?.id;
        const features = Array.isArray(feature) ? feature : feature ? [feature] : [];
        if (features.length && guildId && typeof client.isFeatureEnabled === 'function') {
            const enabled = await Promise.all(features.map(name => client.isFeatureEnabled(name, guildId)));
            if (!enabled.some(Boolean)) return;
        }
        return event(client, ...args);
    };

    if (client.shard.ids[0] === 0) logger.info('EVENTS', 'Chargement des événements');

    fs.readdirSync('./src/events').forEach(dirs => {
        const events = fs.readdirSync(`./src/events/${dirs}`).filter(files => files.endsWith('.js'));

        if (client.shard.ids[0] === 0) logger.success('EVENTS', `${events.length} événement(s) chargé(s) depuis ${dirs}`);

        for (const file of events) {
            const event = require(`../../events/${dirs}/${file}`);
            const eventName = file.split(".")[0];
            const eventUpperCase = eventName.charAt(0).toUpperCase() + eventName.slice(1);
            if(Discord.Events[eventUpperCase] === undefined){
                client.on(eventName, bindEvent(event, eventName)).setMaxListeners(0);
            }else {
            client.on(Discord.Events[eventUpperCase], bindEvent(event, eventName)).setMaxListeners(0);
            }
        };
    });
}


