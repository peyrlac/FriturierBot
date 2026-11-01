const Discord = require('discord.js');
const Captcha = require("@haileybot/captcha-generator");

const reactionSchema = require("../../database/models/reactionRoles");
const banSchema = require("../../database/models/userBans");
const verify = require("../../database/models/verify");
const Commands = require("../../database/models/customCommand");
const CommandsSchema = require("../../database/models/customCommandAdvanced");
const { model: AnnouncementChannels } = require("../../database/models/announcement-channels");
const { ReminderManager, createManager } = require("../../handlers/functions/eventReminders");
const reminderManager = createManager();

module.exports = async (client, interaction) => {
    if (interaction.isChatInputCommand() && interaction.commandName === 'config' && interaction.options.getSubcommand() === 'status') {
        try {
            await interaction.deferReply();
        } catch (error) {
            if (error.code === 10062) return;
            throw error;
        }

        const statusWatchdog = setTimeout(() => {
            if (interaction.deferred && !interaction.replied) {
                interaction.editReply({
                    content: '⚠️ La mise à jour de la présence prend trop de temps. Vérifie la connexion MongoDB et réessaie.',
                }).catch(() => null);
            }
        }, 10000);

        try {
            return await require(`${process.cwd()}/src/commands/config/status.js`)(client, interaction);
        } finally {
            clearTimeout(statusWatchdog);
        }
    }

    /*
    if (
        interaction.isAutocomplete() &&
        interaction.commandName === 'voice' &&
        interaction.options.getSubcommand() === 'move'
    ) {
        const focused = interaction.options.getFocused(true);
    
        if (focused.name !== 'vers') return;
    
        const explicitStartChannel = interaction.options.getChannel('de');
        const fallbackStartChannel = interaction.member.voice.channel;
        const startChannel = explicitStartChannel ?? fallbackStartChannel;
    
        if (!startChannel || startChannel.type !== Discord.ChannelType.GuildVoice) {
            return interaction.respond([{ name: 'Aucun salon de référence', value: 'none' }]);
        }
    
        const allVoiceChannels = interaction.guild.channels.cache
            .filter(c => c.type === Discord.ChannelType.GuildVoice);
    
        const filtered = allVoiceChannels
            .filter(c =>
                // on exclut uniquement si l'utilisateur a explicitement fourni start_channel
                (!explicitStartChannel || c.id !== startChannel.id) &&
                c.name.toLowerCase().includes(focused.value.toLowerCase())
            )
            .map(c => ({
                name: c.name,
                value: c.id
            }))
            .slice(0, 25);
    
        return interaction.respond(filtered);
    }*/

    // Commands
    if (interaction.isCommand() || interaction.isUserContextMenuCommand()) {
        const data = await banSchema.findOne({ User: interaction.user.id });
        if (data) {
            return client.errNormal({
                key: 'router.banned',
                type: 'ephemeral'
            }, interaction);
        }

    const cmd = client.commands.get(interaction.commandName);
    const featureKey = cmd?.featureKey
      || (typeof cmd?.localizationKey === 'string' && cmd.localizationKey.startsWith('commandMetadata.')
        ? cmd.localizationKey.slice('commandMetadata.'.length)
        : cmd?.data?.name);
    if (cmd && typeof client.requireFeature === 'function' && !(await client.requireFeature(interaction, featureKey))) {
      return;
    }
                if (!cmd){
                    const cmdd = await Commands.findOne({
                        Guild: interaction.guild.id,
                        Name: interaction.commandName,
                    });
                    if (cmdd) {
                        return interaction.reply({ content: cmdd.Responce });
                    }

                    const cmdx = await CommandsSchema.findOne({
                        Guild: interaction.guild.id,
                        Name: interaction.commandName,
                    });
                    if (cmdx) {
                        // Remove interaction
                        if (cmdx.Action == "Normal") {
                            return interaction.reply({ content: cmdx.Responce });
                        } else if (cmdx.Action == "Embed") {
                            return client.simpleEmbed(
                                {
                                    desc: `${cmdx.Responce}`,
                                    type: 'reply'
                                },
                                interaction,
                            );
                        } else if (cmdx.Action == "DM") {
                            await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });
                            interaction.editReply({ content: await client.t(interaction, 'router.dmSent') });
                            return interaction.user.send({ content: cmdx.Responce }).catch((e) => {
                                client.errNormal(
                                    {
                                        key: 'router.cannotDM',
                                        type: 'ephemeral'
                                    },
                                    interaction,
                                );
                            });
                        }
                    }
                }
                if (interaction.options._subcommand !== null && interaction.options.getSubcommand() == "help") {
                    const commands = interaction.client.commands.filter(x => x.data.name == interaction.commandName).map((x) => x.data.options.map((c) => '`' + c.name + '` - ' + c.description).join("\n"));

                    return client.embed({
                        title: await client.t(interaction, 'router.helpTitle'),
                        desc: await client.t(interaction, 'router.helpDescription', { command: interaction.commandName, commands }),
                        type: 'reply'
                    }, interaction)
                }

                if (cmd) return cmd.run(client, interaction, interaction.options._hoistedOptions).catch(err => {
                    client.emit("errorCreate", err, interaction.commandName, interaction)
                });
    }

    // Verify system
    if (interaction.isButton() && interaction.customId == "Bot_verify") {
        const data = await verify.findOne({ Guild: interaction.guild.id, Channel: interaction.channel.id });
        if (data) {
            let captcha = new Captcha();

            try {
                var image = new Discord.AttachmentBuilder(captcha.JPEGStream, {name:"captcha.jpeg"});

                interaction.reply({ files: [image], withResponse: true }).then(function (msg) {
                    const filter = s => s.author.id == interaction.user.id;

                    interaction.channel.awaitMessages({ filter, max: 1 }).then(response => {
                        if (response.first().content === captcha.value) {
                            response.first().delete();
                            msg.delete();

                            client.succNormal({
                                key: 'router.verificationSuccess'
                            }, interaction.user).catch(error => {
                                console.error('Failed to send verification confirmation', error);
                            })

                            var verifyUser = interaction.guild.members.cache.get(interaction.user.id);
                            verifyUser.roles.add(data.Role);
                        }
                        else {
                            response.first().delete();
                            msg.delete();

                            client.errNormal({
                                key: 'router.captchaIncorrect',
                                type: 'editreply'
                            }, interaction).then(msgError => {
                                setTimeout(() => {
                                    msgError.delete();
                                }, 2000)
                            })
                        }
                    })
                })
            }
            catch (error) {
                console.log(error)
            }
        }
        else {
            client.errNormal({
                key: 'router.verificationUnavailable',
                type: 'ephemeral'
            }, interaction);
        }
    }

    // Reaction roles button
    if (interaction.isButton()) {
        var buttonID = interaction.customId.split("-");

        if (buttonID[0] == "reaction_button") {
            const data = await reactionSchema.findOne({ Message: interaction.message.id });
            if (!data) return;

            const [roleid] = data.Roles[buttonID[1]];
            const member = interaction.guild.members.cache.get(interaction.user.id);
            const hasRole = interaction.member.roles.cache.get(roleid);

            if (hasRole) {
                await member.roles.remove(roleid);
            }
            else {
                await member.roles.add(roleid);
            }

            return interaction.reply({
                content: await client.t(
                    interaction,
                    hasRole ? 'reactionroles.roleRemoved' : 'reactionroles.roleAdded',
                    { role: `<@&${roleid}>` }
                ),
                flags: Discord.MessageFlags.Ephemeral
            });
        }
    }

    // Reaction roles select
    if (interaction.isStringSelectMenu()) {
        if (interaction.customId == "reaction_select") {
            const data = await reactionSchema.findOne({ Message: interaction.message.id });
            if (!data) return;

            const member = interaction.guild.members.cache.get(interaction.user.id);
            const roles = [];

            for (const value of interaction.values) {
                const [roleid] = data.Roles[value];
                roles.push(`<@&${roleid}>`);

                if (interaction.member.roles.cache.get(roleid)) {
                    await member.roles.remove(roleid);
                }
                else {
                    await member.roles.add(roleid);
                }
            }

            return interaction.reply({
                content: await client.t(interaction, 'reactionroles.rolesUpdated', {
                    roles: roles.join(' ')
                }),
                flags: Discord.MessageFlags.Ephemeral
            });
        }
    }
    // Tickets
    if (interaction.customId == "Bot_openticket") {
        return require(`${process.cwd()}/src/commands/tickets/create.js`)(client, interaction);
    }

    if (interaction.customId == "Bot_closeticket") {
        return require(`${process.cwd()}/src/commands/tickets/close.js`)(client, interaction);
    }

    if (interaction.customId == "Bot_claimTicket") {
        return require(`${process.cwd()}/src/commands/tickets/claim.js`)(client, interaction);
    }

    if (interaction.customId == "Bot_transcriptTicket") {
        return require(`${process.cwd()}/src/commands/tickets/transcript.js`)(client, interaction);
    }

    if (interaction.customId == "Bot_openTicket") {
        return require(`${process.cwd()}/src/commands/tickets/open.js`)(client, interaction);
    }

    if (interaction.customId == "Bot_deleteTicket") {
        return require(`${process.cwd()}/src/commands/tickets/delete.js`)(client, interaction);
    }

    if (interaction.customId == "Bot_noticeTicket") {
        return require(`${process.cwd()}/src/commands/tickets/notice.js`)(client, interaction);
    }

    // Event reminders configuration
    if (interaction.customId === "event_reminders_enable" || interaction.customId === "event_reminders_disable") {
        const thread = interaction.channel;
        if (!thread.isThread()) return;

        try {
            const data = await AnnouncementChannels.findOne({
                Guild: interaction.guildId,
                'EventThreads.threadId': thread.id
            });

            const eventThread = data?.EventThreads?.find(et => et.threadId === thread.id);
            if (!eventThread) return;

            // Vérifier que l'utilisateur est le créateur de l'événement
            const event = await interaction.guild.scheduledEvents.fetch(eventThread.eventId).catch(() => null);
            if (!event || event.creatorId !== interaction.user.id) {
                return interaction.reply({
                    content: await client.t(interaction, 'events.reminderUpdateCreatorOnly'),
                    flags: Discord.MessageFlags.Ephemeral
                });
            }

            const enableReminders = interaction.customId === "event_reminders_enable";
            
            let updatedReminders;
            if (enableReminders) {
                // Réinitialiser les rappels en fonction de la date actuelle
                const reminderManager = new ReminderManager();
                updatedReminders = reminderManager.initializeReminderState(event.scheduledStartTimestamp);
            } else {
                // Désactiver tous les rappels
                updatedReminders = {
                    month: true,
                    week: true,
                    day: true
                };
            }

            // Mettre à jour la base de données
            await AnnouncementChannels.updateOne(
                { 
                    Guild: interaction.guildId,
                    'EventThreads.threadId': thread.id
                },
                { 
                    $set: { 
                        'EventThreads.$.sentReminders': updatedReminders
                    }
                }
            );

            // Créer le nouveau bouton
            const newRow = new Discord.ActionRowBuilder()
                .addComponents(
                    new Discord.ButtonBuilder()
                        .setCustomId(enableReminders ? 'event_reminders_disable' : 'event_reminders_enable')
                        .setLabel(enableReminders ?
                            await client.t(interaction, 'events.reminders.disable') :
                            await client.t(interaction, 'events.reminders.enable'))
                        .setStyle(enableReminders ? Discord.ButtonStyle.Secondary : Discord.ButtonStyle.Success)
                        .setEmoji(enableReminders ? '🔕' : '🔔'),
                    new Discord.ButtonBuilder()
                        .setCustomId('event_delete')
                        .setLabel(await client.t(interaction, 'events.reminders.deleteEvent'))
                        .setStyle(Discord.ButtonStyle.Danger)
                        .setEmoji('🗑️')
                );

            // Mettre à jour le message
            const message = interaction.message;
            const embed = message.embeds[0];
            const newEmbed = new Discord.EmbedBuilder(embed.data)
                .setFields(
                    { 
                        name: await client.t(interaction, 'events.reminders.inviteTitle'),
                        value: await client.t(interaction, 'events.reminders.invite')
                    },
                    { 
                        name: await client.t(interaction, 'events.reminders.automaticTitle'),
                        value: enableReminders ? 
                            await client.t(interaction, 'events.reminders.enabledDescription') :
                            await client.t(interaction, 'events.reminders.disabledDescription')
                    }
                );

            await interaction.update({ 
                embeds: [newEmbed], 
                components: [newRow]
            });

            // Envoyer une confirmation éphémère
            await interaction.followUp({
                content: enableReminders ? 
                    await client.t(interaction, 'events.reminders.reenabled') :
                    await client.t(interaction, 'events.reminders.disabled'),
                flags: Discord.MessageFlags.Ephemeral
            });

        } catch (error) {
            console.error('Erreur lors de la configuration des rappels:', error);
            await interaction.reply({
                content: await client.t(interaction, 'events.reminders.updateError'),
                flags: Discord.MessageFlags.Ephemeral
            });
        }
    }

    if (interaction.customId === "event_reminders_configure") {
        const thread = interaction.channel;
        if (!thread.isThread()) return;

        try {
            const data = await AnnouncementChannels.findOne({
                Guild: interaction.guildId,
                'EventThreads.threadId': thread.id
            });

            const eventThread = data?.EventThreads?.find(et => et.threadId === thread.id);
            if (!eventThread) return;

            // Vérifier que l'utilisateur est le créateur de l'événement
            const event = await interaction.guild.scheduledEvents.fetch(eventThread.eventId).catch(() => null);
            if (!event || event.creatorId !== interaction.user.id) {
                return interaction.reply({
                    content: await client.t(interaction, 'events.reminderCreatorOnly'),
                    flags: Discord.MessageFlags.Ephemeral
                });
            }

            // Initialiser les rappels en fonction de la date de l'événement
            const initialReminders = reminderManager.initializeReminderState(event.scheduledStartTimestamp);

            // Save the thread ID and event ID to the database
            await AnnouncementChannels.updateOne(
                { Guild: event.guildId },
                { 
                    $push: { 
                        EventThreads: { 
                            eventName: event.name, 
                            eventId: event.id, 
                            threadId: thread.id,
                            followupMessageId: eventThread.followupMessageId,
                            scheduledStartTimestamp: event.scheduledStartTimestamp,
                            sentReminders: initialReminders
                        } 
                    } 
                }
            );

            // Calculer si les rappels sont disponibles
            const now = Date.now();
            const timeUntilEvent = event.scheduledStartTimestamp - now;
            const hasAvailableReminders = timeUntilEvent > (24 * 60 * 60 * 1000); // Plus d'un jour

            // Send a reminder message in the thread
            let components = [];
            if (hasAvailableReminders) {
                const row = new Discord.ActionRowBuilder()
                    .addComponents(
                        new Discord.ButtonBuilder()
                            .setCustomId('event_reminders_enable')
                            .setLabel(await client.t(interaction, 'events.reminders.enable'))
                            .setStyle(Discord.ButtonStyle.Success)
                            .setEmoji('🔔'),
                        new Discord.ButtonBuilder()
                            .setCustomId('event_reminders_disable')
                            .setLabel(await client.t(interaction, 'events.reminders.disable'))
                            .setStyle(Discord.ButtonStyle.Secondary)
                            .setEmoji('🔕')
                    );
                components.push(row);
            }

            const welcomeEmbed = new Discord.EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(await client.t(interaction, 'events.reminders.title'))
                .setDescription(await client.t(interaction, 'events.reminders.welcome', { event: event.name }))
                .addFields(
                    { 
                        name: await client.t(interaction, 'events.reminders.inviteTitle'),
                        value: await client.t(interaction, 'events.reminders.invite')
                    },
                    { 
                        name: await client.t(interaction, 'events.reminders.automaticTitle'),
                        value: hasAvailableReminders ? 
                            await client.t(interaction, 'events.reminders.available') :
                            await client.t(interaction, 'events.reminders.unavailable')
                    }
                )
                .setFooter(hasAvailableReminders ? 
                    { text: await client.t(interaction, 'events.reminders.availableFooter') } :
                    { text: await client.t(interaction, 'events.reminders.unavailableFooter') }
                );

            const welcomeMessage = await thread.send({
                content: await client.t(interaction, 'events.reminders.deletedMessage', { timestamp: Math.floor((Date.now() + 60000) / 1000) }),
                embeds: [welcomeEmbed],
                components: components
            });

            // Supprimer complètement le message après 60 secondes
            setTimeout(() => {
                welcomeMessage.delete().catch(() => {
                    console.log(`Failed to delete welcome message in thread ${thread.id}`);
                });
            }, 60000);

            // Envoyer une confirmation éphémère
            await interaction.followUp({
                content: await client.t(interaction, 'events.reminders.configured'),
                flags: Discord.MessageFlags.Ephemeral
            });

        } catch (error) {
            console.error('Erreur lors de la configuration des rappels:', error);
            await interaction.reply({
                content: await client.t(interaction, 'events.reminders.setupError'),
                flags: Discord.MessageFlags.Ephemeral
            });
        }
    }

    // Event deletion
    if (interaction.customId === "event_delete") {
        const thread = interaction.channel;
        if (!thread.isThread()) return;

        try {
            // Différer la réponse immédiatement
            await interaction.deferReply({ flags: Discord.MessageFlags.Ephemeral });

            // Récupérer les données de l'événement
            const data = await AnnouncementChannels.findOne({
                Guild: interaction.guildId,
                'EventThreads.threadId': thread.id
            });

            const eventThread = data?.EventThreads?.find(et => et.threadId === thread.id);
            if (!eventThread) {
                return interaction.editReply({
                    content: await client.t(interaction, 'events.reminders.infoNotFound'),
                });
            }

            // Vérifier que l'utilisateur est le créateur de l'événement
            const event = await interaction.guild.scheduledEvents.fetch(eventThread.eventId).catch(() => null);
            if (!event) {
                return interaction.editReply({
                    content: await client.t(interaction, 'events.reminders.eventNotFound'),
                });
            }

            if (event.creatorId !== interaction.user.id) {
                return interaction.editReply({
                    content: await client.t(interaction, 'events.reminders.deleteCreatorOnly'),
                });
            }

            // Supprimer l'événement programmé
            await event.delete().catch(console.error);

            // Supprimer le message d'annonce
            const channel = await client.channels.fetch(data.Channel).catch(() => null);
            if (channel) {
                const messages = await channel.messages.fetch({ limit: 100 });
                const announcementMessage = messages.find(m => 
                    m.author.id === client.user.id && 
                    m.content.includes(event.name)
                );
                if (announcementMessage) {
                    await announcementMessage.delete().catch(console.error);
                }
            }

            // Archiver le thread
            await thread.setArchived(true).catch(console.error);

            // Supprimer la référence dans la base de données
            await AnnouncementChannels.updateOne(
                { Guild: interaction.guildId },
                { $pull: { EventThreads: { threadId: thread.id } } }
            );

            // Envoyer une confirmation
            await interaction.editReply({
                content: await client.t(interaction, 'events.reminders.deleted'),
            });

        } catch (error) {
            console.error('Erreur lors de la suppression de l\'événement:', error);
            // Si l'interaction est toujours valide, essayer d'envoyer un message d'erreur
            try {
                await interaction.editReply({
                    content: await client.t(interaction, 'events.reminders.deleteError'),
                });
            } catch (replyError) {
                console.error('Erreur lors de la réponse à l\'interaction:', replyError);
            }
        }
    }
}

 
