# 渠道口令部署

独立服务仅监听 `127.0.0.1`，通过 nginx 暴露同域 HTTPS。只允许一个服务进程写入存档和统计日志。本版按渠道口令登录，可选渠道开局数限制；公开试玩不配置开局数限制，以全站每日模型预算控制开支。没有多用户存档访问隔离或按 IP 限流。游戏路由共用 `court-handler.ts`，Vite 保持本机限制。

## 安装与配置

部署完整仓库，安装 Node **24 LTS** 和仓库指定的 pnpm，执行 `pnpm install --frozen-lockfile`（保留 devDependencies，运行服务需要 tsx，构建需要 Vite）。从仓库根目录执行 `npm run serve`，会先构建 `apps/web`，再启动服务。也可分别执行 `npx vite build apps/web --configLoader runner` 和 `npx tsx apps/web/server/standalone.ts`。构建目录存在 `desk.html` 时 `/` 优先返回它，否则返回 `index.html`；当前 Vite 已配置两个入口。

| 配置                                                 | 用途                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `PORT=4173`                                          | 本机监听端口，默认 4173                                                                                    |
| `THRONE_PUBLIC_ORIGIN=https://1566.unryuu.top`       | 外部地址，不带尾斜杠；默认 `http://127.0.0.1:$PORT`                                                        |
| `secret/passcodes.json`                              | 渠道口令表，每次请求重读；不再读取 THRONE_PASSWORD 或 password.txt                                         |
| `THRONE_COOKIE_SECRET` 或 `secret/cookie-secret.txt` | 至少 32 字节的独立随机签名密钥，例如用 `openssl rand -hex 32` 生成；固定保存，重启不变                     |
| `DEEPSEEK_API_KEY` 或 `secret/deepseek.txt`          | 与 play.mjs 相同；环境变量优先，文件中须有且只有一个 `sk-...` 密钥                                         |
| `THRONE_RUNS_DIR=/var/lib/throne/runs`               | 存档、analytics、cache/calls、cache/packs、cache/reports、runtime；默认仓库 runs，相对路径以仓库根目录解析 |

口令表或签名密钥缺失、格式错误时拒绝启动；运行中口令表损坏会返回 500 并记录可定位错误，不沿用旧表。签名 cookie 有效 180 天，包含渠道标签和随机访客编号，HttpOnly、SameSite=Lax；公网地址为 HTTPS 时加 Secure。删除、停用或更换某渠道口令后，下次请求旧 cookie 即失效；更换签名密钥使全部 cookie 失效。旧版单口令 cookie 需重新登录。登录失败 5 次后，一分钟窗口内返回 429（进程内全局节流，重启清空）。未登录的页面/API/资源都返回口令页（401）。密钥文件和 systemd 环境文件只允许服务用户读取。

口令表例如（请自行替换示例 code）：

```json
[
  {
    "code": "replace-with-a-private-code-1",
    "label": "朋友圈",
    "enabled": true,
    "maxRunsPerDay": 20
  },
  {
    "code": "replace-with-a-private-code-2",
    "label": "小红书",
    "enabled": true,
    "maxRunsPerDay": 10
  },
  {
    "code": "replace-with-a-private-code-3",
    "label": "朋友小王",
    "enabled": false
  }
]
```

`code`、`label` 必须分别唯一；code 按原文匹配，label 作为持久渠道标识，请保持稳定，修改 label 相当于新渠道（额度和统计也分开）。`maxRunsPerDay` 是非负整数，0 禁止开局，省略则不限制；空数组表示全部关门。用临时文件写完后原子替换 passcodes.json，避免写到一半时请求读到不完整 JSON。停用后再次启用同一个 code 会恢复原 cookie；需要永久吊销时更换 code。

额度按北京时间（UTC+8）自然日、整个渠道合计。开局前串行检查并追加 `run.started` 占额，达到上限返回 JSON 错误“今日国库已空”，不调用模型。进入模型阶段后失败/中断不退额度；重试同一局不占新额度。重启从统计日志恢复额度；不要在运行中编辑、删除或轮转该日志。

## 公开试玩预算与提醒

独立服务器默认 `THRONE_DAILY_BUDGET_CNY=50`、`THRONE_MODEL_CONCURRENCY=3`。真实模型调用在缓存未命中后才排队、预占费用；所有渠道、旧局和重试都计入，精确缓存命中始终放行。公开时从口令表移除 `maxRunsPerDay`，启用小红书渠道。

账本是 `<THRONE_RUNS_DIR>/budget/events.jsonl`，单进程串行追加。每个文本调用至少预占 0.5 元（长输入按 UTF-8 字节和最大输出上调），终端人物日预占 5 元，用官方 Flash 人民币高峰单价结算，具体口径和测试见 [公开试玩事项](issues/archive/public-playtest.md)。这是保守估算预算，不是服务商账单硬上限；终端日包含多轮请求，实际费用可超过预占。额度不足保存并暂停，可重试原步骤；手机错误面板可展开已打开的文书。预占也可能被其他进行中操作占用，结算后可再试。预算按北京时间零点补充；进行中的跨日调用按准入日记账，在完成前仍占新一天的可用额度。未知用量按预占结算并标记，强杀后未结算的预占留在原日，不按零费处理。部署当天先按 analytics 迁入已有费用，再由新账本记录后续调用，旧 analytics 保持历史统计口径。不要在运行中改写或清空账本。

把完整 Bark 地址（只含服务域名和设备 key）保存为仓库 `secret/bark.txt`，权限 600、归 throne；不要入库。未配置时明确打印提醒关闭，配置损坏则拒绝启动。每分钟检查排队和内存：最长排队超过 2 分钟且持续 5 分钟，或 Linux MemAvailable 持续低于 200 MiB 达 5 分钟，发送一条提醒，恢复后再报；发送失败记录错误并隔 5 分钟重试，不影响游戏。通知区分内存紧张与模型排队，不能仅凭排队判定需要扩容。进程重启会重置提醒状态；宕机需要外部监控。

## 统计

日志追加到 `<THRONE_RUNS_DIR>/analytics/events.jsonl`（默认 `runs/analytics/events.jsonl`）。记录登录成功/失败、开局、每次提交/行动/重试后的日数与状态、首次结局及逐局累计模型用量。没有 IP、口令内容、游戏文书或模型文本。读档不算开局、不重复计费；已有存档在第一次写操作绑定渠道，只统计此后的调用。局的归属随存档保存，其他渠道继续同一局仍计入原渠道；没有新增存档访问隔离。

```sh
npx tsx apps/web/server/analytics-report.ts
npx tsx apps/web/server/analytics-report.ts --since=2026-10-16
# 不需要 tsx CLI 的 IPC 时，也可用同一 TypeScript loader：
node --import tsx apps/web/server/analytics-report.ts --since=2026-10-16
```

访客按匿名编号去重（同一有效 cookie 重登录保持编号；清 cookie/换浏览器会增加访客）。`--since` 从指定日北京时间零点起：登录/访客按期间活动，开局按期间准入数，平均日数与结局率按这些局至今的进展，费用按期间追加用量的增量，跨日局不会重复收费。平均日数使用 day0 起的模拟日，无开局显示破折号。纯历史读档不会把该局记成该渠道的新局或结局。

模型调用数沿用开局包口径：终端整日/文本调用各计一次，排除本地指纹命中；不是 HTTP 请求数。token = 未缓存输入 + 服务商缓存输入 + 输出，推理已含在输出，不再次相加。估算复用开局包 2026-10-15 历史单价（USD/百万 token）：低谷 0.15 / 0.003 / 0.6，高峰 0.3 / 0.006 / 1.2，不是实时账单。缺用量的失败调用单列“用量未知调用”；已占额但尚无用量快照的局单列“未回写局”，费用只含已知部分。强杀进程前尚未写回的调用也可能不在统计内。日志损坏会报具体行号，不跳过；日志写失败会显式失败，不伪造成功。无需公开统计 HTTP 接口，报表仅在服务器终端运行。

迁移时完整复制 `runs/`，特别是 `court/` 和 `cache/`；停止旧服务后切换，持久目录归服务用户所有。代码、`secret/`、场景数据仍在仓库，不随 THRONE_RUNS_DIR 改址。模型运行记录也在持久目录，备份并关注磁盘用量。不要只上传前端 dist。

终端 actor 默认启用，无需真实 bash、Python、Docker 或全局安装 dsh CLI：npm 依赖 `@deepseek-ai/dsh-sdk-client@0.1.5-rc.2` 会启动其配套 `@deepseek-ai/dsh` 子进程，使用当前 `process.execPath`。保留 workspace 包、YAML patch、court-shell/plugin.mjs、court/src/shell.ts 和场景数据；服务用户需要启动子进程、写持久目录、通过 HTTPS 访问 api.deepseek.com。插件直接导入 TypeScript，故部署采用自带类型擦除能力的 Node 24；仓库通用的最低版本 22.12 不足以保证这条子进程路径。`THRONE_NPC_MODE=form` 仅用于原有填表对照，本版默认不设置。

终端缓存指纹包含 shell-day.ts。第一步独立服务的存储路径改动会使更早的终端调用缓存失效：不会伪装命中，会调用模型；发布前按 [开局包说明](architecture/0012-opening-packs-and-memorial-library.md) 重建并 `--verify`。建包脚本也遵守 THRONE_RUNS_DIR。本次渠道统计未改提示词或终端实现，不新增缓存失效。

## nginx

以下放在已有证书的 HTTPS server 中，HTTP server 重定向到 HTTPS。nginx 必须覆盖 Host 和转发协议头；应用以 THRONE_PUBLIC_ORIGIN 为准校验，不从客户端头推断可信公网地址或 IP。不要在 nginx 直接暴露 dist、runs、secret，也不要缓存认证响应。

```nginx
server {
    listen 443 ssl;
    server_name 1566.unryuu.top;
    ssl_certificate /etc/letsencrypt/live/1566.unryuu.top/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/1566.unryuu.top/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header Connection "";
        proxy_read_timeout 1800s;
        proxy_send_timeout 1800s;
        proxy_buffering off;
        client_max_body_size 128k;
    }
}
```

一次请求可能串行等待多个 actor，单个终端 actor 上限 300 秒，故代理超时预留 30 分钟；这不会改变模型调用自己的超时。应用不设置响应 socket 超时，接收请求体限 60 秒。客户端断开不取消已开始的模拟，存档仍会保存；不要用浏览器反复提交来重试。

## systemd 示例

先建普通服务用户 `throne`、可写持久目录，将仓库放在 `/opt/throne`；准备 `/etc/throne.env`（600，服务管理方可读），包含上表配置。路径按实际安装位置替换。示例运行已构建的产物，更新时先停止服务、安装依赖和构建，再启动。

```ini
[Unit]
Description=Throne private court
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=throne
Group=throne
WorkingDirectory=/opt/throne
Environment=NODE_ENV=production
EnvironmentFile=/etc/throne.env
ExecStart=/usr/bin/node /opt/throne/node_modules/tsx/dist/cli.mjs /opt/throne/apps/web/server/standalone.ts
Restart=on-failure
RestartSec=5
TimeoutStopSec=1800
KillMode=mixed
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/throne

[Install]
WantedBy=multi-user.target
```

SIGTERM/SIGINT 停止接收新请求，等待正在执行的请求完成；systemd 超时后才终止整个进程组。仅部署 Web court，不提供早期 `/api/live` 或独立 spectator 服务。本文不代表已执行任何 VPS 操作。
