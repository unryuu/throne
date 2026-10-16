# HANDOFF：已部署到 1566.unryuu.top，等作者试玩

写于 2026-10-16，分支 `feat/jiajing-court`（已推送，未合 `main`）。先读 STATUS.md 最后一段和 [docs/deployment.md](docs/deployment.md)。

## 和用户定下的

- 当前目标是“作者自己能在手机上打开就玩”，然后才是分享给朋友。
- 口令兼作渠道码：`secret/passcodes.json` 里有 作者自用、朋友圈（每日 20 局）、小红书（停用）。小红书的口令等于公开，**发小红书之前必须先做全站每日花费上限**。
- 杂事库要持续换模型来写，以免口味重复。文件名用 `模型名 - 末号.md`，写了一半的稿子放在 `drafts/`。库一改，开局包就要重建，所以新批次攒着一起加。
- HTTPS：vps-02 的 443 端口被用户偶尔翻墙用的 xray（REALITY，伪装 www.apple.com）占着。定了由 nginx stream 按 SNI 分流，不另开公网端口，也不用 Cloudflare（大陆访问慢）。已知风险：游戏和代理共用一个 IP，IP 被墙时就换 IP。

## 待用户

1. 用“作者自用”口令在手机上玩一局，这是作者的第一次亲自试玩。口令在 `secret/passcodes.json`，不要贴进聊天。
2. 什么时候合进 `main`（合进去会触发观战页部署）。

## 下一步

- 开局包：前两次建包分别撞上“归纳少一句”和“打断缺理由”，两个 bug 都已修（3220a67、e24379b），建包也加了按分叉重试。第三次建包在后台跑，日志在会话 scratchpad 的 `packs3.log`。看 `runs/cache/packs/` 里有没有 `opening-plain-true-1` 的正式包（不是 `-failed`）；有就把 `runs/cache/` 传到服务器 `/var/lib/throne/runs/cache/`（权限归 throne）。
- **服务器还是旧代码**：上面两个修复要上线。用户可能正在玩，重启前先问（看 `/var/lib/throne/runs/analytics/events.jsonl` 最后一条的时间）。部署流程：`git archive` 传到 /opt/throne → build → `systemctl restart throne`。
- 决定：暂时只做这一组浅白开局包，玩的人多了再加。
- 部署已完成，台账已更新。更新流程见 VPS 台账 vps-02 档案的 throne 一节；配置文件在 `deploy/vps-02/`（nginx 1.20 要用 `listen ... ssl http2`，不支持 `http2 on`）。
- 试玩反馈之后：滑动手势，以及发小红书前要做的全站花费上限。

## 坑

- 开局包指纹包含 `shell-day.ts`。C 改存档路径时动过它，正好在建包开始后一分钟。所以这轮建完要再跑一遍 `npx tsx apps/web/server/opening-packs.ts --register=plain --groups=1 --verify`：已缓存的调用会直接命中，只补少数几次。之后别再碰指纹相关的文件，见 deployment.md 末段。
- `codex exec resume` 不带沙箱参数，续接的会话没有网络、也不能监听端口；依赖安装和起服务实测要 Claude 自己补。
- 新依赖 `happy-dom`：拉代码后要先跑 `npx -y pnpm@11.19.0 install`。
