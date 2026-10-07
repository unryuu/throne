// Temporary playtest driver (not committed): the emperor follows every draft.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CourtService } from "./court-service.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const days = Number(process.argv[2] ?? 15);
const log = join(root, "runs", "agent-shell", `playtest-${Date.now()}.log`);
const say = (line: string) => {
  appendFileSync(log, line + "\n");
  console.log(line);
};
const service = new CourtService(root);
let snap = await service.create("zh-CN");
say(`run ${snap.id} log ${log}`);
let sent = false;
for (let i = 0; i < 400; i += 1) {
  if (snap.status === "failed") {
    say(`failed: ${snap.error}; retrying`);
    snap = await service.retry(snap.id);
    continue;
  }
  if (snap.status === "complete" || snap.view.time > days * 12) break;
  const audience = snap.view.audience!;
  if (audience.interruption && !audience.interruption.admitted) {
    snap = await service.act(snap.id, audience.id, { type: "admit" });
    continue;
  }
  const day = Math.floor(snap.view.time / 12);
  say(
    `day ${day}: ${audience.documents.length} papers [${audience.documents.map((d) => d.subject).join(" | ")}] oral ${audience.oralReports.length} calls ${snap.calls}`,
  );
  const specials =
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
  const t = Date.now();
  snap = await service.submit(snap.id, {
    audienceId: audience.id,
    items: audience.documents.map((d) =>
      d.draft
        ? { documentId: d.id, disposition: "follow_draft" as const }
        : {
            documentId: d.id,
            disposition: "custom" as const,
            edict: { kind: "acknowledge" as const, params: {} },
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
