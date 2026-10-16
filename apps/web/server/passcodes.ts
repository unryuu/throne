import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type Passcode = Readonly<{
  code: string;
  label: string;
  enabled: boolean;
  maxRunsPerDay?: number;
}>;
export type Visitor = Readonly<{ channel: string; visitor: string }>;

export async function readPasscodes(
  root: string,
): Promise<readonly Passcode[]> {
  const path = join(root, "secret", "passcodes.json");
  let values: unknown;
  try {
    values = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(
      "Cannot read secret/passcodes.json (missing, unreadable or invalid JSON)",
    );
  }
  if (!Array.isArray(values))
    throw new Error("passcodes.json must be an array");
  const labels = new Set<string>();
  const codes = new Set<string>();
  return values.map((value: unknown, index) => {
    const p = value as Passcode | null;
    if (
      !p ||
      typeof p.code !== "string" ||
      !p.code.trim() ||
      p.code.length > 256 ||
      typeof p.label !== "string" ||
      !p.label.trim() ||
      p.label !== p.label.trim() ||
      p.label.length > 80 ||
      /[\p{C}]/u.test(p.label) ||
      typeof p.enabled !== "boolean" ||
      (p.maxRunsPerDay !== undefined &&
        (!Number.isSafeInteger(p.maxRunsPerDay) || p.maxRunsPerDay < 0))
    )
      throw new Error(`Invalid passcode entry #${index + 1}`);
    if (labels.has(p.label) || codes.has(p.code))
      throw new Error(`Duplicate label or code at entry #${index + 1}`);
    labels.add(p.label);
    codes.add(p.code);
    return {
      code: p.code,
      label: p.label,
      enabled: p.enabled,
      ...(p.maxRunsPerDay !== undefined
        ? { maxRunsPerDay: p.maxRunsPerDay }
        : {}),
    };
  });
}
