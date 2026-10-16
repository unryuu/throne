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
