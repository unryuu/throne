# 文档入口

日常启动：根目录 AGENTS.md、STATUS.md。活动事项只读与当前任务相关的条目。

按需查阅：

- [SPEC](SPEC.md)：模拟原则和架构边界。
- [DESIGN](DESIGN.md)：玩法意图，首次参与必读，以后按相关章节查阅。
- [architecture](architecture/overview.md)：架构与仍生效的决定；任命机制见 ADR 0003。
- [providers](providers.md)：接入模型时查阅。
- [真实 NPC 接入](architecture/0004-live-npc.md)：本地服务、调用边界、失败恢复与持久回放。
- [连续短局](architecture/0005-continuous-crisis.md)：两次决策、命令历史、人物记忆与御前时间线。
- [奏疏流转](architecture/0006-court-memorials.md)：朝廷场景、想/说/做、批红与行动校验。
- [司礼监与每日理事](architecture/0007-directorate-daily-court.md)：吕芳处置文书、陆炳转呈原报、闭关与打断。
- [issues](issues/README.md)：当前缺陷和功能；小型整理用提交说明交代。

事后追溯：`issues/archive/`、Git 历史和已关闭 PR。保留调查、取舍和验证结果，不要求日常重读。

文档不重复维护同一份进度。当前状态只在 STATUS；设计正文保留有效规则；历史记录不反向充当新开发要求。
