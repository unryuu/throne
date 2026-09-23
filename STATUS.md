# Status

Direction changed on 2026-09-23: the project now studies a long reign ("Jiajing / Chongzhen simulator"), fun-first with real names. See [DESIGN §11](docs/DESIGN.md#11-方向长期统治与嘉靖--崇祯模拟器).

The default web tab is now the Jiajing court (FEAT-0006, in progress): the player is the emperor. Yan Song drafts rescripts. Zheng Bichang, Hu Zongxian and Yang Jinshui are live DeepSeek actors who each think, write and act separately. Paddy-to-mulberry, the Duanwu flood, dike sabotage, relief, riots and inquiries are resolved by the engine. Runs save after every step under gitignored `runs/court/` and resume after a server restart. The reign-end review shows thought / word / deed / truth side by side. Rules: [ADR 0006](docs/architecture/0006-court-memorials.md).

First live playtest is under way. Early observations: the three layers diverge the way we hoped; reports on the desk contradict each other. Fixes from the playtest: list recipients, reasoning hitting the 8K output cap (now 32K), and one automatic re-ask on malformed JSON.

The seven mechanism demos and the two-decree live commander remain available as earlier tabs.

Checks: 81 tests pass; types, formatting and build pass (the chunk-size advisory is non-blocking).

Next: finish the playtest record, then decide on the pacing of frequent audiences, how the Directorate (Lü Fang) filters memorials, and adding Hai Rui / Yan Shifan as actors.
