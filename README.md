# check-progress-bonsale_3cx-outbound-campaign

監控 Bonsale 自動外撥進度，並透過排程定時發送 Discord 通知。
最後排程時間判斷有無撥打完成來決定要不要停止外播。

## 功能

- 依照 `SCHEDULE` 設定的時段，定時拉取指定專案的待撥名單數量並發送進度報告至 Discord
- 最後一個時段若仍有待撥名單，自動停止外撥並於 20 分鐘後重新啟動
- Discord Bot 常駐，支援 `/check` Slash Command 與訊息按鈕即時查詢進度
- Bot 上線／離線時自動發送通知至 Discord 頻道

## 環境變數

複製 `.env.example` 為 `.env` 並填入對應值：

| 變數 | 說明 |
|---|---|
| `BONSALE_HOST` | Bonsale API 位址 |
| `BONSALE_X_API_KEY` | Bonsale API Key |
| `BONSALE_X_API_SECRET` | Bonsale API Secret |
| `BONSALE_PROJECT_ID` | 監控的專案 ID，多個以逗號分隔 |
| `BONSLAE_3CX_OUTBOUND_CAMPAIGN_HOST` | 3CX Outbound Campaign API 位址 |
| `SCHEDULE` | 排程時段，格式 `HH:MM`，多個以逗號分隔，**最後一個時段**為最終檢查模式（例：`09:30,21:50`） |
| `TIMEZONE` | 時區，預設 `Asia/Taipei` |
| `DISCORD_BOT_TOKEN` | Discord Bot Token |
| `DISCORD_CHANNEL_ID` | 發送通知的頻道 ID |
| `DISCORD_GUILD_ID` | Discord 伺服器 ID（用於註冊 Slash Command） |

## Discord Bot 設定

在 [Discord Developer Portal](https://discord.com/developers/applications) 確認以下設定：

- **Privileged Gateway Intents**：開啟 `MESSAGE CONTENT INTENT`
- **OAuth2 Scopes**：`bot` + `applications.commands`
- **Bot Permissions**：`Send Messages`、`Read Message History`、`View Channels`、`Use Slash Commands`

## 本地執行

```bash
npm install
node index.js
```

## Docker

```bash
# build
docker build -t gcr.io/drvet-server-sysstore-bonvies/check-progress-21-crideit:latest .

# run（.env 不打包進 image，啟動時傳入）
docker run -d --env-file .env --name check-progress-21-crideit gcr.io/drvet-server-sysstore-bonvies/check-progress-21-crideit:latest

# push
docker push gcr.io/drvet-server-sysstore-bonvies/check-progress-21-crideit:latest
```

> 若 3CX Outbound Campaign 服務與 container 同機執行，`BONSLAE_3CX_OUTBOUND_CAMPAIGN_HOST` 請設為 `http://host.docker.internal:<port>`

## 最後時段自動處理流程

1. 最後一個排程時段觸發，取得各專案待撥數量
2. 若 `totalUnDialed > 0`，依序停止每個專案的自動外撥（間隔 3 秒）
3. 等待 20 分鐘後，重新啟動各專案的自動外撥（間隔 3 秒）
