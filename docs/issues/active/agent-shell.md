# FEAT-0009：人物 agent 化（假终端实验）

状态：待开始（用户 2026-10-06 暂缓）。

构想：每个人物是带工具的 agent，按回合（每日）行动；引擎维护客观状态，人物经工具查询和提交意图。通信（写信、拜访、调查）经引擎递送，引擎不解读内容。同一天内大家看到的是当天开始时的世界，意图在日终统一结算。

工具面：DeepSeek Harness 的 sdk-minimal 只给模型一个持久 bash。实验让人物面对一个“终端”，命令就是游戏动作（help、diary、inbox、write、act…），背后不是真 shell——真 bash 是全权限的，能读到 `secret/`。

可借鉴 [dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)（已冻结，基于 harness 0.1.3，我们是 0.1.5-rc.2，接口需复核）：

- `custom-bash`：用 `ctx.tools.register` 注册同名 `bash` 工具、沿用 Minimal 的描述和参数，执行器换成自己的。照此把执行器换成引擎命令解释器，模型看到的仍是它熟悉的 bash。
- `eternal-minimal` 的 `dshx` 网关：`tools/pre-execute` 拦截命令、以 deny 通道替换结果，结果会带错误标记，不如上一条干净，仅作备选。
- `system-prompt/assemble` 与 `context-gate`：逐请求控制可见工具和系统提示，剥掉一切自动注入，保证提示词逐字节稳定。
- prefab：给会话预置一段已发生的历史，不调用模型。每天的会话可以预置“已运行 help 及其输出”，既按用户设想先给工具再给背景，又不多花一次调用，且这段前缀整局不变，正好命中缓存。
- 他们的结论：API 可见的工具面会影响模型的行为风格，可见工具越多越差；首轮输出帽低于实际所需时，截断续写会放大漂移。所以可见工具只留一个 bash，输出上限给足。
- 验证方法：打开会话落盘，检查 `request/header` 核对模型实际看到的工具和提示词。

不需要借鉴：首轮锚定本身（针对已下线的 V4 Pro，flash 系列在他们的数据中本就锚定成功），以及 wire-think、cot-drip 等思考分离插件。
