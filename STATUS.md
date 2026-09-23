# Status

Direction changed on 2026-09-23: the project now studies a long reign ("Jiajing / Chongzhen simulator"), fun-first with real names. See [DESIGN §11](docs/DESIGN.md#11-方向长期统治与嘉靖--崇祯模拟器).

The default web tab is now the Jiajing court (FEAT-0006, in progress): the player is the emperor. Yan Song drafts rescripts. Zheng Bichang, Hu Zongxian and Yang Jinshui are live DeepSeek actors who each think, write and act separately. Paddy-to-mulberry, the Duanwu flood, dike sabotage, relief, riots and inquiries are resolved by the engine. Runs save after every step under gitignored `runs/court/` and resume after a server restart. The reign-end review shows thought / word / deed / truth side by side. Rules: [ADR 0006](docs/architecture/0006-court-memorials.md).

First live playtest finished: Zheng Bichang secretly breached the Jiande dike, Hu Zongxian found out and told only Yan Song, and the Embroidered Guard exposed it and Zheng was arrested. Record: [playtest](docs/issues/archive/court-playtest-2026-09-23.md).

The seven mechanism demos and the two-decree live commander remain available as earlier tabs.

Checks: 81 tests pass; types, formatting and build pass (the chunk-size advisory is non-blocking).

Next: slices A–D in [HANDOFF.md](HANDOFF.md) (small fixes; Directorate gatekeeper and daily decision points; finance accounts; year-end cabinet meeting opening).
