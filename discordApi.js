import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const checkButton = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('check_now')
    .setLabel('立即檢查')
    .setStyle(ButtonStyle.Primary)
);

export function sendDiscordNotification(content) {
  return client.channels.fetch(process.env.DISCORD_CHANNEL_ID)
    .then(channel => channel.send({ content, components: [checkButton] }));
}

export function initDiscordBot(onCheck, onReady) {
  client.once('ready', async () => {
    console.log(`Discord Bot 已上線：${client.user.tag}`);

    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(client.application.id, process.env.DISCORD_GUILD_ID),
      {
        body: [
          new SlashCommandBuilder()
            .setName('check')
            .setDescription('立即檢查自動外撥進度')
            .toJSON(),
        ],
      }
    );
    console.log('Slash command /check 已註冊');

    if (onReady) await onReady();
  });

  client.on('interactionCreate', async (interaction) => {
    const isCheckCommand = interaction.isChatInputCommand() && interaction.commandName === 'check';
    const isCheckButton = interaction.isButton() && interaction.customId === 'check_now';

    if (!isCheckCommand && !isCheckButton) return;

    try {
      await interaction.deferReply();
      const content = await onCheck();
      await interaction.editReply({ content, components: [checkButton] });
    } catch (err) {
      console.error('Discord 互動處理錯誤：', err.message);
    }
  });

  client.login(process.env.DISCORD_BOT_TOKEN);
}

export async function shutdownDiscordBot(reason) {
  try {
    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    await channel.send(`Bot 已離線 (${reason})`);
  } catch (e) {
    console.error('Discord 離線通知發送失敗', e);
  } finally {
    await client.destroy();
  }
}
