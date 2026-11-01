const { CommandInteraction, Client } = require('discord.js');
const { ContextMenuCommandBuilder } = require('discord.js');
const { PermissionsBitField } = require('discord.js');
const Discord = require('discord.js');
const fs = require('fs');
const https = require('https');

module.exports = {
  localizationKey: 'commandMetadata.spoiler',
  data: new ContextMenuCommandBuilder()
    .setName('Mettre en spoiler')
    .setType(3),

  /** 
   * @param {Client} client
   * @param {CommandInteraction} interaction
   * @param {String[]} args
   */
  run: async (client, interaction, args) => {
    const message = args[0].message;
    const user = interaction.member.user;
    const member = interaction.member;
    if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      return interaction.reply({ content: await client.t(interaction, 'spoiler.noPermission'), ephemeral: true });
    }
    await interaction.reply({
      "content": ' ',
      "embeds": [
        {
          "type": "rich",
          "title": "",
          "description": await client.t(interaction, 'spoiler.prompt'),
          "color": 0x00FFFF
        }
      ]/*,
      "components": [
            {
              "style": 4,
              "label": `Cancel`,
              "custom_id": `Cancel`,
              "disabled": false,
              "type": 1
            }
          ]*/
    });

    const filter = m => m.author.id === user.id;
    const collector = message.channel.createMessageCollector({ filter, max: 1, time: 60000 });

    collector.on('collect', async m => {
      if (m.content.trim().toLowerCase() === 'annuler') {
        interaction.editReply({ content: await client.t(interaction, 'spoiler.cancelled'), ephemeral: true });
        m.delete();
        return;
      }


      const context = m.content.trim();
      var files = undefined;
    if(message.attachments.size > 0) {
    var imageUrl = "";
      const firstAttachment = message.attachments.first();
      if (firstAttachment) {
        const attachmentUrl = firstAttachment.url;
        const originalFilename = firstAttachment.name;
        const renamedFilename = "SPOILER_" + originalFilename;
        const tempFilePath = `./${originalFilename}`;
        const newFilePath = `./${renamedFilename}`;
    
        try {
          // Download the file locally
          await downloadFile(attachmentUrl, tempFilePath);
  
          // Rename the file
          fs.renameSync(tempFilePath, newFilePath);
          const channel = await client.channels.fetch(process.env.UPLOAD_CHANNEL_ID).catch(() => null);
          if (!channel?.isTextBased()) {
            throw new Error('UPLOAD_CHANNEL_ID is not configured or is not a text channel');
          }
          
          // Upload the renamed file to Discord
        const uploadedMessage = await channel.send({
          files: [newFilePath],
          content: await client.t(interaction, 'spoiler.uploaded')
        });
        console.log('File uploaded. Generated URL:', imageUrl);
        files = [{
          attachment: uploadedMessage.attachments.first().url,
          name: renamedFilename
       }];
      } catch (error) {
        console.error('Error uploading file:', error);
      } finally {
        // Delete the temporary files
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
        if (fs.existsSync(newFilePath)) {
          fs.unlinkSync(newFilePath);
        }
      }
    } else {
      console.log('No attachments found.');
    }
  }
  const timestamp = message.createdTimestamp;
  const date = new Date(timestamp);
  const isoTimestamp = date.toISOString();
  if (message.content == null || message.content == "") {
    var fields = [
      {
        "name": ``,
        "value": await client.t(interaction, 'spoiler.imagePost', { author: message.author, context })
      },
      {
        "name": ``,
        "value": ` `
      }
    ]
  } else {
    var fields = [
      {
        "name": ``,
        "value": await client.t(interaction, 'spoiler.textPost', { author: message.author, context })
      },
      {
        "name": ``,
        "value": `> ||${message.content}||`
      }
    ]
  }
    // https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.webp
      embed = {
        "channel_id": message.channel_id,
        "content": ``,
        "tts": false,
        "files": files,
        "allowedMentions": { repliedUser: false },
        "embeds": [
          {
            "type": "rich",
            "title": ``,
            "description": ``,
            "color": 0x153866,
            "author": {
              "name": await client.t(interaction, 'spoiler.author'),
              "icon_url": `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.webp`
            },
            "fields": fields,
          "timestamp": isoTimestamp
          }
        ]
      };
    interaction.editReply(embed);
    m.delete();
    message.delete({ timeout: 5000 })
  });

  collector.on('end', async collected => {
    if (collected.size === 0) {
      interaction.followUp({ content: await client.t(interaction, 'spoiler.missingContext'), ephemeral: true });
    }
  });
},
};

function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    const request = https.get(url, function(response) {
      response.pipe(file);
      file.on('finish', function() {
        file.close(resolve);
      });
    }).on('error', function(err) {
      fs.unlink(filePath, () => reject(err));
    });
  });
}
