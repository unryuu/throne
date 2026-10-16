import { describe, expect, it } from "vitest";
import { initialState } from "../../tui/state.ts";
import {
  gameKey,
  inputKey,
  press,
  selectOption,
  thumbActions,
} from "./controls.ts";

describe("browser controls", () => {
  it("maps arrows, Enter, Escape, paging and terminal aliases", () => {
    for (const [key, result] of Object.entries({
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
    }))
      expect(gameKey({ key })).toBe(result);
    expect(gameKey({ key: "a" })).toBeUndefined();
  });
  it("leaves IME, text editing and browser shortcuts alone", () => {
    expect(gameKey({ key: "Enter", isComposing: true })).toBeUndefined();
    expect(gameKey({ key: "Enter", keyCode: 229 })).toBeUndefined();
    expect(gameKey({ key: "ArrowLeft" }, true)).toBeUndefined();
    expect(gameKey({ key: "l", metaKey: true })).toBeUndefined();
    expect(gameKey({ key: "ArrowLeft", altKey: true })).toBeUndefined();
    expect(gameKey({ key: "j", ctrlKey: true })).toBeUndefined();
  });
  it("keeps Enter as a newline in the sheet, and ignores IME confirmation/cancellation", () => {
    expect(inputKey({ key: "Enter" })).toBeUndefined();
    expect(inputKey({ key: "Enter", ctrlKey: true })).toBe("send");
    expect(inputKey({ key: "Enter", metaKey: true })).toBe("send");
    expect(inputKey({ key: "Escape" })).toBe("cancel");
    expect(inputKey({ key: "Escape", isComposing: true })).toBeUndefined();
    expect(
      inputKey({ key: "Enter", ctrlKey: true, keyCode: 229 }),
    ).toBeUndefined();
  });
  it("selects before Enter, rejects invalid indices, and maps thumb shortcuts explicitly", () => {
    const state = initialState();
    expect(press(selectOption(state, 0).state, "enter").state.screen).toBe(
      "settings",
    );
    expect(selectOption(state, -1).state).toBe(state);
    expect(selectOption(state, 10).state).toBe(state);
    expect(thumbActions({ ...state, screen: "desk" })).toEqual([
      { label: "返回", key: "escape" },
      { label: "更多", key: "enter", option: "more" },
      { label: "闭关", key: "right", option: "close" },
      { label: "退朝", key: "enter", option: "close" },
      { label: "小抄", key: "help" },
    ]);
  });
});
