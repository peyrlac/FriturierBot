const Discord = require('discord.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Manager } = require("erela.js");
const Spotify = require("erela.js-spotify");
const Facebook = require("erela.js-facebook");
const Deezer = require("erela.js-deezer");
const AppleMusic = require("erela.js-apple");
const Functions = require('./database/models/functions');
const GlobalFeatures = require('./database/models/globalFeatures');
const { installFeatureManager } = require('./handlers/features');

function createLavalinkNodes() {
    if (process.env.LAVALINK_ENABLED === 'false') return [];

    const host = String(process.env.LAVALINK_HOST || '').trim();
    if (!host) return [];

    const port = Number.parseInt(process.env.LAVALINK_PORT, 10);

    return [{
        host,
        port: Number.isInteger(port) ? port : 2333,
        password: process.env.LAVALINK_PASSWORD || '',
        secure: process.env.LAVALINK_SECURE === 'true'
    }];
}

const lavalinkNodes = createLavalinkNodes();

// Discord client
const client = new Discord.Client({
    allowedMentions: {
        parse: [
            'users',
            'roles'
        ],
        repliedUser: true
    },
    autoReconnect: true,
    disabledEvents: [
        "TYPING_START"
    ],
    partials: [
        Discord.Partials.Channel,
        Discord.Partials.GuildMember,
        Discord.Partials.Message,
        Discord.Partials.Reaction,
        Discord.Partials.User,
        Discord.Partials.GuildScheduledEvent
    ],
    intents: [
        Discord.GatewayIntentBits.Guilds,
        Discord.GatewayIntentBits.GuildMembers,
        Discord.GatewayIntentBits.GuildBans,
        Discord.GatewayIntentBits.GuildEmojisAndStickers,
        Discord.GatewayIntentBits.GuildIntegrations,
        Discord.GatewayIntentBits.GuildWebhooks,
        Discord.GatewayIntentBits.GuildInvites,
        Discord.GatewayIntentBits.GuildVoiceStates,
        Discord.GatewayIntentBits.GuildPresences,
        Discord.GatewayIntentBits.GuildMessages,
        Discord.GatewayIntentBits.GuildMessageReactions,
        Discord.GatewayIntentBits.GuildMessageTyping,
        Discord.GatewayIntentBits.DirectMessages,
        Discord.GatewayIntentBits.DirectMessageReactions,
        Discord.GatewayIntentBits.DirectMessageTyping,
        Discord.GatewayIntentBits.GuildScheduledEvents,
        Discord.GatewayIntentBits.MessageContent
    ],
    restTimeOffset: 0
});


const clientID = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
if (clientID && clientSecret) {
    // Lavalink client
    client.player = new Manager({
        plugins: [
            new AppleMusic(),
            new Deezer(),
            new Facebook(),
            new Spotify({
                clientID,
                clientSecret,
            })
        ],
        nodes: lavalinkNodes,
        send(id, payload) {
            const guild = client.guilds.cache.get(id);
            if (guild) guild.shard.send(payload);
        },
    })

} else {
    // Lavalink client
    client.player = new Manager({
        plugins: [
            new AppleMusic(),
            new Deezer(),
            new Facebook(),
        ],
        nodes: lavalinkNodes,
        send(id, payload) {
            const guild = client.guilds.cache.get(id);
            if (guild) guild.shard.send(payload);
        }
    })
}
const events = fs.readdirSync(`./src/events/music`).filter(files => files.endsWith('.js'));

for (const file of events) {
    const event = require(`./events/music/${file}`);
    client.player.on(file.split(".")[0], event.bind(null, client)).setMaxListeners(0);
};

// Connect to database
require("./database/connect")();

// Client settings
client.config = require('./config/bot');
client.changelogs = require('./config/changelogs');
client.emotes = require("./config/emojis.json");
client.webhooks = require("./config/webhooks.json");
installFeatureManager(client, {
    readGuild: async guildId => Functions.findOne({ Guild: guildId }).select('Features').lean(),
    readGlobal: async () => GlobalFeatures.findOne({ Key: 'global' }).select('Features').lean(),
    writeGuild: async (document, guildId) => Functions.findOneAndUpdate(
        { Guild: guildId },
        { $set: { Features: document.Features || {} } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
    writeGlobal: async document => GlobalFeatures.findOneAndUpdate(
        { Key: 'global' },
        { $set: { Features: document.Features || {} } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ),
    logger: console,
});
const webHooksArray = ['startLogs', 'shardLogs', 'errorLogs', 'dmLogs', 'voiceLogs', 'serverLogs', 'serverLogs2', 'commandLogs', 'consoleLogs', 'warnLogs', 'voiceErrorLogs', 'creditLogs', 'evalLogs', 'interactionLogs'];
// Check if .env webhook_id and webhook_token are set
if (process.env.WEBHOOK_ID && process.env.WEBHOOK_TOKEN) {
    for (const webhookName of webHooksArray) {
        client.webhooks[webhookName].id = process.env.WEBHOOK_ID;
        client.webhooks[webhookName].token = process.env.WEBHOOK_TOKEN;
    }
}

client.commands = new Discord.Collection();
client.playerManager = new Map();
client.triviaManager = new Map();
client.queue = new Map();

// Webhooks
const consoleLogs = new Discord.WebhookClient({
    id: client.webhooks.consoleLogs.id,
    token: client.webhooks.consoleLogs.token,
});

const warnLogs = new Discord.WebhookClient({
    id: client.webhooks.warnLogs.id,
    token: client.webhooks.warnLogs.token,
});

// Load handlers
fs.readdirSync('./src/handlers', { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .forEach(({ name: dir }) => {
    fs.readdirSync(`./src/handlers/${dir}`).forEach((handler) => {
        if (dir === 'serverstats' && handler === 'createStatsChannel.js') return;
        const handlerModule = require(`./handlers/${dir}/${handler}`);
        if (typeof handlerModule === 'function') handlerModule(client);
    });
});

client.login(process.env.DISCORD_TOKEN);

process.on('unhandledRejection', error => {
    console.error('Rejet de promesse non gérée:', error);
    if (error) if (error.length > 950) error = error.slice(0, 950) + '... Afficher la console pour plus de détails';
    if (error.stack) if (error.stack.length > 950) error.stack = error.stack.slice(0, 950) + '... Afficher la console pour plus de détails';
    if(!error.stack) return
    const embed = new Discord.EmbedBuilder()
        .setTitle(`🚨・Rejet de promesse non gérée`)
        .addFields([
            {
                name: "Erreur",
                value: error ? Discord.codeBlock(error) : "Pas d'erreur",
            },
            {
                name: "Erreur de pile",
                value: error.stack ? Discord.codeBlock(error.stack) : "Aucune erreur de Stack",
            }
        ])
        .setColor(client.config.colors.normal)
    consoleLogs.send({
        username: 'Bot Logs',
        embeds: [embed],
    }).catch(() => {
        console.log('Erreur lors de l\'envoi du rejet non géré au webhook')
        console.log(error)
    })
});

process.on('warning', warn => {
    console.warn("Avertissement:", warn);
    const embed = new Discord.EmbedBuilder()
        .setTitle(`🚨・Nouvel avertissement trouvé`)
        .addFields([
            {
                name: `Warn`,
                value: `\`\`\`${warn}\`\`\``,
            },
        ])
        .setColor(client.config.colors.normal)
    warnLogs.send({
        username: 'Logs',
        embeds: [embed],
    }).catch(() => {
        console.log('Erreur lors de l\'envoi de l\'avertissement au webhook')
        console.log(warn)
    })
});

client.on(Discord.ShardEvents.Error, error => {
    console.log(error)
    if (error) if (error.length > 950) error = error.slice(0, 950) + '... Afficher la console pour plus de détails';
    if (error.stack) if (error.stack.length > 950) error.stack = error.stack.slice(0, 950) + '... Afficher la console pour plus de détails';
    if (!error.stack) return
    const embed = new Discord.EmbedBuilder()
        .setTitle(`🚨・Une connexion WebSocket a rencontré une erreur`)
        .addFields([
            {
                name: `Erreur`,
                value: `\`\`\`${error}\`\`\``,
            },
            {
                name: `Erreur Stack`,
                value: `\`\`\`${error.stack}\`\`\``,
            }
        ])
        .setColor(client.config.colors.normal)
    consoleLogs.send({
        username: 'Logs',
        embeds: [embed],
    });
});

// Healthcheck : créer un fichier pour indiquer que le bot est actif
// Ce fichier sera vérifié par le Docker healthcheck
const healthcheckFile = path.join(os.tmpdir(), 'bot-alive');
function updateHealthcheck() {
    try {
        fs.mkdirSync(path.dirname(healthcheckFile), { recursive: true });
        fs.writeFileSync(healthcheckFile, new Date().toISOString(), 'utf8');
    } catch (err) {
        console.error('Erreur lors de la mise à jour du healthcheck:', err);
    }
}

// Mettre à jour le healthcheck toutes les 30 secondes
setInterval(updateHealthcheck, 30000);

// Créer le fichier initial au démarrage
updateHealthcheck();
