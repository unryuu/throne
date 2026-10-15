import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Chronicle } from "@throne/court";
import {
  createLiveTextModel,
  type LiveCallTrace,
  type LiveTextRequest,
} from "@throne/agent-runtime/live";
import { parseStory, verifyStory } from "../shared/story.ts";
import { assertRunId, readChronicle } from "./local-runs.ts";
import { storytellerPrompt, summarizeChronicle } from "./summary.ts";

export type StoryResult = ReturnType<typeof verifyStory> & {
  readonly generatedAt: string;
  readonly trace: LiveCallTrace;
  readonly summary: Omit<ReturnType<typeof summarizeChronicle>, "text">;
};
type ModelFactory = (
  root: string,
  onTrace: (trace: LiveCallTrace) => void,
) => (request: LiveTextRequest) => Promise<string>;

export class Storyteller {
  constructor(
    private readonly root: string,
    private readonly modelFactory: ModelFactory = (root, onTrace) =>
      createLiveTextModel(root, onTrace, {
        timeoutMs: 300000,
        maxTokens: 32768,
      }),
  ) {}
  path(id: string): string {
    assertRunId(id);
    return join(this.root, "runs/storyteller", `${id}.json`);
  }
  private digest(chronicle: Chronicle) {
    return createHash("sha256").update(JSON.stringify(chronicle)).digest("hex");
  }
  async cached(chronicle: Chronicle): Promise<StoryResult | undefined> {
    let text: string;
    try {
      text = await readFile(this.path(chronicle.id), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const cached = JSON.parse(text) as {
      version: number;
      digest: string;
      status: string;
      error?: string;
      raw: string;
      generatedAt: string;
      trace: LiveCallTrace;
      summary: StoryResult["summary"];
    };
    if (cached.version !== 1 || cached.digest !== this.digest(chronicle))
      throw new Error("说书人缓存与存档不符；请用 CLI --force 重新生成");
    if (cached.status !== "succeeded")
      throw new Error(
        `上次说书失败：${cached.error}。请用 CLI --force 重试，避免自动重复付费`,
      );
    const verified = this.validate(cached.raw, chronicle);
    return {
      ...verified,
      generatedAt: cached.generatedAt,
      trace: cached.trace,
      summary: cached.summary,
    };
  }
  private validate(raw: string, chronicle: Chronicle) {
    const text = raw
      .trim()
      .replace(/^```(?:json)?\s*/u, "")
      .replace(/\s*```$/u, "");
    return verifyStory(parseStory(JSON.parse(text), chronicle), chronicle);
  }
  async generate(id: string, force = false): Promise<StoryResult> {
    const chronicle = await readChronicle(this.root, id);
    if (!chronicle.complete)
      throw new Error("本局尚未结束；可以逐日观战，完局后才生成说书");
    const path = this.path(id);
    await mkdir(join(this.root, "runs/storyteller"), { recursive: true });
    if (!force) {
      const cached = await this.cached(chronicle);
      if (cached) return cached;
    }
    const lockPath = path + ".lock";
    let lock;
    for (let attempt = 0; attempt < 360; attempt++) {
      try {
        lock = await open(lockPath, "wx", 0o600);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (force) throw new Error("此局正在生成，不能同时强制重生成");
        await delay(1000);
        const cached = await this.cached(chronicle);
        if (cached) return cached;
      }
    }
    if (!lock)
      throw new Error(
        `说书人生成锁仍被占用：${lockPath}；若进程已退出，请移走此锁文件后重试`,
      );
    try {
      await lock.writeFile(
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        }),
      );
      if (!force) {
        const cached = await this.cached(chronicle);
        if (cached) return cached;
      }
      if (force) {
        const history = join(this.root, "runs/storyteller/history");
        await mkdir(history, { recursive: true });
        await copyFile(path, join(history, `${id}.${randomUUID()}.json`)).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          },
        );
      }
      const { text, ...summary } = summarizeChronicle(chronicle);
      const generatedAt = new Date().toISOString();
      const base = {
        version: 1,
        id,
        digest: this.digest(chronicle),
        generatedAt,
        summary,
      };
      let trace: LiveCallTrace | undefined;
      let raw: string | undefined;
      try {
        raw = await this.modelFactory(this.root, (value) => {
          trace = value;
        })({
          decisionEpisodeId: `storyteller:${id}`,
          sessionKey: `storyteller:${id}:${randomUUID()}`,
          systemPrompt: storytellerPrompt,
          prompt: text,
        });
        if (!trace) throw new Error("说书人调用缺少 token 与调用记录");
        const verified = this.validate(raw, chronicle);
        const result = { ...verified, generatedAt, trace, summary };
        await this.save(path, { ...base, status: "succeeded", raw, ...result });
        return result;
      } catch (error) {
        await this.save(path, {
          ...base,
          status: "failed",
          raw,
          trace,
          error: String(error),
        });
        throw error;
      }
    } finally {
      await lock.close();
      await unlink(lockPath);
    }
  }
  private async save(path: string, data: unknown) {
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await rename(temp, path);
  }
}
