import axios from 'axios';

const LEVEL_CONFIG = {
  silent:  { title: '📋 背景回報', sound: 'bike', priority: -1 },
  info:    { title: '🍏 系統定期回報', sound: 'pushover', priority: 0 },
  warning: { title: '🟡 系統狀態警告', sound: 'echo',  priority: 2, retry: 30, expire: 3600 },
  error:   { title: '🚨 系統嚴重錯誤', sound: 'persistent', priority: 2, retry: 30, expire: 3600 },
};

function getInstance() {
  return axios.create({
    baseURL: process.env.PUSHOVER_HOST,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

export function sendPushoverNotification(level = 'info', message, { url = null, urlTitle = null } = {}) {
  const config = LEVEL_CONFIG[level] ?? LEVEL_CONFIG.info;

  const data = {
    token: process.env.PUSHOVER_API_TOKEN,
    user: process.env.PUSHOVER_USER_KEY,
    message: level === 'silent' ? `📋 ${message}` :
             level === 'info' ? `🍏 ${message}` :
             level === 'warning' ? `🟡 ${message}` :
             level === 'error' ? `🚨 ${message}` :
             message,
    ...config,
  };

  if (url) data.url = url;
  if (urlTitle) data.url_title = urlTitle;

  return getInstance().post('', new URLSearchParams(data).toString());
}

