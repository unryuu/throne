import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  runsDirectory,
  type CallAdmission,
  type LiveCallTrace,
} from "@throne/agent-runtime/live";
import { quotaDay } from "./analytics.ts";

export const budgetMessage =
  "今日生成额度暂不足，进度已保留。稍后可重试；北京时间零点补充额度，已生成的内容仍可阅读。";
type Reservation = {
  readonly id: string;
  readonly day: string;
  readonly cny: number;
};
type BudgetEvent =
  | (Reservation & { readonly type: "reserve" })
  | {
      readonly type: "settle";
      readonly id: string;
      readonly cny: number;
      readonly unknown: boolean;
    };

/** Peak CNY rates verified 2026-10-19; see docs/issues/archive/public-playtest.md. */
export function costCny(trace: LiveCallTrace | undefined): number | undefined {
  const usage = trace?.usage;
  const values = [
    usage?.inputTokens,
    usage?.cacheReadTokens,
    usage?.outputTokens,
  ];
  if (
    !values.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)
  )
    return;
  return (
    ((values[0] as number) * 2 +
      (values[1] as number) * 0.04 +
      (values[2] as number) * 8) /
    1e6
  );
}

export class ModelBudget {
  private queue: Promise<unknown> = Promise.resolve();
  private loaded = false;
  private readonly reservations = new Map<string, Reservation>();
  private readonly settled = new Map<string, number>();
  private readonly ids = new Set<string>();
  private readonly waiting = new Map<string, number>();
  private readonly active = new Map<string, number>();
  private readonly wake: (() => void)[] = [];
  private slots = 0;
  constructor(
    readonly root: string,
    readonly dailyCny = 50,
    readonly concurrency = 3,
    readonly now: () => number = Date.now,
  ) {
    if (
      !Number.isFinite(dailyCny) ||
      dailyCny <= 0 ||
      !Number.isSafeInteger(concurrency) ||
      concurrency < 1
    )
      throw new Error("Invalid model budget configuration");
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => undefined);
    return next;
  }
  private get path() {
    return join(runsDirectory(this.root), "budget", "events.jsonl");
  }
  private apply(event: BudgetEvent) {
    if (
      !event ||
      typeof event.id !== "string" ||
      !Number.isFinite(event.cny) ||
      event.cny < 0
    )
      throw new Error("Invalid budget event");
    if (event.type === "reserve") {
      if (this.ids.has(event.id) || !/^\d{4}-\d{2}-\d{2}$/.test(event.day))
        throw new Error("Invalid budget reservation");
      this.ids.add(event.id);
      this.reservations.set(event.id, event);
    } else if (event.type === "settle" && typeof event.unknown === "boolean") {
      const reservation = this.reservations.get(event.id);
      if (!reservation) throw new Error("Unknown budget reservation");
      this.settled.set(
        reservation.day,
        (this.settled.get(reservation.day) ?? 0) + event.cny,
      );
      this.reservations.delete(event.id);
    } else throw new Error("Unknown budget event");
  }
  private async load() {
    if (this.loaded) return;
    let source: string;
    try {
      source = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      source = "";
    }
    const lines = source.split("\n");
    for (const [i, line] of lines.entries()) {
      if (!line && i === lines.length - 1) continue;
      try {
        this.apply(JSON.parse(line) as BudgetEvent);
      } catch {
        throw new Error(`Invalid budget ledger at ${this.path}:${i + 1}`);
      }
    }
    this.loaded = true;
  }
  private async append(event: BudgetEvent) {
    await mkdir(join(runsDirectory(this.root), "budget"), { recursive: true });
    await appendFile(this.path, JSON.stringify(event) + "\n", { mode: 0o600 });
    this.apply(event);
  }
  async snapshot() {
    return this.serial(async () => {
      await this.load();
      const day = quotaDay(new Date(this.now()));
      return {
        day,
        spentCny: this.settled.get(day) ?? 0,
        heldCny: this.held(day),
        dailyCny: this.dailyCny,
        ...this.pressure(),
      };
    });
  }
  pressure() {
    const age = (values: Iterable<number>) =>
      Math.max(0, ...[...values].map((at) => this.now() - at));
    return {
      waiting: this.waiting.size,
      active: this.active.size,
      oldestWaitMs: age(this.waiting.values()),
      oldestActiveMs: age(this.active.values()),
    };
  }
  private held(day: string) {
    return [...this.reservations.values()].reduce(
      (sum, r) => sum + (r.day === day || this.active.has(r.id) ? r.cny : 0),
      0,
    );
  }
  readonly admit: CallAdmission = async (request) => {
    const id = randomUUID();
    this.waiting.set(id, this.now());
    if (this.slots >= this.concurrency)
      await new Promise<void>((resolve) => this.wake.push(resolve));
    else this.slots++;
    this.waiting.delete(id);
    const release = () => {
      this.active.delete(id);
      const next = this.wake.shift();
      if (next) next();
      else this.slots--;
    };
    let reservation: Reservation;
    try {
      reservation = await this.serial(async () => {
        await this.load();
        const data = request as {
          mode?: string;
          prompt?: string;
          systemPrompt?: string;
          maxTokens?: number;
        };
        const cny =
          data.mode === "terminal-day"
            ? 5
            : Math.max(
                0.5,
                (Buffer.byteLength(
                  (data.systemPrompt ?? "") + (data.prompt ?? ""),
                ) *
                  2 +
                  (data.maxTokens ?? 32768) * 8) /
                  1e6,
              );
        const day = quotaDay(new Date(this.now()));
        if (
          (this.settled.get(day) ?? 0) + this.held(day) + cny >
          this.dailyCny + 1e-9
        )
          throw new Error(budgetMessage);
        const value = { id, day, cny };
        await this.append({ type: "reserve", ...value });
        this.active.set(id, this.now());
        return value;
      });
    } catch (error) {
      release();
      throw error;
    }
    let finished = false;
    return {
      finish: async (trace) => {
        if (finished) throw new Error("Model permit already settled");
        finished = true;
        try {
          await this.serial(async () => {
            const known = costCny(trace);
            await this.append({
              type: "settle",
              id,
              cny: known ?? reservation.cny,
              unknown: known === undefined,
            });
          });
        } finally {
          release();
        }
      },
    };
  };
}
