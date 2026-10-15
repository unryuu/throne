import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Chronicle } from "@throne/court";
import { App } from "./app.tsx";

const local = vi.hoisted(() => ({ useLocalRun: vi.fn() }));
vi.mock("./local.tsx", async (original) => ({
  ...(await original<typeof import("./local.tsx")>()),
  useLocalRun: local.useLocalRun,
}));
const chronicle = JSON.parse(
  readFileSync(new URL("../public/runs/jiande.json", import.meta.url), "utf8"),
) as Chronicle;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
function render(path: string, state: object) {
  vi.stubGlobal("location", { hash: `#/local-test${path}` });
  local.useLocalRun.mockReturnValue(state);
  return renderToStaticMarkup(<App />);
}
describe("local spectator rendering", () => {
  it("has no local entry or local route in the static build", () => {
    vi.stubEnv("DEV", false);
    const html = render("/end", { data: chronicle });
    expect(html).not.toContain("本机存档");
    expect(html).not.toContain("刷新本局记录");
    expect(html).toContain("你是嘉靖。满朝都在骗你。");
  });

  it("can read unfinished runs without curated scenes", () => {
    const html = render("", { data: { ...chronicle, complete: false } });
    expect(html).toContain("暂无名场面");
    expect(html).toContain("从第一天看起");
    expect(html).toContain("本局尚未结束");
  });
  it("keeps day navigation and the ending numbers while generating or on a story failure", () => {
    expect(
      render("/40/truth", { data: chronicle, generating: true }),
    ).toContain("说书人正在通读全局");
    const html = render("/end", {
      data: chronicle,
      storyError: "测试生成失败",
    });
    expect(html).toContain("测试生成失败");
    expect(html).toContain("1060");
  });
  it("labels a generated ending and renders a surviving deed-only highlight", () => {
    const html = render("/end", {
      data: chronicle,
      story: {
        scenes: [
          { day: 12, title: "掘堤", deed: "真实行动引文", note: "旁注" },
        ],
        ending: { verdict: "御批评述", deceivers: [], highlight: 0 },
        verification: { exact: 1, loose: 0, retold: 2 },
      },
    });
    expect(html).toContain("说书人（模型）评述");
    expect(html).toContain("真实行动引文");
    expect(html).not.toContain('class="tag">所言');
    expect(html).toContain("转述 2 条");
  });
});
