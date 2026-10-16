import { afterEach, expect, it, vi } from "vitest";
import { request } from "./api.ts";
import { memoryKey, recall, remember } from "./storage.ts";
import type { CourtSnapshot } from "../../server/court-service.ts";

afterEach(() => vi.unstubAllGlobals());
it("sends the court HTTP contract and preserves server errors", async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(
      async () => new Response(JSON.stringify({ id: "run" })),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(request("/run")).resolves.toEqual({ id: "run" });
  expect(fetcher).toHaveBeenCalledWith("/api/court/run", { cache: "no-store" });
  await request("/run/retry", {});
  expect(fetcher).toHaveBeenLastCalledWith("/api/court/run/retry", {
    cache: "no-store",
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Throne-Client": "local" },
    body: "{}",
  });
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ error: "今日国库已空" }), { status: 429 }),
  );
  await expect(request("", {})).rejects.toThrow("今日国库已空");
  fetcher.mockResolvedValue(
    new Response("<html>bad gateway</html>", { status: 502 }),
  );
  await expect(request("/run")).rejects.toThrow("HTTP 502");
});
it("keeps run and opening-pack history, and reports unavailable or corrupt storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const snapshot = {
    id: "run-1",
    view: { time: 0 },
    status: "waiting",
    openingPackId: "pack-1",
  } as CourtSnapshot;
  const memory = remember(recall(storage), snapshot, storage);
  remember(memory, snapshot, storage);
  expect(recall(storage).runs).toHaveLength(1);
  expect(recall(storage).packs).toEqual(["pack-1"]);
  values.set(memoryKey, "broken");
  expect(recall(storage).warning).toContain("无法读取");
  expect(
    remember(memory, snapshot, {
      setItem: () => {
        throw new Error("storage blocked");
      },
    }).warning,
  ).toContain("服务端已存档");
});
