# HANDOFF：做成网页游戏，开局包已就位，下一步接杂事库

写于 2026-10-16 凌晨，分支 `feat/jiajing-court`，已推送，未合 `main`。先读 STATUS.md、[ADR 0012](docs/architecture/0012-opening-packs-and-memorial-library.md) 和 [opening-packs](docs/issues/active/opening-packs.md)。

## 和用户定下的

- 做成网页在线小游戏。用户出钱，不设邀请码，但要有全站每日花费上限和按 IP 限开局（超了显示“今日国库已空”）。网页和后端都放 `1566.unryuu.top`（已解析到 vps-02，香港，个人机）。
- 用户判断多数人只玩一两天，所以先把开局做顺，后期等久点可以接受。
- 网页版默认浅白。开局包浅白 6 组，文言、现代各 2 组。
- 长期意图：大模型和古典文字游戏互补（已记入 Claude 记忆）。
- 崇祯是将来的事，构想记在 [docs/chongzhen.md](docs/chongzhen.md)，现在不做。

## 这一窗口做完的（Codex 开发，Claude 验收）

指纹缓存、新局文书按发件人编号、种子与局号分开、开局包构建与抽包、召吕芳 / 发问预设、深思附“游戏作者注”、留中改措辞（无票拟的记“已阅”）、等待时显示谁在忙。真实冒烟 13/13 命中，开局和退朝都是毫秒级。建包每组约 50 条分叉，`--plan` 粗估 10 组共 US$16–32。

## 下一步（按顺序）

1. **接杂事库。** 用户正在用网页版 Claude 按 [提示词](docs/prompts/杂事奏疏库-提示词.md) 写，导出的 markdown 放进 `packages/court/data/routine/`。先让用户确认写完、审过。然后交给 Codex：按提示词里的固定格式解析、校验字段和字数；按种子不放回抽取，参考时令；公文体给文言 / 浅白档，现代版给现代档；自带归纳，不进通政司和归纳调用；当天全是杂事时通政司不调模型；库抽完了退回模型自拟；作者注在深思这条时显示。ADR 0012 已写明。
2. **全量建包**：`npx tsx apps/web/server/opening-packs.ts --register=all`，先 `--plan` 看账。必须在第 1 步之后，因为杂事库会改变指纹。建完用 `--verify` 抽查命中。
3. **网页前端**：以 `apps/web/tui/state.ts` 的纯函数状态机为核心，键盘手感照旧；触屏：点 = 选中加回车，边缘右滑 = 返回，卡片横滑 = 依拟（参考《王权》Reigns），底部拇指按钮。长期只留这一套，老的 `court-play.tsx` 逐步退掉。
4. **部署到 vps-02**：先读 `~/Desktop/claude/VPS/README.md`。台账规矩：只读巡检随便做，改机器状态先问用户；手工起的 vela 进程别碰；做完更新台账。要装 nginx 和证书，`runs/`（含 `runs/cache/`）放持久盘，加花费上限。
5. 以后再说：北京三人的东西在朝会中途送到（做崇祯时一起做）。

## 待用户

- 杂事库写完、审完。
- 亲自玩一局：上一份 HANDOFF 留下的，还没玩。
- 什么时候合进 `main`：合进去会触发观战页部署。
- 已发布的结局卡要不要标“开发者代拟”（老遗留）。

## 踩过的坑

- Claude 的 shell 里没有 `pnpm`。用 `npx vitest run`、`npx tsc --noEmit`、`npx prettier --check .`、在各 app 目录跑 `npx vite build --configLoader runner`、`npx tsx apps/web/server/opening-packs.ts`。
- `codex exec resume` 不接受 `-C`，要先 `cd` 到项目目录再跑。
- 指纹里包含提示词和 `rules.ts`、`shell.ts` 等代码的哈希。改了这些，开局包就整批失效（会退回现场调用，不会出错）。所以发布前重建。
- 留中在引擎里是终局：之后不能再批这份，只能另发特旨。
