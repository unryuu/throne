import { runsDirectory } from "@throne/agent-runtime/live";
import { randomInt, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { courtSettingsSchema, type CourtSettings } from "@throne/court";
export type OpeningPack = Readonly<{
  version: 1;
  id: string;
  seed: string;
  settings: CourtSettings;
  locale: "zh-CN" | "en";
  throughDay: number;
  branches: readonly string[];
  complete: boolean;
}>;
const schema = {
  parse(value: unknown): OpeningPack {
    const p = value as OpeningPack;
    if (
      !p ||
      p.version !== 1 ||
      typeof p.id !== "string" ||
      !/^[a-zA-Z0-9-]+$/.test(p.id) ||
      typeof p.seed !== "string" ||
      !p.seed ||
      !["zh-CN", "en"].includes(p.locale) ||
      !Number.isInteger(p.throughDay) ||
      p.throughDay < 0 ||
      !Array.isArray(p.branches) ||
      p.branches.some((b) => typeof b !== "string") ||
      typeof p.complete !== "boolean"
    )
      throw new Error("Invalid opening pack manifest");
    return { ...p, settings: courtSettingsSchema.parse(p.settings) };
  },
};
const directory = (root: string) => join(runsDirectory(root), "cache", "packs");
export async function saveOpeningPack(root: string, pack: OpeningPack) {
  const parsed = schema.parse(pack);
  await mkdir(directory(root), { recursive: true });
  const path = join(directory(root), `${parsed.id}.json`);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(parsed), { mode: 0o600 });
  await rename(temporary, path);
}
export async function listOpeningPacks(
  root: string,
): Promise<readonly OpeningPack[]> {
  let files: string[];
  try {
    files = await readdir(directory(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return Promise.all(
    files
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map(async (f) =>
        schema.parse(
          JSON.parse(await readFile(join(directory(root), f), "utf8")),
        ),
      ),
  );
}
export async function chooseOpeningPack(
  root: string,
  settings: CourtSettings,
  locale: string,
  excluded: readonly string[] = [],
) {
  const matching = (await listOpeningPacks(root)).filter(
    (p) =>
      p.complete &&
      p.locale === locale &&
      p.settings.register === settings.register &&
      p.settings.summaries === settings.summaries,
  );
  const unseen = matching.filter((p) => !excluded.includes(p.id));
  const choices = unseen.length ? unseen : matching;
  return choices.length ? choices[randomInt(choices.length)] : undefined;
}
