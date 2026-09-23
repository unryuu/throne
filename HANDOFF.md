# HANDOFF：嘉靖朝后续切片

写于 2026-09-23，分支 `feat/jiajing-court`（已推送）。先按 AGENTS.md 读 STATUS；设计意图见 [DESIGN §11–12](docs/DESIGN.md#12-朝局节奏两道闸与财政2026-09-23-确认)，现行规则见 [ADR 0006](docs/architecture/0006-court-memorials.md)，首次实玩见[归档](docs/issues/archive/court-playtest-2026-09-23.md)。代码在 `packages/court`（引擎与场景）和 `apps/web`（`court-play.tsx`、`server/court-service.ts`）。

按 A → B → C → D 的顺序做。每个切片都在 docs/issues 登记，做完实玩一局，结果写进归档。

## A. 直接修（已完成）

结果与第二局实玩见 [BUG-0007 归档](docs/issues/archive/court-slice-a.md)，其中有留给 B 的观察。

## B. 司礼监与每日决策点（已完成）

规则见 [ADR 0007](docs/architecture/0007-directorate-daily-court.md)；实玩与遗留见 [FEAT-0007 归档](docs/issues/archive/court-directorate.md)。开始 C 之前，先请用户定护栏与吕芳调用频率。

## C. 财政第一步

按 DESIGN §12：设置有主人的账户（太仓、内帑、织造局、浙江藩库、军饷、沈一石、LLM 人物私囊），银与粮两种。转移需要时间，经手者可以截留（关键人物由 LLM 决定，小吏按固定比例）。欠账到期产生后果。奏报与账实可以不符，查账是一种调查能力。修玄花内帑。现有的 `granary / militaryGrain / merchantGrain / merchantSilverSpent` 迁移到账户里；沈一石的垫款变成要还的债。收入只做田赋（受灾减收）、盐课、丝绸（秋后到账）、商税，用简单的季节公式。

## D. 年终内阁会议开局（已认可，C 之后做）

开局改为年终内阁会议，改稻为桑是第一件被公开讨论的事。每个人的前情（知道多少、怎么知道、私下安排，嘉靖可能已私下点头）是开局前已确立的事实，不能事后编造。多人会议分轮发言，控制轮数。嘉靖可以亲临，也可以不去、听吕芳转述。徐阶、严世蕃成为 LLM 人物。时间线会拉长到端午之后，要靠闭关跳日控制节奏。

## 环境与坑

- 本机没有全局 pnpm，用 `npx -y pnpm@11.19.0 <script>`。开发服务用 `.claude/launch.json` 里的 `throne-web`（端口 4173）。
- 开发服务在 `packages/*` 或 `apps/web/server` 的代码被修改时会自动重启，进行中的推进会丢失（存档还在，可以重试）。实玩期间不要改服务端代码。
- 密钥在 gitignored 的 `secret/deepseek.txt`。真实调用需要联网，受沙箱限制的命令要放开。
- thinking=high 时 reasoning 会吃掉输出额度；court 调用的上限是 32K。
- 需要交回用户决定的：两道闸具体规则的取舍、每日决策点的数量与节奏，以及任何扩大人物或范围的改动。
