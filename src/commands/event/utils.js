const Discord = require('discord.js');
const { model: AnnouncementChannels, getActivityEmoji } = require('../../database/models/announcement-channels');
const { generateCalendarLinks, generateCalendarFile } = require('../../assets/utils/calendar');
const { createManager } = require('../../handlers/functions/eventReminders');

const reminderManager = createManager();

async function getEventContext(client, interaction) {
    if (!interaction.channel?.isThread()) return null;

    const data = await AnnouncementChannels.findOne({
        Guild: interaction.guildId,
        'EventThreads.threadId': interaction.channel.id
    });
    const eventThread = data?.EventThreads?.find(item => item.threadId === interaction.channel.id);
    if (!eventThread) return null;

    const event = await interaction.guild.scheduledEvents.fetch(eventThread.eventId).catch(() => null);
    if (!event) return null;

    return { data, eventThread, event, thread: interaction.channel };
}

async function getEventCreator(client, event) {
    if (event.creator) return event.creator;
    if (!event.creatorId) return null;
    return client.users.fetch(event.creatorId).catch(() => null);
}

function getCalendarLinks(event) {
    const start = event.scheduledStartTimestamp;
    const end = event.scheduledEndTimestamp || (start + 60 * 60 * 1000);
    return generateCalendarLinks({
        title: event.name,
        description: event.description,
        location: event.entityMetadata?.location || '',
        startDate: new Date(start).toISOString(),
        endDate: new Date(end).toISOString()
    });
}

async function uploadCalendarFile(client, event) {
    if (!process.env.UPLOAD_CHANNEL_ID) throw new Error('UPLOAD_CHANNEL_ID is not configured');

    const archiveChannel = await client.channels.fetch(process.env.UPLOAD_CHANNEL_ID);
    if (!archiveChannel?.isTextBased()) throw new Error('UPLOAD_CHANNEL_ID is not a text channel');

    const start = event.scheduledStartTimestamp;
    const end = event.scheduledEndTimestamp || (start + 60 * 60 * 1000);
    const calendarFile = generateCalendarFile({
        eventId: event.id,
        title: event.name,
        description: event.description,
        location: event.entityMetadata?.location || '',
        startDate: new Date(start).toISOString(),
        endDate: new Date(end).toISOString()
    });
    const message = await archiveChannel.send({
        content: `Calendar file for event ${event.id}`,
        files: [{ attachment: calendarFile.content, name: calendarFile.fileName }]
    });
    const attachment = message.attachments.first();
    if (!attachment?.url) throw new Error('Calendar attachment URL was not returned');

    return { messageId: message.id, fileName: calendarFile.fileName, url: attachment.url };
}

function buildCalendarRow(event, calendarFile) {
    const links = getCalendarLinks(event);
    const row = new Discord.ActionRowBuilder().addComponents(
        new Discord.ButtonBuilder()
            .setLabel('Ajouter à Google Agenda')
            .setStyle(Discord.ButtonStyle.Link)
            .setURL(links.google),
        new Discord.ButtonBuilder()
            .setLabel('Ajouter à Outlook')
            .setStyle(Discord.ButtonStyle.Link)
            .setURL(links.outlook)
    );

    if (calendarFile?.url) {
        row.addComponents(
            new Discord.ButtonBuilder()
                .setLabel("Télécharger l'ical")
                .setStyle(Discord.ButtonStyle.Link)
                .setURL(calendarFile.url)
        );
    }
    return row;
}

async function syncEventMessage(client, context) {
    const { event, eventThread, thread } = context;
    const startTimeChanged = eventThread.scheduledStartTimestamp !== event.scheduledStartTimestamp;
    const message = await thread.messages.fetch(eventThread.followupMessageId);
    const creator = await getEventCreator(client, event);
    const embed = new Discord.EmbedBuilder()
        .setTitle('`📌`  Informations importantes')
        .setDescription(event.description || 'Pas de description fournie pour le moment')
        .setColor(0x0099FF)
        .setTimestamp(new Date(event.scheduledStartTimestamp))
        .setFooter({
            text: creator?.globalName || creator?.username || 'Créateur inconnu',
            iconURL: creator?.avatarURL?.() || undefined
        });

    const calendarFile = await uploadCalendarFile(client, event);
    if (eventThread.calendarMessageId) {
        const oldMessage = await client.channels.fetch(process.env.UPLOAD_CHANNEL_ID)
            .then(channel => channel.messages.fetch(eventThread.calendarMessageId))
            .catch(() => null);
        await oldMessage?.delete().catch(() => null);
    }

    await message.edit({
        content: '',
        embeds: [embed],
        components: [buildCalendarRow(event, calendarFile)]
    });
    await message.pin().catch(() => null);

    const emoji = eventThread.emojiOverride || getActivityEmoji(`${event.name} ${event.description || ''}`);
    await thread.setName(`${emoji}・${event.name}`).catch(() => null);

    const updates = {
        'EventThreads.$.eventName': event.name,
        'EventThreads.$.calendarMessageId': calendarFile.messageId,
        'EventThreads.$.calendarFileName': calendarFile.fileName,
        'EventThreads.$.calendarAttachmentUrl': calendarFile.url,
        'EventThreads.$.scheduledStartTimestamp': event.scheduledStartTimestamp
    };

    if (startTimeChanged) {
        updates['EventThreads.$.sentReminders'] = reminderManager.initializeReminderState(event.scheduledStartTimestamp);
    }

    await AnnouncementChannels.updateOne(
        { Guild: event.guildId, 'EventThreads.threadId': thread.id },
        { $set: updates }
    );

    return { calendarFile };
}

module.exports = {
    getEventContext,
    getEventCreator,
    getCalendarLinks,
    buildCalendarRow,
    syncEventMessage,
    uploadCalendarFile
};
