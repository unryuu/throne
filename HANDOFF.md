# HANDOFF：人物 agent 化与锦衣卫规则

写于 2026-10-06，分支 `feat/jiajing-court`（已推送）。先按 AGENTS.md 读 STATUS。嘉靖朝现行规则见 [ADR 0006](docs/architecture/0006-court-memorials.md) 与 [ADR 0007](docs/architecture/0007-directorate-daily-court.md)，三局实玩见 `docs/issues/archive/`。代码在 `packages/court`（引擎与场景）、`apps/web`（`court-play.tsx`、`server/court-service.ts`）、`packages/agent-runtime`（DeepSeek Harness 调用）。

## 接下来（用户定的顺序）

1. ~~假终端小实验~~：已完成（2026-10-06），结果与留给引擎设计的问题见 [FEAT-0009](docs/issues/active/agent-shell.md)。
2. ~~锦衣卫规则~~：已完成（2026-10-06），规则记在 ADR 0007。
3. **核心引擎的 agent 化实现**：依小实验结果设计。

原 HANDOFF 的 C（财政账户）、D（年终内阁会议开局）仍在计划中，排在 agent 化之后，见 DESIGN §12。

## 本轮已定或已查明（2026-10-06）

- **提示词缓存**（[FEAT-0008](docs/issues/active/prompt-cache.md)）：已改为“不变的在前、只追加的经历在中、当下在尾”。离线估算可命中前缀从 4–7% 升到 84–95%；下次实玩核对 DeepSeek 返回的真实命中数。缓存只省输入：第三局输出 111 万 token 里 90 万是思考，调用次数仍是成本大头。
- **行动力**：用户认可“写信、拜访、做事都有代价”的方向。提议的数字未定：每人每日 2 点，写信、上奏、做一件事、拜访各 1 点，最多攒 4 点；本职工作（票拟、处置本章、转呈原报）不花；皇帝不受限。agent 化后直接做成工具扣点，不在旧结构里先做。
- **agent 化构想**：引擎是循环，维护客观状态；人物是按日行动的 agent，经工具查询、提交意图。同一天内大家看到当天开始时的世界，意图在日终统一结算。写信、拜访、暗中调查都经引擎递送，引擎不解读内容；“命令本身不产生效果”不变。拜访：同城、可被拒，别人可能知道“见过”但不知内容。
- **关系系统**：朝廷场景没有实现，关系只是档案里的文字。等拜访、请托做出来，再让关系决定别人肯不肯替你办事。
- **严嵩为何“派锦衣卫”**：他的票拟正文是“锦衣卫见在查勘……着浙直总督就近覆勘”，结构化字段却填了锦衣卫，引擎照字段派了人。根源是一份票拟只能带一个结构化敕令。他知道锦衣卫在查，是陆炳第 36 日写信告诉的。
- **护栏 240 不够用**：第三局第 73 日用完。数值等 agent 化和行动力落地后再定。

## 环境与坑

- 本机没有全局 pnpm，用 `npx -y pnpm@11.19.0 <script>`。开发服务用 `.claude/launch.json` 的 `throne-web`（端口 4173）；端口可能已被别的会话的服务占着，先确认那个服务是否在用。
- 开发服务在 `packages/*` 或 `apps/web/server` 改动时自动重启，进行中的推进会丢失（存档还在，可以重试）。实玩期间改代码会打断对局。
- 实玩用临时脚本经 `/api/court` 的 `rescript`、`act`、`retry` 接口代玩，脚本不在仓库里；请求要带 `X-Throne-Client: local`，地址用 `127.0.0.1`。
- 密钥在 gitignored 的 `secret/deepseek.txt`。真实调用需联网，受沙箱限制的命令要放开。
- 模型会把回复模板里的可选字段留空或填 null，schema 必须容忍。
- harness 版本是 0.1.5-rc.2；dsh-anchored-standard 基于 0.1.3，插件接口要先核对。
