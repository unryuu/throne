import type { Chronicle, TruthEntry } from "@throne/court";
import type { RunMeta, Scene } from "../src/runs.ts";

export type Story = {
  readonly scenes: readonly Scene[];
  readonly ending?: NonNullable<RunMeta["ending"]>;
};
export type QuoteField = "thought" | "word" | "deed";
export type Decision = Extract<TruthEntry, { type: "decision" }>;
const fields = ["thought", "word", "deed"] as const;

function sources(decision: Decision, field: QuoteField): string[] {
  return field === "thought"
    ? [decision.thought]
    : field === "word"
      ? [
          ...decision.documents.map((d) => d.text),
          ...decision.drafts.map((d) => d.text),
          decision.report ?? "",
        ]
      : decision.actions.map((a) => a.description ?? "");
}

/** Exact match; hand-picked runs in runs.ts are held to this. */
export function quoteMatches(
  decision: Decision | undefined,
  field: QuoteField,
  quote: string,
): boolean {
  if (!decision || !quote.trim()) return false;
  return sources(decision, field).some((source) => source.includes(quote));
}

const plain = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, "");

/**
 * The storyteller is allowed to trim, elide with an ellipsis or fix punctuation;
 * the words themselves should still be the actor's. Fields may be mixed up.
 */
export function looselyMatches(decision: Decision, quote: string): boolean {
  const pieces = quote
    .split(/…+|\.{3,}|——/u)
    .map(plain)
    .filter((p) => p.length >= 2);
  if (!pieces.length) return false;
  const text = plain(fields.flatMap((f) => sources(decision, f)).join(""));
  return pieces.every((p) => text.includes(p));
}

/**
 * Quotes that cannot be found in the record are kept and shown as the
 * storyteller's retelling rather than dropped: the point is a good story.
 */
export function verifyStory(story: Story, chronicle: Chronicle) {
  const counts = { exact: 0, loose: 0, retold: 0 };
  const decisions = (day: number) =>
    chronicle.days
      .find((d) => d.day === day)
      ?.truth.filter((e): e is Decision => e.type === "decision") ?? [];
  const scenes = story.scenes.map((scene): Scene => {
    const today = decisions(scene.day);
    const own = today.find((e) => e.episode === scene.episode);
    const retold: QuoteField[] = [];
    for (const field of fields) {
      const quote = scene[field];
      if (!quote) continue;
      if (quoteMatches(own, field, quote)) counts.exact++;
      else if (
        (own && looselyMatches(own, quote)) ||
        today.some((d) => looselyMatches(d, quote))
      )
        counts.loose++;
      else {
        counts.retold++;
        retold.push(field);
      }
    }
    return retold.length ? { ...scene, retold } : scene;
  });
  return {
    scenes,
    ...(story.ending ? { ending: story.ending } : {}),
    verification: counts,
  };
}

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : undefined;

/** Lenient: one odd field should not throw away a paid call. */
export function parseStory(value: unknown, chronicle: Chronicle): Story {
  const data = (value ?? {}) as Record<string, unknown>;
  const scenes = (Array.isArray(data.scenes) ? data.scenes : [])
    .slice(0, 12)
    .flatMap((raw): Scene[] => {
      const s = (raw ?? {}) as Record<string, unknown>;
      const day = Number(s.day);
      const title = text(s.title);
      if (!Number.isInteger(day) || !title) return [];
      const quotes: Partial<Record<QuoteField, string>> = {};
      for (const field of fields) {
        const quote = text(s[field]);
        if (quote) quotes[field] = quote;
      }
      return [
        {
          day,
          title,
          note: text(s.note) ?? "",
          ...(text(s.episode) ? { episode: text(s.episode)! } : {}),
          ...quotes,
        },
      ];
    });
  const e = data.ending as Record<string, unknown> | undefined;
  const verdict = text(e?.verdict);
  if (!e || !verdict) return { scenes };
  const byName = new Map(
    Object.entries(chronicle.actors).map(([id, a]) => [a.name, id]),
  );
  const deceivers = (Array.isArray(e.deceivers) ? e.deceivers : []).flatMap(
    (raw) => {
      const d = (raw ?? {}) as Record<string, unknown>;
      const name = text(d.actor) ?? "";
      const actor = chronicle.actors[name] ? name : byName.get(name);
      const line = text(d.line);
      return actor && line
        ? [{ actor, line, exposed: d.exposed === true }]
        : [];
    },
  );
  const index = Number(e.highlight);
  const highlight = scenes[index] ? index : scenes.length ? 0 : -1;
  return { scenes, ending: { verdict, deceivers, highlight } };
}
