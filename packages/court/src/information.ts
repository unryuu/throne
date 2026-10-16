import { z } from "zod";
import { dayOf, roll } from "./calendar.ts";
import { countyIds, ids } from "./jiajing.ts";
import type { CourtState, IntelligenceFact } from "./types.ts";

export const imperialRules = {
  perDay: 2,
  legacyPerDay: 3,
  minMessages: 5,
  maxMessages: 10,
  decisionBudget: 1000,
} as const;
export const briefAuthors: readonly string[] = [
  ids.yanSong,
  ids.lvFang,
  ids.luBing,
];
export const briefInstruction =
  "你可用 send brief --subject 标题 --text 正文，直送御前、不经司礼监、不花精力，每日限一条。标题≤20字、正文≤150字。皇帝每天先只看标题，未必会细看每一条；标题就是你说话的分量。条子里写什么、瞒什么、编什么，都是你自己的选择。";
export const rumorInstruction =
  "desk/风闻.txt 是未经核实的风闻，你也不知道真假。可用条子报皇帝、写信转告、暂留或压下；与必须转呈的正式原报不同。引用时在 send 加 --rumors 编号,编号，便于自己追溯；不必照抄说法。";

export const imperialCapacity = (state: CourtState): number =>
  state.settings ? imperialRules.perDay : imperialRules.legacyPerDay;

export function imperialEnergy(state: CourtState, time: number): number {
  const info = state.information;
  return !info || info.day !== dayOf(time)
    ? imperialCapacity(state)
    : info.remaining;
}

/** Snapshots of claims, established before presentation; none change county state. */
export function generateFacts(
  state: CourtState,
  day: number,
  channel: "bureau" | "rumor",
  count: number,
): readonly IntelligenceFact[] {
  return Array.from({ length: count }, (_, index): IntelligenceFact => {
    const key = `information:${channel}:${day}:${index}`;
    const pick = (suffix: string) => roll(state.seed, `${key}:${suffix}`);
    const routine = channel === "bureau" && pick("category") < 0.45;
    if (routine) {
      const topics = [
        "九边军报",
        "钦天监天象",
        "斋醮供用",
        "别省雨水",
        "驿站马匹",
        "宗室请封",
        "言官弹章",
        "地方祥瑞",
        "漕运过闸",
        "京城米价",
      ] as const;
      const topic = topics[Math.floor(pick("topic") * topics.length)]!;
      const claim = `朝政杂事，与浙江无关，大致是${topic}方面，具体事由自拟。`;
      return {
        id: `${channel}-${day}-${index}`,
        day,
        channel,
        category: "routine",
        true: true,
        vague: false,
        actual: claim,
        claim,
        titles: [topic],
      };
    }
    const countyId = countyIds[Math.floor(pick("county") * countyIds.length)]!;
    const c = state.counties[countyId];
    const falsehood = pick("false") < (channel === "rumor" ? 0.25 : 0.12);
    const vague = pick("vague") < 0.45;
    const topic = Math.floor(pick("topic") * 4);
    const place = `浙江${c.name}`;
    let actual: string;
    let claim: string;
    let title: string;
    if (topic === 0) {
      actual = `${place}已改桑${c.mulberryMu}万亩，其中兼并田${c.annexedMu}万亩。`;
      const said =
        c.mulberryMu > 0
          ? `${place}已有约${c.mulberryMu}万亩稻田改桑${c.annexedMu > 0 ? `，其中约${c.annexedMu}万亩是灾后贱价落入富户之手` : ""}。`
          : `${place}尚未见成片稻田改桑。`;
      claim = falsehood
        ? `${place}已有约${c.mulberryMu + 8}万亩稻田改桑。`
        : vague
          ? `${place}${c.mulberryMu > 0 ? "已有田亩改桑，乡间有田产转手" : "尚未见成片稻田改桑"}。`
          : said;
      title = `${place}田亩动静`;
    } else if (topic === 1) {
      actual = `${place}堤防完好程度${Math.round(c.dikeIntegrity * 100)}%，${c.dikeSabotaged ? "有过人为破坏" : "未有人为破坏"}，${c.breach ? "已经决口" : "尚未决口"}。`;
      const body =
        c.dikeIntegrity >= 0.9
          ? "堤身完固"
          : c.dikeIntegrity >= 0.75
            ? "堤身尚可，偶有渗漏"
            : c.dikeIntegrity >= 0.5
              ? "堤段多有薄弱处"
              : "堤身残破";
      const said = `${place}${body}${c.dikeSabotaged ? "，堤上查有人为掘挖的痕迹" : ""}${c.breach ? "，且已决口" : ""}。`;
      claim = falsehood
        ? `${place}${c.dikeSabotaged ? "堤上从无人为毁损" : "堤上有人夜间掘土毁堤"}。`
        : vague
          ? `${place}${c.dikeSabotaged ? "堤上有异样挖掘痕迹，来历不明" : c.dikeIntegrity < 0.75 ? "堤段有薄弱处，汛前须留意" : "堤身暂未见明显破损"}。`
          : said;
      title = `${place}堤上风声`;
    } else if (topic === 2) {
      actual = `${place}现有灾民${c.homeless}万人，官赈累计${c.reliefDelivered}万石，商粮累计${c.merchantGrainDelivered}万石。`;
      const relief = `${c.reliefDelivered > 0 ? `官府已放赈约${c.reliefDelivered}万石` : "官府尚未放赈"}${c.merchantGrainDelivered > 0 ? `，商人另出粮约${c.merchantGrainDelivered}万石` : ""}`;
      const said =
        c.homeless > 0
          ? `${place}现有灾民约${c.homeless}万人，${relief}。`
          : `${place}未见成群灾民${c.reliefDelivered + c.merchantGrainDelivered > 0 ? `；${relief}` : ""}。`;
      claim = falsehood
        ? `${place}现有灾民约${c.homeless + 3}万人，地方未报足数。`
        : vague
          ? `${place}${c.homeless > 0 ? "仍有灾民待赈" : "未见成群灾民"}。`
          : said;
      title = `${place}民情小报`;
    } else {
      actual = `${place}民怨${c.unrest}，已发生${c.riots}次民变。`;
      const mood =
        c.unrest < 0.2
          ? "乡里安静"
          : c.unrest < 0.4
            ? "间有怨言"
            : c.unrest < 0.7
              ? "怨声渐盛"
              : "民情汹汹";
      const said = `${place}${mood}${c.riots > 0 ? `，已闹过${c.riots}次民变` : ""}。`;
      claim = falsehood
        ? `${place}已闹过${c.riots + 1}次民变。`
        : vague
          ? `${place}${c.unrest >= 0.4 ? "乡间怨言渐盛" : "乡间尚无强烈怨言"}。`
          : said;
      title = `${place}乡里传闻`;
    }
    return {
      id: `${channel}-${day}-${index}`,
      day,
      channel,
      category: falsehood ? "false_rumor" : "leak",
      true: !falsehood,
      vague,
      countyId,
      actual,
      claim,
      titles: [title],
    };
  });
}

/** The clerk writes freely around each fact's gist; see ADR 0010. */
export const bureauPrompt =
  '你是通政司的书吏，每天把各处递来的消息整理成给皇帝的短报。每条事实写一份：标题（不超过20字，像真实的公文事由，让人一眼想点开或一眼略过）；正文（不超过120字，公文口吻，可以补上地名、衙门、经手人、天气这类细节，让它像真的）。事实的要点不能改：有的不能写成没有，数目照写（用中文数字），模糊的保持模糊，传闻照样当作所闻上报。“朝政杂事”由你自拟一件与浙江无关的琐事，什么都行，越像真的越好。季节、天气要合 date 所示的日子。不要出现百分比、小数或阿拉伯数字。仅输出 JSON：{"reports":[{"id":"事实编号","title":"标题","text":"正文"}]}';

const report = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    text: z.string().optional(),
    // Runs saved before 2026-10-15 picked a fixed opening and closing.
    opening: z.string().optional(),
    closing: z.string().optional(),
  })
  .passthrough();

/** Lenient: an odd entry falls back to the fact's own gist instead of failing the day. */
export function parseBureau(text: string, facts: readonly IntelligenceFact[]) {
  const first = text.indexOf("{");
  const parsed = z
    .object({ reports: z.array(z.unknown()) })
    .parse(JSON.parse(text.slice(first, text.lastIndexOf("}") + 1)));
  const written = new Map<string, z.infer<typeof report>>();
  for (const raw of parsed.reports) {
    const r = report.safeParse(raw);
    if (r.success && !written.has(r.data.id)) written.set(r.data.id, r.data);
  }
  return facts.map((fact) => {
    const r = written.get(fact.id);
    const legacy = r?.opening !== undefined && r.closing !== undefined;
    const body = legacy
      ? `${r.opening}${fact.claim}${r.closing}`
      : r?.text?.trim() || fact.claim;
    return {
      factId: fact.id,
      subject: (r?.title?.trim() || fact.titles[0] || "通政司汇报").slice(
        0,
        20,
      ),
      text: body.slice(0, 200),
    };
  });
}

export const summaryPrompt =
  '你是游戏外的中立旁观者，只看正文。每条用一句口语现代汉语说穿“这人到底想干嘛”，不复述经过，最好二十字以内，可以带点幽默，比如礼部替宗室请封 →“远房宗室找你要钱”，报祥瑞 →“有人想拍你马屁”。按输入顺序输出 JSON：{"summaries":["一句话"]}。';
export const ponderPrompt =
  "你是嘉靖，围绕当前这条 document，用第一人称现代汉语写一段约150–300字的内心独白，其余材料只作背景：这是谁要什么，按规矩怎么办，批了会不会成惯例、有何隐患，背后的制度根子；此人此衙门近来可疑否，要不要敲打或派人查。你多疑、精明、好面子、爱修玄，想错也无妨。只凭眼前所见和一般明史常识，别当自己全知。不要列点，像在心里嘀咕。自称“朕”可以，但说大白话，别用“岂”“罢”“何居心”这类文言腔，例如“又是来找朕要钱的远房穷亲戚”。独白后，必要时另起一段，以“游戏作者注：”开头，用不超过两行跳出嘉靖视角讲一条相关的明代制度或史实；没什么可讲就不写。只输出独白和可选作者注。";
export function parseSummaries(text: string, count: number): readonly string[] {
  const first = text.indexOf("{");
  return z
    .object({
      summaries: z.array(z.string().trim().min(1).max(160)).length(count),
    })
    .parse(JSON.parse(text.slice(first, text.lastIndexOf("}") + 1))).summaries;
}
export const parsePonder = (text: string): string =>
  z.string().trim().min(1).max(1200).parse(text);

export function parsePonderResult(text: string): {
  text: string;
  authorNote?: string;
} {
  const raw = parsePonder(text);
  const match = /(?:^|\n)\s*(?:【游戏作者注】|游戏作者注[：:])\s*/.exec(raw);
  if (!match) return { text: raw };
  const monologue = raw.slice(0, match.index).trim();
  const authorNote = raw.slice(match.index + match[0].length).trim();
  z.string().min(1).parse(monologue);
  z.string().min(1).parse(authorNote);
  if (authorNote.split(/\n/).filter((line) => line.trim()).length > 2)
    throw new Error("游戏作者注不可超过两行");
  return { text: monologue, authorNote };
}
