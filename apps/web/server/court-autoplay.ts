// Playtest driver: spend attention on independent channels, follow drafts and occasionally inquire.
// Usage: npx tsx apps/web/server/court-autoplay.ts [days=15]
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ids, type SpecialEdict } from "@throne/court";
import { CourtService } from "./court-service.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const days = Number(process.argv[2] ?? 15);
mkdirSync(join(root, "runs", "agent-shell"), { recursive: true });
const log = join(root, "runs", "agent-shell", `playtest-${Date.now()}.log`);
const say = (line: string) => {
  appendFileSync(log, line + "\n");
  console.log(line);
};
const service = new CourtService(root);
let snap = await service.create("zh-CN");
say(`run ${snap.id} log ${log}`);
let sent = false;
let asked = false;
let failures = 0;
for (let i = 0; i < 400; i += 1) {
  if (snap.status === "failed") {
    if (++failures > 3) throw new Error(`Three retries failed: ${snap.error}`);
    say(`failed: ${snap.error}; retrying`);
    snap = await service.retry(snap.id);
    continue;
  }
  if (snap.status === "complete" || Math.floor(snap.view.time / 12) >= days)
    break;
  failures = 0;
  const audience = snap.view.audience!;
  if (audience.interruption && !audience.interruption.admitted) {
    snap = await service.act(snap.id, audience.id, { type: "admit" });
    continue;
  }
  const day = Math.floor(snap.view.time / 12);
  say(
    `day ${day}: ${audience.documents.length} papers [${audience.documents.map((d) => d.subject).join(" | ")}] oral ${audience.oralReports.length} calls ${snap.calls}`,
  );
  const specials: SpecialEdict[] =
    !sent && day >= 8
      ? [
          {
            edict: {
              kind: "order_inquiry" as const,
              params: { countyId: "jiande", agent: "jinyiwei" },
            },
          },
        ]
      : [];
  if (specials.length) sent = true;
  if (!asked && day >= 2) {
    specials.push({
      edict: {
        kind: "request_memorial",
        params: {
          actorId: ids.hu,
          question:
            "浙江改稻为桑现议如何？新安江沿岸堤防能否抵御端午汛水？着据实具折回奏。",
        },
      },
    });
    asked = true;
  }
  const rank = (d: (typeof audience.documents)[number]) =>
    d.fromId === ids.luBing
      ? 0
      : d.kind === "bureau" && /浙江|浙省/.test(d.subject)
        ? 1
        : d.kind === "brief"
          ? 2
          : 3;
  for (const doc of [...audience.documents].sort((a, b) => rank(a) - rank(b))) {
    if (snap.view.energy === undefined || snap.view.energy <= specials.length)
      break;
    if (doc.opened !== false) continue;
    snap = await service.act(snap.id, audience.id, {
      type: "open_message",
      documentId: doc.id,
    });
    if (snap.status !== "waiting")
      throw new Error(snap.error ?? "Could not open message");
  }
  const t = Date.now();
  snap = await service.submit(snap.id, {
    audienceId: audience.id,
    items: audience.documents.map((d) =>
      d.draft || d.hasDraft
        ? { documentId: d.id, disposition: "follow_draft" as const }
        : {
            documentId: d.id,
            disposition: "hold" as const,
          },
    ),
    specials,
  });
  say(
    `  advanced in ${Math.round((Date.now() - t) / 1000)}s, status ${snap.status}`,
  );
}
say(
  `stopped at day ${Math.floor(snap.view.time / 12)} status ${snap.status} calls ${snap.calls}`,
);
