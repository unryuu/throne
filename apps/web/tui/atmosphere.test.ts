import { describe, expect, it } from "vitest";
import { atmosphereLine, atmosphereLines, waitedText } from "./atmosphere.ts";

describe("waiting atmosphere", () => {
  it("adds the month's lines and rotates every four seconds", () => {
    const april = atmosphereLines(0);
    const june = atmosphereLines(12 * 65);
    expect(april).toContain("柳絮飘进了廊下……");
    expect(june).toContain("太液池的荷花开了……");
    expect(june).not.toContain("柳絮飘进了廊下……");
    expect(atmosphereLine(april, 0, 3)).toBe(april[3]);
    expect(atmosphereLine(april, 3999, 3)).toBe(april[3]);
    expect(atmosphereLine(april, 4000, 3)).toBe(april[4]);
    expect(atmosphereLine(april, 4000 * april.length, 3)).toBe(april[3]);
  });

  it("never names who is busy and shows how long the emperor has waited", () => {
    expect(atmosphereLines().join("")).not.toMatch(/严嵩|吕芳|陆炳|忙碌/);
    expect(waitedText(9500)).toBe("已候 9 秒");
    expect(waitedText(80000)).toBe("已候 1 分 20 秒");
  });
});
