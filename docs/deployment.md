# 作者自用部署

独立服务仅监听 `127.0.0.1`，通过 nginx 暴露同域 HTTPS。只允许一个服务进程共享存档；本版全站口令、单一作者，未实现多用户隔离、每日预算或按 IP 限流。以后增加这些策略，应在独立服务的认证/API 入口处理；游戏路由仍共用 `court-handler.ts`，Vite 保持本机限制。

## 安装与配置

部署完整仓库，安装 Node **24 LTS** 和仓库指定的 pnpm，执行 `pnpm install --frozen-lockfile`（保留 devDependencies，运行服务需要 tsx，构建需要 Vite）。从仓库根目录执行 `npm run serve`，会先构建 `apps/web`，再启动服务。也可分别执行 `npx vite build apps/web --configLoader runner` 和 `npx tsx apps/web/server/standalone.ts`。构建目录存在 `desk.html` 时 `/` 优先返回它，否则返回 `index.html`；手机版合入时须由它的 Vite 多入口配置将 desk.html 构建进去。

| 配置                                                 | 用途                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PORT=4173`                                          | 本机监听端口，默认 4173                                                                         |
| `THRONE_PUBLIC_ORIGIN=https://1566.unryuu.top`       | 外部地址，不带尾斜杠；默认 `http://127.0.0.1:$PORT`                                             |
| `THRONE_PASSWORD` 或 `secret/password.txt`           | 登录口令；环境变量优先，去除首尾空白                                                            |
| `THRONE_COOKIE_SECRET` 或 `secret/cookie-secret.txt` | 至少 32 字节的独立随机签名密钥，例如用 `openssl rand -hex 32` 生成；固定保存，重启不变          |
| `DEEPSEEK_API_KEY` 或 `secret/deepseek.txt`          | 与 play.mjs 相同；环境变量优先，文件中须有且只有一个 `sk-...` 密钥                              |
| `THRONE_RUNS_DIR=/var/lib/throne/runs`               | 存档、cache/calls、cache/packs、cache/reports、runtime；默认仓库 runs，相对路径以仓库根目录解析 |

口令或签名密钥缺失、为空时拒绝启动。签名 cookie 有效 180 天，HttpOnly、SameSite=Lax，公网地址配置为 HTTPS 时加 Secure；修改口令或签名密钥会让已有 cookie 失效。登录连续失败 5 次后，在一分钟窗口内返回 429（进程内全局节流，重启清空）。没有登录时，API、页面和静态资源都返回口令页（401）。密钥文件和 systemd 环境文件只允许服务用户读取。

迁移时完整复制 `runs/`，特别是 `court/` 和 `cache/`；停止旧服务后切换，持久目录归服务用户所有。代码、`secret/`、场景数据仍在仓库，不随 THRONE_RUNS_DIR 改址。模型运行记录也在持久目录，备份并关注磁盘用量。不要只上传前端 dist。

终端 actor 默认启用，无需真实 bash、Python、Docker 或全局安装 dsh CLI：npm 依赖 `@deepseek-ai/dsh-sdk-client@0.1.5-rc.2` 会启动其配套 `@deepseek-ai/dsh` 子进程，使用当前 `process.execPath`。保留 workspace 包、YAML patch、court-shell/plugin.mjs、court/src/shell.ts 和场景数据；服务用户需要启动子进程、写持久目录、通过 HTTPS 访问 api.deepseek.com。插件直接导入 TypeScript，故部署采用自带类型擦除能力的 Node 24；仓库通用的最低版本 22.12 不足以保证这条子进程路径。`THRONE_NPC_MODE=form` 仅用于原有填表对照，本版默认不设置。

终端缓存指纹包含 shell-day.ts。本次存储路径改动会使旧终端调用缓存失效：不会伪装命中，会调用模型；发布前按 [开局包说明](architecture/0012-opening-packs-and-memorial-library.md) 重建并 `--verify`。建包脚本也遵守 THRONE_RUNS_DIR。

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
