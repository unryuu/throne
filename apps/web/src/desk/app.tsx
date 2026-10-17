import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { formatCourtTime } from "@throne/court";
import { courtGlossary, createTranslator } from "@throne/localization";
import {
  body,
  currentDocument,
  documentData,
  options,
  reservedEnergy,
  safeText,
  summary,
  type State,
} from "../../tui/state.ts";
import {
  atmosphereLine,
  atmosphereLines,
  waitedText,
} from "../../tui/atmosphere.ts";
import { gameKey, inputKey, thumbActions } from "./controls.ts";
import { DeskController, type InputPanel } from "./controller.ts";

const titles: Record<State["screen"], string> = {
  home: "西苑御案",
  settings: "登基之前",
  desk: "今日御案",
  menu: "文书处置",
  confirm: "退朝之前",
  seclusion: "何时再览",
  interrupt: "闭关中有人求见",
  talk: "召见吕芳",
  editor: "拟旨",
  archive: "往日档案",
  edicts: "旨意与口奏",
  standing: "司礼监常例",
  more: "更多",
  help: "名词小抄",
  ending: "此局落幕",
};
function Paragraphs({ lines }: { readonly lines: readonly string[] }) {
  return (
    <>
      {lines.filter(Boolean).map((line, i) => (
        <p key={i}>{safeText(line)}</p>
      ))}
    </>
  );
}
function Context({ state }: { readonly state: State }) {
  const context = documentData(state);
  return (
    <article className="paper">
      <h2>{safeText(context.title)}</h2>
      <Paragraphs lines={context.body} />
    </article>
  );
}
function ScreenContent({ state }: { readonly state: State }) {
  const view = state.snapshot?.view;
  switch (state.screen) {
    case "home":
      return (
        <div className="welcome">
          <p className="eyebrow">嘉靖三十九年 · 西苑</p>
          <h2>天下事，到了御案前。</h2>
          <p>
            奏报未必是真相。读文书、问大臣，或依内阁票拟，看看你的旨意会走到哪里。
          </p>
          <p className="muted">
            点按选项进入。已完成的步骤自动存档，退朝前的暂定处置需提交后保存。
          </p>
        </div>
      );
    case "settings":
      return (
        <p className="muted">
          选一种读起来顺手的语体，点下即登基。每份文书下都附一句白话归纳。
        </p>
      );
    case "desk":
      return (
        <>
          <Paragraphs
            lines={(view?.audience?.oralReports ?? []).map((r) => `口奏：${r}`)}
          />
          <p className="muted">
            读文书免费；深思、召见、改批与特旨共用每日精力。
          </p>
        </>
      );
    case "menu":
      return <Context state={state} />;
    case "editor":
      return (
        <>
          <Context state={state} />
          <h2>
            {state.editor?.step === "kind"
              ? "选处置办法"
              : state.editor?.step === "county"
                ? "选县"
                : state.editor?.step === "agent"
                  ? "派谁查"
                  : state.editor?.step === "actor"
                    ? "选大臣"
                    : state.editor?.step === "question"
                      ? "垂询什么"
                      : "确认旨意"}
          </h2>
        </>
      );
    case "confirm":
      return (
        <article className="paper">
          <Paragraphs lines={summary(state).slice(0, -1)} />
          <p className="muted">确认退朝才会提交。也可返回御案修改。</p>
        </article>
      );
    case "interrupt":
      return (
        <p>
          {view?.audience?.interruption?.byName}求见：
          {view?.audience?.interruption?.reason}
        </p>
      );
    case "talk":
      return (
        <>
          <div className="conversation">
            <Paragraphs
              lines={
                view?.audience?.conversation.map(
                  (c) => `${c.role === "ruler" ? "朕" : "吕芳"}：${c.text}`,
                ) ?? []
              }
            />
          </div>
          <p className="muted">
            还可谈 {view?.audience?.roundsLeft ?? 0} 轮；同次仅首轮耗 1 点。
          </p>
        </>
      );
    case "archive":
      return options(state).length ? (
        <p className="muted">调阅往日文书与已批处置。</p>
      ) : (
        <p>还没有往日档案。</p>
      );
    case "standing":
      return (
        <p className="muted">
          当前暂定：
          {state.standing.mode === "personal" ? "亲览全部" : "司礼监代劳"}
          。退朝时一并提交。
        </p>
      );
    case "edicts":
      return (
        <>
          <Paragraphs
            lines={(view?.audience?.oralReports ?? []).map(
              (r) => `今日口奏：${r}`,
            )}
          />
          {view?.conversations?.map((c, i) => (
            <article className="paper" key={i}>
              <h2>{formatCourtTime(c.at, "zh-CN")}</h2>
              <Paragraphs lines={[`朕：${c.ruler}`, `吕芳：${c.reply}`]} />
            </article>
          ))}
          {view?.edicts.map((e, i) => (
            <article className="paper" key={i}>
              <h2>{e.subject}</h2>
              <p className="muted">
                {formatCourtTime(e.sentAt, "zh-CN")} · 发往{" "}
                {e.toNames.join("、")}
              </p>
              <Paragraphs lines={[e.text]} />
            </article>
          ))}
          {!view?.edicts.length &&
            !view?.conversations?.length &&
            !view?.audience?.oralReports.length && <p>尚未发旨。</p>}
        </>
      );
    case "help":
      return (
        <>
          <p>
            点选一项即打开或确认。返回收起当前页面；退朝要确认后才提交，闭关可选天数。长文直接上下滚动。
          </p>
          <p>
            电脑可用方向键、Enter、Esc、hjkl。PageUp / PageDown 翻阅，Home / End
            到列表首尾，? 打开小抄。输入框内 Enter 换行，Ctrl / ⌘ + Enter 发送。
          </p>
          <p>
            精力会被暂定改批与特旨预留，撤回可释放。同一局请勿同时在其他窗口操作。
          </p>
          <dl>
            {courtGlossary(createTranslator("zh-CN")).map(
              ({ term, definition }) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{definition}</dd>
                </div>
              ),
            )}
          </dl>
        </>
      );
    case "ending":
      return (
        <article className="paper">
          <Paragraphs
            lines={[
              state.ending || "这一段嘉靖朝已落幕。",
              `共调用 ${state.snapshot?.calls ?? 0} 次。`,
            ]}
          />
          <p className="muted">
            此局已存档。完整观战复盘可在电脑端打开，手机版暂不启动本机观战服务。
          </p>
        </article>
      );
    default:
      return null;
  }
}
export function InputSheet({
  panel,
  state,
  busy,
  controller,
}: {
  readonly panel: InputPanel;
  readonly state: State;
  readonly busy: boolean;
  readonly controller: DeskController;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const sheet = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!busy) field.current?.focus();
  }, [busy]);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const resize = () => {
      if (!sheet.current) return;
      sheet.current.style.height = `${viewport.height}px`;
      sheet.current.style.top = `${viewport.offsetTop}px`;
    };
    resize();
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, []);
  return (
    <section
      ref={sheet}
      className="input-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="input-title"
      onKeyDown={(event) => {
        const action = inputKey(event.nativeEvent);
        if (action) {
          event.preventDefault();
          void controller.finishInput(action === "cancel");
        }
        if (event.key === "Tab") {
          const elements = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), textarea:not(:disabled), summary",
            ),
          );
          const first = elements[0];
          const last = elements.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <header>
        <p className="eyebrow">御前亲笔</p>
        <h1 id="input-title">
          {panel.effect.prompt.replace("（空行返回）", "")}
        </h1>
      </header>
      <details className="input-context">
        <summary>查看上下文</summary>
        {state.screen === "talk" ? (
          <Paragraphs
            lines={
              state.snapshot?.view.audience?.conversation.map(
                (c) => `${c.role === "ruler" ? "朕" : "吕芳"}：${c.text}`,
              ) ?? []
            }
          />
        ) : (
          <Context state={state} />
        )}
      </details>
      <label className="sr-only" htmlFor="imperial-text">
        {panel.effect.prompt}
      </label>
      <textarea
        ref={field}
        id="imperial-text"
        value={panel.text}
        disabled={busy}
        onChange={(event) => controller.editInput(event.target.value)}
        aria-describedby="input-help input-error"
        placeholder="在这里写下你的话……"
      />
      <p id="input-help" className="muted">
        {panel.text.length} / {panel.effect.max} 字 · 回车换行，空白发送取消
      </p>
      <p id="input-error" role="alert">
        {panel.error}
      </p>
      <footer>
        <button
          disabled={busy}
          onClick={() => void controller.finishInput(true)}
        >
          取消
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void controller.finishInput()}
        >
          发送
        </button>
      </footer>
    </section>
  );
}
export function DeskApp({
  controller,
  storageWarning = "",
}: {
  readonly controller: DeskController;
  readonly storageWarning?: string;
}) {
  const { state, busy, busySince, input } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const scroller = useRef<HTMLElement>(null);
  const selected = useRef<HTMLButtonElement>(null);
  const previousScreen = useRef("");
  const view = state.snapshot?.view;
  const failed = Boolean(state.error || state.snapshot?.status === "failed");
  const list =
    state.screen === "interrupt"
      ? [
          { name: "召见", value: "admit" },
          { name: "不见，继续闭关", value: "decline" },
        ]
      : options(state);
  useEffect(() => {
    const screen = `${state.screen}:${view?.audience?.id ?? ""}`;
    if (previousScreen.current !== screen) {
      scroller.current?.scrollTo({ top: 0 });
      if (["desk", "archive"].includes(state.screen))
        selected.current?.scrollIntoView({ block: "nearest" });
    } else selected.current?.scrollIntoView({ block: "nearest" });
    previousScreen.current = screen;
  }, [state.cursor, state.screen, view?.audience?.id]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target;
      const editing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (input || editing) return;
      if (event.key === "Enter" && target instanceof HTMLButtonElement) return;
      const key = gameKey(event, editing);
      if (!key) return;
      event.preventDefault();
      if (busy) return;
      if (
        key === "pageup" ||
        key === "pagedown" ||
        (["help", "edicts", "ending", "confirm"].includes(state.screen) &&
          (key === "up" || key === "down"))
      ) {
        scroller.current?.scrollBy({
          top:
            (key === "pageup" || key === "up" ? -1 : 1) *
            (key === "up" || key === "down"
              ? 64
              : scroller.current.clientHeight * 0.8),
        });
      } else {
        if (target instanceof HTMLButtonElement) target.blur();
        void controller.key(key);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [controller, state.screen, busy, input]);
  return (
    <>
      <div className="desk-shell" inert={Boolean(input)}>
        <header className="masthead">
          <div>
            <p className="eyebrow">嘉靖朝 · 西苑</p>
            <h1>{titles[state.screen]}</h1>
          </div>
          {view && (
            <div className="energy">
              <span>{formatCourtTime(view.time, "zh-CN")}</span>
              <strong>
                精力 {view.energy ?? "不限"}
                {view.energyCapacity !== undefined
                  ? ` / ${view.energyCapacity}`
                  : ""}
              </strong>
              {reservedEnergy(state) > 0 && (
                <span>已预留 {reservedEnergy(state)}</span>
              )}
              {!view.settings && <span>旧局 · 阅读收费</span>}
            </div>
          )}
        </header>
        <main
          ref={scroller}
          className="desk-content"
          aria-busy={busy}
          data-screen={state.screen}
        >
          {storageWarning && <p className="warning">{storageWarning}</p>}
          {failed ? (
            <section className="error" role="alert">
              <h2>这一步未完成</h2>
              <p>{state.error ?? state.snapshot?.error ?? "服务步骤失败"}</p>
              <p>暂定处置仍保留。可重试恢复。</p>
            </section>
          ) : (
            <>
              <ScreenContent state={state} />
              <div className="options" aria-label="可选操作">
                {list.map((option, index) => {
                  const active = state.cursor === index;
                  const talkBlocked =
                    state.screen === "talk" &&
                    (view?.audience?.roundsLeft === 0 ||
                      (!view?.audience?.conversation.length &&
                        (view?.energy ?? Infinity) - reservedEnergy(state) <
                          1));
                  const disabled =
                    ("disabled" in option && option.disabled) || talkBlocked;
                  const doc =
                    active && ["desk", "archive"].includes(state.screen)
                      ? currentDocument(state)
                      : undefined;
                  return (
                    <div className="option-group" key={option.value}>
                      <button
                        ref={active ? selected : undefined}
                        className={`option ${active ? "selected" : ""}`}
                        disabled={busy || Boolean(disabled)}
                        aria-current={active ? "true" : undefined}
                        onClick={() => void controller.choose(index)}
                      >
                        {safeText(option.name).replace(
                          "（⏎ 撤回）",
                          "（点按撤回）",
                        )}
                        {disabled ? "（不可选）" : ""}
                      </button>
                      {doc && (
                        <article className="paper inline-paper">
                          <Paragraphs lines={body(doc)} />
                        </article>
                      )}
                    </div>
                  );
                })}
              </div>
              {state.screen === "ending" && (
                <button className="primary" onClick={() => controller.home()}>
                  回首页 · 再开一局
                </button>
              )}
            </>
          )}
          {!busy && state.notice && (
            <p className="notice" role="status">
              {state.notice}
            </p>
          )}
          {Boolean(view?.cappedWakes) && (
            <p className="warning">
              已有 {view?.cappedWakes} 次人物决策被调用上限拦住。
            </p>
          )}
        </main>
        <div className="status-line" role="status" aria-live="polite">
          {busy
            ? ""
            : state.snapshot
              ? "已完成步骤自动存档 · 暂定处置退朝时提交"
              : "点按进入 · 支持键盘"}
        </div>
        {busy && busySince !== undefined && (
          <WaitingVeil since={busySince} time={state.snapshot?.view.time} />
        )}
        <nav className="thumb-bar" aria-label="御案快捷操作">
          {thumbActions(state).map((action) => (
            <button
              key={action.label}
              disabled={
                busy ||
                (action.key === "escape" &&
                  ["home", "interrupt", "ending"].includes(state.screen)) ||
                (action.key === "escape" && state.snapshot?.status === "failed")
              }
              onClick={() => {
                if (action.option)
                  void controller.shortcut(
                    action.option,
                    action.key === "right" ? "right" : "enter",
                  );
                else void controller.key(action.key);
              }}
            >
              {action.label}
            </button>
          ))}
        </nav>
      </div>
      {input && (
        <InputSheet
          panel={input}
          state={state}
          busy={busy}
          controller={controller}
        />
      )}
    </>
  );
}

/** Short waits stay quiet; longer ones show the palace and how long it has been. */
function WaitingVeil({
  since,
  time,
}: {
  readonly since: number;
  readonly time: number | undefined;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [seed] = useState(() => Math.floor(Math.random() * 1000));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  const waited = now - since;
  if (waited < 700) return null;
  const line = atmosphereLine(atmosphereLines(time), waited, seed);
  return (
    <div className="waiting-veil" role="status" aria-live="polite">
      <p key={line} className="waiting-line">
        {line}
      </p>
      <p className="waiting-time">{waitedText(waited)}</p>
    </div>
  );
}
