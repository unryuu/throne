# 文档入口

日常启动：根目录 AGENTS.md、STATUS.md。活动事项只读与当前任务相关的条目。

按需查阅：

- [SPEC](SPEC.md)：模拟原则和架构边界。
- [DESIGN](DESIGN.md)：玩法意图，首次参与必读，以后按相关章节查阅。
- [architecture](architecture/overview.md)：架构与仍生效的决定；任命机制见 ADR 0003。
- [作者自用部署](deployment.md)：独立 Node 服务、口令、持久目录与 nginx/systemd。
- [providers](providers.md)：接入模型时查阅。
- [等待时间与用量](performance.md)：优化耗时、token 或缓存命中前必读，记着试过和证伪的办法。
- [真实 NPC 接入](architecture/0004-live-npc.md)：本地服务、调用边界、失败恢复与持久回放。
- [连续短局](architecture/0005-continuous-crisis.md)：两次决策、命令历史、人物记忆与御前时间线。
- [奏疏流转](architecture/0006-court-memorials.md)：朝廷场景、想/说/做、批红与行动校验。
- [司礼监与每日理事](architecture/0007-directorate-daily-court.md)：吕芳处置文书、陆炳转呈原报、闭关与打断。
- [终端人物与精力](architecture/0008-terminal-actors.md)：人物经假终端过一天，写信做事花精力。
- [具奏垂询与开局节奏](architecture/0009-imperial-questions.md)：亲问回奏、首日行动与跳过空御览。
- [御前消息与精力](architecture/0010-imperial-inbox.md)：多渠道消息、条子、通政司与陆炳风闻。
- [归纳、深思与开局语体](architecture/0011-ponder-summary-register-terminal.md)：新局阅读免费、每日两点精力、文言三档；终端御案入口与按键见根目录 README。
- 观战页：`apps/spectator`，导出与名场面说明见 [FEAT-0010](issues/active/playability.md#已做2026-10-06)。
- [手机御案前端](architecture/web-desk.md)：`/desk.html`、触屏与键盘操作、HTTP 恢复和部署接入边界。
- [issues](issues/README.md)：当前缺陷和功能；小型整理用提交说明交代。

事后追溯：`issues/archive/`、Git 历史和已关闭 PR。保留调查、取舍和验证结果，不要求日常重读。

文档不重复维护同一份进度。当前状态只在 STATUS；设计正文保留有效规则；历史记录不反向充当新开发要求。
