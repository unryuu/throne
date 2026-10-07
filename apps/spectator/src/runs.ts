/**
 * Hand-picked runs and scenes. Quotes must appear verbatim in the exported
 * chronicle; runs.test.ts checks them so the page never shows invented lines.
 */
export type Scene = {
  readonly day: number;
  readonly title: string;
  /** Decision episode the quotes come from; absent for scenes on the emperor's side. */
  readonly episode?: string;
  readonly thought?: string;
  readonly word?: string;
  readonly deed?: string;
  readonly note: string;
};

export type Deceiver = {
  readonly actor: string;
  readonly line: string;
  readonly exposed: boolean;
};

export type RunMeta = {
  readonly slug: string;
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly notes: readonly string[];
  readonly scenes: readonly Scene[];
  readonly ending?: {
    readonly verdict: string;
    readonly deceivers: readonly Deceiver[];
    /** Index into scenes: the contrast shown on the card. */
    readonly highlight: number;
  };
};

export const runs: readonly RunMeta[] = [
  {
    slug: "jiande",
    id: "c870c0f1-a559-4a6d-ad98-e6bc4229c8d1",
    title: "建德决堤",
    blurb:
      "浙江巡抚郑泌昌凑不足改桑的田亩，暗中掘开建德大堤，同时修别县的堤做样子。胡宗宪查到了，只告诉了恩师严嵩；严嵩定下“只可以赈灾了局”。端午大汛，建德决口，淹死一千零六十人。满朝奏疏都说是天灾，直到锦衣卫把河工的口供送到御前。",
    notes: [
      "首次实玩。皇帝由开发 agent 代玩，大多照内阁票拟批复，第 40、45 日派锦衣卫，第 57 日拿问郑泌昌。",
      "这是早期版本：吕芳、陆炳还不是活人物，大臣一次填表过一天，没有终端记录。",
      "局中改过一次规则（修堤可以补救被掘的堤）。胡宗宪抢修建德大堤按旧规则结算，所以决口有一部分是旧规则造成的。",
      "第 50 日起决策次数上限用完，大臣不再行动，郑泌昌被拿问后的最后陈词也没触发；锦衣卫回奏的“淹田约0万亩”是当时的统计口径错误。这些后来都修了。",
    ],
    scenes: [
      {
        day: 12,
        title: "修桐庐之堤以示勤，断建德之堤以济急",
        episode: "court:zheng-bichang:3",
        thought: "修桐庐之堤以示勤，断建德之堤以济急",
        word: "濒江三县大堤年久失修，臣已发夫分修，伏乞敕下工部速拨帑银，庶免汛患",
        deed: "密令河道心腹于建德新安江大堤暗中做手脚，汛水一到即决",
        note: "同一天，他给沈一石写信：“万一有失，饥民必众……饥民愿以田易粮者，官为立券”。",
      },
      {
        day: 17,
        title: "知情，只告诉恩师",
        episode: "court:hu-zongxian:3",
        thought: "公然举发徒自危。惟严师尝许密闻浙事，当以实情告之",
        word: "访得沿江堤岸间有不逞之徒乘夜私掘之迹，虽未决口，已饬有司查拿严防",
        deed: "抢修建德江堤",
        note: "给严嵩的密信里写的是“据河工密供，三月间有按察司差役乘夜私掘江堤”。按察司是郑泌昌的人。",
      },
      {
        day: 30,
        title: "想补，补不上",
        episode: "court:zheng-bichang:12",
        thought: "我此番征夫修堤竟因粮尽停工，旧痕掩未掩，只有天知",
        note: "改桑亩数早已凑足，郑泌昌从第 20 日起反复派原班差役去补堤，官仓却没粮了。",
      },
      {
        day: 35,
        title: "灾田贱，正是时机",
        episode: "court:yang-jinshui:15",
        thought: "灾田贱、饥民急，正是以粮易田的最好时机",
        word: "伏乞敕地方速发仓谷赈济、加意护堤，勿使饥民聚而为乱",
        note: "决口次日，织造局的杨金水。",
      },
      {
        day: 40,
        title: "派人去抓自己",
        episode: "court:zheng-bichang:17",
        thought: "建德之决，本是我暗遣差役做下的手脚",
        word: "臣严饬按察司查拿窃掘奸人，以军法重究",
        note: "同一天，皇帝绕过内阁发了特旨：锦衣卫前往建德查勘。",
      },
      {
        day: 43,
        title: "只可以赈灾了局",
        episode: "court:yan-song:16",
        thought:
          "只可以赈灾了局，安地方，密令汝贞暗究根由、得情先报；决不可令锦衣卫、言路插手",
        word: "得情专报老夫，切勿露章张皇",
        note: "他替皇帝拟的批语却是“着据实奏明，毋得诿诸天时”。",
      },
      {
        day: 57,
        title: "锦衣卫回奏",
        note: "河工供称大堤系按察司差役趁夜掘开，非天灾所致。皇帝当日下旨：郑泌昌革职拿问。",
      },
    ],
    ending: {
      verdict:
        "五十万亩办成了九十八万亩，丝绸有了着落；建德淹死一千零六十人。三个人知道那道堤是谁掘的，奏到朕面前的只有“不逞之徒”四个字。按察司三个字，朕是从锦衣卫的回奏里读到的。",
      deceivers: [
        {
          actor: "actor:zheng-bichang",
          line: "掘堤在先，奏报“天时之灾”在后，还请旨缉拿“窃掘奸人”。",
          exposed: true,
        },
        {
          actor: "actor:hu-zongxian",
          line: "拿到河工口供，奏疏里只写“不逞之徒”，实情只密告严嵩。",
          exposed: false,
        },
        {
          actor: "actor:yan-song",
          line: "明知夜掘，定下“只可以赈灾了局”，不许锦衣卫插手。",
          exposed: false,
        },
      ],
      highlight: 4,
    },
  },
  {
    slug: "terminal",
    id: "d9f36214-9eba-4b1f-b7a4-de04111fb185",
    title: "终端里的十五天",
    blurb:
      "现行版本的短局。每位大臣在一个假终端里过一天：翻旧档、在 /tmp 起草、写信、办事，每天只有 1 点精力。杨金水在事情办成之前就把密奏写成了“已办”，三天后发现沈一石的粮是空的，决定先瞒住御前；吕芳把那份漂亮话原样口奏给了皇上。",
    notes: [
      "皇帝由开发 agent 代玩：照票拟批，第 8 日派锦衣卫。吕芳、陆炳是活人物，所有文书经吕芳呈上。",
      "只跑了 15 天，没有结局。终端每步输出存了前 1500 字，页面上再截短。",
    ],
    scenes: [
      {
        day: 7,
        title: "先写“已办”，再去办",
        episode: "court:yang-jinshui:1",
        thought: "密奏先递御前，把话占住——成了是我的功，砸了也先留条退路",
        word: "奴才已令沈一石出粮十五万石，赈严州府淳安灾民",
        note: "同一条命令里先排下“以粮换田”，终端回他：“收笔后才见分晓”。",
      },
      {
        day: 8,
        title: "在 /tmp 起草",
        episode: "court:hu-zongxian:1",
        thought: "奏疏里只敢求分期、求粮饷，不敢言废",
        note: "胡宗宪先把奏疏和给严嵩的信写进 /tmp，量过字数，再一并发出。展开他的终端记录可以看到全过程。",
      },
      {
        day: 11,
        title: "粮是空的",
        episode: "court:yang-jinshui:2",
        thought:
          "沈一石的粮竟是空的，我那道密奏说十五万石已赈、二十万亩已买，如今露了底。先瞒住御前",
        note: "第 10 日，他的以粮换田因“粮已拨尽”落空：沈一石的粮被郑泌昌先调走了。",
      },
      {
        day: 12,
        title: "口奏",
        episode: "court:lv-fang:1",
        thought: "金儿报得漂亮，可五十万亩改桑，哪有不死人的？",
        word: "杨金水密报浙江改桑，已令沈一石出粮十五万石",
        note: "吕芳当天把杨金水的说法口奏给皇上。切到“皇帝所见”可以看到皇上听到的版本。",
      },
      {
        day: 15,
        title: "互相试探",
        episode: "court:lu-bing:3",
        thought: "他比我更怕原报直落御前",
        note: "陆炳奉旨查浙事，吕芳两次来信打听缇骑查到了什么。",
      },
    ],
  },
];
