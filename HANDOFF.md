# HANDOFF：手机能玩，只差部署

写于 2026-10-16，分支 `feat/jiajing-court`（已推送，未合 `main`）。先读 STATUS.md 最后一段和 [docs/deployment.md](docs/deployment.md)。

## 和用户定下的

- 当前目标是“作者自己能在手机上打开就玩”，然后才是分享给朋友。
- 口令兼作渠道码：`secret/passcodes.json` 里有 作者自用、朋友圈（每日 20 局）、小红书（停用）。小红书的口令等于公开，**发小红书之前必须先做全站每日花费上限**。
- 杂事库要持续换模型来写，以免口味重复。文件名用 `模型名 - 末号.md`，写了一半的稿子放在 `drafts/`。库一改，开局包就要重建，所以新批次攒着一起加。
- HTTPS：vps-02 的 443 端口被用户偶尔翻墙用的 xray（REALITY，伪装 www.apple.com）占着。定了由 nginx stream 按 SNI 分流，不用 8443 端口，也不用 Cloudflare（大陆访问慢）。已知风险：游戏和代理共用一个 IP，IP 被墙时就换 IP。

## 待用户

1. **批准下面的 vps-02 改动清单**（台账规矩：改动机器要先问）。xray 切换监听端口时，代理会断几分钟。
2. 部署完，用“作者自用”口令在手机上玩一局，这是作者的第一次亲自试玩。口令在 `secret/passcodes.json`，不要贴进聊天。
3. 什么时候合进 `main`（合进去会触发观战页部署）。

## vps-02 改动清单（巡检已做：CentOS 9，SELinux 关，nginx 在 80 端口服务 hk.purestretch.cn，xray 占 443，没有 Node 和 certbot，DNS 已指向本机）

1. 安装 Node 24、`nginx-mod-stream`、EPEL 和 certbot。
2. 建 `throne` 用户。代码用 rsync 传到 `/opt/throne`（排除 node_modules、runs）；`secret/` 只带 deepseek.txt、passcodes.json、cookie-secret.txt，权限 600。持久目录 `/var/lib/throne/runs`，带上 `runs/cache/`（开局包和调用缓存）。然后 `pnpm install --frozen-lockfile` 并 build。
3. 装 systemd 单元 `throne.service`（照 deployment.md），环境文件 `/etc/throne.env`：PORT=4173，THRONE_PUBLIC_ORIGIN=https://1566.unryuu.top，THRONE_RUNS_DIR。
4. certbot 通过 80 端口签 `1566.unryuu.top`。
5. xray 的监听从 `0.0.0.0:443` 改到 `127.0.0.1:10443`。nginx 加 stream：443 端口做 ssl_preread，SNI 是 1566 的转到 127.0.0.1:8443（http ssl server，反代 4173，超时照 deployment.md），其余转到 10443。改之前把配置备份成 `.bak-时间戳`。
6. 在 Mac 上 curl 一遍（应返回 401 口令页），再请用户测一下翻墙还能不能用。最后更新 VPS 台账：vps-02 档案里写的“只有 22 在监听”已经过时。

## 坑

- 开局包指纹包含 `shell-day.ts`。C 改存档路径时动过它，正好在建包开始后一分钟。所以这轮建完要再跑一遍 `npx tsx apps/web/server/opening-packs.ts --register=plain --groups=1 --verify`：已缓存的调用会直接命中，只补少数几次。之后别再碰指纹相关的文件，见 deployment.md 末段。
- `codex exec resume` 不带沙箱参数，续接的会话没有网络、也不能监听端口；依赖安装和起服务实测要 Claude 自己补。
- 新依赖 `happy-dom`：拉代码后要先跑 `npx -y pnpm@11.19.0 install`。
