# 开局包与调用指纹库（实现完成，待验收）

范围与命令见 [ADR 0012](../../architecture/0012-opening-packs-and-memorial-library.md)，本次不含通政司杂事库；未改 STATUS、AGENTS、CLAUDE、soul，未提交 Git。

根因是文书全局流水号、普通人物提示词中的 runId：前者使无关分支的文书编号错位，后者使同种子不同局号无法共享。新局开局事件记种子、包号和编号版本；文书按发件人／来源计数。旧事件无版本字段，仍用原规则重放。检查了经历序号、观察流水号、行动编号：人物经历只按本人的可见记录编号；全局观察编号用于内部关联、不直接入提示词；行动号仍是引擎内部全局编号，但经历与行动结果不把它交给人物；调查取证的随机判定仍依赖内部行动号，后续真实行动分支变化不承诺命中。本次保留所有真正可见的内容。

`call-cache.ts` 提供文件锁与原子写入；live 文本缓存完整请求，终端缓存整日最终决定和完整命令输出。失败或验证不合格不入库；命中记录新局的 episode、`cached: true`、零用量。模型名、参数、提示词、终端可读输入及工具实现都参与指纹。旧终端输入中不可见的 runId / decisionEpisodeId 不参与整日指纹。注入桩模型走独立命名空间，可指定 modelIdentity；修改桩实现或参数须改 identity，不能与真实模型混用。

`opening-packs.ts` 同时供命令和离线测试使用，覆盖 9 分支及默认路线上的独立预设分叉；每个分叉走正常会话、调度和验证。完整包才参加随机抽取，设置和语言必须匹配；全部抽过时重新从匹配池抽。局部冒烟包不会混入正式池。任意连续组合与不同阅读顺序仍可能现场调用，有限预跑不承诺整个游戏树命中。库在 gitignore 的 `runs/cache/`。中断留下的 `.lock` 有 pid 和时间；确认所有者退出后手动移走，不自动抢锁。预跑错误保留失败报告。

预设数据在 `packages/court/data/imperial-presets.ts`。网页、终端共用；特旨不打字仍使用引擎标准措辞。作者注单独存入事件并由御案和观战显示，旧档可省略。无票拟消息不提供留中菜单、汇总为已阅。未命中时通过进度接口／终端轮询显示实际在忙的人名，不暴露决策内容；命中不触发等待提示。

## 验收记录

离线验收：同种子请饷依拟／留中，浙江三人在第 1–5 天实际发生的调用指纹逐个相同；桩会互发私信，覆盖文书编号传播。改桑依拟／驳回使严嵩下一次输入不同。全包构建后换新局号一路依拟到第 5 天，全部命中、桩模型计数不增加。另测并发去重、失败／无效输出不入库、终端记录、作者注事件／重放／观战、旧档回放与菜单。

真实 DeepSeek **只跑一组浅白、归纳开启、依拟／依拟，到第 2 天**：

- 命令：`pnpm opening-packs --register=plain --groups=1 --default-only --days=2 --parallel=1 --verify`
- 包号：`a52b63a2-369d-4c23-b7f3-737739a505af`；验证局：`56c1e121-5d91-49be-aba0-f612baefb44f`。
- 建包 272,596 ms，13 次现场调用，未命中输入 30,470 tokens、供应商缓存输入 202,368 tokens、输出 63,464 tokens。
- 验证开启 `THRONE_CACHE_ONLY=1`，任何漏项直接报错，13/13 命中；开局 5 ms，第 1 天 20 ms，第 2 天 15 ms；新增模型费用 0。
- 调用发生于 2026-10-16 06:41–06:46 UTC，按 [DeepSeek 官方价格](https://api-docs.deepseek.com/quick_start/pricing/) 的高峰费率，估算 **US$0.086512008**（未查询账单实际扣费）。报告保留峰／谷两档估价和原始 usage。
- 报告：`runs/cache/reports/a52b63a2-369d-4c23-b7f3-737739a505af.json`、同名 `-verification.json`；存档可供本机观战。

全量真实建包按 brief 留待验收后另派。`pnpm format:check` 的全库检查发现未改动的 `docs/prompts/杂事奏疏库-提示词.md` 有既有格式问题；按“不碰杂事”边界未改它，也未加忽略规则。最终四项仓库检查结果见交接回复。

## 预跑范围收缩（实现完成，待验收）

验收后用户要求：保留九条主分支至第 5 天和第 0 天深思；预设只保留第 0–2 天召吕芳三句、向北京人物发问三句，每条只到下一朝会。旧 `presetEdicts` 将所有特旨参数做笛卡尔积且延伸到第 5 天，超过了“预设操作短等待”的预算。取消其余特旨预热，并加纯规划 `--plan`，共享执行任务定义，按已有冒烟数据粗估费用；本轮禁止真实建包。

实现：新增 `apps/web/server/opening-pack-plan.ts` 作为规划／执行共用的任务定义，移除 `presetEdicts` 的特旨笛卡尔积；构建报告记录每条实际到达的朝会天数。完整包固定 9 条长分支、36 条单日预设分叉，以及按种子确定的 5–10 条深思。本次不调用真实模型。估算以历史冒烟开局 2 次、两天后续 11 次为基础，推进日均 5.5 次，召见和深思各加一次；乘以历史每次平均费用，不扣跨分支命中。语体和模型行为可能改变实际费用，非上限。

离线回归覆盖实际执行终点、北京目标范围，以及用新局重走全部 36 条单日预设都命中；CLI 测试同时设置空密钥、仅缓存模式并带 `--verify`，确认 `--plan` 不进入建包／验证路径。

命令 `pnpm opening-packs --register=all --plan` 原始标准输出（本次未真实建包）：

```text
只规划，不调用模型、不写入缓存或开局包。
T1 浙江那边最近有什么动静？
T2 严嵩这几天在忙什么？
T3 宫里用度还撑得住吗？
Q1 浙江改稻为桑现在办得怎样？
Q2 新安江堤防挡得住端午汛水吗？
Q3 你那边钱粮还够不够？
估算依据：2026-10-16 浅白、归纳开启的冒烟到 day2 共13次（开局2次，其后均摊5.5次/推进日）；费用 US$0.043256004–0.086512008/13次。未扣指纹命中，按浅白样本外推各语体；不是报价或上限，终端整日计1次、不是HTTP请求数。
opening-plain-true-1
  准备：开局 → 默认 day2（共享，不计入分叉条数）
  主分支：follow_draft/follow_draft、follow_draft/hold、follow_draft/reject、hold/follow_draft、hold/hold、hold/reject、reject/follow_draft、reject/hold、reject/reject → day5
  深思：day0 消息 #1–#5，每条独立展开并深思
  day0 → day1：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day1 → day2：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day2 → day3：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  共 50 条 = 主分支 9 + 深思 5 + 召见 9 + 发问 27
  粗估 473 次整日/文本调用，US$1.57–3.15
opening-plain-true-2
  准备：开局 → 默认 day2（共享，不计入分叉条数）
  主分支：follow_draft/follow_draft、follow_draft/hold、follow_draft/reject、hold/follow_draft、hold/hold、hold/reject、reject/follow_draft、reject/hold、reject/reject → day5
  深思：day0 消息 #1–#7，每条独立展开并深思
  day0 → day1：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day1 → day2：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day2 → day3：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  共 52 条 = 主分支 9 + 深思 7 + 召见 9 + 发问 27
  粗估 475 次整日/文本调用，US$1.58–3.16
opening-plain-true-3
  准备：开局 → 默认 day2（共享，不计入分叉条数）
  主分支：follow_draft/follow_draft、follow_draft/hold、follow_draft/reject、hold/follow_draft、hold/hold、hold/reject、reject/follow_draft、reject/hold、reject/reject → day5
  深思：day0 消息 #1–#10，每条独立展开并深思
  day0 → day1：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day1 → day2：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day2 → day3：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  共 55 条 = 主分支 9 + 深思 10 + 召见 9 + 发问 27
  粗估 478 次整日/文本调用，US$1.59–3.18
opening-plain-true-4
  准备：开局 → 默认 day2（共享，不计入分叉条数）
  主分支：follow_draft/follow_draft、follow_draft/hold、follow_draft/reject、hold/follow_draft、hold/hold、hold/reject、reject/follow_draft、reject/hold、reject/reject → day5
  深思：day0 消息 #1–#10，每条独立展开并深思
  day0 → day1：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day1 → day2：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day2 → day3：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  共 55 条 = 主分支 9 + 深思 10 + 召见 9 + 发问 27
  粗估 478 次整日/文本调用，US$1.59–3.18
opening-plain-true-5
  准备：开局 → 默认 day2（共享，不计入分叉条数）
  主分支：follow_draft/follow_draft、follow_draft/hold、follow_draft/reject、hold/follow_draft、hold/hold、hold/reject、reject/follow_draft、reject/hold、reject/reject → day5
  深思：day0 消息 #1–#8，每条独立展开并深思
  day0 → day1：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day1 → day2：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day2 → day3：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  共 53 条 = 主分支 9 + 深思 8 + 召见 9 + 发问 27
  粗估 476 次整日/文本调用，US$1.58–3.17
opening-plain-true-6
  准备：开局 → 默认 day2（共享，不计入分叉条数）
  主分支：follow_draft/follow_draft、follow_draft/hold、follow_draft/reject、hold/follow_draft、hold/hold、hold/reject、reject/follow_draft、reject/hold、reject/reject → day5
  深思：day0 消息 #1–#6，每条独立展开并深思
  day0 → day1：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day1 → day2：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day2 → day3：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  共 51 条 = 主分支 9 + 深思 6 + 召见 9 + 发问 27
  粗估 474 次整日/文本调用，US$1.58–3.15
opening-classical-true-1
  准备：开局 → 默认 day2（共享，不计入分叉条数）
  主分支：follow_draft/follow_draft、follow_draft/hold、follow_draft/reject、hold/follow_draft、hold/hold、hold/reject、reject/follow_draft、reject/hold、reject/reject → day5
  深思：day0 消息 #1–#6，每条独立展开并深思
  day0 → day1：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day1 → day2：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day2 → day3：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  共 51 条 = 主分支 9 + 深思 6 + 召见 9 + 发问 27
  粗估 474 次整日/文本调用，US$1.58–3.15
opening-classical-true-2
  准备：开局 → 默认 day2（共享，不计入分叉条数）
  主分支：follow_draft/follow_draft、follow_draft/hold、follow_draft/reject、hold/follow_draft、hold/hold、hold/reject、reject/follow_draft、reject/hold、reject/reject → day5
  深思：day0 消息 #1–#6，每条独立展开并深思
  day0 → day1：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day1 → day2：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day2 → day3：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  共 51 条 = 主分支 9 + 深思 6 + 召见 9 + 发问 27
  粗估 474 次整日/文本调用，US$1.58–3.15
opening-modern-true-1
  准备：开局 → 默认 day2（共享，不计入分叉条数）
  主分支：follow_draft/follow_draft、follow_draft/hold、follow_draft/reject、hold/follow_draft、hold/hold、hold/reject、reject/follow_draft、reject/hold、reject/reject → day5
  深思：day0 消息 #1–#8，每条独立展开并深思
  day0 → day1：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day1 → day2：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day2 → day3：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  共 53 条 = 主分支 9 + 深思 8 + 召见 9 + 发问 27
  粗估 476 次整日/文本调用，US$1.58–3.17
opening-modern-true-2
  准备：开局 → 默认 day2（共享，不计入分叉条数）
  主分支：follow_draft/follow_draft、follow_draft/hold、follow_draft/reject、hold/follow_draft、hold/hold、hold/reject、reject/follow_draft、reject/hold、reject/reject → day5
  深思：day0 消息 #1–#10，每条独立展开并深思
  day0 → day1：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day1 → day2：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  day2 → day3：召吕芳 T1–T3；严嵩、吕芳、陆炳各问 Q1–Q3（12 条）
  共 55 条 = 主分支 9 + 深思 10 + 召见 9 + 发问 27
  粗估 478 次整日/文本调用，US$1.59–3.18
合计 10 组，526 条分叉；粗估 4756 次调用，US$15.83–31.65。
```

本轮验收：`pnpm test` 35 个文件、183 项通过；`pnpm typecheck`、`pnpm format:check`、`pnpm build` 全通过（构建仅有既有体积提示）。未运行真实建包，未提交 Git，未改 STATUS。
