# 渠道口令与统计

状态：实现完成，待环境验收，2026-10-16。单口令无法区分来源、停用某渠道或统计转化/费用。改为每次请求校验 secret/passcodes.json；cookie 签入渠道和匿名访客，并与当前口令摘要绑定。

开局前按北京时间自然日、渠道串行检查并落盘占额，日志重建计数以支持重启；模型失败不退额度。日志只服务独立部署，不改变 Vite 本机入口。局归属创建渠道；旧局仅在首次写操作时绑定渠道，历史调用排除，单纯 GET 不计开局或费用。统计用每局累计用量去重，缺少用量显式标明未知，不伪装零费用。全站花费上限留在开局准入钩子，暂不实施。

不记录 IP、口令内容或游戏文本；报表采用开局包已有历史单价区间，不另查报价。部署、口径和验证收尾写入文档。

## 实现与口径

实现已完成，验收有两项环境阻塞。有效规则见 [deployment](../../deployment.md)，不重复维护。新加 passcodes.ts、analytics.ts、analytics-report.ts、model-cost.ts；CourtService 的可选生命周期钩子负责准入和存档后采样，归属/callOffset 随存档保存。预算错误在任何模型工作前返回；统计按逐局累计用量差值汇总。首次结局去重，日志含具体操作与模拟日。旧存档 GET 不产生归属或模型费，首次写操作排除之前的调用。

本次不改提示词/终端 actor 实现，未造成新的指纹缓存失效。未新增依赖，未修改用户 secret/ 文件、STATUS.md、AGENTS.md 或 CLAUDE.md，未提交 Git。日志写入和配额锁为单进程设计，按部署约定只起一个服务进程。

## 验证（2026-10-16）

- 新功能及原服务测试：口令热更新、多渠道 cookie、停用/改码吊销、匿名编号复用、秘密不入日志、开局 API 限额且零模型调用、并发配额/重启/北京时间跨日、日志损坏定位、已有局 GET 不计费/首次写操作绑定、真实 CourtService 推进/结局落盘、假事件文件报表及真正 CLI 子进程汇总均通过。所有模型测试使用假模型，未发起付费调用。
- `npx tsc --noEmit`、`npx prettier --check .` 通过。
- `npx vite build apps/web --configLoader runner`、`npx vite build apps/spectator --configLoader runner` 通过；Web 包含 desk.html。
- `npx vitest run`：43 个文件、239 项测试通过；手机前端 `apps/web/src/desk/app.test.tsx` 未启动，错误为 `Cannot find package 'happy-dom'`。合并后的 package.json / lockfile 已声明该依赖，但本机未安装。离线安装尝试因现有 modules 重建确认、只读 pnpm 缓存数据库而失败；未清空 node_modules 或修改锁文件。
- 本轮沙盒禁止监听 TCP：实际尝试 `127.0.0.1:4188` 返回 `listen EPERM`，不能执行真实 curl 验收。HTTP 集成测试改为通过真实 IncomingMessage/ServerResponse 在进程内调用请求监听器；Vite 使用真实 middleware、关闭 WebSocket，未跳过断言。这不是实际端口验证。

只读冒烟使用两个临时口令、临时 runs 和两个现有存档副本，无新开局或模型调用。实际命令：

```sh
node --import tsx /tmp/throne-channel-smoke.mts --listen
# Error: listen EPERM: operation not permitted 127.0.0.1:4188
node --import tsx /tmp/throne-channel-smoke.mts
# In-process handler smoke (no TCP listener / no curl)
# {"channel":"验收朋友圈","login":303,"read":200,"id":"d9f36214-9eba-4b1f-b7a4-de04111fb185","status":"waiting","calls":14}
# {"channel":"验收小红书","login":303,"read":200,"id":"b1742afd-a070-415d-91d9-7f8a0f9822a9","status":"complete","calls":201}
THRONE_RUNS_DIR=/var/folders/hn/t8j28rjd3w51gttynhxt2kg40000gn/T/throne-channel-smoke-aMgKXO/runs node --import tsx apps/web/server/analytics-report.ts
```

实际报表输出（省略口径说明）：

```text
渠道统计｜全部记录（北京时间）
| 渠道 | 访客 | 登录 | 开局 | 平均日数 | 结局率 | 模型调用 | token | 估算 US$ | 用量未知调用 | 未回写局 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 验收朋友圈 | 1 | 1 | 0 | — | — | 0 | 0 | 0.000000–0.000000 | 0 | 0 |
| 验收小红书 | 1 | 1 | 0 | — | — | 0 | 0 | 0.000000–0.000000 | 0 | 0 |
登录失败：0（不归因渠道）。
```

验收方仍须补：安装合并后的依赖后完整跑测试；在允许监听的窗口，用临时渠道口令起服务并执行真正的登录→cookie→GET 已有存档→报表。无需新开局。通过后将本记录移入 archive 并更新功能索引。
