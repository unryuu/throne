import type { BribeDecisionPolicy } from "@throne/agent-runtime/bribe";
import { runGrandCourt, type GrandRun } from "./grand-court.ts";

export type BribeComparisonCase = {
  readonly label: string;
  readonly policy: BribeDecisionPolicy;
};

export type BribeComparisonRow = {
  readonly label: string;
  readonly bribeStatus: string | undefined;
  readonly corruptionCount: number;
  readonly treasuryVerified: number | undefined;
  readonly removals: number;
  readonly resistanceEvidence: number | undefined;
  readonly resistanceFlat: number;
  readonly ruleValue: string;
};

export const alwaysAcceptBribePolicy: BribeDecisionPolicy = {
  decide() {
    return { accept: true, reason: "always accepts in this probe" };
  },
};

export function bribeComparisonRow(
  label: string,
  run: GrandRun,
): BribeComparisonRow {
  const v = run.finalView;
  return {
    label,
    bribeStatus: v.bribeStatus,
    corruptionCount: v.corruptionCount,
    treasuryVerified: v.treasuryVerified,
    removals: v.removals,
    resistanceEvidence: v.resistanceEvidence,
    resistanceFlat: v.resistanceFlat,
    ruleValue: v.ruleValue,
  };
}

export async function compareBribePolicies(
  cases: readonly BribeComparisonCase[],
): Promise<readonly BribeComparisonRow[]> {
  const rows: BribeComparisonRow[] = [];
  for (const item of cases) {
    const run = await runGrandCourt(`compare-${item.label}`, item.policy);
    rows.push(bribeComparisonRow(item.label, run));
  }
  return rows;
}
