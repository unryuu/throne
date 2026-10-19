import { readFile } from "node:fs/promises";
import { freemem } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelBudget } from "./model-budget.ts";

export function availableMemory() {
  if (process.platform !== "linux") return freemem();
  const match = /^MemAvailable:\s+(\d+) kB$/m.exec(
    readFileSync("/proc/meminfo", "utf8"),
  );
  if (!match) throw new Error("Cannot read MemAvailable");
  return Number(match[1]) * 1024;
}
export async function readBark(root: string) {
  const value = (await readFile(join(root, "secret/bark.txt"), "utf8")).trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid Bark address in secret/bark.txt");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    parts.length !== 1 ||
    url.search ||
    url.hash
  )
    throw new Error(
      "secret/bark.txt must contain only the HTTPS Bark server and device key",
    );
  return { endpoint: `${url.origin}/push`, key: parts[0]! };
}
export function barkSender(config: { endpoint: string; key: string }) {
  return async (title: string, body: string) => {
    // Do not log response bodies or exceptions containing the private endpoint.
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        device_key: config.key,
        title,
        body,
        group: "嘉靖模拟器",
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Bark HTTP ${response.status}`);
    const result = (await response.json()) as { code?: number };
    if (result.code !== 200)
      throw new Error("Bark did not acknowledge notification");
  };
}

type Pressure = ReturnType<ModelBudget["pressure"]>;
export class PressureMonitor {
  private since: number | undefined;
  private notified = false;
  private lastAttempt = -Infinity;
  private checking = false;
  constructor(
    readonly pressure: () => Pressure,
    readonly send: (title: string, body: string) => Promise<void>,
    readonly now: () => number = Date.now,
    readonly memory: () => number = availableMemory,
  ) {}
  async check() {
    if (this.checking) return;
    this.checking = true;
    try {
      const p = this.pressure();
      const memoryMiB = Math.floor(this.memory() / 1024 / 1024);
      const crowded = p.oldestWaitMs >= 120000 || memoryMiB < 200;
      if (crowded) this.since ??= this.now();
      else this.since = undefined;
      const alert = crowded && this.now() - this.since! >= 300000;
      const recovery = !crowded && this.notified;
      if ((!alert || this.notified) && !recovery) return;
      if (this.now() - this.lastAttempt < 300000) return;
      this.lastAttempt = this.now();
      const kind =
        memoryMiB < 200
          ? "服务器内存紧张"
          : "模型调用持续排队（也可能是模型服务响应慢）";
      await this.send(
        recovery ? "嘉靖模拟器 · 拥堵已缓解" : "嘉靖模拟器 · 需要关注",
        [
          recovery ? "排队和内存已回到提醒阈值以内。" : kind,
          `排队 ${p.waiting}，执行中 ${p.active}，最长排队 ${Math.ceil(p.oldestWaitMs / 1000)} 秒，最长执行 ${Math.ceil(p.oldestActiveMs / 1000)} 秒，可用内存 ${memoryMiB} MiB。`,
        ].join("\n"),
      );
      this.notified = !recovery;
    } catch {
      console.error(
        "Bark pressure notification failed; will retry in five minutes",
      );
    } finally {
      this.checking = false;
    }
  }
  start() {
    const timer = setInterval(() => void this.check(), 60000);
    timer.unref();
    return () => clearInterval(timer);
  }
}
