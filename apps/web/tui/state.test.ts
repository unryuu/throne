import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createInitialState,
  reduceCourtState,
  type RescriptSubmission,
} from "@throne/court";
import { replay } from "@throne/sim-core";
import {
  CourtService,
  type CourtSnapshot,
  type SavedCourtRun,
} from "../server/court-service.ts";
import { demoModel } from "./demo.ts";
import {
  availableEnergy,
  content,
  currentDocument,
  focus,
  initialState,
  inputResult,
  inputFrame,
  keyHint,
  keypress,
  menu,
  receive,
  render,
  submission,
  summary,
  wrap,
  type State,
  type Transition,
} from "./state.ts";
import { displayWidth } from "./width.ts";
import { listRuns } from "./local.ts";
import { decodeKey } from "./terminal.ts";

async function game() {
  const root = await mkdtemp(join(tmpdir(), "throne-tui-test-"));
  const service = new CourtService(root, () => demoModel);
  const snapshot = await service.create("zh-CN");
  expect(snapshot.error).toBeUndefined();
  const state = receive(initialState(), snapshot);
  async function settle(result: Transition): Promise<State> {
    const { effect } = result;
    if (!effect) return result.state;
    if (effect.type === "act")
      return receive(
        result.state,
        await service.act(
          snapshot.id,
          result.state.snapshot!.view.audience!.id,
          effect.action,
        ),
      );
    if (effect.type === "submit")
      return receive(
        result.state,
        await service.submit(snapshot.id, effect.submission),
      );
    throw new Error(`Unexpected effect ${effect.type}`);
  }
  return { root, service, snapshot, state, settle };
}
const paperIndex = (s: State) =>
  s.snapshot!.view.audience!.documents.findIndex((d) => d.hasDraft || d.draft);
const select = (s: State, cursor: number): State => ({
  ...s,
  cursor,
  deskCursor: cursor,
  scroll: 0,
  screen: "desk",
});
const close = (s: State): State =>
  select(
    s,
    s.snapshot!.view.audience!.documents.length + s.specials.length + 3,
  );
const advance = (s: State, ...keys: Parameters<typeof keypress>[1][]) =>
  keys.reduce((current, key) => keypress(current, key).state, s);

describe("terminal court decisions", () => {
  it("defaults to drafts without opening papers, confirms before submitting, and actually issues their edicts", async () => {
    const { state, settle, service, root, snapshot } = await game();
    const drafts = state.snapshot!.view.audience!.documents.filter(
      (d) => d.hasDraft,
    );
    expect(drafts.length).toBe(2);
    expect(
      submission(state)
        .items.filter((i) => i.disposition === "follow_draft")
        .map((i) => i.documentId),
    ).toEqual(drafts.map((d) => d.id));
    const confirm = keypress(close(state), "enter");
    expect(confirm.effect).toBeUndefined();
    expect(confirm.state.screen).toBe("confirm");
    expect(summary(confirm.state).join("\n")).toContain("2 份没停下看就依拟了");
    const sent = keypress(confirm.state, "enter");
    expect(sent.effect?.type).toBe("submit");
    const next = await settle(sent);
    expect(next.snapshot?.error).toBeUndefined();
    expect(next.snapshot!.view.time).toBeGreaterThan(snapshot.view.time);
    expect(next.snapshot!.view.edicts.length).toBeGreaterThanOrEqual(2);
    expect(
      next
        .snapshot!.view.archive.filter((d) => drafts.some((p) => p.id === d.id))
        .every((d) => d.rescript?.disposition === "follow_draft"),
    ).toBe(true);
    const saved = JSON.parse(
      await readFile(join(root, "runs/court", snapshot.id + ".json"), "utf8"),
    ) as SavedCourtRun;
    expect(
      replay(createInitialState(snapshot.id), saved.records, reduceCourtState),
    ).toEqual(saved.state);
    expect((await service.get(snapshot.id)).view.energy).toBe(2);
  });

  it("changes a draft to hold, can change it back, and preserves the choice across reading and failed actions", async () => {
    const { state, settle } = await game();
    let s = await settle(focus(select(state, paperIndex(state))));
    expect(s.snapshot!.view.energy).toBe(2);
    s = advance(s, "right", "down", "down", "enter");
    const id = currentDocument(s)!.id;
    expect(s.choices[id]!.disposition).toBe("hold");
    expect(summary(s)[0]).toContain("留中 1");
    const failed: CourtSnapshot = {
      ...s.snapshot!,
      status: "failed",
      error: "provider offline",
    };
    s = receive(s, failed);
    expect(s.choices[id]!.disposition).toBe("hold");
    expect(render(s)).toContain("provider offline");
    expect(keypress(s, "enter").effect).toEqual({ type: "retry" });
    const { error: _error, ...recovered } = s.snapshot!;
    s = receive(s, { ...recovered, status: "waiting" });
    s = advance(s, "right", "enter");
    expect(s.choices[id]!.disposition).toBe("follow_draft");
    s = advance(s, "right", "down", "down", "enter");
    const next = await settle(
      keypress(keypress(close(s), "enter").state, "enter"),
    );
    expect(next.snapshot?.error).toBeUndefined();
    expect(
      next.snapshot!.view.archive.find((d) => d.id === id)?.rescript
        ?.disposition,
    ).toBe("hold");
  });

  it("charges pondering through CourtService, blocks all paid options at zero, but still allows reading", async () => {
    const { state, settle } = await game();
    let s = await settle(focus(state));
    expect(s.snapshot!.view.energy).toBe(2);
    for (const energy of [1, 0]) {
      s = await settle(keypress(keypress(s, "right").state, "enter"));
      expect(s.snapshot?.error).toBeUndefined();
      expect(s.snapshot!.view.energy).toBe(energy);
    }
    expect(currentDocument(s)!.ponders).toHaveLength(2);
    const blocked = keypress(s, "right").state;
    expect(menu(blocked)[0]?.disabled).toBe(true);
    expect(keypress(blocked, "enter").effect).toBeUndefined();
    const nextDoc = await settle(keypress(s, "down"));
    expect(currentDocument(nextDoc)!.opened).toBe(true);
    expect(nextDoc.snapshot!.view.energy).toBe(0);
    expect(
      keypress(select(s, s.snapshot!.view.audience!.documents.length), "enter")
        .effect,
    ).toBeUndefined();
    expect(
      keypress(
        select(s, s.snapshot!.view.audience!.documents.length + 1),
        "enter",
      ).state.screen,
    ).toBe("desk");
    const draftMenu = keypress(select(s, paperIndex(s)), "right").state;
    expect(menu(draftMenu).find((m) => m.value === "custom")!.disabled).toBe(
      true,
    );
  });

  it("reserves custom and special energy, returns it on cancellation, and assembles county/agent/question parameters", async () => {
    const { state, settle } = await game();
    let s = await settle(focus(select(state, paperIndex(state))));
    s = advance(s, "right", "down", "down", "down", "enter");
    expect(s.screen).toBe("editor");
    const edit = keypress(s, "enter");
    expect(edit.state.editor?.step).toBe("text");
    s = keypress(edit.state, "enter").state;
    expect(availableEnergy(s)).toBe(1);
    const add = select(
      s,
      s.snapshot!.view.audience!.documents.length + s.specials.length + 1,
    );
    s = advance(add, "enter", "down", "down", "enter"); // inquiry
    expect(s.editor?.step).toBe("county");
    s = advance(s, "enter", "down");
    const text = keypress(advance(s, "enter", "down"), "enter");
    expect(text.effect?.type).toBe("input");
    s = inputResult(text.state, "edict", "查明实情").state;
    expect(s.specials[0]).toEqual({
      edict: {
        kind: "order_inquiry",
        params: {
          countyId: s.snapshot!.view.options.counties[0]!.id,
          agent: "hu",
        },
      },
      text: "查明实情",
    });
    expect(availableEnergy(s)).toBe(0);
    expect(
      menu(keypress(select(s, paperIndex(s)), "right").state).find(
        (m) => m.value === "ponder",
      )!.disabled,
    ).toBe(true);
    // Reverting the custom rescript releases one reserved point.
    s = advance(select(s, paperIndex(s)), "right", "enter");
    expect(availableEnergy(s)).toBe(1);
    // The staged special is a selectable row and can be removed.
    s = keypress(
      select(s, s.snapshot!.view.audience!.documents.length + 1),
      "enter",
    ).state;
    expect(s.specials).toHaveLength(0);
    expect(availableEnergy(s)).toBe(2);
    s = advance(
      select(s, s.snapshot!.view.audience!.documents.length + 1),
      "enter",
      "down",
      "down",
      "down",
      "enter",
    );
    expect(s.editor?.step).toBe("actor");
    const questionMenu = keypress(s, "enter").state;
    expect(questionMenu.editor?.step).toBe("question");
    const question = keypress({ ...questionMenu, cursor: 3 }, "enter");
    expect(question.effect).toMatchObject({
      type: "input",
      purpose: "question",
    });
    s = inputResult(question.state, "question", "堤防可还稳固？").state;
    const payload = submission(s);
    expect(payload.specials[0]?.edict).toEqual({
      kind: "request_memorial",
      params: {
        actorId: s.snapshot!.view.options.questionable[0]!.id,
        question: "堤防可还稳固？",
      },
    });
    const next = await settle({
      state: s,
      effect: { type: "submit", submission: payload },
    });
    expect(next.snapshot?.error).toBeUndefined();
    expect(
      next.snapshot!.view.edicts.some(
        (e) =>
          e.edict.kind === "request_memorial" &&
          e.edict.params.question === "堤防可还稳固？",
      ),
    ).toBe(true);
  });

  it("supports three rounds with Lü Fang at one total point, and cancels blank input", async () => {
    const { state, settle } = await game();
    let s = advance(
      select(state, state.snapshot!.view.audience!.documents.length),
      "enter",
    );
    expect(s.screen).toBe("talk");
    expect(inputResult(s, "talk", "").effect).toBeUndefined();
    for (let i = 0; i < 3; i++) {
      expect(keypress({ ...s, cursor: 3 }, "enter").effect).toMatchObject({
        type: "input",
        purpose: "talk",
      });
      s = await settle(inputResult(s, "talk", `第${i + 1}问，浙江如何？`));
      expect(s.snapshot?.error).toBeUndefined();
      expect(s.snapshot!.view.energy).toBe(1);
    }
    expect(s.snapshot!.view.audience!.roundsLeft).toBe(0);
    expect(keypress(s, "enter").effect).toBeUndefined();
    expect(content(s, 80).lines.join("\n")).toContain("奴婢不敢替地方打包票");
  });

  it("chooses seclusion with arrows, confirms its payload, and admits or declines interruptions", async () => {
    const { state } = await game();
    const s = advance(close(state), "right", "down", "down", "enter");
    expect(s.screen).toBe("confirm");
    const effect = keypress(s, "enter").effect as {
      type: "submit";
      submission: RescriptSubmission;
    };
    expect(effect.submission.seclusionDays).toBe(7);
    const snap = {
      ...state.snapshot!,
      view: {
        ...state.snapshot!.view,
        audience: {
          ...state.snapshot!.view.audience!,
          interruption: { byName: "吕芳", reason: "急报", admitted: false },
        },
      },
    };
    const interrupt = receive(state, snap);
    expect(interrupt.screen).toBe("interrupt");
    expect(
      keypress(keypress(interrupt, "right").state, "enter").effect,
    ).toMatchObject({
      type: "submit",
      submission: { decline: true, items: [], specials: [] },
    });
    const left = keypress(keypress(interrupt, "right").state, "left").state;
    expect(left.screen).toBe("interrupt");
    expect(keypress(left, "enter").effect).toEqual({
      type: "act",
      action: { type: "admit" },
    });
  });

  it("reads archives without accidentally acting on today’s selected paper and restores help exactly", async () => {
    const { state, settle } = await game();
    let s = await settle(
      keypress(keypress(close(state), "enter").state, "enter"),
    );
    const deskCursor = s.snapshot!.view.audience!.documents.length + 2;
    s = advance(select(s, deskCursor), "enter", "enter");
    expect(s.screen).toBe("archive");
    s = await settle(focus(s));
    const archiveId = currentDocument(s)!.id;
    s = keypress(s, "right").state;
    expect(currentDocument(s)!.id).toBe(archiveId);
    expect(menu(s).some((m) => m.value === "hold")).toBe(false);
    expect(keypress(keypress(s, "help").state, "left").state).toEqual(s);
    const ponder = keypress(s, "enter");
    expect(ponder.effect).toEqual({
      type: "act",
      action: { type: "ponder", documentId: archiveId },
    });
  });

  it("finishes an offline reign through the engine and opens the ending route without returning to a stale desk", async () => {
    const { state, settle, service, snapshot } = await game();
    let s = state;
    for (
      let step = 0;
      s.snapshot?.status !== "complete" && step < 100;
      step++
    ) {
      s =
        s.screen === "interrupt"
          ? await settle(keypress(keypress(s, "left").state, "enter"))
          : await settle({
              state: s,
              effect: {
                type: "submit",
                submission: { ...submission(s), seclusionDays: 30 },
              },
            });
      expect(s.snapshot?.error).toBeUndefined();
    }
    expect(s.snapshot?.status).toBe("complete");
    expect(s.screen).toBe("ending");
    expect(keypress(s, "left").state.screen).toBe("ending");
    expect(keypress(s, "enter").effect).toEqual({ type: "spectate" });
    expect((await service.review(snapshot.id)).state.summary).toHaveProperty(
      "deaths",
    );
    expect((await service.replay(snapshot.id)).verified).toBe(true);
  });

  it("lists unfinished saves and offers the explicit three register choices", async () => {
    const { root, snapshot } = await game();
    const runs = await listRuns(root);
    expect(runs.map((r) => r.id)).toEqual([snapshot.id]);
    let s = advance(
      initialState(runs),
      "enter",
      "up",
      "up",
      "enter",
      "up",
      "enter",
      "down",
    );
    expect(keypress(s, "enter").effect).toEqual({
      type: "create",
      settings: { register: "modern", summaries: false },
    });
    s = advance(initialState(runs), "down");
    expect(keypress(s, "enter").effect).toEqual({
      type: "load",
      id: snapshot.id,
    });
  });
});

describe("terminal rendering", () => {
  it("wraps Chinese, combining marks and emoji by display cells and strips terminal controls", () => {
    expect(wrap("甲乙ab丙", 4)).toEqual(["甲乙", "ab丙"]);
    expect(wrap("e\u0301中👨‍👩‍👧‍👦文", 4)).toEqual(["e\u0301中", "👨‍👩‍👧‍👦文"]);
    expect(wrap("\x1b[2J你好\x07", 8)).toEqual(["你好"]);
  });
  it("keeps the selected row visible and lets arrows reach the end of a long expanded body", async () => {
    const { state, settle } = await game();
    const opened = await settle(focus(state));
    const snap = opened.snapshot!;
    const documents = snap.view.audience!.documents.map((d, i) =>
      i === 0 ? { ...d, text: "长正文".repeat(300) + "最后一句。" } : d,
    );
    let s = receive(opened, {
      ...snap,
      view: { ...snap.view, audience: { ...snap.view.audience!, documents } },
    });
    let sawEnd = false;
    for (let i = 0; i < 300 && s.cursor === 0; i++) {
      const frame = render(s, 40, 12);
      expect(frame.split("\n")).toHaveLength(12);
      for (const line of frame.split("\n"))
        expect(displayWidth(line)).toBeLessThanOrEqual(39);
      sawEnd ||= frame
        .split("\n")
        .slice(2, -3)
        .map((line) => line.trim())
        .join("")
        .includes("最后一句");
      s = keypress(s, "down", 40, 12).state;
    }
    expect(sawEnd).toBe(true);
    expect(s.cursor).toBe(1);
    s = keypress(s, "end", 40, 12).state;
    expect(render(s, 40, 12)).toContain("▶ 退朝");
  });
  it("maps directional aliases and Ctrl+C without consuming Chinese line input", () => {
    expect(decodeKey("j", { name: "j" })).toBe("down");
    expect(decodeKey("?", {})).toBe("help");
    expect(decodeKey("\x03", { name: "c", ctrl: true })).toBe("quit");
    expect(decodeKey("中", {})).toBeUndefined();
  });
});

describe("terminal usability", () => {
  it("starts with one confirmation, and returns to ascend after selecting a register", () => {
    const s = keypress(initialState(), "enter").state;
    expect(s.cursor).toBe(4);
    expect(keypress(s, "enter").effect).toEqual({
      type: "create",
      settings: { register: "classical", summaries: true },
    });
    const modern = advance(s, "up", "up", "enter");
    expect(modern.cursor).toBe(4);
    expect(modern.settings.register).toBe("modern");
  });
  it("keeps retirement last and nests secondary screens under More", async () => {
    const { state } = await game();
    const last = keypress(state, "end").state;
    expect(render(last)).toContain("▶ 退朝");
    const more = advance(last, "up", "right");
    expect(more.screen).toBe("more");
    for (const name of ["往日档案", "已发旨意 / 口奏与谈话", "司礼监常例"])
      expect(render(more)).toContain(name);
    expect(render(state)).not.toContain("往日档案");
    expect(advance(more, "down", "enter", "left").screen).toBe("more");
    expect(keypress(more, "left").state.deskCursor).toBe(last.cursor - 1);
  });
  it("keeps paper context visible through menus, kinds, counties and agents, even when the paper is long", async () => {
    const { state, settle } = await game();
    const s = await settle(focus(select(state, paperIndex(state))));
    const doc = currentDocument(s)!;
    const menuState = keypress(s, "right").state;
    for (const screen of [
      menuState,
      advance(menuState, "down", "down", "down", "enter"),
    ]) {
      const frame = render(screen, 80, 24);
      expect(frame).toContain(doc.subject);
      expect(frame).toContain(doc.text.slice(0, 10));
      expect(frame).toContain("▶");
    }
    let edit = advance(
      menuState,
      "down",
      "down",
      "down",
      "enter",
      "down",
      "down",
      "down",
      "down",
      "enter",
    );
    expect(edit.editor?.step).toBe("county");
    expect(render(edit)).toContain(doc.subject);
    edit = keypress(edit, "enter").state;
    expect(edit.editor?.step).toBe("agent");
    expect(render(edit)).toContain(doc.subject);
    const snap = s.snapshot!;
    const long = receive(s, {
      ...snap,
      view: {
        ...snap.view,
        audience: {
          ...snap.view.audience!,
          documents: snap.view.audience!.documents.map((d) =>
            d.id === doc.id
              ? { ...d, text: "文书上下文".repeat(80) + "尾声。" }
              : d,
          ),
        },
      },
    });
    const opened = keypress(long, "right").state;
    expect(render(opened, 48, 16)).toContain(doc.subject);
    expect(render(opened, 48, 16)).toContain("文书上下文");
    const page = keypress(opened, "pagedown").state;
    expect(page.contextScroll).toBeGreaterThan(0);
    expect(page.cursor).toBe(opened.cursor);
    expect(render(page, 48, 16)).toContain("▶ 依拟");
  });
  it("uses hanging indents and keeps closing punctuation with the preceding character within terminal width", () => {
    const lines = wrap(
      "    这是正文，继续说话。还有右引号‘话语’和右括号（如此）。",
      20,
    );
    expect(lines.length).toBeGreaterThan(2);
    expect(
      wrap("    第一段。\n第二段仍须缩进，不能顶格。", 18).every((line) =>
        line.startsWith("    "),
      ),
    ).toBe(true);
    for (const line of lines) {
      expect(line.startsWith("    ")).toBe(true);
      expect(line.trimStart()).not.toMatch(/^[，。、；：？！）》】〕〉」』”’]/);
      expect(displayWidth(line)).toBeLessThanOrEqual(20);
    }
    expect(
      wrap("吕芳：" + "主子且听奴婢回话。".repeat(5), 24, "      ")
        .slice(1)
        .every((l) => l.startsWith("      ")),
    ).toBe(true);
  });
  it("shows one glossary term per row and contextual hints, restoring help with all three return keys", async () => {
    const { state } = await game();
    const help = keypress(state, "help").state;
    const lines = content(help, 96).lines;
    expect(lines.some((l) => /^依拟 +照大臣/.test(l))).toBe(true);
    expect(lines.some((l) => /^票拟 +内阁/.test(l))).toBe(true);
    for (const key of ["left", "escape", "help"] as const)
      expect(keypress(help, key).state).toEqual(state);
    expect(keyHint(help)).toContain("Esc / ? 返回");
    expect(keyHint({ ...state, screen: "confirm" })).toContain("⏎ 提交");
    expect(keyHint({ ...state, screen: "confirm" })).not.toContain("菜单");
    expect(keyHint({ ...state, screen: "settings" })).toContain("勾选/登基");
  });
  it("separates editable input from context, and blank or Escape cancels all input purposes", async () => {
    const { state, settle } = await game();
    let talk = advance(
      select(state, state.snapshot!.view.audience!.documents.length),
      "enter",
    );
    talk = await settle(inputResult(talk, "talk", "浙江如何？"));
    const frame = inputFrame(talk, "对吕芳说：", 400, 80, 24);
    expect(frame).toContain("朕：浙江如何？");
    expect(frame).toContain("吕芳：主子");
    expect(frame).toContain("\n对吕芳说：\n");
    expect(frame).not.toContain("? 小抄对吕芳");
    expect(inputResult(talk, "talk", "").effect).toBeUndefined();
    const paper = await settle(focus(select(state, paperIndex(state))));
    const editor = advance(
      paper,
      "right",
      "down",
      "down",
      "down",
      "enter",
      "enter",
    );
    for (const value of ["", undefined]) {
      const cancelled = inputResult(editor, "edict", value);
      expect(cancelled.state.choices).toEqual(editor.choices);
      expect(cancelled.state.screen).toBe("editor");
      expect(cancelled.effect).toBeUndefined();
    }
    expect(inputFrame(editor, "旨意正文：", 600)).toContain(
      currentDocument(paper)!.subject,
    );
  });
});
