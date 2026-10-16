import { loadRoutineLibrary } from "./routine-library.ts";
import { randomUUID } from "node:crypto";
import type { LiveCallTrace } from "@throne/agent-runtime/live";
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replay } from "@throne/sim-core";
import {
  ids,
  startCourtSession,
  createInitialState,
  reduceCourtState,
  type CourtModelRequest,
} from "@throne/court";
import { fingerprint } from "@throne/agent-runtime/live";
import { demoModel } from "../tui/demo.ts";
import { CourtService } from "./court-service.ts";
import {
  advanceDefault,
  buildOpeningPack,
  defaultSubmission,
  submitOpening,
  type OpeningChoice,
} from "./opening-packs.ts";
import { chooseOpeningPack } from "./opening-pack-store.ts";

const settings = { register: "plain", summaries: true } as const;
const root = () => mkdtemp(join(tmpdir(), "opening-packs-"));
describe("opening packs", () => {
  it("keeps Zhejiang inputs identical across unrelated army rescripts for days 1–5, but changes Yan Song's day 1 after rejecting policy", async () => {
    const run = async (
      army: OpeningChoice,
      policy: OpeningChoice = "follow_draft",
    ) => {
      const requests: CourtModelRequest[] = [];
      const s = await startCourtSession({
        runId: `run-${army}-${policy}`,
        seed: "same-seed",
        language: "zh-CN",
        settings,
        fullLog: true,
        model: async (r) => {
          requests.push(r);
          if ([ids.zheng, ids.hu, ids.yang].includes(r.input.actorId as never))
            return JSON.stringify({
              inner: "照常办差。",
              documents: [
                {
                  kind: "letter",
                  to: [ids.zheng, ids.hu, ids.yang].filter(
                    (id) => id !== r.input.actorId,
                  ),
                  subject: "近日公务",
                  text: "请各自留心汛期。",
                },
              ],
            });
          return demoModel(r);
        },
      });
      const first = requests.length;
      await submitOpening(s, [policy, army]);
      await advanceDefault(s, 5);
      expect(
        replay(
          createInitialState(`run-${army}-${policy}`),
          await s.records(),
          reduceCourtState,
        ),
      ).toEqual(s.state);
      expect(s.state.seed).toBe("same-seed");
      return requests.slice(first);
    };
    const follow = await run("follow_draft"),
      hold = await run("hold"),
      reject = await run("follow_draft", "reject");
    for (const actor of [ids.zheng, ids.hu, ids.yang]) {
      const select = (requests: CourtModelRequest[]) =>
        requests
          .filter((r) => r.input.actorId === actor)
          .map((r) =>
            fingerprint({
              systemPrompt: r.systemPrompt,
              prompt: r.prompt,
              input: r.input,
            }),
          );
      expect(select(follow).length).toBeGreaterThanOrEqual(1);
      expect(select(hold)).toEqual(select(follow));
    }
    expect(
      follow.find((r) => r.input.actorId === ids.yanSong)?.prompt,
    ).not.toBe(reject.find((r) => r.input.actorId === ids.yanSong)?.prompt);
  });
  it("builds a full pack and starts a different run with every call cached through day 5", async () => {
    const directory = await root();
    let live = 0;
    const factory = () => async (r: CourtModelRequest) => {
      live++;
      return demoModel(r);
    };
    const report = await buildOpeningPack({
      root: directory,
      settings,
      modelFactory: factory,
      modelIdentity: "offline-pack-v1",
      parallel: 4,
    });
    expect(report.pack.complete).toBe(true);
    const opening = report.tasks.filter(({ task }) => task.type === "opening");
    const ponders = report.tasks.filter(({ task }) => task.type === "ponder");
    const presets = report.tasks.filter(
      ({ task }) => task.type === "talk" || task.type === "question",
    );
    expect(opening).toHaveLength(9);
    expect(opening.every((t) => t.reachedDay === 5)).toBe(true);
    expect(ponders.length).toBeGreaterThanOrEqual(5);
    expect(ponders.every((t) => t.reachedDay === 0)).toBe(true);
    expect(presets).toHaveLength(36);
    expect(presets.every((t) => t.reachedDay === t.task.day + 1)).toBe(true);
    expect(
      report.tasks
        .filter(({ task }) => task.type === "question")
        .every(
          ({ task }) =>
            task.type === "question" &&
            [ids.yanSong, ids.lvFang, ids.luBing].includes(
              task.actorId as never,
            ),
        ),
    ).toBe(true);
    const before = live;
    const service = new CourtService(directory, factory, "offline-pack-v1");
    let snap = await service.create("zh-CN", settings);
    expect(snap.openingPackId).toBe(report.pack.id);
    while (Math.floor(snap.view.time / 12) < 5) {
      const s = service.entries.get(snap.id)!.session;
      snap = await service.submit(snap.id, defaultSubmission(s));
      expect(snap.status).toBe("waiting");
    }
    expect(live).toBe(before);
    const baseline = await service.create("zh-CN", settings);
    const baselineSession = service.entries.get(baseline.id)!.session;
    for (let day = 0; day <= 2; day++) {
      const checkpoint = await baselineSession.records();
      for (const task of report.tasks
        .map((item) => item.task)
        .filter(
          (t) => t.day === day && (t.type === "talk" || t.type === "question"),
        )) {
        const traces: LiveCallTrace[] = [];
        const fork = await startCourtSession({
          runId: randomUUID(),
          language: "zh-CN",
          records: checkpoint,
          routineLibrary: (await loadRoutineLibrary()).entries,
          fullLog: true,
          model: service.model(traces, new Set()),
        });
        if (task.type === "talk")
          await fork.act(fork.view.audience!.id, {
            type: "converse",
            message: task.message,
          });
        else if (task.type === "question")
          await fork.submit(
            defaultSubmission(fork, [
              {
                edict: {
                  kind: "request_memorial",
                  params: { actorId: task.actorId, question: task.message },
                },
              },
            ]),
          );
        await advanceDefault(fork, day + 1);
        expect(traces.length).toBeGreaterThan(0);
        expect(traces.every((t) => t.cached)).toBe(true);
      }
      if (day < 2)
        await baselineSession.submit(defaultSubmission(baselineSession));
    }
    expect(live).toBe(before);
    const saved = JSON.parse(
      await readFile(
        join(directory, "runs", "court", `${snap.id}.json`),
        "utf8",
      ),
    );
    expect(saved.calls.length).toBeGreaterThan(20);
    expect(
      saved.calls.every(
        (c: { cached?: boolean; usage: { totalTokens: number } }) =>
          c.cached && c.usage.totalTokens === 0,
      ),
    ).toBe(true);
    expect(
      await chooseOpeningPack(
        directory,
        { ...settings, register: "modern" },
        "zh-CN",
      ),
    ).toBeUndefined();
  }, 60000);
});
