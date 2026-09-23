import type { MotivationProfile } from "@throne/shared-types";

export type OfficialTier = 2 | 3;
export type OfficialFaction = "reform" | "restore" | null;

export type OfficialStrategy =
  "honest" | "exaggerate" | "divert" | "both" | "request_information";

export type OfficialDecisionContext = {
  readonly actorId: string;
  readonly tier: OfficialTier;
  readonly faction: OfficialFaction;
  readonly influence: number;
  readonly motivations: MotivationProfile;
  readonly perceivedDetection: number;
  readonly perceivedSupervision: number;
  readonly localVisibility: number;
  readonly obligations: number;
  readonly availableStrategies: readonly OfficialStrategy[];
  readonly knownSubjectRefs: readonly string[];
};

export type OfficialDecision = {
  readonly strategy: OfficialStrategy;
  readonly rationale: string;
  readonly requestedInformation?: readonly string[];
};

export type OfficialDecisionPolicy = {
  decide(
    context: OfficialDecisionContext,
  ): Promise<OfficialDecision> | OfficialDecision;
};

export function offendPropensity(context: OfficialDecisionContext): number {
  const greed =
    context.motivations.wealth * (1 - context.motivations.proceduralLegality);
  const pressure = context.faction === "reform" ? 0.25 : 0.1;
  const risk =
    0.6 * context.perceivedDetection + 0.4 * context.perceivedSupervision;
  return rounded(
    clamp(
      greed + pressure - risk - 0.2 * context.motivations.proceduralLegality,
      -0.5,
      1,
    ),
  );
}

export class HeuristicOfficialPolicy implements OfficialDecisionPolicy {
  decide(context: OfficialDecisionContext): OfficialDecision {
    const propensity = offendPropensity(context);
    if (
      context.perceivedDetection >= 0.7 &&
      context.availableStrategies.includes("request_information")
    ) {
      return {
        strategy: "request_information",
        rationale: `perceived detection ${context.perceivedDetection} is high; probe before acting`,
        requestedInformation: ["what does the investigatory office know?"],
      };
    }
    if (propensity < 0.15) {
      return {
        strategy: "honest",
        rationale: `offend propensity ${propensity} is low`,
      };
    }
    if (propensity < 0.4) {
      const single: OfficialStrategy =
        context.faction === "reform" ? "exaggerate" : "divert";
      if (context.availableStrategies.includes(single)) {
        return {
          strategy: single,
          rationale: `moderate propensity ${propensity}; faction-typical offence`,
        };
      }
    }
    if (context.availableStrategies.includes("both")) {
      return {
        strategy: "both",
        rationale: `high propensity ${propensity}; falsify and divert`,
      };
    }
    return { strategy: "honest", rationale: "no offending strategy available" };
  }
}

export class RecordedOfficialPolicy implements OfficialDecisionPolicy {
  readonly #decisions: ReadonlyMap<string, OfficialDecision>;
  constructor(decisions: ReadonlyMap<string, OfficialDecision>) {
    this.#decisions = decisions;
  }
  decide(context: OfficialDecisionContext): OfficialDecision {
    const decision = this.#decisions.get(context.actorId);
    if (!decision) {
      throw new Error(`No recorded official decision for ${context.actorId}`);
    }
    return decision;
  }
}

export type OfficialDecisionRunner = (
  context: OfficialDecisionContext,
) => Promise<OfficialDecision>;

export const officialSystemPrompt = [
  "You are one official inside a political simulation, not an assistant to the player.",
  "You know only the actor-visible facts supplied here. Reports are claims.",
  "Choose one strategy from the available strategies that best serves your own interests and safety.",
  "Do not name numbers; choose a strategy only.",
  "If you lack information you reasonably need, choose request_information and say what you need.",
  "Return JSON: { strategy, rationale, requestedInformation? }.",
].join("\n");

export function assertOfficialInstructions(instructions: string): void {
  if (instructions.trim().length === 0) {
    throw new Error("Official decision requires non-empty actor instructions");
  }
}

export class HarnessOfficialPolicy implements OfficialDecisionPolicy {
  constructor(
    readonly runner: OfficialDecisionRunner,
    readonly actorInstructions: string = officialSystemPrompt,
  ) {
    assertOfficialInstructions(actorInstructions);
  }
  decide(context: OfficialDecisionContext): Promise<OfficialDecision> {
    return this.runner(context);
  }
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
