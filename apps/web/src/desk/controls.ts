import {
  focus,
  keypress,
  options,
  type Key,
  type State,
  type Transition,
} from "../../tui/state.ts";

export type BrowserKey = {
  readonly key: string;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
};
export function gameKey(event: BrowserKey, editing = false): Key | undefined {
  if (
    editing ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return undefined;
  const keys: Record<string, Key> = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    Enter: "enter",
    Escape: "escape",
    PageUp: "pageup",
    PageDown: "pagedown",
    Home: "home",
    End: "end",
    "?": "help",
    h: "left",
    j: "down",
    k: "up",
    l: "right",
  };
  return keys[event.key];
}
export function inputKey(event: BrowserKey): "cancel" | "send" | undefined {
  if (event.isComposing || event.keyCode === 229) return undefined;
  if (event.key === "Escape") return "cancel";
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) return "send";
  return undefined;
}
export function selectOption(s: State, index: number): Transition {
  if (s.error || s.snapshot?.status === "failed") return { state: s };
  const count = s.screen === "interrupt" ? 2 : options(s).length;
  if (!Number.isInteger(index) || index < 0 || index >= count)
    return { state: s };
  return focus({
    ...s,
    cursor: index,
    scroll: 0,
    contextScroll: 0,
    notice: "",
    ...(s.screen === "desk" ? { deskCursor: index } : {}),
  });
}
// DOM owns scrolling; an unbounded viewport prevents terminal line wrapping from consuming arrows.
export const press = (s: State, key: Key): Transition =>
  keypress(s, key, 1_000_000, 1_000_000);

export type ThumbAction = {
  readonly label: string;
  readonly key: Key;
  readonly option?: string;
};
export function thumbActions(s: State): readonly ThumbAction[] {
  if (s.error || s.snapshot?.status === "failed")
    return [
      { label: "返回", key: "escape" },
      ...(s.snapshot?.status !== "failed"
        ? [{ label: "收起错误", key: "left" as const }]
        : []),
      { label: "重试", key: "enter" },
    ];
  const actions: ThumbAction[] = [{ label: "返回", key: "escape" }];
  if (s.screen === "desk")
    actions.push(
      { label: "更多", key: "enter", option: "more" },
      { label: "闭关", key: "right", option: "close" },
      { label: "退朝", key: "enter", option: "close" },
    );
  else if (s.screen === "confirm")
    actions.push({ label: "确认退朝", key: "enter" });
  else if (s.screen === "interrupt")
    actions.push({ label: "确定", key: "enter" });
  if (s.screen !== "help") actions.push({ label: "小抄", key: "help" });
  return actions;
}
