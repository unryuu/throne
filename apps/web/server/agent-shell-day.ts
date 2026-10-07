// FEAT-0009 experiment: replays a saved court run to one actor's decision point,
// then lets the actor live that day through the fake terminal, next to a fresh
// one-shot decision on the same input. Writes runs/agent-shell/<stamp>/.
// Usage: npx tsx apps/web/server/agent-shell-day.ts [runId] [actorId] [decisionNo] [--no-oneshot] [--dry]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLiveTextModel,
  type LiveCallTrace,
} from "@throne/agent-runtime/live";
import { runShellDay } from "@throne/agent-runtime/shell-day";
import {
  buildNpcInput,
  courtDecisionSchema,
  createInitialState,
  decisionPrompt,
  parseCourtDecision,
  reduceCourtState,
  shellDecision,
  shellGreeting,
  shellSystemPrompt,
  systemPrompt,
  type CourtState,
} from "@throne/court";
import type { SimulationRecord } from "@throne/shared-types";
import { replay } from "@throne/sim-core";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const shellModule = fileURLToPath(
  new URL("../../../packages/court/src/shell.ts", import.meta.url),
);
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const runId = args[0] ?? "39c4f396-1603-45e5-81e3-7de83b5abf9b";
const actorId = args[1] ?? "actor:zheng-bichang";
const decisionNo = Number(args[2] ?? 12);
const oneshot = !process.argv.includes("--no-oneshot");

const saved = JSON.parse(
  await readFile(join(root, "runs", "court", `${runId}.json`), "utf8"),
) as { records: SimulationRecord[]; state: CourtState };
const episode = `court:${actorId.replace("actor:", "")}:${decisionNo}`;
const at = saved.state.decisions.find(
  (d) => d.decisionEpisodeId === episode,
)?.at;
if (at === undefined) throw new Error(`No decision ${episode} in ${runId}`);
// Inputs are built when the wake is consumed, before any decision of that wake commits.
const decided = saved.records.findIndex(
  (r) =>
    r.kind === "committed" &&
    r.event.eventType === "npc.decided" &&
    (r.event.payload as { record: { at: number } }).record.at === at,
);
const cut = saved.records
  .slice(0, decided)
  .findLastIndex((r) => r.kind === "consumed");
const state = replay(
  createInitialState(runId),
  saved.records.slice(0, cut + 1),
  reduceCourtState,
);
const input = buildNpcInput(state, actorId, at, runId, "zh-CN");
const original = saved.state.decisions.find(
  (d) => d.decisionEpisodeId === episode,
)!;

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(root, "runs", "agent-shell", stamp);
await mkdir(out, { recursive: true });
await writeFile(join(out, "input.json"), JSON.stringify(input, null, 2));
console.log(
  `${episode} at ${String(input.now)}; input ${JSON.stringify(input).length} chars; writing ${out}`,
);

if (process.argv.includes("--dry")) {
  console.log(shellGreeting(input));
  process.exit(0);
}

const traces: LiveCallTrace[] = [];
const [agent, single] = await Promise.allSettled([
  runShellDay({
    root,
    shellModule,
    world: input,
    systemPrompt: shellSystemPrompt(input),
    prompt: shellGreeting(input),
  }),
  oneshot
    ? createLiveTextModel(root, (t) => traces.push(t))({
        decisionEpisodeId: `${episode}:oneshot`,
        sessionKey: `${runId}:${actorId}:oneshot`,
        systemPrompt: systemPrompt(state, actorId, "zh-CN"),
        prompt: decisionPrompt(input),
      })
    : Promise.resolve(undefined),
]);

const report: Record<string, unknown> = {
  runId,
  episode,
  now: input.now,
  inputChars: JSON.stringify(input).length,
  originalDecision: original.output,
};
if (agent.status === "fulfilled") {
  const a = agent.value;
  const shellState = a.state as Parameters<typeof shellDecision>[0];
  report.agent = {
    directory: a.directory,
    durationMs: a.durationMs,
    requests: a.requests,
    commands: a.transcript.length,
    usage: a.usage,
    nudged: a.nudged,
    decision: courtDecisionSchema.parse(shellDecision(shellState)),
    transcript: a.transcript,
  };
} else report.agentError = String(agent.reason);
if (oneshot) {
  if (single.status === "fulfilled" && single.value !== undefined)
    report.oneshot = {
      trace: traces[0],
      decision: parseCourtDecision(single.value),
    };
  else report.oneshotError = String((single as PromiseRejectedResult).reason);
}
await writeFile(join(out, "report.json"), JSON.stringify(report, null, 2));

const agentReport = report.agent as
  | {
      durationMs: number;
      requests: number;
      commands: number;
      usage: Record<string, number>;
      transcript: { command: string; isError: boolean }[];
    }
  | undefined;
if (agentReport) {
  console.log(
    `agent: ${agentReport.commands} commands, ${agentReport.requests} requests, ${Math.round(agentReport.durationMs / 1000)}s, usage ${JSON.stringify(agentReport.usage)}`,
  );
  for (const step of agentReport.transcript)
    console.log(
      `  ${step.isError ? "✗" : "$"} ${step.command.split("\n")[0]!.slice(0, 100)}`,
    );
} else console.log(`agent failed: ${String(report.agentError)}`);
if (oneshot)
  console.log(
    report.oneshot
      ? `oneshot: ${JSON.stringify((report.oneshot as { trace?: LiveCallTrace }).trace)}`
      : `oneshot failed: ${String(report.oneshotError)}`,
  );
