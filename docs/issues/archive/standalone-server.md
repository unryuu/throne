# 独立部署服务

状态：完成，2026-10-16。范围以本次 brief 为准：作者自用，口令保护，不加入每日花费上限、按 IP 限流或多用户隔离。

当前差距：court 路由与 Vite、本机来源校验耦合；存档、开局包、调用缓存、actor 运行目录分别硬编码在仓库 runs 下。方案：抽取共享 court handler，独立 Node HTTP 服务提供 build 静态文件、签名登录 cookie、全站认证；统一 THRONE_RUNS_DIR，代码和 secret 仍从仓库读取。开发服继续只接受本机。

终端 actor 的缓存指纹包含 shell-day.ts；修改运行目录解析会改变该指纹，已有终端调用缓存不会误用，但发布前需要重建开局包。独立服务与手机版页面只通过 dist/desk.html 和现有 API 对接，不修改前端。

部署规则与运行环境见 [deployment](../../deployment.md)。未连接 VPS，未修改 STATUS.md 或用户维护文档，未提交 Git。

## 验收

- `npx vitest run`：38 个文件、213 个测试通过。新增 6 项集成测试覆盖未登录页面/资源/API/POST、cookie 签名/到期/重启/改口令、登录节流、跨站来源、静态目录边界、desk/index 回退、真实 Vite 中间件的本机限制，以及持久目录的存档/开局包/调用缓存。
- `npx tsc --noEmit`、`npx vite build apps/web --configLoader runner` 通过；仅原有大 chunk 提示。全仓 `npx prettier --check .` 首轮通过；收尾重跑时其他窗口新增修改了 `.claude/launch.json`，最新全仓检查仅该文件格式失败，未覆盖并行改动。本次修改文件的格式检查通过。
- 在 Node v26.5.0 上通过真实 `runShellDay` 做一次最小收笔调用，未修改已有存档：2 个 assistant/message 事件、2871ms，唯一工具命令 `end --text "今日照常办差。"` 成功，inner 正确写回；目录位于临时 THRONE_RUNS_DIR 下的 runtime/shell-*。这覆盖真实 SDK 子进程、DeepSeek、插件导入 TypeScript 和文件回写，未做完整付费对局或 Linux VPS 验证。

实际本机命令（以下口令和签名密钥仅测试使用，服务验收后已停止）：

```sh
PORT=4188 THRONE_PASSWORD=local-smoke-only THRONE_COOKIE_SECRET=local-smoke-signing-key-32-bytes-only npm run serve
# build 成功；Throne listening on http://127.0.0.1:4188

curl -sS -o /tmp/throne-unauth.html -w 'unauthenticated HTTP %{http_code}\n' http://127.0.0.1:4188/api/court/d9f36214-9eba-4b1f-b7a4-de04111fb185
# unauthenticated HTTP 401
curl -sS -c /tmp/throne-smoke.cookies -o /dev/null -w 'login HTTP %{http_code}\n' --data-urlencode 'password=local-smoke-only' http://127.0.0.1:4188/auth/login
# login HTTP 303
curl -sS -b /tmp/throne-smoke.cookies -o /tmp/throne-snapshot.json -w 'saved game HTTP %{http_code}\n' http://127.0.0.1:4188/api/court/d9f36214-9eba-4b1f-b7a4-de04111fb185
# saved game HTTP 200
```

响应字段摘录：`{"id":"d9f36214-9eba-4b1f-b7a4-de04111fb185","status":"waiting","calls":14,"error":null}`，`view.time=186`。未配置登录口令的启动也实际验证过，因缺少 secret/password.txt 明确退出，没有开放匿名服务。
