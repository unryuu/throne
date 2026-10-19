# HANDOFF：已上线 1566.unryuu.top，收集试玩反馈

更新于 2026-10-19，分支 `feat/jiajing-court`（已推送，未合 `main`）。先读 STATUS.md 最后一段和 [docs/deployment.md](docs/deployment.md)。

## 和用户定下的

- 当前目标是“作者自己能在手机上打开就玩”，然后才是分享给朋友。
- 口令兼作渠道码，配置在 `secret/passcodes.json`。2026-10-19 已开放小红书渠道，各渠道开局数限制已移除，以每天 50 元估算模型预算控制开支，Bark 收拥堵提醒。14:22 部署与线上验收见 [记录](docs/issues/archive/public-playtest.md)。
- 杂事库要持续换模型来写，以免口味重复。文件名用 `模型名 - 末号.md`，写了一半的稿子放在 `drafts/`。库一改，开局包就要重建，所以新批次攒着一起加。
- HTTPS：vps-02 的 443 端口被用户偶尔翻墙用的 xray（REALITY，伪装 www.apple.com）占着。定了由 nginx stream 按 SNI 分流，不另开公网端口，也不用 Cloudflare（大陆访问慢）。已知风险：游戏和代理共用一个 IP，IP 被墙时就换 IP。

## 待用户

1. 用“作者自用”口令在手机上玩一局，这是作者的第一次亲自试玩。口令在 `secret/passcodes.json`，不要贴进聊天。
2. 什么时候合进 `main`（合进去会触发观战页部署）。

## 下一步

- 已上线（2026-10-17）：一组浅白开局包 `opening-plain-true-1`（线上开局 0.9 秒命中），等待意境句，归纳和打断两处容错修复。决定暂时只做这一组，玩的人多了再加；加之前先改完试玩反馈，因为库或提示词一改包就要重建。
- 更新服务器：`git archive` 传到 `/opt/throne` → `apps/web` 里 build → `systemctl restart throne`。重启前先看 `/var/lib/throne/runs/analytics/events.jsonl` 最后一条的时间，确认没人在等模型。新建的包要把 `runs/cache/calls` 和 `runs/cache/packs/<包>.json` 传到 `/var/lib/throne/runs/cache/`（tar 加 `COPYFILE_DISABLE=1`，避免带上 `._` 文件），权限归 throne。
- 下一步：发布 [小红书文案](docs/launch-xiaohongshu.md)，观察试玩反馈与 Bark 提醒，再决定是否扩容；滑动手势尚未做。
- 渠道统计：在服务器上用 `THRONE_RUNS_DIR=/var/lib/throne/runs` 跑 `apps/web/server/analytics-report.ts`。

## 坑

- 开局包指纹包含 `shell-day.ts`。C 改存档路径时动过它，正好在建包开始后一分钟。所以这轮建完要再跑一遍 `npx tsx apps/web/server/opening-packs.ts --register=plain --groups=1 --verify`：已缓存的调用会直接命中，只补少数几次。之后别再碰指纹相关的文件，见 deployment.md 末段。
- `codex exec resume` 不带沙箱参数，续接的会话没有网络、也不能监听端口；依赖安装和起服务实测要 Claude 自己补。
- 新依赖 `happy-dom`：拉代码后要先跑 `npx -y pnpm@11.19.0 install`。
