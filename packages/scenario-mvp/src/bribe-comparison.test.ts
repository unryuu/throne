import { describe, expect, it } from "vitest";
import { HeuristicBribePolicy } from "@throne/agent-runtime/bribe";
import {
  alwaysAcceptBribePolicy,
  compareBribePolicies,
} from "./bribe-comparison.ts";

describe("bribe comparison harness", () => {
  it("contrasts an honest and a corrupt auditor on the same run", async () => {
    const rows = await compareBribePolicies([
      { label: "honest", policy: new HeuristicBribePolicy() },
      { label: "corrupt", policy: alwaysAcceptBribePolicy },
    ]);
    const honest = rows.find((row) => row.label === "honest");
    const corrupt = rows.find((row) => row.label === "corrupt");
    expect(honest?.bribeStatus).toBe("rejected");
    expect(honest?.treasuryVerified).toBe(60);
    expect(honest?.corruptionCount).toBe(0);
    expect(corrupt?.bribeStatus).toBe("accepted");
    expect(corrupt?.treasuryVerified).toBe(100);
    expect(corrupt?.corruptionCount).toBe(1);
  });
});
