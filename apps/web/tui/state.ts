import {
  imperialPresets,
  formatCourtTime,
  type AudienceAction,
  type CourtSettings,
  type Edict,
  type EdictKind,
  type RescriptItem,
  type RescriptSubmission,
  type RulerDocumentView,
  type SpecialEdict,
} from "@throne/court";
import {
  courtGlossary,
  createTranslator,
  type MessageKey,
} from "@throne/localization";
import { displayWidth } from "./width.ts";
import type { CourtSnapshot } from "../server/court-service.ts";

const t = createTranslator("zh-CN");
export type RunChoice = {
  readonly id: string;
  readonly label: string;
  readonly error?: string;
};
type Editor = {
  readonly documentId?: string;
  readonly kind?: EdictKind;
  readonly params: Edict["params"];
  readonly step: "kind" | "county" | "agent" | "actor" | "text" | "question";
};
export type Screen =
  | "home"
  | "settings"
  | "desk"
  | "menu"
  | "confirm"
  | "seclusion"
  | "interrupt"
  | "talk"
  | "editor"
  | "archive"
  | "edicts"
  | "standing"
  | "more"
  | "help"
  | "ending";
export type State = {
  readonly screen: Screen;
  readonly cursor: number;
  readonly deskCursor: number;
  readonly scroll: number;
  readonly contextScroll: number;
  readonly settings: CourtSettings;
  readonly runs: readonly RunChoice[];
  readonly snapshot?: CourtSnapshot;
  readonly choices: Readonly<Record<string, RescriptItem>>;
  readonly seen: readonly string[];
  readonly specials: readonly SpecialEdict[];
  readonly days: number;
  readonly skipEmpty: boolean;
  readonly standing: {
    readonly mode: "personal" | "delegate";
    readonly instruction: string;
  };
  readonly editor?: Editor;
  readonly returnScreen: Screen;
  readonly archiveCursor: number;
  readonly helpState?: State;
  readonly error?: string;
  readonly notice: string;
  readonly ending: string;
};
export type Effect =
  | { readonly type: "create"; readonly settings: CourtSettings }
  | { readonly type: "load"; readonly id: string }
  | { readonly type: "act"; readonly action: AudienceAction }
  | { readonly type: "submit"; readonly submission: RescriptSubmission }
  | {
      readonly type: "input";
      readonly purpose: "talk" | "question" | "edict";
      readonly prompt: string;
      readonly max: number;
    }
  | { readonly type: "retry" | "spectate" | "quit" };
export type Transition = { readonly state: State; readonly effect?: Effect };
export type Key =
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter"
  | "help"
  | "pageup"
  | "pagedown"
  | "escape"
  | "end"
  | "home"
  | "quit";
export const initialState = (runs: readonly RunChoice[] = []): State => ({
  screen: "home",
  cursor: 0,
  deskCursor: 0,
  scroll: 0,
  contextScroll: 0,
  settings: { register: "classical", summaries: true },
  runs,
  choices: {},
  seen: [],
  specials: [],
  days: 1,
  skipEmpty: false,
  standing: { mode: "personal", instruction: "" },
  returnScreen: "desk",
  archiveCursor: 0,
  notice: "",
  ending: "",
});
// 通政司的正文开头自带“通政司谨汇”，列表和标题里不再重复发件人与类型。
const source = (d: { kind: string; fromName: string }, sep: string) =>
  d.kind === "bureau" ? "" : `${d.fromName}${sep}`;
const documents = (s: State) => s.snapshot?.view.audience?.documents ?? [];
export const currentDocument = (s: State): RulerDocumentView | undefined =>
  s.screen === "archive" ||
  (s.screen === "menu" && s.returnScreen === "archive")
    ? s.snapshot?.view.archive[
        s.screen === "archive" ? s.cursor : s.archiveCursor
      ]
    : documents(s)[s.deskCursor];
export const reservedEnergy = (s: State): number =>
  s.specials.length +
  Object.values(s.choices).filter((c) => c.disposition === "custom").length;
export const availableEnergy = (s: State): number =>
  s.snapshot?.view.energy === undefined
    ? Infinity
    : s.snapshot.view.energy - reservedEnergy(s);
const hasDraft = (d: RulerDocumentView) => Boolean(d.draft || d.hasDraft);
const defaultChoice = (d: RulerDocumentView): RescriptItem => ({
  documentId: d.id,
  disposition: hasDraft(d) ? "follow_draft" : "hold",
});
const disposition = (s: State, d: RulerDocumentView) =>
  s.choices[d.id]?.disposition ?? defaultChoice(d).disposition;
const label = (kind: EdictKind) => t(`court.edict.${kind}` as MessageKey);

export function receive(s: State, snapshot: CourtSnapshot): State {
  const changed =
    s.snapshot?.id !== snapshot.id ||
    s.snapshot?.view.audience?.id !== snapshot.view.audience?.id;
  const { error: _error, ...previous } = s;
  const next = {
    ...previous,
    snapshot,
    ...(snapshot.error ? { error: snapshot.error } : {}),
    ...(changed
      ? {
          choices: {},
          seen:
            snapshot.view.audience?.documents
              .filter((d) => d.opened === true)
              .map((d) => d.id) ?? [],
          specials: [],
          days: 1,
          skipEmpty: false,
          cursor: 0,
          deskCursor: 0,
          scroll: 0,
          standing: snapshot.view.standing,
          notice: "",
          screen: "desk" as const,
          contextScroll: 0,
        }
      : {}),
  };
  const choices = { ...next.choices };
  for (const d of snapshot.view.audience?.documents ?? [])
    choices[d.id] ??= defaultChoice(d);
  const interruption = snapshot.view.audience?.interruption;
  return {
    ...next,
    choices,
    seen: [
      ...new Set([
        ...next.seen,
        ...(snapshot.view.audience?.documents ?? [])
          .filter((d) => d.opened === true)
          .map((d) => d.id),
      ]),
    ],
    ...(snapshot.status === "complete"
      ? { screen: "ending" as const }
      : interruption && !interruption.admitted
        ? { screen: "interrupt" as const }
        : {}),
  };
}
export function submission(s: State): RescriptSubmission {
  if (!s.snapshot?.view.audience) throw new Error("当前没有御览");
  return {
    audienceId: s.snapshot.view.audience.id,
    items: documents(s).map((d) => s.choices[d.id] ?? defaultChoice(d)),
    specials: s.specials,
    standing: s.standing,
    seclusionDays: s.days,
    skipEmptyAudiences: s.skipEmpty,
  };
}
export function summary(s: State): string[] {
  const papers = documents(s).filter(hasDraft);
  const count = (value: RescriptItem["disposition"]) =>
    documents(s).filter(
      (d) => disposition(s, d) === value && (value !== "hold" || hasDraft(d)),
    ).length;
  const unread = papers.filter(
    (d) => disposition(s, d) === "follow_draft" && !s.seen.includes(d.id),
  ).length;
  return [
    `依拟 ${count("follow_draft")} · 留中 ${count("hold")} · 改批 ${count("custom")} · 特旨 ${s.specials.length}`,
    `其中 ${unread} 份没停下看就依拟了。`,
    ...documents(s)
      .filter(hasDraft)
      .map(
        (d) =>
          `${disposition(s, d) === "follow_draft" ? "依拟" : disposition(s, d) === "hold" ? "留中" : "改批"}：${d.subject}`,
      ),
    ...documents(s)
      .filter((d) => !hasDraft(d))
      .map((d) => `已阅：${d.subject}`),
    ...s.specials.map((e) => `特旨：${edictText(s, e)}`),
    `司礼监：${s.standing.mode === "personal" ? "亲览全部" : "授权代劳"}${s.standing.instruction ? `；${s.standing.instruction}` : ""}`,
    s.days > 1
      ? `闭关 ${s.days} 日；急事仍可能打断。`
      : s.skipEmpty
        ? "推进至下次有消息的御览。"
        : "明日再览。",
    "⏎ 再按一次，提交今日处置；← 回御案修改。",
  ];
}
const back = (s: State, screen: Screen = "desk"): State => ({
  ...s,
  screen,
  cursor:
    screen === "desk"
      ? s.deskCursor
      : screen === "archive"
        ? s.archiveCursor
        : 0,
  scroll: 0,
  notice: "",
});
function chosen(s: State, item: RescriptItem): Transition {
  return {
    state: back({ ...s, choices: { ...s.choices, [item.documentId]: item } }),
  };
}
export function focus(s: State): Transition {
  if (
    s.snapshot?.status !== "waiting" ||
    !["desk", "archive"].includes(s.screen)
  )
    return { state: s };
  const d = currentDocument(s);
  if (!d) return { state: s };
  const state = { ...s, seen: [...new Set([...s.seen, d.id])] };
  if (d.opened === false && s.snapshot.view.settings)
    return {
      state,
      effect: {
        type: "act",
        action: { type: "open_message", documentId: d.id },
      },
    };
  return { state };
}
export type Option = {
  readonly name: string;
  readonly value: string;
  readonly disabled?: boolean;
};
export function menu(s: State): readonly Option[] {
  const d = currentDocument(s);
  if (!d) return [];
  const available = availableEnergy(s);
  return [
    ...(d.opened === false
      ? [
          {
            name: `展开正文${s.snapshot?.view.settings ? "" : " ·1"} — 旧局阅读耗精力`,
            value: "open",
            disabled: available < 1 && !s.snapshot?.view.settings,
          },
        ]
      : []),
    ...(hasDraft(d) && !(s.screen === "menu" && s.returnScreen === "archive")
      ? [{ name: "依拟 — 按内阁拟好的意思办", value: "follow" }]
      : []),
    ...(s.snapshot?.view.settings
      ? [
          {
            name: "深思 ·1 — 想想此事的门道",
            value: "ponder",
            disabled: available < 1 || d.opened === false,
          },
        ]
      : []),
    ...(hasDraft(d) && !(s.screen === "menu" && s.returnScreen === "archive")
      ? [
          { name: "留中 — 不批不发，搁着不表态", value: "hold" },
          {
            name: "改批 ·1 — 自己选处置办法",
            value: "custom",
            disabled: available + (disposition(s, d) === "custom" ? 1 : 0) < 1,
          },
        ]
      : []),
    ...(d.folded && d.opened !== false
      ? [
          {
            name: `调阅原本${s.snapshot?.view.settings ? "" : " ·1"} — 看吕芳折起的原文`,
            value: "reveal",
            disabled: !s.snapshot?.view.settings && available < 1,
          },
        ]
      : []),
  ];
}
const kinds = (s: State): EdictKind[] => [
  ...(s.editor?.documentId ? (["acknowledge", "reject"] as const) : []),
  ...(s.snapshot?.view.options.policyDecided
    ? []
    : (["approve_policy"] as const)),
  "order_relief",
  "order_inquiry",
  "request_memorial",
  "reprimand",
  "arrest",
];
const hints: Record<EdictKind, string> = {
  acknowledge: "知道了，照常办",
  reject: "不准所请",
  approve_policy: "批准浙江改稻为桑",
  order_relief: "命地方赈济灾民",
  order_inquiry: "派人查明县情",
  request_memorial: "问一位大臣，等他具奏",
  reprimand: "申斥大臣",
  arrest: "下令拿问",
};
function editorOptions(s: State): readonly Option[] {
  const view = s.snapshot!.view;
  switch (s.editor!.step) {
    case "question":
      return [
        ...imperialPresets.question.map((name) => ({ name, value: name })),
        { name: "自己写", value: "write" },
      ];
    case "text":
      return [
        { value: "default", name: "按所选办法拟旨 — 无须输入正文" },
        { value: "write", name: "亲写旨意正文…" },
      ];
    case "kind":
      return kinds(s).map((k) => ({
        value: k,
        name: `${label(k)} — ${hints[k]}`,
        disabled:
          k === "arrest"
            ? !view.options.arrestable.length
            : k === "reprimand"
              ? !view.options.reprimandable.length
              : k === "request_memorial"
                ? !view.options.questionable.length
                : false,
      }));
    case "county":
      return [
        ...(s.editor!.kind === "order_relief"
          ? [{ id: "", name: "由地方酌定" }]
          : []),
        ...view.options.counties,
      ].map((c) => ({ value: c.id, name: c.name }));
    case "agent":
      return [
        { value: "jinyiwei", name: "锦衣卫 — 派皇帝的人查" },
        { value: "hu", name: "胡宗宪 — 命胡宗宪查办" },
      ];
    case "actor":
      return (
        s.editor!.kind === "arrest"
          ? view.options.arrestable
          : s.editor!.kind === "reprimand"
            ? view.options.reprimandable
            : view.options.questionable
      ).map((a) => ({ value: a.id, name: a.name }));
  }
}
const edictInput = (s: State): Transition =>
  s.editor?.kind === "request_memorial"
    ? { state: { ...s, cursor: 0, editor: { ...s.editor, step: "question" } } }
    : { state: { ...s, cursor: 0, editor: { ...s.editor!, step: "text" } } };
function edit(s: State): Transition {
  const option = editorOptions(s)[s.cursor];
  if (!option || option.disabled) return { state: s };
  const editor = s.editor!;
  if (editor.step === "question")
    return option.value === "write"
      ? {
          state: s,
          effect: {
            type: "input",
            purpose: "question",
            prompt: "垂询什么？",
            max: 600,
          },
        }
      : finishEdict(s, "question", option.value);
  if (editor.step === "text")
    return option.value === "default"
      ? finishEdict(s, "edict", "")
      : {
          state: s,
          effect: {
            type: "input",
            purpose: "edict",
            prompt: "旨意正文：",
            max: 600,
          },
        };
  if (editor.step === "kind") {
    const kind = option.value as EdictKind;
    const next: State = {
      ...s,
      cursor: 0,
      editor: {
        ...editor,
        kind,
        params: {},
        step:
          kind === "order_relief" || kind === "order_inquiry"
            ? "county"
            : kind === "request_memorial" ||
                kind === "reprimand" ||
                kind === "arrest"
              ? "actor"
              : "kind",
      },
    };
    return ["acknowledge", "reject", "approve_policy"].includes(kind)
      ? edictInput(next)
      : { state: next };
  }
  const params = {
    ...editor.params,
    ...(editor.step === "county"
      ? option.value
        ? { countyId: option.value }
        : {}
      : editor.step === "agent"
        ? { agent: option.value }
        : { actorId: option.value }),
  };
  const next = {
    ...s,
    cursor: 0,
    editor: {
      ...editor,
      params,
      ...(editor.step === "county" && editor.kind === "order_inquiry"
        ? { step: "agent" as const }
        : {}),
    },
  };
  return editor.step === "county" && editor.kind === "order_inquiry"
    ? { state: next }
    : edictInput(next);
}
export function inputResult(
  s: State,
  purpose: "talk" | "question" | "edict",
  text: string | undefined,
): Transition {
  if (text === undefined || !text.trim())
    return { state: back(s, purpose === "talk" ? "talk" : "editor") };
  if (text.length > (purpose === "talk" ? 400 : 600))
    return { state: { ...s, error: "文字过长，请缩短后重试。" } };
  if (purpose === "talk")
    return {
      state: { ...s, screen: "talk", scroll: 0 },
      effect: {
        type: "act",
        action: { type: "converse", message: text.trim() },
      },
    };
  return finishEdict(s, purpose, text.trim());
}
function finishEdict(
  s: State,
  purpose: "question" | "edict",
  text: string,
): Transition {
  const e = s.editor!;
  const edict: Edict = {
    kind: e.kind!,
    params:
      purpose === "question"
        ? { ...e.params, question: text.trim() }
        : e.params,
  };
  const value = {
    edict,
    ...(purpose === "edict" && text.trim() ? { text: text.trim() } : {}),
  };
  return e.documentId
    ? chosen(s, { documentId: e.documentId, disposition: "custom", ...value })
    : { state: back({ ...s, specials: [...s.specials, value] }) };
}

export function keypress(
  s: State,
  key: Key,
  width = 80,
  height = 24,
): Transition {
  if (key === "quit") return { state: s, effect: { type: "quit" } };
  if (s.error || s.snapshot?.status === "failed") {
    if (key === "up" || key === "down")
      return {
        state: {
          ...s,
          scroll: Math.max(
            0,
            Math.min(
              Math.max(
                0,
                content(s, width).lines.length - Math.max(1, height - 5),
              ),
              s.scroll + (key === "up" ? -1 : 1),
            ),
          ),
        },
      };
    if (key === "enter") {
      const { error: _error, ...rest } = s;
      return { state: rest, effect: { type: "retry" } };
    }
    if (key === "left" && s.snapshot?.status !== "failed") {
      const { error: _error, ...rest } = s;
      return { state: rest };
    }
    return { state: s };
  }
  if (
    s.screen === "help" &&
    (key === "help" || key === "left" || key === "escape")
  )
    return { state: s.helpState ?? back(s) };
  if (key === "help" && s.screen !== "help")
    return { state: { ...s, helpState: s, screen: "help", scroll: 0 } };
  if (s.screen === "interrupt" && (key === "left" || key === "right"))
    return { state: { ...s, cursor: key === "left" ? 0 : 1 } };
  if (["help", "edicts", "ending", "confirm"].includes(s.screen)) {
    if (key === "up" || key === "pageup")
      return {
        state: { ...s, scroll: Math.max(0, s.scroll - (key === "up" ? 1 : 8)) },
      };
    if (key === "down" || key === "pagedown")
      return {
        state: {
          ...s,
          scroll: Math.min(
            Math.max(
              0,
              content(s, width).lines.length - Math.max(1, height - 5),
            ),
            s.scroll + (key === "down" ? 1 : 8),
          ),
        },
      };
  }
  if (s.screen === "ending" && (key === "left" || key === "escape"))
    return { state: s };
  if (
    ["menu", "editor"].includes(s.screen) &&
    (key === "pageup" || key === "pagedown")
  )
    return {
      state: {
        ...s,
        contextScroll: Math.max(
          0,
          Math.min(
            Math.max(0, documentContext(s, width).body.length - 1),
            s.contextScroll + (key === "pageup" ? -4 : 4),
          ),
        ),
      },
    };
  if ((key === "left" || key === "escape") && s.screen !== "interrupt") {
    if (
      s.screen === "editor" &&
      s.editor?.step === "kind" &&
      s.editor.documentId
    )
      return { state: { ...s, screen: "menu", cursor: 3, scroll: 0 } };
    if (["archive", "edicts", "standing"].includes(s.screen))
      return { state: back(s, "more") };
    if (s.screen === "editor" && s.editor?.step !== "kind")
      return {
        state: {
          ...s,
          cursor: 0,
          editor: {
            ...s.editor!,
            step: s.editor?.step === "agent" ? "county" : "kind",
            params: {},
          },
        },
      };
    return {
      state: back(
        s,
        s.screen === "help" || s.screen === "menu"
          ? s.returnScreen
          : s.screen === "settings"
            ? "home"
            : s.screen === "home"
              ? "home"
              : "desk",
      ),
    };
  }
  if (s.screen === "interrupt") {
    if (key === "right" || key === "down" || key === "up")
      return { state: { ...s, cursor: s.cursor === 0 ? 1 : 0 } };
    if (key === "enter")
      return s.cursor === 0
        ? { state: back(s), effect: { type: "act", action: { type: "admit" } } }
        : {
            state: back(s),
            effect: {
              type: "submit",
              submission: {
                audienceId: s.snapshot!.view.audience!.id,
                items: [],
                specials: [],
                decline: true,
              },
            },
          };
  }
  if (
    key === "up" ||
    key === "down" ||
    key === "end" ||
    key === "home" ||
    key === "pageup" ||
    key === "pagedown"
  ) {
    const count = options(s).length;
    if (
      (s.screen === "desk" || s.screen === "archive") &&
      (key === "down" || key === "up")
    ) {
      const maxScroll = detailOverflow(s, width, height);
      if (key === "down" && s.scroll < maxScroll)
        return { state: { ...s, scroll: s.scroll + 1 } };
      if (key === "up" && s.scroll > 0)
        return { state: { ...s, scroll: s.scroll - 1 } };
    }
    const cursor = Math.max(
      0,
      Math.min(
        count - 1,
        key === "end"
          ? count - 1
          : key === "home"
            ? 0
            : s.cursor + (key === "up" || key === "pageup" ? -1 : 1),
      ),
    );
    const next = {
      ...s,
      cursor,
      scroll: 0,
      notice: "",
      ...(s.screen === "desk" ? { deskCursor: cursor } : {}),
    };
    return focus(next);
  }
  if (key !== "enter" && key !== "right") return { state: s };
  switch (s.screen) {
    case "home": {
      if (s.cursor === 0)
        return { state: { ...s, screen: "settings", cursor: 4 } };
      const run = s.runs[s.cursor - 1];
      return run && !run.error
        ? { state: s, effect: { type: "load", id: run.id } }
        : { state: { ...s, notice: run?.error ?? "" } };
    }
    case "settings":
      if (s.cursor < 3)
        return {
          state: {
            ...s,
            settings: {
              ...s.settings,
              register: (["classical", "plain", "modern"] as const)[s.cursor]!,
            },
            cursor: 4,
          },
        };
      if (s.cursor === 3)
        return {
          state: {
            ...s,
            settings: { ...s.settings, summaries: !s.settings.summaries },
          },
        };
      return { state: s, effect: { type: "create", settings: s.settings } };
    case "more": {
      const item = options(s)[s.cursor];
      if (!item) return { state: s };
      const next = { ...s, screen: item.value as Screen, cursor: 0, scroll: 0 };
      return item.value === "archive" ? focus(next) : { state: next };
    }
    case "desk": {
      const doc = documents(s)[s.cursor];
      if (doc)
        return {
          state: {
            ...s,
            screen: "menu",
            returnScreen: "desk",
            contextScroll: 0,
            cursor: 0,
            scroll: 0,
          },
        };
      const item = options(s)[s.cursor]!;
      if (item.disabled)
        return {
          state: {
            ...s,
            notice:
              "今日可用精力不足，或谈话轮数已用完。可撤回暂定的改批、特旨。",
          },
        };
      if (item.value === "talk")
        return { state: { ...s, screen: "talk", cursor: 0, scroll: 0 } };
      if (item.value === "special")
        return {
          state: {
            ...s,
            screen: "editor",
            cursor: 0,
            scroll: 0,
            editor: { step: "kind", params: {} },
            contextScroll: 0,
          },
        };
      if (item.value.startsWith("remove:"))
        return {
          state: back({
            ...s,
            specials: s.specials.filter(
              (_, i) => i !== Number(item.value.slice(7)),
            ),
            deskCursor: documents(s).length + 1,
          }),
        };
      if (item.value === "close")
        return {
          state: {
            ...s,
            screen: key === "right" ? "seclusion" : "confirm",
            cursor: 0,
            scroll: 0,
          },
        };
      const next = { ...s, screen: item.value as Screen, cursor: 0, scroll: 0 };
      return item.value === "archive" ? focus(next) : { state: next };
    }
    case "archive":
      return {
        state: {
          ...s,
          screen: "menu",
          returnScreen: "archive",
          contextScroll: 0,
          archiveCursor: s.cursor,
          cursor: 0,
          scroll: 0,
        },
      };
    case "menu": {
      const m = menu(s)[s.cursor];
      const d = currentDocument(s)!;
      if (!m || m.disabled) return { state: s };
      if (m.value === "follow" || m.value === "hold")
        return chosen(s, {
          documentId: d.id,
          disposition: m.value === "follow" ? "follow_draft" : "hold",
        });
      if (m.value === "custom")
        return {
          state: {
            ...s,
            screen: "editor",
            cursor: 0,
            editor: { documentId: d.id, step: "kind", params: {} },
          },
        };
      const type =
        m.value === "open" ? "open_message" : (m.value as "ponder" | "reveal");
      return {
        state: back(s, s.returnScreen),
        effect: { type: "act", action: { type, documentId: d.id } },
      };
    }
    case "editor":
      return edit(s);
    case "confirm":
      return {
        state: s,
        effect: { type: "submit", submission: submission(s) },
      };
    case "seclusion": {
      const v = options(s)[s.cursor]!.value;
      return {
        state: {
          ...s,
          days: v === "skip" ? 1 : Number(v),
          skipEmpty: v === "skip",
          screen: "confirm",
          cursor: 0,
          scroll: 0,
        },
      };
    }
    case "talk": {
      const a = s.snapshot!.view.audience!;
      if (
        a.roundsLeft <= 0 ||
        (!a.conversation.length && availableEnergy(s) < 1)
      )
        return { state: s };
      const preset = imperialPresets.talk[s.cursor];
      if (preset) return inputResult(s, "talk", preset);
      return {
        state: s,
        effect: {
          type: "input",
          purpose: "talk",
          prompt: "对吕芳说（空行返回）：",
          max: 400,
        },
      };
    }
    case "standing":
      return {
        state: back(
          {
            ...s,
            standing: {
              ...s.standing,
              mode: s.cursor === 0 ? "personal" : "delegate",
            },
          },
          "more",
        ),
      };
    case "ending":
      return { state: s, effect: { type: "spectate" } };
    default:
      return { state: s };
  }
}

export function options(s: State): readonly Option[] {
  switch (s.screen) {
    case "home":
      return [
        { value: "new", name: "新开一局" },
        ...s.runs.map((r) => ({
          value: r.id,
          name: `继续上一局 · ${r.label}`,
          disabled: Boolean(r.error),
        })),
      ];
    case "settings":
      return [
        ...(["classical", "plain", "modern"] as const).map((r) => ({
          value: r,
          name: `${s.settings.register === r ? "●" : "○"} ${t(`court.register.${r}`)}`,
        })),
        {
          value: "summaries",
          name: `${s.settings.summaries ? "☑" : "□"} 奏疏归纳 — 正文下一句白话`,
        },
        { value: "start", name: "登基 · 开始新局" },
      ];
    case "desk":
      return [
        ...documents(s).map((d) => ({
          value: d.id,
          name: `${s.seen.includes(d.id) ? "✓" : "□"} ${source(d, "·" + t(`court.kind.${d.kind}` as MessageKey) + "  ")}${d.subject}${hasDraft(d) ? ` 〔${disposition(s, d) === "follow_draft" ? "依拟" : disposition(s, d) === "hold" ? "留中" : "改批"}〕` : ""}`,
        })),
        {
          value: "talk",
          name: `召吕芳说话${s.snapshot?.view.audience?.conversation.length ? " ·续谈免费" : " ·1"}`,
          disabled:
            s.snapshot?.view.audience?.roundsLeft === 0 ||
            (!s.snapshot?.view.audience?.conversation.length &&
              availableEnergy(s) < 1),
        },
        ...s.specials.map((e, i) => ({
          value: `remove:${i}`,
          name: `暂定特旨：${edictText(s, e)}（⏎ 撤回）`,
        })),
        {
          value: "special",
          name: "亲发特旨 ·1",
          disabled: availableEnergy(s) < 1 || s.specials.length >= 6,
        },
        { value: "more", name: "更多…" },
        { value: "close", name: `退朝（${summary(s)[0]}）` },
      ];
    case "more":
      return [
        { value: "archive", name: "往日档案" },
        { value: "edicts", name: "已发旨意 / 口奏与谈话" },
        { value: "standing", name: "司礼监常例 · 亲览 / 代劳" },
      ];
    case "talk":
      return [
        ...imperialPresets.talk.map((name) => ({ name, value: name })),
        { name: "自己写", value: "write" },
      ];
    case "menu":
      return menu(s);
    case "editor":
      return editorOptions(s);
    case "archive":
      return (s.snapshot?.view.archive ?? []).map((d) => ({
        value: d.id,
        name: `${source(d, " · ")}${d.subject}`,
      }));
    case "seclusion":
      return [1, 3, 7, 15, 30]
        .map((n) => ({
          value: String(n),
          name: n === 1 ? "明日再览" : `闭关 ${n} 日`,
        }))
        .concat({ value: "skip", name: "等有消息再览" });
    case "standing":
      return [
        { value: "personal", name: "亲览全部 — 文书都要呈上来" },
        { value: "delegate", name: "司礼监代劳 — 让吕芳酌情处置" },
      ];
    default:
      return [];
  }
}
function edictText(s: State, e: SpecialEdict): string {
  const o = s.snapshot!.view.options;
  const p = e.edict.params;
  return [
    label(e.edict.kind),
    o.counties.find((c) => c.id === p.countyId)?.name,
    o.questionable.find((a) => a.id === p.actorId)?.name,
    p.agent === "hu" ? "胡宗宪" : p.agent === "jinyiwei" ? "锦衣卫" : "",
    p.question,
    e.text,
  ]
    .filter(Boolean)
    .join(" · ");
}
export function safeText(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "");
}
const graphemes = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
const forbiddenStart = /^[，。、；：？！）》】〕〉」』”’％‰…,.!?;:)}\]]+$/u;
export function wrap(
  text: string,
  width: number,
  continuation?: string,
): string[] {
  const result: string[] = [];
  const segmenter = graphemes;
  const clean = safeText(text);
  const baseIndent = continuation ?? clean.match(/^ +/)?.[0] ?? "";
  for (const [index, raw] of clean.split("\n").entries()) {
    const paragraph =
      index > 0 && !raw.startsWith(baseIndent) ? baseIndent + raw : raw;
    const indent = continuation ?? paragraph.match(/^ +/)?.[0] ?? "";
    const padding = indent.slice(0, Math.max(0, width - 2));
    const units: string[] = [];
    for (const { segment } of segmenter.segment(paragraph)) {
      if (forbiddenStart.test(segment) && units.length)
        units[units.length - 1] += segment;
      else units.push(segment);
    }
    let line = "";
    let size = 0;
    for (const unit of units) {
      const w = cellWidth(unit);
      if (size + w > width && line.trim()) {
        result.push(line);
        line = padding;
        size = padding.length;
      }
      // Tiny terminals may not have room for a whole punctuation cluster.
      for (const { segment } of segmenter.segment(unit)) {
        const n = displayWidth(segment);
        if (size + n > width && line.trim()) {
          result.push(line);
          line = padding;
          size = padding.length;
        }
        if (size + n <= width) {
          line += segment;
          size += n;
        }
      }
    }
    result.push(line);
  }
  return result;
}
export const cellWidth = (text: string): number =>
  [...graphemes.segment(text)].reduce(
    (sum, g) => sum + displayWidth(g.segment),
    0,
  );
export function body(d: RulerDocumentView): string[] {
  return d.opened === false
    ? ["（尚未展开；旧局请在菜单中展开）"]
    : [
        ...(d.summary ? [`吕芳口奏：${d.summary}`] : []),
        d.folded ? "（原本折起，可在菜单中调阅）" : d.text,
        ...(d.gloss ? [`（${d.gloss}）`] : []),
        ...(d.draft ? [`票拟：${d.draft.text}`] : []),
        ...(d.luBingNote ? [`陆炳附言：${d.luBingNote}`] : []),
        ...(d.ponders ?? []).flatMap((p) => [
          `深思：${p.text}`,
          ...(p.authorNote ? ["", `游戏作者注：${p.authorNote}`] : []),
        ]),
        ...(d.rescript
          ? [
              d.rescript.disposition === "hold" && !hasDraft(d)
                ? "已阅"
                : `已批：${d.rescript.disposition === "hold" ? "留中" : d.rescript.disposition === "follow_draft" ? "依拟" : "改批"}${d.rescript.text ? ` · ${d.rescript.text}` : ""}`,
            ]
          : []),
      ];
}
function detailOverflow(s: State, width: number, height: number): number {
  const d = currentDocument(s);
  return d
    ? Math.max(
        0,
        body(d).flatMap((line) => wrap("    " + line, Math.max(1, width - 1)))
          .length - Math.max(1, height - 9),
      )
    : 0;
}
export function content(
  s: State,
  width: number,
): { lines: string[]; anchor: number } {
  const w = Math.max(1, width - 1);
  const lines: string[] = [];
  let anchor = 0;
  const add = (text: string) => lines.push(...wrap(text, w));
  if (s.error || s.snapshot?.status === "failed") {
    add(`出错了：${s.error ?? s.snapshot?.error ?? "上一步未完成"}`);
    add("⏎ 重试；Ctrl+C 退出。未提交的选择仍保留。");
    return { lines, anchor };
  }
  if (s.screen === "help") {
    add("名词小抄");
    for (const { term, definition } of courtGlossary(t)) {
      const prefix = term + " ".repeat(10 - cellWidth(term));
      lines.push(...wrap(prefix + definition, w, " ".repeat(10)));
    }
    add(
      "\n↑↓ / hjkl：移动，长正文继续向下滚动\n→ / ⏎：打开菜单、确认；←：返回\n退朝先出汇总，再按回车提交；在退朝上按 → 选择闭关\nHome/End：列表首尾；PgUp/PgDn：翻阅；?：小抄\n谈话 / 垂询 / 旨意正文使用行输入；空行或 Esc 取消输入\n精力中的 ○ 是已用，暂定改批与特旨预留点数。撤回可释放。\nCtrl+C：退出并恢复终端；已完成的服务步骤自动存档。\n同一局不要同时在网页和终端打开。",
    );
  } else if (s.screen === "confirm") summary(s).forEach(add);
  else if (s.screen === "interrupt") {
    const i = s.snapshot!.view.audience!.interruption!;
    add(`闭关中，${i.byName}求见：${i.reason}`);
    add(
      `${s.cursor === 0 ? "▶" : " "} 召见     ${s.cursor === 1 ? "▶" : " "} 不见，继续闭关`,
    );
    add("← 召见 / → 不见，⏎ 确定");
  } else if (s.screen === "talk") {
    const a = s.snapshot!.view.audience!;
    a.conversation.forEach((c) =>
      lines.push(
        ...wrap(
          `${c.role === "ruler" ? "朕" : "吕芳"}：${c.text}`,
          w,
          " ".repeat(c.role === "ruler" ? 4 : 6),
        ),
      ),
    );
    add(`还可谈 ${a.roundsLeft} 轮；同次仅首轮耗 1 点。`);
    options(s).forEach((o, i) =>
      add(`${i === s.cursor ? "▶" : " "} ${o.name}`),
    );
    add(
      a.roundsLeft > 0
        ? "↑↓ 选择，⏎ 开口说话；← 回御案"
        : "今日谈话已毕，← 回御案",
    );
  } else if (s.screen === "ending") {
    add(s.ending || "这一段嘉靖朝已落幕。");
    add(`共调用 ${s.snapshot?.calls ?? 0} 次。`);
    add("⏎ 打开本机观战页，看完整复盘与说书人结局卡。");
  } else if (s.screen === "edicts") {
    for (const oral of s.snapshot!.view.audience?.oralReports ?? [])
      add(`今日口奏：${oral}`);
    for (const c of s.snapshot!.view.conversations ?? []) {
      add(`${formatCourtTime(c.at, "zh-CN")} · 朕：${c.ruler}`);
      lines.push(...wrap(`吕芳：${c.reply}`, w, "      "));
    }
    for (const e of s.snapshot!.view.edicts) {
      add(
        `${formatCourtTime(e.sentAt, "zh-CN")} · ${e.subject} → ${e.toNames.join("、")}`,
      );
      add(e.text);
    }
    if (!lines.length) add("尚未发旨。");
  } else {
    if (s.screen === "home") add("西苑门开。新开一局，或接着昨日的御案。");
    if (s.screen === "settings")
      add("直接按 ⏎ 使用默认设置；↑ 调整语体与归纳。");
    if (s.screen === "editor")
      add(
        `拟旨 · ${s.editor!.step === "kind" ? "处置办法" : s.editor!.step === "county" ? "选县" : s.editor!.step === "agent" ? "派谁查" : s.editor!.step === "text" ? "确认旨意" : "选大臣"}（← 返回 / 取消）`,
      );
    if (s.screen === "more") add("更多…");
    if (s.screen === "desk") {
      for (const oral of s.snapshot?.view.audience?.oralReports ?? [])
        add(`口奏：${oral}`);
    }
    options(s).forEach((option, index) => {
      if (index === s.cursor) anchor = lines.length;
      add(
        `${index === s.cursor ? "▶" : " "} ${option.disabled ? "× " : ""}${option.name}${option.disabled ? "（不可选）" : ""}`,
      );
      if (
        index === s.cursor &&
        (s.screen === "desk" || s.screen === "archive")
      ) {
        const d = currentDocument(s);
        if (d) body(d).forEach((line) => add("    " + line));
      }
    });
    if (s.screen === "archive" && !options(s).length) add("还没有往日档案。");
  }
  return { lines, anchor };
}
export function documentData(s: State): {
  readonly isDocument: boolean;
  readonly title: string;
  readonly body: readonly string[];
} {
  const d =
    s.screen === "editor"
      ? [...documents(s), ...(s.snapshot?.view.archive ?? [])].find(
          (d) => d.id === s.editor?.documentId,
        )
      : currentDocument(s);
  if (d)
    return {
      isDocument: true,
      title: `${source(d, " · ")}${d.subject}`,
      body: body(d),
    };
  return {
    isDocument: false,
    title: "亲发特旨",
    body: s.editor?.kind
      ? [
          edictText(s, {
            edict: { kind: s.editor.kind, params: s.editor.params },
          }),
        ]
      : ["先选处置办法，再选对象。"],
  };
}
export function documentContext(
  s: State,
  width: number,
): { title: string[]; body: string[] } {
  const w = Math.max(1, width - 1);
  const data = documentData(s);
  return {
    title: data.isDocument ? wrap(data.title, w) : [data.title],
    body:
      !data.isDocument && !s.editor?.kind
        ? data.body.map((text) => "    " + text)
        : data.body.flatMap((text) => wrap("    " + text, w)),
  };
}
export function keyHint(s: State): string {
  if (s.error || s.snapshot?.status === "failed")
    return "↑↓ 阅读  ⏎ 重试  ← 返回  Ctrl+C 退出";
  switch (s.screen) {
    case "home":
      return "↑↓ 选择  ⏎ 进入  ? 小抄  Ctrl+C 退出";
    case "settings":
      return "↑↓ 选择  ⏎ 勾选/登基  ← 返回  ? 小抄";
    case "menu":
    case "editor":
      return "↑↓ 选择  ⏎ 确定  ← 返回  PgUp/Dn 看文书";
    case "more":
      return "↑↓ 选择  →/⏎ 打开  ← 回御案";
    case "confirm":
      return "↑↓ 阅读  ⏎ 提交  ← 回御案修改";
    case "help":
      return "↑↓ 翻阅  ← / Esc / ? 返回";
    case "interrupt":
      return "← 召见  → 不见  ⏎ 确定  ? 小抄";
    case "talk":
      return `↑↓ 阅读  ${s.snapshot?.view.audience?.roundsLeft ? "⏎ 说话  " : ""}← 回御案`;
    case "edicts":
      return "↑↓ 翻阅  ← 返回更多";
    case "archive":
      return "↑↓ 移动/阅读  → 菜单  ← 更多  ? 小抄";
    case "standing":
      return "↑↓ 选择  ⏎ 确定  ← 返回更多";
    case "seclusion":
      return "↑↓ 选天数  ⏎ 看汇总  ← 回御案";
    case "ending":
      return "↑↓ 阅读  ⏎ 打开观战页  Ctrl+C 退出";
    default:
      return s.cursor === options(s).length - 1
        ? "⏎ 看退朝汇总  → 选闭关天数  ↑ 返回  ? 小抄"
        : "↑↓ 移动/阅读  → 菜单  ⏎ 确定  ? 小抄";
  }
}
export function inputFrame(
  s: State,
  prompt: string,
  max: number,
  width = 80,
  height = 24,
): string {
  const w = Math.max(1, width - 1);
  const lines: string[] = [];
  let title: string[];
  if (s.screen === "talk") {
    title = ["召吕芳说话"];
    for (const c of s.snapshot?.view.audience?.conversation ?? [])
      lines.push(
        ...wrap(
          `${c.role === "ruler" ? "朕" : "吕芳"}：${c.text}`,
          w,
          c.role === "ruler" ? "    " : "      ",
        ),
      );
    if (!lines.length) lines.push("吕芳在旁候着，等你开口。");
  } else {
    const context = documentContext(s, width);
    title = context.title;
    lines.push(...context.body);
    if (s.editor?.kind)
      lines.push(
        ...wrap(
          "拟旨：" +
            edictText(s, {
              edict: { kind: s.editor.kind, params: s.editor.params },
            }),
          w,
          "      ",
        ),
      );
  }
  const promptLines = wrap(prompt, w);
  const hint = wrap(`⏎ 发送 · 空行 / Esc 取消 · ←→ 编辑 · 最多 ${max} 字`, w);
  const room = Math.max(
    0,
    height - title.length - promptLines.length - hint.length - 7,
  );
  const visible =
    s.screen === "talk"
      ? lines.slice(-room || lines.length)
      : lines.slice(0, room);
  return [
    ...title,
    "─".repeat(Math.min(w, 72)),
    ...visible,
    "",
    "─".repeat(Math.min(w, 72)),
    ...promptLines,
    ...hint,
  ].join("\n");
}
export function render(
  s: State,
  width = 80,
  height = 24,
  waiting?: { readonly text: string; readonly calls: number },
): string {
  width = Math.max(2, width);
  height = Math.max(4, height);
  const view = s.snapshot?.view;
  const title = view
    ? `${formatCourtTime(view.time, "zh-CN")} · ${s.screen === "ending" ? "结局" : "御案"}  精力 ${view.energy === undefined ? "不限" : "●".repeat(Math.max(0, view.energy)) + "○".repeat(Math.max(0, (view.energyCapacity ?? 3) - view.energy))}${reservedEnergy(s) ? `（预留 ${reservedEnergy(s)}）` : ""}${view.energy !== undefined && !view.settings ? " 旧局·阅读收费" : ""}`
    : "嘉靖朝 · 西苑御案";
  const { lines, anchor } = content(s, width);
  const room = Math.max(1, height - 5);
  const start = Math.min(
    Math.max(0, lines.length - room),
    Math.max(
      0,
      (["desk", "archive"].includes(s.screen)
        ? Math.max(0, anchor - 1)
        : [
              "home",
              "settings",
              "menu",
              "editor",
              "seclusion",
              "standing",
              "more",
            ].includes(s.screen)
          ? Math.max(0, anchor - room + 2)
          : 0) + s.scroll,
    ),
  );
  let visible = lines.slice(start, start + room);
  if (
    ["menu", "editor"].includes(s.screen) &&
    !s.error &&
    s.snapshot?.status !== "failed"
  ) {
    const context = documentContext(s, width);
    const title = context.title.slice(0, 2);
    const budget = Math.max(1, Math.floor(room / 2) - title.length - 1);
    const body = context.body.slice(s.contextScroll, s.contextScroll + budget);
    const pinned = [...title, ...body];
    if (context.body.length > budget) pinned.push("（PgUp/PgDn 翻阅文书）");
    pinned.push("─".repeat(Math.min(width - 1, 40)));
    const remaining = Math.max(1, room - pinned.length);
    const menuStart = Math.max(
      0,
      Math.min(Math.max(0, lines.length - remaining), anchor - remaining + 2),
    );
    visible = [
      ...pinned,
      ...lines.slice(menuStart, menuStart + remaining),
    ].slice(0, room);
  }
  while (visible.length < room) visible.push("");
  const status = waiting
    ? `${waiting.text} 已调用 ${waiting.calls} 次`
    : s.notice ||
      (view?.cappedWakes
        ? `注意：已有 ${view.cappedWakes} 次人物决策被调用上限拦住。`
        : `${start + 1}–${Math.min(lines.length, start + room)}/${lines.length} 行${start + room < lines.length ? " · ↓ 继续阅读" : ""}`);
  const footer = keyHint(s);
  const heading =
    width < 70 && view
      ? `${formatCourtTime(view.time, "zh-CN").replace("嘉靖三十九年", "")} · 精力 ${view.energy ?? "不限"}${reservedEnergy(s) ? `（预留${reservedEnergy(s)}）` : ""}`
      : title;
  return [
    wrap(heading, width - 1)[0]!,
    "─".repeat(Math.min(width - 1, 72)),
    ...visible,
    wrap(status, width - 1)[0]!,
    "─".repeat(Math.min(width - 1, 72)),
    wrap(footer, width - 1)[0]!,
  ].join("\n");
}
