import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type {
  AudienceAction,
  CourtSettings,
  RescriptSubmission,
} from "@throne/court";
import {
  CourtService,
  type CourtSnapshot,
} from "../../server/court-service.ts";
import { demoModel } from "../../tui/demo.ts";
import {
  currentDocument,
  initialState,
  options,
  receive,
} from "../../tui/state.ts";
import { DeskController } from "./controller.ts";
import type { CourtRequest } from "./api.ts";

async function fixture() {
  const service = new CourtService(
    await mkdtemp(join(tmpdir(), "throne-desk-")),
    () => demoModel,
  );
  const request = vi.fn<CourtRequest>(
    async <T>(path: string, body?: unknown): Promise<T> => {
      const [id, route] = path.split("/").filter(Boolean);
      const data = body as {
        settings: CourtSettings;
        action: AudienceAction;
        audienceId: string;
        submission: RescriptSubmission;
      };
      let value: unknown;
      if (!id)
        value = await service.create("zh-CN", data.settings, {
          usePacks: false,
        });
      else if (id === "progress") value = { busy: service.busyMessages(route) };
      else if (route === "act")
        value = await service.act(id, data.audienceId, data.action);
      else if (route === "rescript")
        value = await service.submit(id, data.submission);
      else if (route === "retry") value = await service.retry(id);
      else if (route === "review") value = await service.review(id);
      else value = await service.get(id);
      return value as T;
    },
  );
  const remembered = vi.fn();
  const deps = {
    request: request as CourtRequest,
    remember: remembered,
    packs: () => ["plain-1"],
    operationId: () => "operation-1",
  };
  const controller = new DeskController(deps);
  const state = () => controller.getSnapshot().state;
  const choose = (value: string) =>
    controller.choose(options(state()).findIndex((o) => o.value === value));
  const start = async () => {
    await choose("new");
    await choose("plain");
  };
  return {
    service,
    request,
    remembered,
    deps,
    controller,
    state,
    choose,
    start,
  };
}

describe("browser court effect runner", () => {
  it("holds the new reign until the enthronement ceremony ends", async () => {
    const f = await fixture();
    let end!: () => void;
    const controller = new DeskController({
      ...f.deps,
      enthrone: () => new Promise<void>((resolve) => (end = resolve)),
    });
    await controller.choose(0);
    const pending = controller.choose(1);
    await vi.waitFor(() =>
      expect(f.request.mock.calls.some(([path]) => path === "")).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(controller.getSnapshot().state.snapshot).toBeUndefined();
    expect(controller.getSnapshot().busy).toBe(true);
    end();
    await pending;
    expect(controller.getSnapshot().state.screen).toBe("desk");
  });

  it("acts on the focused paper from the desk without visiting the action page", async () => {
    const f = await fixture();
    await f.start();
    const index = f
      .state()
      .snapshot!.view.audience!.documents.findIndex(
        (d) => d.hasDraft || d.draft,
      );
    await f.controller.choose(index);
    await f.controller.paperAction("hold");
    expect(f.state().screen).toBe("desk");
    expect(f.state().cursor).toBe(index);
    expect(f.state().choices[currentDocument(f.state())!.id]?.disposition).toBe(
      "hold",
    );
  });

  it("creates a plain game, sends pack exclusions, opens the focused paper, and remembers the save", async () => {
    const f = await fixture();
    await f.start();
    expect(f.state().screen).toBe("desk");
    expect(f.state().snapshot?.view.settings?.register).toBe("plain");
    expect(f.request).toHaveBeenCalledWith("", {
      locale: "zh-CN",
      settings: { register: "plain", summaries: true },
      operationId: "operation-1",
      excludePackIds: ["plain-1"],
    });
    expect(currentDocument(f.state())?.opened).toBe(true);
    expect(f.state().snapshot?.view.energy).toBe(2);
    expect(f.remembered).toHaveBeenCalled();
    f.controller.home();
    expect(f.state().runs).toHaveLength(1);
  });

  it("loads a save, a tap only focuses and opens the paper, and an inline ponder is paid once", async () => {
    const f = await fixture();
    const saved = await f.service.create("zh-CN");
    await f.controller.load(saved.id);
    await f.controller.choose(1);
    const doc = currentDocument(f.state())!;
    expect(f.state().screen).toBe("desk");
    expect(doc.id).toBe(saved.view.audience!.documents[1]!.id);
    expect(doc.opened).toBe(true);
    await f.controller.paperAction("ponder");
    expect(f.state().screen).toBe("desk");
    expect(currentDocument(f.state())?.ponders).toHaveLength(1);
    expect(f.state().snapshot?.view.energy).toBe(1);
    expect(
      f.request.mock.calls.filter(
        ([, body]) =>
          (body as { action?: AudienceAction } | undefined)?.action?.type ===
          "ponder",
      ),
    ).toHaveLength(1);
  });

  it("keeps rescripts tentative until the second confirmation and advances the real engine", async () => {
    const f = await fixture();
    await f.start();
    const time = f.state().snapshot!.view.time;
    await f.choose("close");
    expect(f.state().screen).toBe("confirm");
    expect(
      f.request.mock.calls.some(([path]) => path.endsWith("/rescript")),
    ).toBe(false);
    await f.controller.key("enter");
    expect(f.state().snapshot!.view.time).toBeGreaterThan(time);
    expect(f.state().snapshot!.view.edicts.length).toBeGreaterThan(0);
    expect(f.state().error).toBeUndefined();
  });

  it("plays a complete offline reign through browser controls and verifies deterministic replay", async () => {
    const f = await fixture();
    await f.start();
    for (
      let step = 0;
      f.state().snapshot?.status !== "complete" && step < 100;
      step++
    ) {
      if (f.state().screen === "interrupt") await f.controller.choose(0);
      else {
        await f.controller.shortcut("close", "right");
        await f.choose("30");
        await f.controller.key("enter");
      }
      expect(f.state().error).toBeUndefined();
    }
    expect(f.state().screen).toBe("ending");
    expect(f.state().ending).toContain("死亡");
    expect((await f.service.replay(f.state().snapshot!.id)).verified).toBe(
      true,
    );
    await f.controller.key("enter");
    expect(f.state().notice).toContain("暂不启动本机观战服务");
    f.controller.home();
    expect(f.state().screen).toBe("home");
    expect(f.state().runs).toHaveLength(1);
  });

  it("routes closed-door timing through right, and More through the same selected-option path", async () => {
    const f = await fixture();
    await f.start();
    await f.controller.shortcut("more");
    expect(f.state().screen).toBe("more");
    await f.controller.key("escape");
    await f.controller.shortcut("close", "right");
    expect(f.state().screen).toBe("seclusion");
    await f.choose("7");
    expect(f.state().days).toBe(7);
    expect(f.state().screen).toBe("confirm");
  });

  it("reconciles a lost paid-action response instead of charging twice", async () => {
    const f = await fixture();
    await f.start();
    await f.controller.choose(0);
    const actual = f.request.getMockImplementation()!;
    f.request.mockImplementationOnce(
      async <T>(path: string, body?: unknown) => {
        await actual(path, body);
        throw new Error("网络断开");
      },
    );
    await f.controller.paperAction("ponder");
    expect(f.state().error).toBe("网络断开");
    await f.controller.key("enter");
    expect(f.state().error).toBeUndefined();
    expect(f.state().snapshot!.view.energy).toBe(1);
    expect(currentDocument(f.state())?.ponders).toHaveLength(1);
  });

  it("retries failed server steps and preserves tentative choices", async () => {
    const f = await fixture();
    await f.start();
    const before = f.state();
    const failed = {
      ...before.snapshot!,
      status: "failed" as const,
      error: "模型暂不可用",
    };
    const request = vi.fn<CourtRequest>(async <T>() => before.snapshot as T);
    const controller = new DeskController(
      { ...f.deps, request: request as CourtRequest },
      receive(before, failed),
    );
    await controller.key("enter");
    expect(request).toHaveBeenCalledWith(`/${before.snapshot!.id}/retry`, {});
    expect(controller.getSnapshot().state.choices).toEqual(before.choices);
    expect(controller.getSnapshot().state.error).toBeUndefined();
  });

  it("locks duplicate taps and times the wait without asking who is busy", async () => {
    const f = await fixture();
    const snapshot = await f.service.create("zh-CN");
    const ready = receive(initialState(), snapshot).snapshot!;
    let finish!: (value: CourtSnapshot) => void;
    const request = vi.fn<CourtRequest>(async <T>(path: string) => {
      if (path === "")
        return (await new Promise<CourtSnapshot>((resolve) => {
          finish = resolve;
        })) as T;
      return {
        ...ready,
        view: {
          ...ready.view,
          audience: {
            ...ready.view.audience!,
            documents: ready.view.audience!.documents.map((d) => ({
              ...d,
              opened: true,
            })),
          },
        },
      } as T;
    });
    const controller = new DeskController({
      ...f.deps,
      request: request as CourtRequest,
    });
    vi.useFakeTimers();
    try {
      await controller.choose(0);
      const pending = controller.choose(1);
      await controller.choose(1);
      expect(controller.getSnapshot().busySince).toBe(Date.now());
      await vi.advanceTimersByTimeAsync(5000);
      finish(ready);
      await pending;
      expect(controller.getSnapshot().busy).toBe(false);
      expect(controller.getSnapshot().busySince).toBeUndefined();
      expect(
        request.mock.calls.some(([path]) => path.startsWith("/progress")),
      ).toBe(false);
      expect(request.mock.calls.filter(([path]) => path === "")).toHaveLength(
        1,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for a running save and obtains completion statistics through review", async () => {
    const f = await fixture();
    await f.start();
    const snapshot = f.state().snapshot!;
    const complete = { ...snapshot, status: "complete" as const };
    const request = vi.fn<CourtRequest>();
    request
      .mockResolvedValueOnce({ ...snapshot, status: "running" })
      .mockResolvedValueOnce(complete)
      .mockResolvedValueOnce({
        state: {
          summary: {
            convertedMu: 12,
            targetMu: 30,
            annexedMu: 4,
            deaths: 7,
            riots: 1,
          },
        },
      });
    const pause = vi.fn(async () => {});
    const controller = new DeskController({
      ...f.deps,
      request: request as CourtRequest,
      pause,
    });
    await controller.load(snapshot.id);
    expect(pause).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().state.screen).toBe("ending");
    expect(controller.getSnapshot().state.ending).toContain(
      "改桑 12 万亩 / 目标 30 万亩",
    );
    expect(request).toHaveBeenLastCalledWith(`/${snapshot.id}/review`);
  });

  it("surfaces a missing ending summary and retries the review without resubmitting a day", async () => {
    const f = await fixture();
    await f.start();
    const snapshot = { ...f.state().snapshot!, status: "complete" as const };
    const request = vi
      .fn<CourtRequest>()
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce({ state: {} });
    const controller = new DeskController({
      ...f.deps,
      request: request as CourtRequest,
    });
    await controller.load(snapshot.id);
    expect(controller.getSnapshot().state.error).toContain("缺少结局统计");
    request.mockResolvedValueOnce(snapshot).mockResolvedValueOnce({
      state: {
        summary: {
          convertedMu: 0,
          targetMu: 30,
          annexedMu: 0,
          deaths: 0,
          riots: 0,
        },
      },
    });
    await controller.key("enter");
    expect(controller.getSnapshot().state.error).toBeUndefined();
    expect(request.mock.calls.every(([, body]) => body === undefined)).toBe(
      true,
    );
  });
});

describe("full-screen writing flow", () => {
  it("cancels blank or Escape input, retains over-limit text, and sends multiline talk through the state machine", async () => {
    const f = await fixture();
    await f.start();
    await f.choose("talk");
    await f.choose("write");
    expect(f.controller.getSnapshot().input?.effect.purpose).toBe("talk");
    f.controller.editInput("暂不问");
    await f.controller.finishInput(true);
    expect(f.state().screen).toBe("talk");
    expect(f.state().snapshot!.view.energy).toBe(2);
    await f.choose("write");
    f.controller.editInput(" \n ");
    await f.controller.finishInput();
    expect(f.controller.getSnapshot().input).toBeUndefined();
    await f.choose("write");
    f.controller.editInput("问".repeat(401));
    await f.controller.finishInput();
    expect(f.controller.getSnapshot().input?.error).toContain("最多 400");
    expect(f.controller.getSnapshot().input?.text).toHaveLength(401);
    f.controller.editInput("浙江粮饷如何？\n据实说来。");
    await f.controller.finishInput();
    expect(f.controller.getSnapshot().input).toBeUndefined();
    expect(f.state().snapshot!.view.energy).toBe(1);
    expect(f.state().snapshot!.view.audience!.conversation[0]?.text).toBe(
      "浙江粮饷如何？\n据实说来。",
    );
  });

  it("writes a question as a tentative special edict, and cancels back to its editor", async () => {
    const f = await fixture();
    await f.start();
    await f.choose("special");
    await f.choose("request_memorial");
    await f.controller.choose(0);
    await f.choose("write");
    expect(f.controller.getSnapshot().input?.effect.purpose).toBe("question");
    await f.controller.finishInput(true);
    expect(f.state().screen).toBe("editor");
    await f.choose("write");
    f.controller.editInput("军饷是否到齐？");
    await f.controller.finishInput();
    expect(f.state().specials[0]?.edict.params.question).toBe("军饷是否到齐？");
    expect(f.state().snapshot!.view.energy).toBe(2);
    expect(f.state().screen).toBe("desk");
  });

  it("writes custom rescript text without submitting until retreat", async () => {
    const f = await fixture();
    await f.start();
    const index = f
      .state()
      .snapshot!.view.audience!.documents.findIndex(
        (d) => d.hasDraft || d.draft,
      );
    await f.controller.choose(index);
    await f.controller.paperAction("custom");
    await f.choose("reject");
    await f.choose("write");
    expect(f.controller.getSnapshot().input?.effect.purpose).toBe("edict");
    f.controller.editInput("所请不准。");
    await f.controller.finishInput();
    expect(
      Object.values(f.state().choices).some(
        (c) => c.text === "所请不准。" && c.disposition === "custom",
      ),
    ).toBe(true);
    expect(
      f.request.mock.calls.some(([path]) => path.endsWith("/rescript")),
    ).toBe(false);
  });
});
