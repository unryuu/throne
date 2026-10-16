import { formatCourtTime } from "@throne/court";
import type { CourtReview, CourtSnapshot } from "../../server/court-service.ts";
import {
  focus,
  initialState,
  inputResult,
  options,
  receive,
  type Effect,
  type Key,
  type State,
  type Transition,
} from "../../tui/state.ts";
import { press, selectOption } from "./controls.ts";
import type { CourtRequest } from "./api.ts";

export type InputEffect = Extract<Effect, { type: "input" }>;
export type InputPanel = {
  readonly effect: InputEffect;
  readonly text: string;
  readonly error: string;
};
export type DeskView = {
  readonly state: State;
  readonly busy: boolean;
  /** When the current wait began; the emperor sees only the palace, not who is busy. */
  readonly busySince: number | undefined;
  readonly input: InputPanel | undefined;
};
type Dependencies = {
  readonly request: CourtRequest;
  readonly remember: (snapshot: CourtSnapshot) => void;
  readonly packs: () => readonly string[];
  readonly operationId: () => string;
  readonly pause?: () => Promise<void>;
};
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export class DeskController {
  private view: DeskView;
  private readonly listeners = new Set<() => void>();
  private lastEffect: Effect | undefined;
  private progressId: string | undefined;
  constructor(
    private readonly deps: Dependencies,
    state: State = {
      ...initialState(),
      settings: { register: "plain", summaries: true },
    },
  ) {
    this.view = { state, busy: false, busySince: undefined, input: undefined };
  }
  getSnapshot = (): DeskView => this.view;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(patch: Partial<DeskView>): void {
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private setState(state: State): void {
    this.update({ state });
  }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.view.busy) return;
    this.update({ busy: true, busySince: Date.now() });
    try {
      await action();
    } catch (error) {
      this.setState({
        ...this.view.state,
        error:
          message(error) +
          (this.lastEffect?.type === "create" && !this.view.state.snapshot
            ? " 开局结果尚未确认；当前接口无法按请求号找回对局，重试会重新开局。"
            : ""),
      });
    } finally {
      this.progressId = undefined;
      this.update({ busy: false, busySince: undefined });
    }
  }
  async key(key: Key): Promise<void> {
    if (this.view.input) return;
    await this.run(() => this.dispatch(press(this.view.state, key)));
  }
  async choose(index: number, key: "enter" | "right" = "enter"): Promise<void> {
    if (this.view.input || this.view.busy) return;
    await this.run(async () => {
      const selected = selectOption(this.view.state, index);
      if (selected.state === this.view.state) return;
      await this.dispatch(selected);
      if (
        !this.view.state.error &&
        this.view.state.snapshot?.status !== "failed"
      )
        await this.dispatch(press(this.view.state, key));
    });
  }
  async shortcut(
    value: string,
    key: "enter" | "right" = "enter",
  ): Promise<void> {
    await this.choose(
      options(this.view.state).findIndex((o) => o.value === value),
      key,
    );
  }
  async load(id: string): Promise<void> {
    await this.run(() => this.execute({ type: "load", id }));
  }
  home(): void {
    if (this.view.busy || this.view.input) return;
    this.setState({
      ...initialState(this.view.state.runs),
      settings: this.view.state.settings,
    });
  }
  editInput(text: string): void {
    if (this.view.input && !this.view.busy)
      this.update({ input: { ...this.view.input, text, error: "" } });
  }
  async finishInput(cancel = false): Promise<void> {
    const panel = this.view.input;
    if (!panel || this.view.busy) return;
    if (!cancel && panel.text.length > panel.effect.max) {
      this.update({
        input: {
          ...panel,
          error: `最多 ${panel.effect.max} 字，请缩短后发送。`,
        },
      });
      return;
    }
    this.update({ input: undefined });
    await this.run(() =>
      this.dispatch(
        inputResult(
          this.view.state,
          panel.effect.purpose,
          cancel ? undefined : panel.text,
        ),
      ),
    );
  }
  private async dispatch(transition: Transition): Promise<void> {
    this.setState(transition.state);
    if (transition.effect) await this.execute(transition.effect);
  }
  private async accept(snapshot: CourtSnapshot): Promise<void> {
    this.setState({
      ...receive(this.view.state, snapshot),
      runs: [
        {
          id: snapshot.id,
          label: formatCourtTime(snapshot.view.time, "zh-CN"),
        },
        ...this.view.state.runs.filter((run) => run.id !== snapshot.id),
      ],
    });
    this.deps.remember(snapshot);
    if (snapshot.status === "complete") {
      const review = await this.deps.request<CourtReview>(
        `/${snapshot.id}/review`,
      );
      const summary = review.state.summary;
      if (!summary) throw new Error("完局存档缺少结局统计");
      this.setState({
        ...this.view.state,
        ending: `嘉靖朝 · 此局落幕\n改桑 ${summary.convertedMu} 万亩 / 目标 ${summary.targetMu} 万亩\n兼并 ${summary.annexedMu} 万亩 · 死亡 ${summary.deaths} 人 · 民变 ${summary.riots} 次\n事已至此。此局已存档。`,
      });
    }
  }
  private async execute(effect: Effect): Promise<void> {
    if (effect.type === "quit") {
      this.setState({
        ...this.view.state,
        notice: "已完成的步骤已存档，可以关闭页面；暂定处置需退朝后才保存。",
      });
      return;
    }
    if (effect.type === "spectate") {
      this.setState({
        ...this.view.state,
        notice: "手机版暂不启动本机观战服务。此局已存档，可在电脑端复盘。",
      });
      return;
    }
    if (effect.type === "input") {
      this.update({ input: { effect, text: "", error: "" } });
      return;
    }
    let next: CourtSnapshot;
    const s = this.view.state;
    this.progressId = s.snapshot?.id;
    if (effect.type === "retry") {
      if (s.snapshot?.status === "failed") {
        next = await this.deps.request<CourtSnapshot>(
          `/${s.snapshot.id}/retry`,
          {},
        );
      } else if (
        s.snapshot &&
        (this.lastEffect?.type === "act" ||
          this.lastEffect?.type === "submit" ||
          s.snapshot.status === "complete")
      ) {
        // A lost HTTP response does not prove that the paid action failed.
        next = await this.deps.request<CourtSnapshot>(`/${s.snapshot.id}`);
        if (next.status === "failed")
          next = await this.deps.request<CourtSnapshot>(
            `/${next.id}/retry`,
            {},
          );
        this.setState({
          ...this.view.state,
          notice: "已重新读取存档，请核对刚才的操作结果。",
        });
      } else if (this.lastEffect) {
        await this.execute(this.lastEffect);
        return;
      } else throw new Error("没有可重试的操作，请返回后重新选择。");
    } else {
      this.lastEffect = effect;
      switch (effect.type) {
        case "create":
          this.progressId = this.deps.operationId();
          next = await this.deps.request<CourtSnapshot>("", {
            locale: "zh-CN",
            settings: effect.settings,
            operationId: this.progressId,
            excludePackIds: this.deps.packs(),
          });
          break;
        case "load":
          this.progressId = effect.id;
          next = await this.deps.request<CourtSnapshot>(
            `/${encodeURIComponent(effect.id)}`,
          );
          break;
        case "act":
          if (!s.snapshot?.view.audience) throw new Error("当前没有御览");
          next = await this.deps.request<CourtSnapshot>(
            `/${s.snapshot.id}/act`,
            { audienceId: s.snapshot.view.audience.id, action: effect.action },
          );
          break;
        case "submit":
          if (!s.snapshot) throw new Error("当前没有对局");
          next = await this.deps.request<CourtSnapshot>(
            `/${s.snapshot.id}/rescript`,
            { submission: effect.submission },
          );
          break;
      }
    }
    while (next.status === "running") {
      this.progressId = next.id;
      await (this.deps.pause?.() ??
        new Promise((resolve) => setTimeout(resolve, 1200)));
      next = await this.deps.request<CourtSnapshot>(`/${next.id}`);
    }
    await this.accept(next);
    if (next.error || next.status === "failed") return;
    await this.dispatch(focus(this.view.state));
  }
}
