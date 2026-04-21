import axios from 'axios';
import dotenv from 'dotenv';
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
import schedule from 'node-schedule';
import { stopAutoDial, startAutoDial } from './outboundCampaignApi.js';

dotenv.config();

// ========== Bonsale API 設定 ==========
const host = process.env.BONSALE_HOST;
const xApiKey = process.env.BONSALE_X_API_KEY;
const xApiSecret = process.env.BONSALE_X_API_SECRET;

const axiosBonsaleInstance = axios.create({
  baseURL: host,
  headers: {
    'X-API-KEY': xApiKey,
    'X-API-SECRET': xApiSecret,
  },
});

// 要監控的 Bonsale 專案 ID（支援多個，逗號分隔）
const PROJECT_ID = process.env.BONSALE_PROJECT_ID.split(',').map(id => id.trim());
const TIMEZONE = process.env.TIMEZONE || 'Asia/Taipei';

// 排程時段清單，解析一次供全域使用
const SCHEDULE_TIMES = process.env.SCHEDULE?.split(',').map(s => s.trim()).filter(Boolean) ?? [];

// ========== Discord Bot 設定 ==========
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// 所有訊息共用的「立即檢查」按鈕
const checkButton = new ActionRowBuilder().addComponents(
  new ButtonBuilder()
    .setCustomId('check_now')
    .setLabel('立即檢查')
    .setStyle(ButtonStyle.Primary)
);

// ========== Bonsale API 資料取得 ==========

// 從 Bonsale API 取得自動外撥清單，並過濾出指定專案的資料
async function getDebtCollectionFlow(PROJECT_ID) {
  const response = await axiosBonsaleInstance.get("/project/auto-dial?limit=-1&sort=created_at+desc");
  const list = response.data.list;
  const debtCollectionFlow = list.filter((item) => PROJECT_ID.includes(item.projectId));

  return debtCollectionFlow;
}

// ========== 訊息格式化 ==========

// 將外撥清單資料排版成 Discord 訊息文字
function formatProgress(list) {
  const lines = ['========== 今天的自動外撥進度 =========='];

  list.forEach((item) => {
    const name = item.projectInfo?.projectName ?? item.projectId;
    const lastRun = item.lastExecutedAt
      ? new Date(item.lastExecutedAt).toLocaleString('zh-TW', { timeZone: TIMEZONE })
      : '尚未執行';
    const restrictions = item.callRestriction?.map(r => `${r.startTime}~${r.stopTime}`).join(', ') || '無';

    lines.push('');
    lines.push(`【${name}】`);
    lines.push(`  待撥數量  : ${item.unDialedCount}`);
    lines.push(`  最後執行  : ${lastRun}`);
    lines.push(`  限制時段  : ${restrictions}`);
  });

  // 加總所有專案的待撥數量
  const totalUnDialed = list.reduce((sum, item) => sum + item.unDialedCount, 0);
  lines.push(`\n總撥號名單數量 : ${totalUnDialed}`);

  lines.push(`\n固定排程時間 : ${SCHEDULE_TIMES.join(' / ')}`);
  lines.push('\n==================================');

  return {
    totalUnDialed,
    message: '```\n' + lines.join('\n') + '\n```'
  };
}

// ========== 進度檢查核心 ==========

// 取得資料並組合完整訊息內容
// mode 'regular'：一般檢查（非最後時段），依待撥數量給出不同程度的提示
// mode 'final'：最後時段的檢查，只區分「打完」或「未打完」
async function fetchProgress(mode = 'regular') {
  const debtCollectionFlow = await getDebtCollectionFlow(PROJECT_ID);
  const { totalUnDialed, message } = formatProgress(debtCollectionFlow);

  const extraMessage = (totalUnDialed) => {
    if (mode === 'final') {
      if (totalUnDialed === 0) {
        return '最後檢查完畢，名單數量已經全部撥打完畢了，太棒了，準備要好好睡一覺了 ☺️ ☺️ ☺️';
      } else {
        return '最後檢查完畢，名單數量仍然沒打完，準備要停止撥號 以免暫存名單存留導致出問題 😱 😱 😱';
      }
    }

    if (mode === 'regular') {
      if (totalUnDialed > 0 && totalUnDialed <= 3000) {
        return '檢查名單數量還算正常，今天應該可以好好睡覺了 ☺️ ☺️ ☺️';
      } else if (totalUnDialed > 3000 && totalUnDialed <= 4000) {
        return '檢查名單數量有點多，晚上睡前檢查並需注意撥打完沒 😳 😳 😳';
      } else if (totalUnDialed > 4000) {
        return '檢查名單數量太多了，晚上睡前要做好心理準備了 😱 😱 😱';
      } else {
        return '未知的名單數量，請確認 API 回傳資料是否正確 ❌ ❌ ❌';
      }
    }
  };

  return {
    debtCollectionFlow,
    totalUnDialed,
    content: message + '\n\n' + extraMessage(totalUnDialed),
  };
}

// 取得進度後發送到 Discord 頻道（排程觸發時使用）
async function sendScheduledCheck(mode) {
  const { debtCollectionFlow, totalUnDialed, content } = await fetchProgress(mode);
  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  await channel.send({ content, components: [checkButton] });
  console.log('訊息已發送');
  return { debtCollectionFlow, totalUnDialed };
}

// ========== 最後時段後續處理 ==========

// 最後時段檢查後，若仍有待撥名單：
// 1. 停止所有專案的自動外撥
// 2. 等待 20 分鐘後重新啟動，避免暫存名單殘留造成問題
async function handleEveningFollowUp(debtCollectionFlow, totalUnDialed) {
  if (totalUnDialed === 0) return;
  console.log(`最後檢查發現待撥名單數量為 ${totalUnDialed}，準備進行後續處理...`);

  for (const projectId of PROJECT_ID) {
    console.log(`正在停止專案 ${projectId} 的自動外撥...`);
    await stopAutoDial(projectId);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  console.log('已完成停止自動外撥的操作，再來關閉後 過 20 分鐘再開啟');

  setTimeout(async () => {
    try {
      for (const project of debtCollectionFlow) {
        console.log(`正在重新啟動專案 ${project.projectId} 的自動外撥...`);
        await startAutoDial(project);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      console.log('已完成重新啟動自動外撥的操作，請持續關注後續的撥打進度');
    } catch (err) {
      console.error('重新啟動自動外撥時發生錯誤：', err);
    }
  }, 20 * 60 * 1000);
}

// ========== Discord Bot 事件 ==========

// Bot 上線後執行一次性初始化
client.once('ready', async () => {
  console.log(`Bot 已上線：${client.user.tag}`);

  // 向 Discord 註冊 /check slash command（guild 範圍，即時生效）
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

  setupSchedule();

  // 發送上線通知到指定頻道
  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  await channel.send({ content: `Bot 已上線，排程已啟動\n排程時段：${SCHEDULE_TIMES.join(' / ')}`, components: [checkButton] });
});

// 處理 /check 指令 與「立即檢查」按鈕的互動
client.on('interactionCreate', async (interaction) => {
  const isCheckCommand = interaction.isChatInputCommand() && interaction.commandName === 'check';
  const isCheckButton = interaction.isButton() && interaction.customId === 'check_now';

  if (!isCheckCommand && !isCheckButton) return;

  // deferReply 避免 Discord 3 秒逾時，實際回應用 editReply
  await interaction.deferReply();
  const { content } = await fetchProgress('regular');
  await interaction.editReply({ content, components: [checkButton] });
});

// ========== 排程設定 ==========

// 根據 SCHEDULE 環境變數建立多個排程
// 非最後時段 → regular 模式；最後時段 → final 模式（含後續處理）
function setupSchedule() {
  SCHEDULE_TIMES.forEach((timeStr, index) => {
    const isLast = index === SCHEDULE_TIMES.length - 1;
    const [hour, minute] = timeStr.split(':').map(Number);

    schedule.scheduleJob({ hour, minute, tz: TIMEZONE }, async () => {
      console.log(`[${timeStr}] 開始檢查...`);
      if (isLast) {
        const { debtCollectionFlow, totalUnDialed } = await sendScheduledCheck('final');
        if (totalUnDialed > 0) {
          await handleEveningFollowUp(debtCollectionFlow, totalUnDialed);
        }
      } else {
        await sendScheduledCheck('regular');
      }
    });
  });

  console.log(`排程已啟動，等待執行 (${SCHEDULE_TIMES.join(' / ')})`);
}

// ========== 啟動驗證 ==========

function main() {
  // 確認必要的環境變數都已設定
  if (!process.env.SCHEDULE) {
    console.error('錯誤：環境變數 SCHEDULE 未設定，請在 .env 中設定（格式範例：09:30,21:50）');
    process.exit(1);
  }

  if (!process.env.DISCORD_GUILD_ID) {
    console.error('錯誤：環境變數 DISCORD_GUILD_ID 未設定，請在 .env 中填入 Discord 伺服器 ID');
    process.exit(1);
  }

  // 驗證每個時段格式是否符合 HH:MM
  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  const invalid = SCHEDULE_TIMES.filter(t => !timeRegex.test(t));

  if (SCHEDULE_TIMES.length === 0) {
    console.error('錯誤：SCHEDULE 未包含任何時間');
    process.exit(1);
  }

  if (invalid.length > 0) {
    console.error(`錯誤：SCHEDULE 包含格式不正確的時間：${invalid.join(', ')}（正確格式：HH:MM，例如 09:30）`);
    process.exit(1);
  }

  client.login(process.env.DISCORD_BOT_TOKEN);
}

// ========== 關閉處理 ==========

// 發送離線通知後關閉 Bot，確保 Discord 頻道知道程式已停止
async function shutdown(reason) {
  console.log(`正在關閉：${reason}`);
  try {
    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    await channel.send(`Bot 已離線 (${reason})`);
  } catch (e) {
    console.error('離線通知發送失敗', e);
  } finally {
    await client.destroy();
    process.exit(0);
  }
}

// 監聽各種終止信號，確保程式結束前都能發送通知
process.on('SIGINT', () => shutdown('手動停止'));
process.on('SIGTERM', () => shutdown('系統終止'));
process.on('uncaughtException', async (err) => {
  console.error('未捕獲的例外：', err);
  await shutdown(`程式發生錯誤：${err.message}`);
});
process.on('unhandledRejection', async (reason) => {
  console.error('未處理的 Promise 拒絕：', reason);
  await shutdown(`未處理的錯誤：${reason}`);
});

main();
