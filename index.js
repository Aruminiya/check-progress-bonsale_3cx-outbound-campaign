import axios from 'axios';
import dotenv from 'dotenv';
import schedule from 'node-schedule';
import { stopAutoDial, startAutoDial } from './outboundCampaignApi.js';
import { sendPushoverNotification } from './pushoverApi.js';
import { initDiscordBot, sendDiscordNotification, shutdownDiscordBot } from './discordApi.js';

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

const PROJECT_ID = process.env.BONSALE_PROJECT_ID.split(',').map(id => id.trim());
const TIMEZONE = process.env.TIMEZONE || 'Asia/Taipei';
const SCHEDULE_TIMES = process.env.SCHEDULE?.split(',').map(s => s.trim()).filter(Boolean) ?? [];

// ========== Bonsale API 資料取得 ==========

async function getDebtCollectionFlow(projectIds) {
  const response = await axiosBonsaleInstance.get('/project/auto-dial?limit=-1&sort=created_at+desc');
  return response.data.list.filter(item => projectIds.includes(item.projectId));
}

// ========== 訊息格式化 ==========

function formatProgress(list) {
  const lines = ['今天的自動外撥進度'];

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

  const totalUnDialed = list.reduce((sum, item) => sum + item.unDialedCount, 0);
  lines.push(`\n總撥號名單數量 : ${totalUnDialed}`);
  lines.push(`固定排程時間 : ${SCHEDULE_TIMES.join(' / ')}`);

  return { totalUnDialed, message: lines.join('\n') };
}

// 進度檢查核心 ==========

function getProgressLevel(mode,totalUnDialed) {
  if (mode === 'final') {
    if (totalUnDialed === 0) return 'info';
    if (totalUnDialed > 0) return 'warning';
    return 'error';
  }

  return 'info';
}

async function fetchProgress(mode = 'regular') {
  const debtCollectionFlow = await getDebtCollectionFlow(PROJECT_ID);
  const { totalUnDialed, message } = formatProgress(debtCollectionFlow);
  console.log(`取得進度資料，mode=${mode}，totalUnDialed=${totalUnDialed}`);

  return {
    debtCollectionFlow,
    totalUnDialed,
    level: getProgressLevel(mode, totalUnDialed),
    content: message,
  };
}

// ========== 排程通知 ==========

async function notify(level, content) {
  await Promise.all([
    sendPushoverNotification(level, content),
    sendDiscordNotification(content),
  ]);
}

async function sendScheduledCheck(mode) {
  const { debtCollectionFlow, totalUnDialed, level, content } = await fetchProgress(mode);
  await notify(level, content);
  console.log('通知已發送');
  return { debtCollectionFlow, totalUnDialed };
}


// ========== 最後時段後續處理 ==========
async function handleEveningFollowUp(debtCollectionFlow, totalUnDialed) {
  if (totalUnDialed === 0) {
    await notify('info', '最後檢查發現沒有待撥名單，無需停止自動外撥 😊😊😊');
    return
  };
  console.log(`最後檢查發現待撥名單數量為 ${totalUnDialed}，開始進行後續處理...`);
  await notify('info', `最後檢查發現 ${totalUnDialed} 筆待撥名單，開始進行後續處理... 😱😱😱`);

  const pendingProjects = debtCollectionFlow.filter(item => item.unDialedCount > 0);

  for (const project of pendingProjects) {
    console.log(`正在停止專案 ${project.projectId} 的自動外撥...`);
    await notify('info', `正在停止專案 ${project.projectId} 的自動外撥...`);
    try {
      await stopAutoDial(project.projectId);
      console.log('已完成停止自動外撥的操作，20 分鐘後重新啟動');
      await notify('info', `已停止自動外撥，20 分鐘後自動重新啟動`);
    } catch (err) {
      console.warn(`停止專案 ${project.projectId} 時發生錯誤（可能已停止）：`, err.response?.data?.message ?? err.message);
      await notify('error', ` 停止專案 ${project.projectId} 的自動外撥時發生錯誤：${err.response?.data?.message ?? err.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 3000)); // 每個專案操作間隔 3 秒，避免對 API 造成過大壓力
  }

  setTimeout(async () => {
    try {
      for (const project of pendingProjects) {
        console.log(`正在重新啟動專案 ${project.projectId} 的自動外撥...`);
        await notify('info', `正在重新啟動專案 ${project.projectId} 的自動外撥...`);
        await startAutoDial(project);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      console.log('已完成重新啟動自動外撥的操作，請持續關注後續的撥打進度');
      await notify('info', '自動外撥已重新啟動，請持續關注後續撥打進度');
    } catch (err) {
      console.error('重新啟動自動外撥時發生錯誤：', err);
      await notify('error', `重新啟動自動外撥失敗：${err.message}`);
    }
  }, 20 * 60 * 1000);
}

// ========== 排程設定 ==========

function setupSchedule() {
  SCHEDULE_TIMES.forEach((timeStr, index) => {
    const isLast = index === SCHEDULE_TIMES.length - 1;
    const [hour, minute] = timeStr.split(':').map(Number);

    schedule.scheduleJob({ hour, minute, tz: TIMEZONE }, async () => {
      console.log(`[${timeStr}] 開始檢查...`);
      if (isLast) { // 最後一個排程時段，執行完檢查後如果有待撥名單則進行後續處理
        const { debtCollectionFlow, totalUnDialed } = await sendScheduledCheck('final');
        await handleEveningFollowUp(debtCollectionFlow, totalUnDialed);
      } else {
        await sendScheduledCheck('regular');
      }
    });
  });

  console.log(`排程已啟動，等待執行 (${SCHEDULE_TIMES.join(' / ')})`);
}

// ========== 啟動驗證 ==========

async function main() {
  if (!process.env.SCHEDULE) {
    console.error('錯誤：環境變數 SCHEDULE 未設定，請在 .env 中設定（格式範例：09:30,21:50）');
    process.exit(1);
  }

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

  initDiscordBot(
    async () => {
      const { level, content } = await fetchProgress('regular');
      await notify(level, content);
      return content;
    },
    async () => {
      await sendDiscordNotification(`Bot 已上線，排程已啟動\n排程時段：${SCHEDULE_TIMES.join(' / ')}`);
    }
  );

  await sendPushoverNotification('info', `排程已啟動\n排程時段：${SCHEDULE_TIMES.join(' / ')}`);
  setupSchedule();
}

// ========== 關閉處理 ==========

async function shutdown(level, reason) {
  console.log(`正在關閉：${reason}`);
  try {
    await Promise.all([
      sendPushoverNotification(level, reason),
      shutdownDiscordBot(reason),
    ]);
  } catch (e) {
    console.error('離線通知發送失敗', e);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('info', '手動停止'));
process.on('SIGTERM', () => shutdown('info', '系統終止'));
process.on('uncaughtException', async (err) => {
  console.error('未捕獲的例外：', err);
  await shutdown('error', `程式發生錯誤：${err.message}`);
});
process.on('unhandledRejection', async (reason) => {
  console.error('未處理的 Promise 拒絕：', reason);
  await shutdown('error', `未處理的錯誤：${reason}`);
});

main();
