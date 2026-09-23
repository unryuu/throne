# Provider notes

Last verified: 2026-09-17. These are point-in-time black-box observations, not proofs of model provenance. Credentials live only under the gitignored `secret/` directory.

## Current selection

- Development and debugging: DeepSeek official API with thinking enabled.
- Player-facing runs: mix DeepSeek official, SudoCode's Codex-format endpoint, and TKen Grok for model diversity.
- Do not use SudoCode's Claude Code-format endpoint.
- Keep Lumin Grok out of the active pool until its routing and fixed context are understood.

## Observations

| Provider                    | Tested route/model                                         | Result                                                                                                                                                                                                   | Decision                                                                                    |
| --------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| DeepSeek official           | Chat Completions, `deepseek-flash`                         | No evidence of a thick injected identity prompt. Baseline was 49 prompt tokens. An explicit political `system` message was followed exactly. Thinking returned 98/70 reasoning tokens in the two probes. | Primary provider during development.                                                        |
| SudoCode Codex format       | Responses, `gpt-6-astra`                                   | Omitting `instructions` injected 4,114 instruction tokens. Explicit `instructions` replaced that default: total input fell from 4,128 to 69 tokens and the political role worked.                        | Allowed in player-facing runs only when non-empty `instructions` are sent on every request. |
| SudoCode Claude Code format | Anthropic Messages, `claude-fable-5-1`                     | A supplied political `system` prompt did not displace the Claude Code identity. The model identified itself as Claude Code and rejected the simulated deceptive report.                                  | Excluded.                                                                                   |
| TKen Grok                   | Responses, requested and returned `grok-4.6`               | Baseline input was 226 tokens, including 192 cached tokens. With political `instructions`, input was 292 tokens and the model returned the requested JSON. Reasoning was present.                        | Active in player-facing runs.                                                               |
| Lumin Grok                  | Responses, requested `grok-4.6`, returned `grok-4.6-build` | Baseline input was 2,170 tokens, including 2,048 cached tokens. Explicit political `instructions` worked but input remained 2,236 tokens. The model route and fixed context are opaque.                  | Do not add to the active pool yet.                                                          |

Token counts are comparable only within the same provider and probe shape. They are used here to detect large fixed context, not to compare model efficiency.

## Adapter rules

1. Every live decision request must carry non-empty actor instructions. Missing instructions fail locally instead of falling back to a provider default.
2. Thinking/reasoning is enabled explicitly, with effort selected by the simulation rather than provider defaults.
3. Persist the requested provider/model and the provider/model actually returned.
4. Persist structured decisions and concise rationales, not raw reasoning or chain-of-thought.
5. Validate every decision against `ActorDecisionOutput` before it can produce an intent.
6. Keep a regression probe for role takeover, coding-agent identity leakage, and unexpectedly large fixed input.
7. Extend the regression probe to political-actor decisions (bribery, deception, disobedience): verify that non-empty actor instructions displace any assistant identity, that an offered payment is weighed rather than refused by default, and that acceptance tracks the structured incentives instead of model politeness. The bribe adapter rejects empty instructions locally (see `packages/agent-runtime/src/bribe-policy.ts`).

For DeepSeek tool loops in thinking mode, `reasoning_content` must remain available transiently during the current tool loop and be passed back as required by the API. It is discarded after the decision episode rather than entering the simulation event log.

## Protocol mapping

Throne should expose one internal `actorInstructions` field and translate it at the provider boundary:

| API family                         | Provider field                        |
| ---------------------------------- | ------------------------------------- |
| OpenAI Responses                   | `instructions`                        |
| OpenAI-compatible Chat Completions | `messages` item with `role: "system"` |
| Anthropic Messages                 | top-level `system`                    |

References: [DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/), [OpenAI Responses `instructions`](https://developers.openai.com/api/reference/cli/resources/responses/methods/create), [xAI reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning).
