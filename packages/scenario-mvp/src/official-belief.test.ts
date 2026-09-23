import { describe, expect, it } from "vitest";
import {
  HeuristicOfficialPolicy,
  RecordedOfficialPolicy,
  assertOfficialInstructions,
} from "@throne/agent-runtime/official";
import {
  comparePerceptions,
  resolveOfficial,
  type OfficialPerception,
} from "./official-belief.ts";
import { createBureaucracyInitialState } from "./bureaucracy-cycle.ts";

function actor(id: string) {
  const state = createBureaucracyInitialState();
  const found = state.actors[id];
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

const informed: OfficialPerception = {
  perceivedDetection: 0.8,
  perceivedSupervision: 0.6,
  localVisibility: 0.9,
  obligations: 1,
};
const uninformed: OfficialPerception = {
  perceivedDetection: 0.1,
  perceivedSupervision: 0.1,
  localVisibility: 0.2,
  obligations: 0,
};

describe("official belief-driven decisions", () => {
  it("changes one reform officer's behaviour with its beliefs, not its motives", async () => {
    const officer = actor("actor:wang:officer1");
    const view = await comparePerceptions(officer);
    expect(view.informed.strategy).toBe("request_information");
    expect(view.informed.graftRate).toBe(0);
    expect(view.informed.falsification).toBe(0);
    expect(view.uninformed.strategy).toBe("exaggerate");
    expect(view.uninformed.falsification).toBeGreaterThan(0);
    expect(view.uninformed.graftRate).toBeGreaterThan(0);
  });

  it("makes different factions offend differently under identical beliefs", async () => {
    const reform = await resolveOfficial(
      actor("actor:wang:officer1"),
      uninformed,
    );
    const restore = await resolveOfficial(
      actor("actor:sima:officer1"),
      uninformed,
    );
    expect(reform.falsification).toBeGreaterThan(0);
    expect(reform.graftRate).toBeLessThan(restore.graftRate);
    expect(restore.graftRate).toBeGreaterThan(0);
  });

  it("is a pluggable policy: a recorded policy overrides the heuristic", async () => {
    const officer = actor("actor:lv:officer1");
    const policy = new RecordedOfficialPolicy(
      new Map([
        [officer.id, { strategy: "honest", rationale: "recorded honesty" }],
      ]),
    );
    const result = await resolveOfficial(officer, uninformed, policy);
    expect(result.strategy).toBe("honest");
    expect(result.delivered).toBe(4);
  });

  it("requires non-empty instructions for the harness policy", () => {
    expect(() => assertOfficialInstructions("  ")).toThrow(
      "non-empty actor instructions",
    );
  });

  it("is deterministic under the heuristic", async () => {
    const officer = actor("actor:zhang:officer1");
    const a = await resolveOfficial(
      officer,
      uninformed,
      new HeuristicOfficialPolicy(),
    );
    const b = await resolveOfficial(
      officer,
      uninformed,
      new HeuristicOfficialPolicy(),
    );
    expect(a).toEqual(b);
  });
});
