import { describe, expect, it } from "vitest";
import { simTime, type DomainEvent } from "@throne/shared-types";
import { replay } from "@throne/sim-core";
import {
  deriveResistance,
  deriveStance,
  factionReformIds,
  factionReformInitialState,
  reduceFactionReformState,
  runFactionReformScenario,
  type ImperialBasis,
  type ImperialPolicy,
} from "./faction-reform.ts";

const alwaysEndorse = (basis: ImperialBasis): ImperialPolicy => ({
  decide() {
    return { kind: "endorse", policyId: factionReformIds.newLaw, basis };
  },
});

describe("factional reform", () => {
  it("records petitions and shifts the rule when the emperor endorses", async () => {
    const run = await runFactionReformScenario();
    expect(run.afterFirstAudience.ruleValue).toBe("new_law");
    expect(run.afterFirstAudience.resistance.restore).toBeGreaterThan(0);
    expect(run.finalView.ruleValue).toBe("old_law");
    expect(run.state.petitions).toEqual([
      factionReformIds.newLaw,
      factionReformIds.restoreLaw,
    ]);
    expect(run.state.acts.map((act) => act.kind)).toEqual([
      "endorse",
      "grant_office",
      "revert",
    ]);
  });

  it("lets an evidence-backed act provoke less resistance than a flat one", async () => {
    const flat = await runFactionReformScenario({
      policy: alwaysEndorse("flat"),
    });
    const evidence = await runFactionReformScenario({
      policy: alwaysEndorse("evidence"),
    });
    expect(flat.finalView.ruleValue).toBe("new_law");
    expect(evidence.finalView.ruleValue).toBe("new_law");
    expect(flat.finalView.resistance.restore).toBeGreaterThan(
      evidence.finalView.resistance.restore,
    );
  });

  it("raises a faction's support when its member is given office", async () => {
    const run = await runFactionReformScenario();
    const finalRestore = run.finalView.factionSupport.restore;
    expect(finalRestore).toBeGreaterThan(1.35);
    expect(run.state.actors[factionReformIds.sima]?.influence).toBe(1.2);
  });

  it("derives policy stance from ideology, not a stored label", () => {
    expect(
      deriveStance(
        factionReformInitialState,
        factionReformIds.wang,
        factionReformIds.newLaw,
      ),
    ).toBe(0.9);
    expect(
      deriveStance(
        factionReformInitialState,
        factionReformIds.sima,
        factionReformIds.newLaw,
      ),
    ).toBe(-0.85);
    expect(
      deriveStance(
        factionReformInitialState,
        factionReformIds.sima,
        factionReformIds.restoreLaw,
      ),
    ).toBe(0.85);
  });

  it("replays from committed records without model calls", async () => {
    const run = await runFactionReformScenario();
    const replayed = replay(
      factionReformInitialState,
      run.records,
      reduceFactionReformState,
    );
    expect(replayed).toEqual(run.state);
    expect(deriveResistance(replayed)).toEqual(deriveResistance(run.state));
  });

  it("rejects unknown domain events and unknown actors", async () => {
    const unknown: DomainEvent = {
      id: "bad",
      occurredAt: simTime(10),
      eventType: "typo.unknown",
      payload: {},
    };
    expect(() =>
      reduceFactionReformState(factionReformInitialState, unknown),
    ).toThrow("Unhandled faction-reform event");

    await expect(
      runFactionReformScenario({
        policy: {
          decide() {
            return {
              kind: "grant_office",
              actorId: "actor:nobody",
              officeId: "office:chancellery",
              basis: "flat",
            };
          },
        },
      }),
    ).rejects.toThrow("Unknown faction-reform actor");
  });
});
