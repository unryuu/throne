// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startCourtSession } from "@throne/court";
import type { CourtSnapshot } from "../../server/court-service.ts";
import { demoModel } from "../../tui/demo.ts";
import { initialState, receive, type State } from "../../tui/state.ts";
import { DeskController } from "./controller.ts";
import { DeskApp } from "./app.tsx";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const button = (label: string) => {
  const found = Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label),
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
};
const click = async (label: string) => {
  await act(async () => button(label).click());
};
async function mount(state?: State) {
  const request = vi.fn(async () => {
    throw new Error("Unexpected HTTP request");
  });
  const controller = new DeskController(
    {
      request,
      remember: () => {},
      packs: () => [],
      operationId: () => "operation",
    },
    state,
  );
  await act(async () => root.render(<DeskApp controller={controller} />));
  return controller;
}
async function ready(): Promise<CourtSnapshot> {
  const session = await startCourtSession({
    runId: "dom-test",
    language: "zh-CN",
    model: demoModel,
  });
  await session.act(session.view.audience!.id, {
    type: "open_message",
    documentId: session.view.audience!.documents[0]!.id,
  });
  return { id: "dom-test", status: "waiting", view: session.view, calls: 0 };
}

describe("DOM desk", () => {
  it("opens settings by tap and supports arrow/Enter/Escape without losing native button activation", async () => {
    const controller = await mount();
    await click("新开一局");
    expect(host.querySelector("h1")?.textContent).toBe("登基之前");
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      ),
    );
    expect(controller.getSnapshot().state.cursor).toBe(0);
    expect(host.textContent).not.toContain("奏疏归纳");
    expect(host.textContent).not.toContain("开始新局");
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(host.querySelector("h1")?.textContent).toBe("西苑御案");
    expect(button("返回").disabled).toBe(true);
  });

  it("renders long unwrapped document text as paragraphs, and preserves folded-paper secrecy", async () => {
    const snapshot = await ready();
    const text = "这是一份很长的奏疏。".repeat(180);
    const first = snapshot.view.audience!.documents[0]!;
    const state = receive(initialState(), {
      ...snapshot,
      view: {
        ...snapshot.view,
        audience: {
          ...snapshot.view.audience!,
          documents: [{ ...first, text }],
        },
      },
    });
    await mount(state);
    expect(
      Array.from(host.querySelectorAll("article p")).some(
        (p) => p.textContent === text,
      ),
    ).toBe(true);
    expect(host.querySelector("pre")).toBeNull();
    const folded = {
      ...snapshot,
      view: {
        ...snapshot.view,
        audience: {
          ...snapshot.view.audience!,
          documents: [{ ...first, text: "不应暴露的原文", folded: true }],
        },
      },
    };
    await mount(receive(initialState(), folded));
    expect(host.textContent).not.toContain("不应暴露的原文");
    expect(host.textContent).toContain("原本折起");
  });

  it("fits the writing sheet to the visible viewport when the phone keyboard opens", async () => {
    const viewport = Object.assign(new EventTarget(), {
      height: 780,
      offsetTop: 0,
    });
    vi.stubGlobal("visualViewport", viewport);
    await mount({ ...receive(initialState(), await ready()), screen: "talk" });
    await click("自己写");
    const sheet = host.querySelector<HTMLElement>(".input-sheet")!;
    expect(sheet.style.height).toBe("780px");
    await act(async () => {
      viewport.height = 390;
      viewport.offsetTop = 12;
      viewport.dispatchEvent(new Event("resize"));
    });
    expect(sheet.style.height).toBe("390px");
    expect(sheet.style.top).toBe("12px");
  });

  it("opens a real modal textarea, shields IME keys, validates length and cancels with Escape", async () => {
    const snapshot = await ready();
    const controller = await mount({
      ...receive(initialState(), snapshot),
      screen: "talk",
    });
    await click("自己写");
    expect(
      host.querySelector('[role="dialog"]')?.getAttribute("aria-modal"),
    ).toBe("true");
    expect(host.querySelector(".desk-shell")?.hasAttribute("inert")).toBe(true);
    const textarea = host.querySelector("textarea")!;
    expect(document.activeElement).toBe(textarea);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, "这是一句尚未写完的话");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          isComposing: true,
          ctrlKey: true,
          bubbles: true,
        }),
      ),
    );
    expect(controller.getSnapshot().input?.text).toBe("这是一句尚未写完的话");
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    expect(host.querySelector("textarea")).toBe(textarea);
    await act(async () => controller.editInput("字".repeat(401)));
    await click("发送");
    expect(host.querySelector("#input-error")?.textContent).toContain(
      "最多 400",
    );
    expect(textarea.value).toHaveLength(401);
    await act(async () =>
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(controller.getSnapshot().state.screen).toBe("talk");
    expect(controller.getSnapshot().state.snapshot!.view.energy).toBe(2);
  });
});
