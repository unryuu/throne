# FEAT-0012：归纳、深思与开局语体

状态：完成。规则见 [ADR 0011](../../architecture/0011-ponder-summary-register-terminal.md)；终端御案不在本次范围。

原有差距：ADR 0010 在开局事件启用三点精力和阅读收费，没有语体设置或皇帝辅助理解调用。新局在 `information.enabled.settings` 保存 `{ register, summaries }`，默认 classical + 开归纳；无该字段的旧局继续三点/阅读收费，更早无 information 的局也保持原状。

实现：归纳只接收正文数组，司礼监折起的原文以吕芳呈报摘要替代；每日呈阅批量生成，谈话中新呈文书另补一批。先保存呈阅批次，再单独调模型，失败重启只重试归纳。深思只投影 `courtRulerView` 的当前消息、御案、档案、旨意、谈话和口奏，结果存事件，不进人物经历。语体贯穿表单、终端日、通政司及固定开场文书、批红、锦衣卫原报；归纳和深思始终现代汉语。

终端接入：直接 `CourtService.create(locale, { register: "modern", summaries: true })`；展开用 `act(id, audienceId, { type: "open_message", documentId })`，深思同样传 `{ type: "ponder", documentId }`，先展开再深思。视图提供 `settings`、`energyCapacity`、`gloss` 和 `ponders[{at,text}]`；存档与 HTTP 共用原有服务，不需要终端专用持久化。

网页已加设置、免费展开/档案补读、括号归纳、深思按钮与历史、名词小抄及悬停说明。观战转换及页面能显示归纳和深思。代玩：`court-autoplay.ts 3 --register=modern --summaries=true`，默认也是 modern + 开归纳，偶数日深思。

验证：30 个测试文件、155 项测试通过，format:check、typecheck、build 通过（保留已有的大包提示）。新增测试检查实情隔离、免费阅读、共享精力、归纳开关/批量、失败恢复、语体传递及确定性重放；网页组件测试验证零精力展开和正文内显示。没有可用浏览器，未做截图验收。旧局 `d9f36214-9eba-4b1f-b7a4-de04111fb185` 与 `c9d32fb1-5afa-41c6-ae70-22f54900dcbe` 均以 `CourtService.get` 成功读取，后者仍显示容量 3、剩余 0，未调用模型。

真实试跑：classical `4f536e6d-08ab-47d4-87d1-98555cab1146` 已走完两天，14 次调用，无失败，文书仍半文半白。modern 首轮发现语体随原公文惯性偏古、深思偶尔离开当前主题，已简短补明现代语体并在请求中携带语体说明、强调当前消息，不增加内容模板/事实校验。最终 modern 局 `cd6337d5-05db-46bf-b640-8fd29778bc00` 走满三天（第 0 天至第 3 天御览），22 次模型调用，4 批归纳、2 次深思、零失败，存档逐事件重放与保存状态完全一致。胡宗宪实写奏疏见 `doc-15`，归纳见各文书 `gloss`，两段深思见 `doc-2`、`doc-32` 的 `ponders`。模型仍偶有古词，不做语体硬筛。试跑存档均在 `runs/court/`，日志在 `runs/agent-shell/playtest-1792090699261.log`；classical 存档也已核对重放一致。另两次提示词调整前的 modern 三天局保留：`5a018429-4b8f-4902-88a6-1b11ba7dabd6`、`5fcdfcd7-71a4-44ec-aa26-2644d68caeba`，均零失败。
