import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { CourtService, type CourtSnapshot } from "../server/court-service.ts";
import { demoModel } from "./demo.ts";
import { listRuns, openSpectator } from "./local.ts";
import { Terminal } from "./terminal.ts";
import {
  focus,
  initialState,
  inputResult,
  inputFrame,
  keypress,
  receive,
  render,
  type Effect,
  type State,
  type Transition,
} from "./state.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const demo = process.argv.includes("--demo");
const serviceRoot = demo ? await mkdtemp(join(tmpdir(), "throne-demo-")) : root;
let calls = 0;
const service = new CourtService(
  serviceRoot,
  demo
    ? () => async (r) => {
        calls++;
        return demoModel(r);
      }
    : undefined,
);
let state: State = initialState(demo ? [] : await listRuns(root));
let terminal: Terminal | undefined;
let busy = false;
let stopped = false;
let lastEffect: Effect | undefined;
let ticker: ReturnType<typeof setInterval> | undefined;
let spectator: ChildProcess | undefined;
let pulse = 0;
let animation:
  { documentId: string; text: string; visible: number } | undefined;

const draw = () => {
  let shown = state;
  if (animation && state.snapshot?.view.audience) {
    const a = animation;
    shown = {
      ...state,
      snapshot: {
        ...state.snapshot,
        view: {
          ...state.snapshot.view,
          audience: {
            ...state.snapshot.view.audience,
            documents: state.snapshot.view.audience.documents.map((d) =>
              d.id === a.documentId
                ? {
                    ...d,
                    ponders:
                      d.ponders?.map((p, i) =>
                        i === d.ponders!.length - 1
                          ? {
                              ...p,
                              text: [...a.text].slice(0, a.visible).join(""),
                            }
                          : p,
                      ) ?? [],
                  }
                : d,
            ),
          },
        },
      },
    };
  }
  if (demo && !shown.notice)
    shown = { ...shown, notice: "演示模式 · 假模型 / 不联网 / 独立临时存档" };
  terminal?.draw(
    render(
      shown,
      process.stdout.columns || 80,
      process.stdout.rows || 24,
      busy && service.busyMessages().length
        ? { text: service.busyMessages().join(" "), calls }
        : undefined,
    ),
  );
};
function stop(code = 0): void {
  if (stopped) return;
  stopped = true;
  if (ticker) clearInterval(ticker);
  spectator?.kill();
  terminal?.close();
  process.exit(code);
}
process.once("SIGINT", () => stop(130));
process.once("SIGTERM", () => stop(143));
process.once("SIGHUP", () => stop(129));
process.once("uncaughtException", (error) => {
  terminal?.close();
  console.error(error);
  stop(1);
});
process.once("unhandledRejection", (error) => {
  terminal?.close();
  console.error(error);
  stop(1);
});

async function accept(snapshot: CourtSnapshot): Promise<void> {
  state = receive(state, snapshot);
  if (!demo) calls = snapshot.calls;
  if (snapshot.status === "complete") {
    const review = await service.review(snapshot.id);
    const summary = review.state.summary;
    if (!summary) throw new Error("完局存档缺少结局统计");
    state = {
      ...state,
      ending: `嘉靖朝 · 此局落幕\n改桑 ${summary.convertedMu} 万亩 / 目标 ${summary.targetMu} 万亩\n兼并 ${summary.annexedMu} 万亩 · 死亡 ${summary.deaths} 人 · 民变 ${summary.riots} 次\n${demo ? "这是演示假模型的结果。" : "事已至此。哪些奏报可信，哪些话另有隐情，复盘里自有分晓。"}`,
    };
  }
}
async function execute(effect: Effect): Promise<void> {
  if (effect.type === "quit") {
    stop();
    return;
  }
  if (effect.type === "input") {
    const text = await terminal!.input(() =>
      inputFrame(
        state,
        effect.prompt,
        effect.max,
        process.stdout.columns || 80,
        process.stdout.rows || 24,
      ),
    );
    lastEffect = effect;
    await dispatch(inputResult(state, effect.purpose, text));
    return;
  }
  if (effect.type === "spectate") {
    lastEffect = effect;
    if (demo) {
      state = {
        ...state,
        notice: `演示存档在 ${serviceRoot}，不列入本机真实对局。`,
      };
      return;
    }
    const opened = await openSpectator(root, state.snapshot!.id);
    spectator ??= opened.child;
    state = { ...state, ending: state.ending + "\n\n" + opened.message };
    return;
  }
  let next: CourtSnapshot;
  if (effect.type === "retry") {
    if (state.snapshot?.status === "failed")
      next = await service.retry(state.snapshot.id);
    else if (lastEffect && lastEffect.type !== "retry") {
      await execute(lastEffect);
      return;
    } else throw new Error("没有可重试的操作，请返回后重新选择。");
  } else {
    lastEffect = effect;
    switch (effect.type) {
      case "create":
        calls = 0;
        next = await service.create("zh-CN", effect.settings);
        break;
      case "load":
        next = await service.get(effect.id);
        break;
      case "act":
        next = await service.act(
          state.snapshot!.id,
          state.snapshot!.view.audience!.id,
          effect.action,
        );
        break;
      case "submit":
        next = await service.submit(state.snapshot!.id, effect.submission);
        break;
    }
  }
  await accept(next);
  if (next.error || next.status === "failed") return;
  if (effect.type === "act" && effect.action.type === "ponder") {
    const id = effect.action.documentId;
    const doc = [...next.view.audience!.documents, ...next.view.archive].find(
      (d) => d.id === id,
    );
    const text = doc?.ponders?.at(-1)?.text;
    if (text && next.view.audience!.documents.some((d) => d.id === id))
      animation = { documentId: id, text, visible: 0 };
  }
  const focused = focus(state);
  state = focused.state;
  if (focused.effect) await execute(focused.effect);
}
async function dispatch(result: Transition): Promise<void> {
  state = result.state;
  if (result.effect) await execute(result.effect);
}
try {
  terminal = new Terminal();
  ticker = setInterval(() => {
    pulse++;
    if (busy) draw();
  }, 1600);
  const typewriter = setInterval(() => {
    if (!animation || busy) return;
    animation = { ...animation, visible: animation.visible + 4 };
    if (animation.visible >= [...animation.text].length) animation = undefined;
    draw();
  }, 35);
  typewriter.unref();
  terminal.listen((key) => {
    if (key === "quit") {
      stop();
      return;
    }
    if (busy) return;
    animation = undefined;
    const result = keypress(
      state,
      key,
      process.stdout.columns || 80,
      process.stdout.rows || 24,
    );
    busy = Boolean(result.effect);
    state = result.state;
    draw();
    void dispatch(result)
      .catch((error: unknown) => {
        state = {
          ...state,
          error: error instanceof Error ? error.message : String(error),
        };
      })
      .finally(() => {
        busy = false;
        draw();
      });
  }, draw);
  draw();
} catch (error) {
  terminal?.close();
  console.error(error instanceof Error ? error.message : String(error));
  stop(1);
}
