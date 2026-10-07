# HANDOFF：观战里程碑之后

写于 2026-10-06，分支 `feat/jiajing-court`。先按 AGENTS.md 读 STATUS。

## 刚做完

[FEAT-0010](docs/issues/active/playability.md) 第一部分的三件：观战页 `apps/spectator`、结局卡、README 改为讲故事。做法与取舍写在 FEAT-0010“已做”一节，导出原理在 [architecture overview](docs/architecture/overview.md) 末段。这一轮没有调用模型。

## 候选的下一步（未排期，待用户挑）

1. **自己玩的局也能观战**：开发服务提供 `buildChronicle` 的结果，局终复盘链到观战页。不调模型。
2. **局后说书人**：局终调一次模型，挑出最有戏的几段并起标题，自动生成结局卡的欺瞒名单和反差；现在这些是手选的（`apps/spectator/src/runs.ts`）。
3. **用现行终端模式重跑一局完整对局**，戏好就换成观战页的主推局。约 76 天，每天 1–2 分钟，要花 DeepSeek。
4. 局中揭穿（对质、召见套话、调阅账簿）、财政（切片 C）、年终内阁会议（切片 D），见 FEAT-0010。

## 待用户

名场面清单；上面几项的取舍与排期；公开仓库命名（README 暂用“Throne · 嘉靖朝模拟器”，注明灵感来自《大明王朝1566》）。

## 环境与坑

- 没有全局 pnpm，用 `npx -y pnpm@11.19.0 <script>`。`throne-web` 端口 4173，`throne-spectator` 端口 4174（`.claude/launch.json`）。预览工具启动 `throne-spectator` 时出现过服务没起来、日志为空的情况，手动 `npx -y pnpm@11.19.0 spectator` 正常。
- 加一局到观战页：`npx tsx apps/spectator/scripts/export-run.ts <局号> <slug>`，再在 `runs.ts` 登记标题、说明和名场面；`runs.test.ts` 会核对引文是否为人物原话。引擎新增事件类型时，导出会报错，需要在 `chronicle.ts` 里决定怎么显示。
- 代玩：`npx tsx apps/web/server/court-autoplay.ts [天数]`，不需要开发服务。存档在 gitignored 的 `runs/court/`，密钥在 `secret/deepseek.txt`；真实调用要联网。`THRONE_NPC_MODE=form` 切回一次填表。
