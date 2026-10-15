# Architecture overview

Throne is a modular monolith. Package boundaries protect the experiment's semantics; they are not deployment boundaries.

The simulation event log and the DeepSeek Harness session log are deliberately separate. The simulation log records world history in simulation time. Harness records model execution history. They are joined through run, branch, actor, decision-episode, and model-call identifiers.

The simulation kernel follows this path:

```text
ScheduledEvent batch
  -> scenario resolver
  -> proposed DomainEvents and future ScheduledEvents
  -> invariant validation
  -> atomic record append
  -> objective-state projection
```

All events at the earliest simulation timestamp are delivered to the scenario resolver as one batch. This prevents meaningful simultaneous inputs, such as contradictory orders, from being resolved by incidental array order.

Actor cognition is accessed through one `DecisionPolicy` contract. A role can use a human policy during play, a Harness policy during autonomous runs, or a recorded policy during replay without changing the simulation rules. For a human turn, the scenario opens a decision and deliberately schedules no successor event. Submitting the validated player output schedules resolution at the paused simulation time; the UI never mutates world state directly.

The static spectator page (`apps/spectator`, published to GitHub Pages) reads chronicles built by `buildChronicle` in `packages/court/src/chronicle.ts`. A chronicle folds a saved run's committed events into days without re-running rules, so runs saved under older rule versions still read; it fails if the folded county and grain numbers differ from the saved final state. Every court event type is either rendered or listed there as quiet, so a new event type fails the export until someone decides how it shows.

In development, spectator's local-only `/api/local-runs` lists `runs/court/*.json` and folds each selected save through the same `buildChronicle`. Saves are read only. `#/local-<run-id>` opens a local run; the web app's end-of-run link targets port 4174. The static build has no local navigation or API middleware.

The post-run storyteller (`apps/spectator/server`) uses one DeepSeek text completion when a completed local run has no cache. Its input omits terminal transcripts and intermediate world snapshots, deduplicates repeated text, and retains every day, decision, result and ruler entry within a 900,000-character budget. Thoughts, non-letter documents, oral reports, drafts, action descriptions and the ruler’s perspective remain complete, even when deduplicated. Under pressure, secondary text such as private letters becomes marked contiguous excerpts; repeated field names can also be encoded. If the core originals still cannot fit, it fails explicitly instead of clipping them. `shared/story.ts` checks each quote against the same day, episode and thought/word/deed source used by the curated-run tests. It drops invalid quotes and empty scenes, remaps the highlighted scene, and records discard counts. Commentary and verdicts remain labelled model interpretations.

Cache files are `runs/storyteller/<run-id>.json`, with source digest, validated scenes/ending, raw model response, usage trace and compression/verification statistics. File locks prevent concurrent calls across the CLI and development service. Failed calls are cached too; no automatic paid retries. `npx tsx apps/spectator/scripts/storyteller.ts <run-id> [--force]` prints JSON; `--force` archives the previous cache under `runs/storyteller/history/` before regenerating. A process killed before releasing its lock leaves an explicit lock error; after confirming that process exited, move its `.json.lock` file aside to recover.
