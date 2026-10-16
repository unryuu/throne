# 手机御案前端

入口 `/desk.html`，代码在 `apps/web/src/desk/`。Vite 开发与多页面构建均保留旧 `index.html`；独立服务把新页面挂到根路径时，不必改游戏代码。旧 `court-play.tsx` 未接入新页面。

## 状态与输入

`controller.ts` 只执行 `tui/state.ts` 的 Transition / Effect；菜单和文书使用共享的 `options`、`body`、`documentData`，不用终端的字符画或换行结果。点按先选中、执行 `focus`（必要时免费展开文书），成功后再 Enter。键盘、底部按钮走同一入口，后续手势可调用 `choose` / `key` / `shortcut`，本版不注册手势。

默认浅白，仍可选文言或现代。长文由 DOM 原生滚动；方向键 / hjkl 移动和确认，Home / End 到列表首尾，PageUp / PageDown 翻阅可视内容，Esc 返回，? 打开小抄。网页不模拟终端的逐行滚动和深思打字机动画，深思成功后直接呈现全文及作者注。

底部按钮：

| 按钮            | 状态机输入                                           |
| --------------- | ---------------------------------------------------- |
| 返回            | Escape；首页、强制求见选择、结局等不能返回的状态禁用 |
| 更多            | 选中 `more` 后 Enter                                 |
| 闭关            | 选中 `close` 后 Right                                |
| 退朝            | 选中 `close` 后 Enter，仅打开汇总                    |
| 确认退朝 / 确定 | Enter                                                |
| 小抄            | Help（?）                                            |
| 重试            | Enter（错误状态）                                    |
| 收起错误        | Left；仅非服务端 failed 错误可用，沿用终端语义       |

谈话、垂询和旨意正文使用全屏输入面板。Enter 换行，Ctrl / ⌘ + Enter 发送，Esc 或取消按钮放弃，空白发送也取消。输入法组合期间不响应快捷键；超长内容保留并提示，不截断。软键盘出现时通过 VisualViewport 调整面板高度。手机仍可直接点发送。

## HTTP 与恢复

所有模型操作走同源 `/api/court`；等待通过 `/progress/:operationId`（开局）或 `/progress/:runId` 查询人物忙碌提示，忙时锁住重复点击。接收快照后继续 `focus`；`running` 存档先轮询到可操作状态。结束时请求 `/review` 显示真实结局统计，缺失统计显式报错。

服务端 `failed` 用 `/retry`。已经发出的 act / submit 若 HTTP 失败，重试先 GET 核对服务端状态，必要时调用 `/retry`，不直接重发付费操作。若 GET 表明仍是原状，玩家需核对后重新选择操作。开局请求未返回局号时，现有 API 没有按 operationId 找回对局的能力，页面会明确提示再次重试会重新开局。

浏览器 `throne.desk` 保存本页面玩过的局号和已抽开局包；首次可接续旧页面的 `throne.courtRun`。服务端不提供全局存档列表，此页面不遍历其他浏览器的局。地址携带 `?run=<id>`，刷新可恢复服务端已完成步骤；当日暂定处置与未发送文字不持久化。浏览器存储不可用时显示提示，不假装保存成功。

`spectate` 不启动本机子进程，结局页提示到电脑复盘；手机版无法访问电脑的 localhost 观战端口。`quit` 不关闭浏览器或绑定 Ctrl+C，保留浏览器自身快捷键；玩家可关闭页面。结局页提供回首页再开一局。

验证记录见 [手机御案验收](../issues/archive/mobile-desk.md)。部署、鉴权和服务端网络访问策略由独立服务负责，原 Vite API 仍仅允许 localhost，不能直接用局域网地址在手机玩。
