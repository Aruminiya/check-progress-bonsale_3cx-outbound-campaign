import axios from 'axios';
import dotenv from 'dotenv';
import { Client, GatewayIntentBits } from 'discord.js';
import schedule from 'node-schedule';
import { stopAutoDial, startAutoDial } from './outboundCampaignApi.js';

dotenv.config();
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

const PROJECT_ID = process.env.BONSALE_PROJECT_ID.split(',').map(id => id.trim());
const TIMEZONE = process.env.TIMEZONE || 'Asia/Taipei';

// 取得 21 世紀 專案自動外撥的撥打進度
async function getDebtCollectionFlow(PROJECT_ID) {
  const response = await axiosBonsaleInstance.get("/project/auto-dial?limit=-1&sort=created_at+desc");
  const list = response.data.list;
  const debtCollectionFlow = list.filter((item) => PROJECT_ID.includes(item.projectId));

  return debtCollectionFlow;
}

function formatProgress(list) {
  const lines = ['========== 今天的自動外撥進度 =========='];

  list.forEach((item) => {
    const name = item.projectInfo?.projectName ?? item.projectId;
    const lastRun = item.lastExecutedAt
      ? new Date(item.lastExecutedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
      : '尚未執行';
    const restrictions = item.callRestriction?.map(r => `${r.startTime}~${r.stopTime}`).join(', ') || '無';

    lines.push('');
    lines.push(`【${name}】`);
    lines.push(`  待撥數量  : ${item.unDialedCount}`);
    lines.push(`  最後執行  : ${lastRun}`);
    lines.push(`  限制時段  : ${restrictions}`);
  });

  const totalUnDialed = list.reduce((sum, item) => sum + item.unDialedCount, 0);
  lines.push(`\n總撥號名單數量 : ${totalUnDialed}`);
  lines.push(`\n檢測時間 : ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
  lines.push('\n==================================');

  return {
    totalUnDialed,
    message: '```\n' + lines.join('\n') + '\n```'
  };
}

async function getDataToDiscord(mode = 'regular') {
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

  const sendMessage = message + '\n\n' + extraMessage(totalUnDialed);

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(process.env.DISCORD_BOT_TOKEN);

  const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
  await channel.send(sendMessage);
  console.log('訊息已發送');

  await client.destroy();
  return { debtCollectionFlow, totalUnDialed };
}

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
    for (const project of debtCollectionFlow) {
      console.log(`正在重新啟動專案 ${project.projectId} 的自動外撥...`);
      await startAutoDial(project);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    console.log('已完成重新啟動自動外撥的操作，請持續關注後續的撥打進度');
  }, 20 * 60 * 1000);
}

function main() {
  if (!process.env.SCHEDULE) {
    console.error('錯誤：環境變數 SCHEDULE 未設定，請在 .env 中設定（格式範例：09:30,21:50）');
    process.exit(1);
  }

  const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
  const times = process.env.SCHEDULE.split(',').map(s => s.trim()).filter(Boolean);
  const invalid = times.filter(t => !timeRegex.test(t));

  if (times.length === 0) {
    console.error('錯誤：SCHEDULE 未包含任何時間');
    process.exit(1);
  }

  if (invalid.length > 0) {
    console.error(`錯誤：SCHEDULE 包含格式不正確的時間：${invalid.join(', ')}（正確格式：HH:MM，例如 09:30）`);
    process.exit(1);
  }

  times.forEach((timeStr, index) => {
    const isLast = index === times.length - 1;
    const [hour, minute] = timeStr.split(':').map(Number);

    schedule.scheduleJob({ hour, minute, tz: TIMEZONE }, async () => {
      console.log(`[${timeStr}] 開始檢查...`);
      if (isLast) {
        const { debtCollectionFlow, totalUnDialed } = await getDataToDiscord('final');
        if (totalUnDialed > 0) {
          await handleEveningFollowUp(debtCollectionFlow, totalUnDialed);
        }
      } else {
        await getDataToDiscord('regular');
      }
    });
  });

  console.log(`排程已啟動，等待執行 (${times.join(' / ')})`);
}

main();

