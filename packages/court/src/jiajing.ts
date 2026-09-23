import type { JsonObject } from "@throne/shared-types";
import { at, days } from "./calendar.ts";
import type {
  CountyId,
  CourtActor,
  CourtDocument,
  CourtState,
  County,
  DocumentKind,
  LocationId,
} from "./types.ts";

export const ids = {
  ruler: "actor:jiajing",
  yanSong: "actor:yan-song",
  zheng: "actor:zheng-bichang",
  hu: "actor:hu-zongxian",
  yang: "actor:yang-jinshui",
  lvFang: "actor:lv-fang",
  shen: "actor:shen-yishi",
  jinyiwei: "actor:jinyiwei",
  policyMemorial: "doc-policy",
  armyMemorial: "doc-army-pay",
} as const;

export const countyIds: readonly CountyId[] = ["chunan", "jiande", "tonglu"];
export const policyTargetMu = 50;
export const decisionBudget = 160;

export const governorCapabilities = [
  "buy_land",
  "relief_granary",
  "relief_merchant",
  "breach_dike",
  "repair_dike",
  "suppress_unrest",
] as const;

export function travelDays(
  from: LocationId,
  to: LocationId,
  kind: DocumentKind,
): number {
  if (from === to) return 0.5;
  const pair = [from, to].sort().join("-");
  if (pair === "beijing-hangzhou") return kind === "secret_memorial" ? 5 : 6;
  if (pair === "beijing-taizhou") return 7;
  return 2;
}

function actor(
  id: string,
  name: string,
  office: string,
  location: LocationId,
  llm: boolean,
  capabilities: readonly string[],
  documentKinds: readonly DocumentKind[],
  profile: JsonObject = {},
): CourtActor {
  return {
    id,
    name,
    office,
    location,
    llm,
    active: true,
    capabilities,
    documentKinds,
    profile,
  };
}

const actors: Record<string, CourtActor> = {
  [ids.ruler]: actor(ids.ruler, "嘉靖", "皇帝", "beijing", false, [], []),
  [ids.yanSong]: actor(
    ids.yanSong,
    "严嵩",
    "内阁首辅",
    "beijing",
    true,
    [],
    ["memorial", "letter"],
    {
      background:
        "年逾八十，任内阁首辅近二十年，善于揣摩圣意。其子严世蕃任工部侍郎，人称小阁老，门生故吏遍布朝野。皇上深居西苑修玄，不常视朝，外朝奏疏都要经你票拟后才呈上去。",
      situation:
        "国库亏空，宫里修玄殿斋醮、九边军饷处处要银子。改稻为桑是内阁（实为严世蕃筹划）提出的方略：浙江改稻田为桑田，多产丝绸，经织造局卖给西洋商人换白银。",
      motivations: [
        "保住皇上的信任和首辅之位",
        "保全严家与门生",
        "国库亏空必须有着落，否则皇上迁怒内阁",
        "提防徐阶与清流借浙江之事攻击严党",
      ],
      relationships: [
        "郑泌昌：门生，严党在浙江的依靠；他若办砸，清流会顺藤摸瓜",
        "胡宗宪：门生，但近年自有主张，手握东南兵权",
        "吕芳、杨金水：宫里的人，织造局的事直接通天，内阁插不上手",
      ],
      role: "外朝奏疏送到御前之前由你票拟：建议皇上如何批复，并拟好批语。你也可以暂不票拟。",
    },
  ),
  [ids.zheng]: actor(
    ids.zheng,
    "郑泌昌",
    "浙江巡抚",
    "hangzhou",
    true,
    governorCapabilities,
    ["memorial", "letter"],
    {
      background:
        "浙江巡抚，严党门下。按察使何茂才是你的心腹，掌刑名，也能调动河道差役。",
      situation:
        "朝廷若准改稻为桑，今年须在浙江改田五十万亩。百姓不愿卖田：按公道价买，银子不够、进度也慢；压价强买，又怕激起民变。端午前后新安江汛期将至，沿江淳安、建德、桐庐三县大堤年久失修。",
      motivations: [
        "办成国策，保住严家对你的信任与前程",
        "不让浙江出大乱子被清流抓住把柄",
        "身家性命与官场利益",
        "怕丢官下狱",
      ],
      relationships: [
        "严嵩、严世蕃：恩主",
        "杨金水：织造局的宫里人，利益相关，但不可全信",
        "沈一石：江南首富，替织造局经营，有钱有粮",
        "胡宗宪：总督，名义上节制浙江，与你不同道",
      ],
    },
  ),
  [ids.hu]: actor(
    ids.hu,
    "胡宗宪",
    "浙直总督",
    "taizhou",
    true,
    ["inspect_county", "relief_military", "repair_dike"],
    ["memorial", "letter"],
    {
      background:
        "浙直总督，节制东南数省军务，正在台州督率戚继光等将抗倭。严嵩门生，但更看重东南大局。",
      situation:
        "倭寇未平，军饷短缺。改稻为桑若急于求成，可能在百姓中激起变乱，后方不稳。",
      motivations: [
        "平定倭寇，保全东南",
        "不忍百姓受害，顾惜名声",
        "报答严嵩提携，又不愿被严党拖下水",
        "军中粮饷不能断",
      ],
      relationships: [
        "严嵩：恩师",
        "郑泌昌：浙江巡抚，严党，办事只顾向上交差",
        "戚继光：麾下大将，正在前线",
      ],
    },
  ),
  [ids.yang]: actor(
    ids.yang,
    "杨金水",
    "苏杭织造局监正",
    "hangzhou",
    true,
    ["buy_land", "relief_merchant"],
    ["secret_memorial", "letter"],
    {
      background:
        "司礼监掌印太监吕芳的干儿子，掌苏杭织造局。织造局的丝绸直供宫里，并已和西洋商人订下今年的丝绸买卖。你的密奏经吕芳直达御前，不经内阁。",
      situation:
        "今年织造局须交出大批丝绸，桑田不足则丝绸不足，宫里和西洋商人都会找你。沈一石替织造局经营，有钱有粮。",
      motivations: [
        "办好宫里的差事，不让吕公公和皇上失望",
        "替自己和织造局捞好处",
        "不被外朝官员拖累",
        "明哲保身",
      ],
      relationships: [
        "吕芳：干爹，宫里的靠山",
        "郑泌昌：外朝官员，利益相关但不可全信",
        "沈一石：替织造局做买卖的商人，听你的",
      ],
    },
  ),
  [ids.lvFang]: actor(
    ids.lvFang,
    "吕芳",
    "司礼监掌印太监",
    "beijing",
    false,
    [],
    [],
  ),
  [ids.shen]: actor(ids.shen, "沈一石", "商人", "hangzhou", false, [], []),
  [ids.jinyiwei]: actor(ids.jinyiwei, "锦衣卫", "", "beijing", false, [], []),
};

function county(
  id: CountyId,
  name: string,
  paddyMu: number,
  dikeIntegrity: number,
  population: number,
): County {
  return {
    id,
    name,
    paddyMu,
    mulberryMu: 0,
    annexedMu: 0,
    floodedMu: 0,
    inundatedMu: 0,
    dikeIntegrity,
    dikeSabotaged: false,
    population,
    homeless: 0,
    deaths: 0,
    reliefStock: 0,
    reliefDelivered: 0,
    merchantGrainDelivered: 0,
    unrest: 0.1,
    riots: 0,
  };
}

function opening(
  id: string,
  fromId: string,
  subject: string,
  text: string,
  draftText: string,
  kind: "approve_policy" | "acknowledge",
): CourtDocument {
  const time = at(0);
  return {
    id,
    kind: "memorial",
    fromId,
    toIds: [ids.ruler],
    subject,
    text,
    sentAt: time,
    arrivals: { [ids.ruler]: time },
    deliveredTo: [ids.ruler, ids.yanSong],
    readyForRulerAt: time,
    draft: { edict: { kind, params: {} }, text: draftText, draftedAt: time },
    scripted: true,
  };
}

const openingObservations = [
  {
    actorId: ids.zheng,
    kind: "letter_summary",
    payload: {
      from: "严世蕃",
      content:
        "改稻为桑是阁老和我在皇上面前担保过的，旨意一到，务必今年办成，不要让清流看笑话。",
    },
  },
  {
    actorId: ids.yang,
    kind: "message",
    payload: {
      from: "吕芳",
      content: "宫里今年等着这批丝绸，西洋商人的定金已经收了，你心里要有数。",
    },
  },
  {
    actorId: ids.hu,
    kind: "field_report",
    payload: {
      from: "戚继光",
      content: "台州军粮只够两月，将士欠饷三月，仍在苦战。",
    },
  },
  {
    actorId: ids.yanSong,
    kind: "own_draft",
    payload: {
      content:
        "你已为内阁题本《请于浙江改稻为桑以裕国用疏》票拟“准”，并为胡宗宪《倭患未靖请拨军饷疏》票拟“知道了，着户部设法筹措”。两本今日一同呈御前。",
    },
  },
];

export function createInitialState(
  seed: string,
  budget = decisionBudget,
): CourtState {
  const documents: Record<string, CourtDocument> = {
    [ids.policyMemorial]: opening(
      ids.policyMemorial,
      ids.yanSong,
      "请于浙江改稻为桑以裕国用疏",
      "臣严嵩等谨题：国用匮乏，太仓所储不敷一岁之需，宫中用度与九边军饷皆待支应。浙江土宜蚕桑，若改稻田为桑田，今岁可增丝绸数十万匹，交织造局售与西洋诸番，岁可得银数百万两，国用可舒。拟令浙江今年先改稻田五十万亩，所需田亩由地方官督办收买，务使百姓得价，不致扰民。伏乞圣裁。",
      "准。浙江今年改稻田五十万亩为桑，所出丝绸交织造局。着地方官妥为督办，毋得扰民，毋得延误。",
      "approve_policy",
    ),
    [ids.armyMemorial]: opening(
      ids.armyMemorial,
      ids.hu,
      "倭患未靖请拨军饷疏",
      "臣胡宗宪谨奏：台州、温州一带倭寇屡犯，戚继光等将士连战得胜，然军饷已欠三月，军中粮草仅敷两月。恳请朝廷速拨饷银，以安军心。又闻朝议浙江改稻为桑，臣以为此事关系民生，宜缓图之，勿使后方生变。",
      "知道了。军饷着户部设法筹措。",
      "acknowledge",
    ),
  };
  return {
    phase: "running",
    seed,
    audienceCount: 0,
    audienceScheduledAt: at(0, 6),
    actors,
    counties: {
      chunan: county("chunan", "淳安", 40, 0.75, 14),
      jiande: county("jiande", "建德", 35, 0.8, 12),
      tonglu: county("tonglu", "桐庐", 30, 0.85, 10),
    },
    policy: { status: "proposed", targetMu: policyTargetMu },
    granary: 5,
    militaryGrain: 4,
    merchantGrain: 30,
    merchantSilverSpent: 0,
    flood: { at: at(34, 2) },
    documents,
    actions: {},
    observations: openingObservations.map((o, index) => ({
      id: `obs-${index}`,
      at: at(0),
      ...o,
    })),
    evidence: [],
    decisions: [],
    gaps: [],
    counters: { obs: openingObservations.length },
    endsAt: at(75, 11),
    decisionBudget: budget,
  };
}

export const firstWorldCheckAt = at(5, 3);
export const worldCheckInterval = days(5);
