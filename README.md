# check-progress-21-crideit-outbound-campaign

監控 21 世紀信貸催收 Flow 自動外撥進度，並透過排程定時發送 Discord 通知。

## 功能

- 每天早上 09:30 拉取指定專案的待撥名單數量，發送進度報告至 Discord
- 每天晚上 21:30 再次檢查，若仍有待撥名單，自動停止外撥並於 20 分鐘後重新啟動（待 API 就緒後啟用）
- 排程時間可透過環境變數調整

## 環境變數

複製 `.env.example` 為 `.env` 並填入對應值：

| 變數 | 說明 |
|---|---|
| `BONSALE_HOST` | Bonsale API 位址 |
| `BONSALE_X_API_KEY` | Bonsale API Key |
| `BONSALE_X_API_SECRET` | Bonsale API Secret |
| `BONSALE_PROJECT_ID` | 監控的專案 ID，多個以逗號分隔 |
| `BONSLAE_3CX_OUTBOUND_CAMPAIGN_HOST` | 3CX Outbound Campaign API 位址 |
| `SCHEDULE_MORNING` | 早上檢查時間，格式 `HH:MM`，預設 `09:30` |
| `SCHEDULE_EVENING` | 晚上檢查時間，格式 `HH:MM`，預設 `21:30` |
| `DISCORD_BOT_TOKEN` | Discord Bot Token |
| `DISCORD_CHANNEL_ID` | 發送通知的頻道 ID |

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

## 晚上自動處理流程（待啟用）

1. 晚上排程觸發，取得各專案待撥數量
2. 若 `totalUnDialed > 0`，依序停止每個專案的自動外撥（間隔 3 秒）
3. 等待 20 分鐘後，重新啟動各專案的自動外撥（間隔 3 秒）

> 目前此流程已寫好但暫時註解，等 `bonsale_3cx-outbound-campaign` API 版本就緒後再開啟
