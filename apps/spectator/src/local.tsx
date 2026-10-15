import { useEffect, useState } from "react";
import type { Chronicle } from "@throne/court";
import type { LocalRun } from "../server/local-runs.ts";
import type { StoryResult } from "../server/storyteller.ts";

export const localSlug = (id: string) => `local-${id}`;
export const localId = (slug: string | undefined) =>
  import.meta.env.DEV && slug?.startsWith("local-") ? slug.slice(6) : undefined;

async function json<T>(url: string, method = "GET"): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "x-throne-client": "local" },
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}

type LoadedLocal = {
  readonly chronicle: Chronicle;
  readonly story?: StoryResult;
  readonly storyError?: string;
};
const pendingStories = new Map<string, Promise<StoryResult>>();
export function useLocalRun(id: string | undefined) {
  const [state, setState] = useState<{
    id: string;
    data?: Chronicle;
    story?: StoryResult;
    error?: string;
    storyError?: string;
    generating?: boolean;
  }>();
  useEffect(() => {
    if (!id) return;
    let live = true;
    const load = async () => {
      try {
        const loaded = await json<LoadedLocal>(
          `/api/local-runs/${encodeURIComponent(id)}`,
        );
        if (!live) return;
        const base = {
          id,
          data: loaded.chronicle,
          ...(loaded.story ? { story: loaded.story } : {}),
          ...(loaded.storyError ? { storyError: loaded.storyError } : {}),
        };
        const generate =
          loaded.chronicle.complete && !loaded.story && !loaded.storyError;
        setState({ ...base, generating: generate });
        if (!generate) return;
        let promise = pendingStories.get(id);
        if (!promise) {
          promise = json<StoryResult>(
            `/api/local-runs/${encodeURIComponent(id)}/story`,
            "POST",
          );
          pendingStories.set(id, promise);
          void promise.finally(() => pendingStories.delete(id)).catch(() => {});
        }
        try {
          const story = await promise;
          if (live) setState({ ...base, story, generating: false });
        } catch (error) {
          if (live)
            setState({ ...base, storyError: String(error), generating: false });
        }
      } catch (error) {
        if (live) setState({ id, error: String(error) });
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [id]);
  return state?.id === id ? state : undefined;
}

export function LocalRuns() {
  const [result, setResult] = useState<{
    runs: readonly LocalRun[];
    errors: readonly { id: string; error: string }[];
  }>();
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setError(undefined);
    void json<NonNullable<typeof result>>("/api/local-runs").then(
      (value) => {
        if (live) setResult(value);
      },
      (error) => {
        if (live) setError(String(error));
      },
    );
    return () => {
      live = false;
    };
  }, [revision]);
  return (
    <section className="home">
      <h1>本机存档</h1>
      <p className="lede">
        选一局逐日观战。已完局会请说书人挑名场面、写结局卡；首次生成调用一次
        DeepSeek，随后使用缓存。
      </p>
      <button onClick={() => setRevision((n) => n + 1)}>刷新存档</button>
      {error && <p className="error">{error}</p>}
      {!result && !error && <p className="loading">读取本机存档……</p>}
      {result?.runs.length === 0 && <p>还没有本机存档。先在主应用开始一局。</p>}
      <div className="run-list">
        {result?.runs.map((run) => (
          <a key={run.id} className="run-card" href={`#/${localSlug(run.id)}`}>
            <h2 className="local-run-id">{run.id}</h2>
            <p>
              {run.complete ? "已完局" : "未完局"} · 第 {run.days} 日 ·{" "}
              {run.calls} 次调用
            </p>
            <span className="go">翻开 →</span>
          </a>
        ))}
      </div>
      {result?.errors.map((e) => (
        <p className="error" key={e.id}>
          存档 {e.id} 读取失败：{e.error}
        </p>
      ))}
    </section>
  );
}
