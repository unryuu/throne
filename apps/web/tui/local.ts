import { readdir, readFile, stat } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { formatCourtTime } from "@throne/court";
import type { SavedCourtRun } from "../server/court-service.ts";
import type { RunChoice } from "./state.ts";

export async function listRuns(root: string): Promise<readonly RunChoice[]> {
  const dir = join(root, "runs", "court");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const rows = await Promise.all(
    names
      .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
      .map(async (name) => {
        const id = name.slice(0, -5);
        try {
          const path = join(dir, name);
          const saved = JSON.parse(
            await readFile(path, "utf8"),
          ) as SavedCourtRun;
          if (
            saved.id !== id ||
            saved.version !== 1 ||
            !Array.isArray(saved.records) ||
            !saved.state
          )
            throw new Error("存档格式损坏");
          if (
            !["waiting", "running", "failed", "complete"].includes(saved.status)
          )
            throw new Error("存档状态无法识别");
          if (saved.status === "complete") return undefined;
          const time =
            saved.state.audience?.openedAt ??
            saved.state.lastAudienceAt ??
            saved.state.nextAudienceAt;
          if (time === undefined || !Number.isFinite(time))
            throw new Error("存档缺少有效御览日期");
          return {
            id,
            label: `${formatCourtTime(time, "zh-CN")} · ${id.slice(0, 8)}${saved.status === "failed" ? " · 待重试" : ""}`,
            mtime: (await stat(path)).mtimeMs,
          };
        } catch (e) {
          return {
            id,
            label: `${id.slice(0, 8)} · 无法读取`,
            error: String(e),
            mtime: 0,
          };
        }
      }),
  );
  return rows.filter((r) => r !== undefined).sort((a, b) => b.mtime - a.mtime);
}
const probe = async () => {
  try {
    const r = await fetch("http://localhost:4174/api/local-runs", {
      signal: AbortSignal.timeout(1000),
    });
    return (
      r.ok && (r.headers.get("content-type") ?? "").includes("application/json")
    );
  } catch {
    return false;
  }
};
export async function openSpectator(
  root: string,
  id: string,
): Promise<{ child?: ChildProcess; message: string }> {
  let child: ChildProcess | undefined;
  const url = `http://localhost:4174/#/local-${encodeURIComponent(id)}`;
  const command = "npx -y pnpm@11.19.0 spectator";
  if (!(await probe())) {
    const require = createRequire(join(root, "apps/spectator/package.json"));
    const vite = join(
      dirname(require.resolve("vite/package.json")),
      "bin/vite.js",
    );
    child = spawn(process.execPath, [vite, "--configLoader", "runner"], {
      cwd: join(root, "apps/spectator"),
      stdio: "ignore",
    });
    let failed = false;
    child.on("error", () => {
      failed = true;
    });
    for (let n = 0; n < 40 && !failed && child.exitCode === null; n++) {
      if (await probe()) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!(await probe())) {
      child.kill();
      return {
        message: `观战服务未能启动。另开终端运行：${command}\n然后打开 ${url}`,
      };
    }
  }
  const program =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const opened = await new Promise<boolean>((resolve) => {
    const browser = spawn(program, args, { stdio: "ignore" });
    browser.once("error", () => resolve(false));
    browser.once("exit", (code) => resolve(code === 0));
  });
  return {
    ...(child ? { child } : {}),
    message: `${opened ? "观战页已打开。保持此终端运行可继续观战。" : "未能自动打开浏览器，请手动打开："}\n${url}\n下次可运行：${command}`,
  };
}
