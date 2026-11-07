const discord = require('discord.js');

const ticketChannels = require("../../database/models/ticketChannels");
const voiceChannelStatusConfig = require('../../database/models/voiceChannelStatusConfig');
const voiceChannelStatusState = require('../../database/models/voiceChannelStatusState');

module.exports = async (client, channel) => {
    await Promise.all([
        voiceChannelStatusConfig.deleteMany({
            guildId: channel.guild.id,
            $or: [
                // A category may only remove its own category-scoped setup.
                // In particular, do not match a guild setup that merely kept
                // the channel's parent category as metadata.
                { scope: 'category', $or: [{ targetId: channel.id }, { categoryId: channel.id }] },
                { scope: 'channel', $or: [{ targetId: channel.id }, { channelId: channel.id }] },
            ],
        }),
        voiceChannelStatusState.deleteOne({ guildId: channel.guild.id, channelId: channel.id }),
    ]).catch(() => null);

    let types = {
        0: "Text Channel",
        2: "Voice Channel",
        4: "Category",
        5: "News Channel",
        10: "News Thread",
        11: "Public Thread",
        12: "Private Thread",
        13: "Stage Channel",
        14: "Category",
    }
    
    const logsChannel = await client.getLogs(channel.guild.id);
    if (!logsChannel) return;

    await client.embed({
        title: `🔧・Channel deleted`,
        desc: `A channel has been deleted`,
        fields: [
            {
                name: `> Name`,
                value: `- ${channel.name}`
            },
            {
                name: `> ID`,
                value: `- ${channel.id}`
            },
            {
                name: `> Category`,
                value: `- ${channel.parent}`
            },
            {
                name: `> Type`,
                value: `- ${types[channel.type]}`
            }
        ]
    }, logsChannel).catch(console.error)

    try {
        const data = await ticketChannels.findOne({ Guild: channel.guild.id, channelID: channel.id });
        if (data) {
            await ticketChannels.deleteOne({ Guild: channel.guild.id, channelID: channel.id });
        }
    }
    catch (error) {
        console.error(error);
    }
};
