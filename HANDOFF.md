# HANDOFF：能给朋友看的小里程碑

写于 2026-10-06，分支 `feat/jiajing-court`（已推送）。先按 AGENTS.md 读 STATUS。要做的是 [FEAT-0010](docs/issues/active/playability.md) 第一部分里的三件，都基本不碰引擎：

1. **观战模式**：用已有存档逐日翻看一局，皇帝所见与实情可切换，所想 / 所言 / 所为并排；终端操作记录可并排显示（大臣翻旧档、在 /tmp 起草、撤回重写）。做成静态页，不需要密钥。
2. **README 卖故事**：一句话、一段真实对局的言行反差、两个入口（先看一局 / 自己当皇帝：命令、密钥、大致时长与花费）。架构文档往后放。
3. **结局卡**：御批式总结（谁欺瞒了你、揭穿了几个、最精彩的一段反差）。

## 素材（`runs/court/`，gitignored）

- 完整对局（一次填表时代，无终端记录）：`39c4f396`（第三局，有司礼监与陆炳）、`4b7d7ed4`（第二局）、`c870c0f1`（首局，郑泌昌掘堤被锦衣卫揭穿）。实玩记录在 `docs/issues/archive/`。
- 终端模式 15 日短局，带终端记录：`fe975e4d`（旧精力数值）、`d9f36214`（现行数值）。
- 静态页要带的对局须导出精简后放进仓库：存档最大 25MB，大部分是每次决策的完整输入。

## 存档里有什么

`SavedCourtRun`（`apps/web/server/court-service.ts`）：`records` 是事件，`replay` 可重建任意时刻的状态；`state.decisions[]` 每条有 `input`（人物当时所见）和 `output`（内心、文书、行动等）；`calls[]` 是模型调用记录，按 `decisionEpisodeId` 对应。终端日的调用带 `terminal: { nudged, steps: [{ command, output, isError }] }`，每条输出只存前 1500 字，`shellReplay(decision.input, commands)`（`packages/court/src/shell.ts`）可还原完整输出。服务端已有局终复盘接口 `review` / `replay` 可参考。

## 本轮已定（2026-10-06）

- 人物经假终端过一天，写信做事花精力（每日 1 点，上限 3 点）：[ADR 0008](docs/architecture/0008-terminal-actors.md)，实验与实玩数据见 [FEAT-0009](docs/issues/active/agent-shell.md)。
- 锦衣卫只听皇帝；私信只送 LLM 人物：ADR 0007。
- 成本护栏维持 240 次常规决策（用户：DeepSeek 便宜，不改）。

## 待用户

名场面清单（FEAT-0010）；局中揭穿、财政（C）、年终内阁会议（D）的取舍与排期；公开仓库命名。

## 环境与坑

- 没有全局 pnpm，用 `npx -y pnpm@11.19.0 <script>`。开发服务用 `.claude/launch.json` 的 `throne-web`（端口 4173），可能被别的会话占着。`packages/*` 或 `apps/web/server` 改动会让开发服务重启，进行中的推进丢失（存档还在）。
- 代玩：`npx tsx apps/web/server/court-autoplay.ts [天数]` 直接驱动 CourtService，不需要开发服务；推进一日约 1–2 分钟。终端日的现场在 `runs/runtime/shell-*/`（世界快照、命令记录、模型事件）。
- 密钥在 gitignored 的 `secret/deepseek.txt`；真实调用要联网，受沙箱限制的命令要放开。
- `THRONE_NPC_MODE=form` 切回一次填表。
