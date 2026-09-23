import {
  HeuristicOfficialPolicy,
  type OfficialDecisionContext,
  type OfficialDecisionPolicy,
  type OfficialStrategy,
} from "@throne/agent-runtime/official";
import {
  deriveFalsification,
  deriveGraftRate,
  type Bureaucrat,
} from "./bureaucracy-cycle.ts";

export type OfficialPerception = {
  readonly perceivedDetection: number;
  readonly perceivedSupervision: number;
  readonly localVisibility: number;
  readonly obligations: number;
  readonly knownSubjectRefs?: readonly string[];
};

export type OfficialResolution = {
  readonly actorId: string;
  readonly tier: 2 | 3;
  readonly faction: Bureaucrat["faction"];
  readonly strategy: OfficialStrategy;
  readonly rationale: string;
  readonly graftRate: number;
  readonly falsification: number;
  readonly delivered: number;
  readonly claimed: number;
};

export const allStrategies: readonly OfficialStrategy[] = [
  "honest",
  "exaggerate",
  "divert",
  "both",
  "request_information",
];

export function buildOfficialContext(
  actor: Bureaucrat,
  perception: OfficialPerception,
): OfficialDecisionContext {
  if (actor.tier === 1) {
    throw new Error("The emperor is not an official decision context");
  }
  return {
    actorId: actor.id,
    tier: actor.tier,
    faction: actor.faction,
    influence: actor.influence,
    motivations: actor.motivations,
    perceivedDetection: perception.perceivedDetection,
    perceivedSupervision: perception.perceivedSupervision,
    localVisibility: perception.localVisibility,
    obligations: perception.obligations,
    availableStrategies: allStrategies,
    knownSubjectRefs: perception.knownSubjectRefs ?? [],
  };
}

export function paramsForStrategy(
  actor: Bureaucrat,
  strategy: OfficialStrategy,
): { readonly graftRate: number; readonly falsification: number } {
  switch (strategy) {
    case "honest":
    case "request_information":
      return { graftRate: 0, falsification: 0 };
    case "exaggerate":
      return { graftRate: 0.15, falsification: deriveFalsification(actor) };
    case "divert":
      return { graftRate: deriveGraftRate(actor), falsification: 0.2 };
    case "both":
      return {
        graftRate: deriveGraftRate(actor),
        falsification: deriveFalsification(actor),
      };
  }
}

export async function resolveOfficial(
  actor: Bureaucrat,
  perception: OfficialPerception,
  policy: OfficialDecisionPolicy = new HeuristicOfficialPolicy(),
  quota = 4,
): Promise<OfficialResolution> {
  const decision = await policy.decide(buildOfficialContext(actor, perception));
  const { graftRate, falsification } = paramsForStrategy(
    actor,
    decision.strategy,
  );
  const delivered = round(quota * (1 - graftRate));
  const claimed = round(delivered + (quota - delivered) * falsification);
  return {
    actorId: actor.id,
    tier: actor.tier === 2 ? 2 : 3,
    faction: actor.faction,
    strategy: decision.strategy,
    rationale: decision.rationale,
    graftRate,
    falsification,
    delivered,
    claimed,
  };
}

export function comparePerceptions(
  actor: Bureaucrat,
  policy: OfficialDecisionPolicy = new HeuristicOfficialPolicy(),
): Promise<{
  readonly informed: OfficialResolution;
  readonly uninformed: OfficialResolution;
}> {
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
  return Promise.all([
    resolveOfficial(actor, informed, policy),
    resolveOfficial(actor, uninformed, policy),
  ]).then(([informedResult, uninformedResult]) => ({
    informed: informedResult,
    uninformed: uninformedResult,
  }));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
