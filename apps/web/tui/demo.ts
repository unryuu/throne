import { ids, type CourtModel, type IntelligenceFact } from "@throne/court";

/** Deliberately fictional, offline practice; the real engine still settles every action. */
export const demoModel: CourtModel = async (r) => {
  if (r.ponder)
    return "这张纸说得好听，我却不能只凭一句顺遂就放心。先让地方据实回奏，再看看各人说法是否对得上。若急着批下去，往后出了事，他们便都说是奉旨办的。";
  if (r.summaries)
    return JSON.stringify({
      summaries: (r.input.texts as string[]).map(
        () => "演示归纳：先听他说，再想想该怎么办。",
      ),
    });
  if (r.bureau)
    return JSON.stringify({
      reports: (r.input.facts as unknown as IntelligenceFact[]).map((f) => ({
        id: f.id,
        title: f.titles[0],
        text: `通政司谨汇：${f.claim}谨请御览。`,
      })),
    });
  if (r.converse)
    return JSON.stringify({
      inner: "回禀主子。",
      reply:
        "主子，案上的折子都在这里。浙江的事，奴婢不敢替地方打包票，您若不放心，便让他们具折说清楚。",
      dispositions: [],
    });
  const input = r.input;
  return JSON.stringify({
    inner: "演示人物照常当值。",
    drafts: (
      (input.memorialsAwaitingYourDraft ?? []) as { memorialId: string }[]
    ).map((m) => ({
      memorialId: m.memorialId,
      edict: { kind: "acknowledge", params: {} },
      text: "知道了。",
    })),
    dispositions: ((input.inbox ?? []) as { documentId: string }[]).map(
      (d) => ({ documentId: d.documentId, action: "present" }),
    ),
    routes: (
      (input.reportsAwaitingRouting ?? []) as { reportId: string }[]
    ).map((d) => ({ reportId: d.reportId, channel: "directorate" })),
    ...(input.actorId === ids.yanSong
      ? {
          documents: [
            {
              kind: "brief",
              subject: "浙江改桑尚待圣裁",
              text: "浙江改稻为桑，地方俱候明旨。臣以为当先定章程，再令诸县遵行。",
            },
          ],
        }
      : {}),
  });
};
