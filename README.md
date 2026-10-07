# Throne · 嘉靖朝模拟器

**你是嘉靖。满朝都在骗你，你得自己看出来。**

嘉靖三十九年，国库空虚，内阁请于浙江改稻为桑。严嵩、郑泌昌、胡宗宪、杨金水、吕芳、陆炳各由一个大模型扮演，各有各的算盘：心里想一套，奏疏写一套，背地里做的又是一套。你只能看到递到御案上的东西。灵感来自电视剧《大明王朝1566》。

## 一段真实对局

[首次实玩](https://unryuu.github.io/throne/#/jiande/40/truth)第 40 日。六天前端午大汛，建德大堤决口，淹死近千人。浙江巡抚郑泌昌这一天：

> **心里**：建德之决，本是我暗遣差役做下的手脚……绝不让堤上一字露于人前。
>
> **奏疏**：臣严饬按察司查拿窃掘奸人，以军法重究。

堤是他第 12 日派人掘开的。同一天他还在修邻县的堤做样子，并奏请工部拨银修堤。胡宗宪查到了河工的口供，只告诉了恩师严嵩；严嵩定下“只可以赈灾了局”。满朝奏疏都说是天灾。皇帝最后绕过内阁派了锦衣卫，十七天后，口供才送到御前。

这些不是写好的剧情。规则引擎只给了郑泌昌“掘堤”这个能力和凑不足田亩的压力，他自己决定动手，其他人各自决定瞒不瞒、瞒多少。

## 先看一局

**[打开观战页](https://unryuu.github.io/throne/)**：不用安装，不用密钥。可以逐日翻看，在“皇帝所见”和“实情”之间切换；每位大臣的所想、所言、所为并排；最后有一张结局卡。

- **建德决堤**：76 天的完整一局，就是上面那段。
- **终端里的十五天**：现行版本的短局。大臣在假终端里过一天，可以看到他们翻旧档、在 /tmp 起草、写信办事的全过程。

## 自己当皇帝

需要 Node.js 22.12 以上和一个 [DeepSeek API 密钥](https://platform.deepseek.com/)。

```bash
git clone https://github.com/unryuu/throne.git
cd throne
npx pnpm@11 install
```

把密钥写进 `secret/deepseek.txt`（只放一行，这个目录不会进 Git），或者设环境变量 `DEEPSEEK_API_KEY`。然后：

```bash
npx pnpm@11 dev
```

打开 <http://127.0.0.1:4173>，默认就是嘉靖朝。每天午时御案上会有本章，你可以照票拟批、自己写朱批、发特旨、派锦衣卫、拿问大臣，也可以闭关。

**时长与花费**：推进一天要等 1–2 分钟，大臣们在这段时间里各自过他们的一天。实测 15 天的短局用了约 79 万 token，其中 63 万命中缓存；完整一局 76 天，按此估算约 300–500 万 token。按 [DeepSeek 价目](https://api-docs.deepseek.com/quick_start/pricing)计费，缓存命中部分便宜得多。每一步都会存档，服务重启后可以接着玩；局终可以看完整复盘。

## 它怎么运转

- **各自只知道自己该知道的**：每位大臣只看得到寄给他的文书、自己的档案和打听来的风声。皇帝也一样，御案上只有吕芳肯递上来的东西。
- **大臣在假终端里过一天**：读档案、起草、写信、办事；每天精力有限，写信做事都要花。
- **世界由规则结算**：买田、修堤、掘堤、洪水、赈灾、民变、查勘都由引擎按规则推进。角色只能提交决定，不能直接改世界。
- **全程事件溯源**：每一局都可以确定性重放；观战页就是从存档里按天整理出来的。

## 开发

```bash
npx pnpm@11 test        # 测试
npx pnpm@11 typecheck   # 类型检查
npx pnpm@11 spectator   # 本地打开观战页（端口 4174）
npx pnpm@11 build       # 构建
```

从 [STATUS.md](STATUS.md) 和[文档入口](docs/README.md)开始；[SPEC](docs/SPEC.md) 是模拟原则，[DESIGN](docs/DESIGN.md) 是玩法意图，[架构总览](docs/architecture/overview.md)和各篇 ADR 记录仍生效的决定。网页里除了嘉靖朝，还有几个早期的机制演示标签。观战页的数据由 `apps/spectator/scripts/export-run.ts` 从存档导出，名场面在 `apps/spectator/src/runs.ts` 里手选，引文由测试核对必须是人物原话。

## In English

Throne is a political simulation where you play the Jiajing Emperor. Each minister is played by a separate LLM that thinks, writes and acts on its own; a rules engine settles the world, and every run can be replayed from its event log. The [spectator page](https://unryuu.github.io/throne/) lets you step through a real run day by day, switching between what the emperor saw and what actually happened. The game text is Chinese.
