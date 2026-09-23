# 当前功能

当前无已开工功能。FEAT-0005 已完成：[连续决策短局及两局实玩](archive/continuous-crisis.md)。现行规则见 [ADR 0005](../architecture/0005-continuous-crisis.md)。

FEAT-0001 已完成，见 [归档](archive/live-npc.md) 与 [首次实玩](archive/live-playtest-2026-09-21.md)。

FEAT-0004 已完成，结果见 [归档](archive/appointments.md)；现行规则仍在 [ADR 0003](../architecture/0003-appointment-layer.md)，开发任命机制时按需读取。

原 FEAT-0002 / 0003 并入可靠性修复，不单独扩大为全项目类型系统重构。

## 待评估（proposed ADR）

- FEAT-0006 资源与财政层，设计见 [ADR 0002](../architecture/0002-resource-and-fiscal-layer.md)。前置：无。
- FEAT-0007 问责与有据罢免，设计见 [ADR 0006](../architecture/0006-accountability-and-removal.md)。前置：FEAT-0006、任命层（已完成）。
- FEAT-0008 角色与关系契约 v2，设计见 [ADR 0007](../architecture/0007-actor-and-relationship-contract.md)。前置：无。
- FEAT-0009 党争路线与变法平衡，设计见 [ADR 0008](../architecture/0008-factional-reform-and-balance.md)。前置：FEAT-0006、0007、0008。
- FEAT-0010 恩庇与腐败网络（多级贿赂 / 利益输送 / 结党营私），设计见 [ADR 0009](../architecture/0009-patronage-and-corruption-networks.md)。前置：FEAT-0006、0007、0009。

以上均扩大 SPEC 范围（§7/§21/§26），需设计评审通过后再实现。

## 实现进展（fork 最小切片）

以下为在 fork 中按 ADR 落地的可运行最小切片，尚未合入上游，也未迁移既有场景：

- FEAT-0006 资源与财政层：`packages/shared-types/src/resources.ts` + `packages/scenario-mvp/src/fiscal.ts`（账户、流量、上报/审计分离、守恒与非负校验）。
- FEAT-0007 问责与有据罢免：`packages/shared-types/src/accountability.ts` + `packages/scenario-mvp/src/accountability.ts`（finding、证据强度、`deriveResistanceToRemoval`，有据罢免抵抗低于随意罢免）。
- FEAT-0008 角色与关系契约 v2：`packages/shared-types/src/actor-contract.ts`（`MotivationProfile`、十一类关系 + valence、派生立场）；既有 `PersistentActor` 暂未替换。
- FEAT-0009 党争路线与变法平衡：`packages/scenario-mvp/src/faction-reform.ts`（政策/规则/派生支持与抵抗）+ `packages/scenario-mvp/src/court.ts`（契约 v2 + 财政 + 问责 + 派系集成）。

### 贿赂与 AI 决策边界（7 项改动）

- 契约：`BribeOfferView` 只含角色可见事实（金额、对象、自身动机、关系、可选检测提示），引擎不再下发算好的 benefit/risk。
- 策略：`packages/agent-runtime/src/bribe-policy.ts`（`HeuristicBribePolicy`、`RecordedBribePolicy`、`HarnessBribePolicy` + `assertActorInstructions`、结构化激励系统提示）。
- 复现/失败：`RecordedBribePolicy` 缺失记录即抛错；harness 失败不回落默认（无兜底）。
- 供应商探针：`docs/providers.md` 规则 7。
- 对照夹具：`packages/scenario-mvp/src/bribe-comparison.ts`（同局对比清廉/腐败审计官）。
- 统一行动空间：`packages/agent-runtime/src/actor-action.ts` + `packages/scenario-mvp/src/strategy-court.ts`（官员在 lobby/bribe/report/obey/defect 中自行选择，`canAttempt` 校验）。
- 集成：`grand-court.ts` 接入贿赂（收买审计官 → 洗白审计 / 压案 / 罢免降级）。

### 恩庇与腐败网络（FEAT-0010 最小切片）

- 契约：`BribeRecord` 增加 `chainId` / `parentBribeId` / `instruction`；新增 `ObligationRecord`。
- 归约/派生：`bribe.passed_on` 以子报价（带 `parentBribeId`）表示；`obligation.incurred`；`deriveBriberyChain`、`derivePatronageShare`、`deriveObligations`、`deriveProtectionScore`。
- 场景：`packages/scenario-mvp/src/network-court.ts` —— 上级行贿监管 → 监管转包 → 审计被洗白 → 立案 → 派系庇护（disputed）→ 独立审计反挖整条链（按跳立案）→ 有据追责（exposed + prosecution）。
- 验证：链 depth=1 / hops=2 / totalValue=70；patron share=50；protection=0.56；corruption 2 条；暴露后 findings=4、removals=4（均 evidence）；回放一致。
- 三层延伸：`packages/scenario-mvp/src/three-tier-court.ts` —— 皇帝(L1) → 宰执/台谏(L2) → 州县(L3)；变法裁决 → 逐级执行(实缴/侵吞/虚报) → 跨级贿赂链(governor→censor→magistrate) → 洗白审计 → 反挖暴露 → 逐跳有据追责。
- 周期与权力消长：`packages/scenario-mvp/src/policy-cycle.ts` —— 周期性朝议（SPEC §9.1 的最小实现）；政策反复摇摆（新法↔旧法），皇帝权威与派系权力互为反馈：强帝有据 → 权威升、政策在其掌控下摆动；弱帝搁置 → 权威崩、政策由大臣 imposed。派生量 `deriveAuthority`、`deriveFactionPower`（非单一权力标量）。
- 官僚体系：`packages/scenario-mvp/src/bureaucracy-cycle.ts` —— 1 皇帝 + 5 大臣 + 25 州县（5×5 名册）；每轮**显式游说**（`minister.lobbied`，谁拉谁可见）；**党派差异化贪腐**（变法派虚报高、守旧派侵占高，`deriveFalsification`/`deriveGraftRate`）；**级联聚合**（25 官各自实缴/上报 → 大臣汇总 → 皇帝只见顶层，上报 > 实际）。
- 信念驱动决策（接大模型的钩子）：`packages/agent-runtime/src/official-policy.ts`（`OfficialDecisionPolicy` + `HeuristicOfficialPolicy` / `RecordedOfficialPolicy` / `HarnessOfficialPolicy`）+ `packages/scenario-mvp/src/official-belief.ts`（按角色可见信息构造 context；`strategy → 参数` 映射）。要点：**同一官员动机相同，仅因"对风险的认知"不同就采取不同策略**（感知被查→`request_information`；不知有查→`exaggerate`/`both`）；引擎掌数值，LLM 只选路线。换 LLM 适配器即可接真实 API。
- 官僚体系三条反馈（每轮演化）：`bureaucracy-cycle.ts` 接上 **政策压力**（执政派按 `ruleStreak` 加码）、**审计暴露**（逢单轮查违规最重的 3 官+其大臣，下轮其感知上升而收敛）、**影响力滚雪球**（执政大臣每轮 +0.1、在野 -0.1，并作为下属的"庇护"）。派生 `offenceContext` 综合三者；实测 6 轮实际入库 60.2→63.16→63.6→66.56→63.58→66.62 逐轮不同。
- 官僚体系长期演化（200 轮不静止）：新增 **政策翻转反向力**（执政越久 → 全体游说偏置逆向漂移 → 规则可回退）、**影响力均值回归**（不再顶到 2.0/0.1，而是收敛后随执政方来回）、**周期性外生冲击**（每 12 轮：整肃/危机/大赦）。实测 200 轮中规则在新法/旧法间多次翻转，影响力与失真持续波动，781ms 跑完。
- 官僚体系 2000 轮 + 个体化 + 随机冲击：见 [实现记录](archive/bureaucracy-cycle.md)。要点：每官持久 `trait`（收入各不相同）、`caution` 衰减（修掉换挡锯齿）、`externalShock(seed,round)` 随机冲击；2000 轮政策翻转 192 次、冲击 142 次。**已知 O(n²) 性能问题**（`ledger`/`timeline` 存于状态内，内核每步深克隆）。

验证：`pnpm test`（28 文件 / 121 测试）、`pnpm typecheck`、`pnpm build` 均通过。
