# 官僚体系与长期演化（bureaucracy-cycle）

状态：实现记录，2026-09-21。现行规则仍以 [SPEC](../../SPEC.md) 与相关 ADR 为准。

## 模块

`packages/scenario-mvp/src/bureaucracy-cycle.ts`：1 皇帝 + 5 大臣 + 25 州县（每臣 5 官）。

- 每轮四段：① 5 大臣**显式游说**（`minister.lobbied`，谁拉谁可见）→ ② 政策裁决 → ③ 25 州县执行（`official.executed`/`official.reported`）→ ④ `round.settled` 级联汇总。
- 州县级联聚合：25 官实缴/上报 → 大臣汇总 → 皇帝只见顶层，上报 > 实际。

## 党派差异化贪腐

- 变法派：高**虚报**（考核压力）；守旧派：高**侵占**（地方自主）。
- 派生函数：`deriveFalsification` / `deriveGraftRate`。
- 每名州县另有**持久个体偏差** `traitGraft` / `traitFals`（按 id 哈希，∈[-1,1]），使各州县收入不再一致（实测 25 官中不同实缴值 18 个）。

## 三条反馈（每轮演化）

1. **政策压力**：执政派按 `ruleStreak` 加码（`offenceContext`）。
2. **审计暴露**：逢单轮开查，暴露违规最重的 3 官 + 其大臣，记入 `audit.conducted`。
3. **影响力滚雪球 + 均值回归**：执政大臣每轮向执政方偏移但带均值回归（不封顶、来回），并作为下属的"庇护"（influence 越高 → 下属感知越低 → 越敢贪）。

## 长期演化的三个补充

1. **政策翻转反向力**：执政越久 → 全体大臣游说偏置逆向漂移 → 规则可回退（新法↔旧法）。
2. **谨慎度衰减**（`caution`，0.15/轮）：修掉了"换挡当轮一跳、下轮立刻精确回稳态"的锯齿。被查 +0.6、整肃 +0.7，逐轮衰减，效果为**渐进恢复**。
   - 根因：旧实现用"只影响下一轮"的二元开关 `exposedRound===round-1` + 同党参数全同 → 一次性跳变。现改为持久 `caution` + 个体 `trait`。
3. **随机外生冲击**：`externalShock(seed, round)` 按种子伪随机（可复现），每轮约 7% 概率触发**整肃 / 危机 / 大赦**（不再每 12 轮固定）。

## 实测

- 200 轮：政策翻转 32 次，随机冲击若干；无 20 轮后静止问题。
- 2000 轮（seed=`throne-2000`）：**政策翻转 192 次**（约每 10.4 轮），**外生冲击 142 次**（整肃 46 / 危机 61 / 大赦 35），皇帝权力 0.484–0.836，实际入库 54.2–67.2。
- 图：`throne-2000轮-随机冲击.svg`（桌面）。

## 已知性能问题

2000 轮耗时约 **92 秒**。根因：内核 `SimulationKernel.get state()` 每次 `structuredClone` 整个状态，而 `ledger`/`timeline` 存于状态内并随轮次增长 → **O(n²)**。
建议修法（未实施）：`ledger`/`timeline` 移出状态，改由 committed 记录派生；状态只留计数器。

## 验证

`pnpm test` 32 文件 / 142 测试全过；`pnpm typecheck`、`pnpm build` 通过；回放一致、不调模型。

## 待核（与 SPEC 的设计冲突）

见 [spec-conflict-review](./spec-conflict-review.md)。
