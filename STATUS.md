# Status

Direction changed on 2026-09-23: the project now studies a long reign ("Jiajing / Chongzhen simulator"), fun-first with real names. See [DESIGN §11](docs/DESIGN.md#11-方向长期统治与嘉靖--崇祯模拟器).

The default web tab is now the Jiajing court (FEAT-0006, in progress): the player is the emperor. Yan Song drafts rescripts. Zheng Bichang, Hu Zongxian and Yang Jinshui are live DeepSeek actors who each think, write and act separately. Paddy-to-mulberry, the Duanwu flood, dike sabotage, relief, riots and inquiries are resolved by the engine. Runs save after every step under gitignored `runs/court/` and resume after a server restart. The reign-end review shows thought / word / deed / truth side by side. Rules: [ADR 0006](docs/architecture/0006-court-memorials.md).

First live playtest finished: Zheng Bichang secretly breached the Jiande dike, Hu Zongxian found out and told only Yan Song, and the Embroidered Guard exposed it and Zheng was arrested. Record: [playtest](docs/issues/archive/court-playtest-2026-09-23.md).

The seven mechanism demos and the two-decree live commander remain available as earlier tabs.

Slice A done (2026-09-23): regular decisions have a 160-call cost guard that is shown when hit, an arrested minister always gets his last decision, and Embroidered Guard reports give the inundated area and separate merchant grain from official relief. Second playtest: 128 calls, about 2.24M tokens. Record: [BUG-0007](docs/issues/archive/court-slice-a.md).

Slice B done (2026-09-23): Lü Fang and Lu Bing are live. Every paper reaches the throne through Lü Fang, who presents, summarises, holds, endorses on the draft or returns it to the cabinet. Embroidered Guard reports go to Lu Bing, who either hands them to the Directorate or brings them in person. The emperor holds court daily at noon, can talk to Lü, and can go into seclusion. Rules: [ADR 0007](docs/architecture/0007-directorate-daily-court.md). Third playtest: 259 calls, about 4.65M tokens; the 240-decision cost guard ran out on day 73. Record: [FEAT-0007](docs/issues/archive/court-directorate.md).

Checks: tests, types, formatting and build pass (the chunk-size advisory is non-blocking).

Next: the user decides the cost guard and how often Lü Fang is called; then slice C (finance accounts) and D (year-end cabinet meeting opening) in [HANDOFF.md](HANDOFF.md).
