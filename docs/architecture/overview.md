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
