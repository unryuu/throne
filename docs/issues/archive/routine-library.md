# 杂事奏疏库接入（完成，2026-10-16）

差距：`generateFacts` 只确定杂事类别，`composeBureau` 再让模型自拟；归纳与作者注也没有人工内容入口。库多来源且持续增长，必须区分来源编号、过滤时令，并让已抽内容随事件存档。

方案：court 内纯解析器；服务端按文件名排序加载顶层 Markdown 并报告校验警告。会话注入库，抽取结果整条写入 fact，文书直接取相应语体及 gloss；深思照常调用模型，作者注优先取 fact 快照。未注入或可用条目耗尽保留原路径。现有文书视图需显式遵守归纳开关，因为此前关闭归纳时根本不会生成 gloss。

入口与库格式见 [ADR 0012](../../architecture/0012-opening-packs-and-memorial-library.md)。验收覆盖解析、确定性抽取、模型调用隔离、存档重放及服务端开局链路。

实现文件：`packages/court/src/routine-library.ts` 是纯解析器；`information.ts`、`model.ts`、`session.ts`、`types.ts` 接入抽取与快照，`views.ts` 保持归纳开关。服务端 `routine-library.ts` 加载器及 CLI、`court-service.ts` 与 `opening-packs.ts` 覆盖所有生产开局入口；终端 main 和 autoplay 经 CourtService，`tui/local.ts` 只列存档／打开观战，无会话构造点。服务端会话延迟加载且每会话只加载一次，恢复、回放和深思不读库。

校验两套标题和正文，字数按 Unicode 码点计（含标点）；作者注可缺省或空白，超长保留并警告。文件名按代码点排序，标题在全库去重，来源/编号重复也跳过。未命名来源的文件以完整文件名（含 `.md`）为来源。已接受的条目决定重复项保留顺序，读取失败显式抛错。

验收：`npx vitest run` 37 文件、208 项通过（新增 25 项）；`npx tsc --noEmit`、`npx prettier --check .` 通过；分别在 `apps/web`、`apps/spectator` 执行 `npx vite build --configLoader runner` 通过，网页仅有既有 chunk 体积提示。覆盖全库杂事零调用、混合事实仅模型处理非库部分、现代／浅白／文言、归纳显示开关、作者注回退与覆盖、跨天不重复、时令边界、耗尽回退、无库恢复及加载器目录过滤；原有旧档、开局包缓存回归也通过。未调用真实模型或付费建包，未改 STATUS、AGENTS、CLAUDE、soul，未提交 Git。

开发期间库目录由外部持续增补 Claude 稿件，从 brief 的 215 条变为 415 条；收尾实际加载 390 条（原有 ChatGPT／DeepSeek 203 条）。25 条跳过：DeepSeek 重名 12 条、Claude 超长 13 条；另有作者注超长警告 11 条。库仅做 Prettier 格式化，没有修改条目措辞；最新批次格式化前后解析结果完全一致。

自检命令：`npx tsx apps/web/server/routine-library.ts`，以下为收尾实际输出：

```text
杂事奏疏库：加载 390 条
来源：
  chatgpt：100
  claude：187
  deepseek：103
类别：
  九边军报：38
  钦天监天象：35
  斋醮供用：38
  别省雨水：38
  驿站马匹：38
  宗室请封：34
  言官弹章：39
  地方祥瑞：35
  漕运过闸：34
  京城米价：32
  其他：29
可信度：
  虚构：87
  化用：242
  据实：61
警告：36 条
claude - 010.md: claude/R006: 跳过：「现代标题」22字，超过20字
claude - 010.md: claude/R008: 跳过：「现代标题」21字，超过20字
claude - 070.md: claude/R047: 跳过：「现代正文」123字，超过120字
claude - 070.md: claude/R052: 跳过：「现代标题」23字，超过20字
claude - 100.md: claude/R084: 跳过：「现代标题」22字，超过20字
claude - 100.md: claude/R086: 跳过：「现代标题」22字，超过20字
claude - 100.md: claude/R096: 跳过：「现代标题」21字，超过20字；「现代正文」123字，超过120字
claude - 130.md: claude/R102: 跳过：「现代标题」21字，超过20字
claude - 130.md: claude/R117: 跳过：「现代标题」22字，超过20字
claude - 130.md: claude/R129: 跳过：「现代标题」21字，超过20字
claude - 160.md: claude/R134: 跳过：「现代标题」21字，超过20字
claude - 160.md: claude/R146: 跳过：「现代正文」121字，超过120字
claude - 190.md: claude/R178: 跳过：「现代标题」22字，超过20字；「现代正文」121字，超过120字
deepseek - 010.md: deepseek/R010: 作者注64字，超过60字（仅警告）
deepseek - 040.md: deepseek/R014: 作者注82字，超过60字（仅警告）
deepseek - 040.md: deepseek/R016: 作者注61字，超过60字（仅警告）
deepseek - 040.md: deepseek/R019: 作者注70字，超过60字（仅警告）
deepseek - 040.md: deepseek/R020: 作者注69字，超过60字（仅警告）
deepseek - 040.md: deepseek/R025: 作者注77字，超过60字（仅警告）
deepseek - 040.md: deepseek/R027: 作者注62字，超过60字（仅警告）
deepseek - 040.md: deepseek/R033: 作者注62字，超过60字（仅警告）
deepseek - 080.md: deepseek/R055: 作者注67字，超过60字（仅警告）
deepseek - 080.md: deepseek/R066: 跳过：标题重复，保留先出现的 deepseek/R008
deepseek - 080.md: deepseek/R072: 跳过：标题重复，保留先出现的 deepseek/R038
deepseek - 080.md: deepseek/R078: 作者注61字，超过60字（仅警告）
deepseek - 115.md: deepseek/R101: 跳过：标题重复，保留先出现的 deepseek/R067
deepseek - 115.md: deepseek/R102: 跳过：标题重复，保留先出现的 deepseek/R008
deepseek - 115.md: deepseek/R104: 跳过：标题重复，保留先出现的 deepseek/R034
deepseek - 115.md: deepseek/R105: 跳过：标题重复，保留先出现的 deepseek/R036
deepseek - 115.md: deepseek/R106: 跳过：标题重复，保留先出现的 deepseek/R037
deepseek - 115.md: deepseek/R107: 跳过：标题重复，保留先出现的 deepseek/R038
deepseek - 115.md: deepseek/R109: 跳过：标题重复，保留先出现的 deepseek/R076
deepseek - 115.md: deepseek/R110: 跳过：标题重复，保留先出现的 deepseek/R074
deepseek - 115.md: deepseek/R113: 跳过：标题重复，保留先出现的 deepseek/R077
deepseek - 115.md: deepseek/R114: 作者注62字，超过60字（仅警告）
deepseek - 115.md: deepseek/R114: 跳过：标题重复，保留先出现的 deepseek/R078
```
