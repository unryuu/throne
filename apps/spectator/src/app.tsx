import { useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  Chronicle,
  ChronicleDay,
  ChroniclePaper,
  RulerEntry,
  TruthEntry,
  WorldSnapshot,
} from "@throne/court";
import { createTranslator, type MessageKey } from "@throne/localization";
import { runs, type RunMeta, type Scene } from "./runs.ts";

const t = createTranslator("zh-CN");
const label = (prefix: string, value: string) => {
  const key = `${prefix}.${value}` as MessageKey;
  const text = t(key);
  return text === key ? value : text;
};
const repo = "https://github.com/unryuu/throne";

type View = "ruler" | "truth";
type Route =
  | { page: "home" }
  | { page: "cover"; slug: string }
  | { page: "day"; slug: string; day: number; view: View }
  | { page: "end"; slug: string };

function parseHash(hash: string): Route {
  const [slug, a, b] = hash.replace(/^#\/?/, "").split("/");
  if (!slug || !runs.some((r) => r.slug === slug)) return { page: "home" };
  if (a === "end") return { page: "end", slug };
  if (a !== undefined && /^\d+$/.test(a))
    return {
      page: "day",
      slug,
      day: Number(a),
      view: b === "ruler" ? "ruler" : "truth",
    };
  return { page: "cover", slug };
}
function href(route: Route): string {
  switch (route.page) {
    case "home":
      return "#/";
    case "cover":
      return `#/${route.slug}`;
    case "end":
      return `#/${route.slug}/end`;
    case "day":
      return `#/${route.slug}/${route.day}/${route.view}`;
  }
}

function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const update = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

const cache = new Map<string, Promise<Chronicle>>();
function useChronicle(slug: string | undefined) {
  const [state, setState] = useState<{
    slug: string;
    data?: Chronicle;
    error?: string;
  }>();
  useEffect(() => {
    if (!slug) return;
    let live = true;
    if (!cache.has(slug))
      cache.set(
        slug,
        fetch(`runs/${slug}.json`).then((r) => {
          if (!r.ok) throw new Error(`读取对局失败：HTTP ${r.status}`);
          return r.json() as Promise<Chronicle>;
        }),
      );
    cache.get(slug)!.then(
      (data) => live && setState({ slug, data }),
      (error: unknown) => {
        cache.delete(slug);
        if (live) setState({ slug, error: String(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [slug]);
  return state?.slug === slug ? state : undefined;
}

export function App() {
  const route = useRoute();
  const slug = route.page === "home" ? undefined : route.slug;
  const run = runs.find((r) => r.slug === slug);
  const loaded = useChronicle(slug);
  return (
    <div className="page">
      <header className="masthead">
        <a className="brand" href="#/">
          嘉靖朝<span>观战</span>
        </a>
        <nav>
          {runs.map((r) => (
            <a
              key={r.slug}
              href={href({ page: "cover", slug: r.slug })}
              className={r.slug === slug ? "on" : ""}
            >
              {r.title}
            </a>
          ))}
          <a href={repo} className="repo">
            自己当皇帝 ↗
          </a>
        </nav>
      </header>
      <main>
        {route.page === "home" || !run ? (
          <Home />
        ) : loaded?.error ? (
          <p className="error">{loaded.error}</p>
        ) : !loaded?.data ? (
          <p className="loading">展卷中……</p>
        ) : route.page === "cover" ? (
          <Cover run={run} chronicle={loaded.data} />
        ) : route.page === "end" ? (
          <Ending run={run} chronicle={loaded.data} />
        ) : (
          <DayPage
            run={run}
            chronicle={loaded.data}
            day={route.day}
            view={route.view}
          />
        )}
      </main>
      <footer>
        这些是真实对局记录：每位大臣由一个大模型扮演，各自想、写、做，世界由规则引擎结算。
        <a href={repo}>源码与玩法</a>
      </footer>
    </div>
  );
}

function Home() {
  return (
    <section className="home">
      <h1>你是嘉靖。满朝都在骗你。</h1>
      <p className="lede">
        嘉靖三十九年，国库空虚，内阁请于浙江改稻为桑。严嵩、郑泌昌、胡宗宪、杨金水、吕芳、陆炳各由一个大模型扮演，各有算盘。皇帝只能看到递到御案上的奏疏。
      </p>
      <p className="lede">
        下面是真实对局。每一天都可以在“皇帝所见”和“实情”之间切换：他心里想的、写给你的、背地里做的，并排摆着。
      </p>
      <div className="run-list">
        {runs.map((r) => (
          <a
            key={r.slug}
            className="run-card"
            href={href({ page: "cover", slug: r.slug })}
          >
            <h2>{r.title}</h2>
            <p>{r.blurb}</p>
            <span className="go">翻开 →</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function Cover({ run, chronicle }: { run: RunMeta; chronicle: Chronicle }) {
  const cast = Object.entries(chronicle.actors).filter(([, a]) => a.llm);
  return (
    <section className="cover">
      <h1>{run.title}</h1>
      <p className="lede">{run.blurb}</p>
      <div className="cover-actions">
        <a
          className="primary"
          href={href({ page: "day", slug: run.slug, day: 0, view: "ruler" })}
        >
          从第一天看起
        </a>
        <a href={href({ page: "end", slug: run.slug })}>
          {chronicle.complete ? "直接看结局" : "看到哪了"}
        </a>
      </div>
      <h2>名场面</h2>
      <ol className="scenes">
        {run.scenes.map((s) => (
          <li key={s.day + s.title}>
            <a
              href={href({
                page: "day",
                slug: run.slug,
                day: s.day,
                view: s.episode ? "truth" : "ruler",
              })}
            >
              <span className="day-no">第 {s.day} 日</span>
              <strong>{s.title}</strong>
            </a>
            <p>{s.note}</p>
          </li>
        ))}
      </ol>
      <h2>登场</h2>
      <ul className="cast">
        {cast.map(([id, a]) => (
          <li key={id}>
            <strong>{a.name}</strong>
            {a.office}
          </li>
        ))}
      </ul>
      <h2>本局说明</h2>
      <ul className="notes">
        {run.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}

const busy = (day: ChronicleDay) =>
  day.ruler.length > 0 || day.truth.length > 0;

function DayPage({
  run,
  chronicle,
  day: requested,
  view,
}: {
  run: RunMeta;
  chronicle: Chronicle;
  day: number;
  view: View;
}) {
  const last = chronicle.days.length - 1;
  const index = Math.min(Math.max(requested, 0), last);
  const day = chronicle.days[index]!;
  const scenes = run.scenes.filter((s) => s.day === index);
  const go = (to: number, v: View = view) => {
    location.hash = href({ page: "day", slug: run.slug, day: to, view: v });
  };
  const step = (dir: 1 | -1) => {
    for (let i = index + dir; i >= 0 && i <= last; i += dir)
      if (busy(chronicle.days[i]!)) return i;
    return undefined;
  };
  const prev = step(-1);
  const next = step(1);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft" && prev !== undefined) go(prev);
      if (e.key === "ArrowRight")
        next !== undefined
          ? go(next)
          : (location.hash = href({ page: "end", slug: run.slug }));
      if (e.key === "Tab" && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        go(index, view === "ruler" ? "truth" : "ruler");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const sceneEpisodes = new Map(
    scenes.filter((s) => s.episode).map((s) => [s.episode!, s]),
  );
  return (
    <section className="day">
      <div className="daybar">
        <div className="daynav">
          <button
            disabled={prev === undefined}
            onClick={() => prev !== undefined && go(prev)}
            aria-label="上一日"
          >
            ←
          </button>
          <div className="date">
            <strong>第 {index} 日</strong>
            <span>{day.date}</span>
          </div>
          {next !== undefined ? (
            <button onClick={() => go(next)} aria-label="下一日">
              →
            </button>
          ) : (
            <a className="button" href={href({ page: "end", slug: run.slug })}>
              结局
            </a>
          )}
        </div>
        <input
          type="range"
          min={0}
          max={last}
          value={index}
          onChange={(e) => go(Number(e.target.value))}
          aria-label="跳到某一日"
        />
        <div className="toggle" role="tablist">
          <button
            role="tab"
            aria-selected={view === "ruler"}
            className={view === "ruler" ? "on" : ""}
            onClick={() => go(index, "ruler")}
          >
            皇帝所见
          </button>
          <button
            role="tab"
            aria-selected={view === "truth"}
            className={view === "truth" ? "on" : ""}
            onClick={() => go(index, "truth")}
          >
            实情
          </button>
        </div>
      </div>
      {scenes.map((s) => (
        <div className="scene-banner" key={s.title}>
          <span>名场面</span>
          <strong>{s.title}</strong>
          <p>{s.note}</p>
        </div>
      ))}
      {view === "ruler" ? (
        <RulerDay
          day={day}
          chronicle={chronicle}
          onTruth={() => go(index, "truth")}
        />
      ) : (
        <TruthDay day={day} chronicle={chronicle} scenes={sceneEpisodes} />
      )}
      <p className="hint">← → 翻日，Tab 切换视角。没有动静的日子会自动跳过。</p>
    </section>
  );
}

function RulerDay({
  day,
  chronicle,
  onTruth,
}: {
  day: ChronicleDay;
  chronicle: Chronicle;
  onTruth: () => void;
}) {
  const hidden = day.truth.filter((e) => e.type === "decision").length;
  return (
    <div className="ruler">
      {day.ruler.length === 0 ? (
        <p className="quiet">今日御案上没有东西。</p>
      ) : (
        day.ruler.map((e, i) => (
          <RulerItem key={i} entry={e} chronicle={chronicle} />
        ))
      )}
      {hidden > 0 && (
        <button className="peek" onClick={onTruth}>
          这一天朝中另有 {hidden} 人拿了主意，皇帝看不到 →
        </button>
      )}
    </div>
  );
}

function RulerItem({
  entry,
  chronicle,
}: {
  entry: RulerEntry;
  chronicle: Chronicle;
}) {
  const name = (id: string) => chronicle.actors[id]?.name ?? id;
  switch (entry.type) {
    case "audience":
      return (
        <article className="audience">
          <h3>午时御览</h3>
          {entry.oral.map((text, i) => (
            <div className="oral" key={i}>
              <span className="tag">吕芳口奏</span>
              <p>{text}</p>
            </div>
          ))}
          {entry.papers.length === 0 && entry.oral.length === 0 && (
            <p className="quiet">没有本章。</p>
          )}
          {entry.papers.map((p) => (
            <Paper key={p.id} paper={p} from={name(p.from)} />
          ))}
        </article>
      );
    case "edict":
      return (
        <article className="edict">
          <span className="tag vermilion">
            {entry.proxy ? "司礼监代批" : entry.subject}
          </span>
          <p className="vermilion-text">
            {entry.text || label("court.edict", entry.edict)}
          </p>
          <p className="meta">
            {label("court.edict", entry.edict)}
            {entry.to.length > 0 && ` · 发往 ${entry.to.join("、")}`}
          </p>
        </article>
      );
    case "conversation":
      return (
        <article className="talk">
          <p>
            <span className="tag">皇上</span>
            {entry.ruler}
          </p>
          <p>
            <span className="tag">吕芳</span>
            {entry.reply}
          </p>
        </article>
      );
    case "standing":
      return <p className="meta">改口谕：{entry.text}</p>;
    case "interruption":
      return (
        <p className="meta">
          {entry.by}请求打断闭关{entry.reason && `：${entry.reason}`}
          {entry.admitted !== undefined &&
            (entry.admitted ? "（召见）" : "（不见）")}
        </p>
      );
  }
}

function Paper({ paper, from }: { paper: ChroniclePaper; from: string }) {
  const folded = paper.summary !== undefined && !paper.revealed;
  return (
    <div className="paper">
      <p className="paper-head">
        <span className="tag">{label("court.kind", paper.kind)}</span>
        {from}《{paper.subject}》
        {paper.direct && <span className="tag">陆炳面呈</span>}
      </p>
      {folded ? (
        <p className="summary">吕芳只口奏了摘要：{paper.summary}</p>
      ) : (
        <p className="body">{paper.text}</p>
      )}
      {paper.luBingNote && <p className="meta">陆炳附言：{paper.luBingNote}</p>}
      {paper.draft && (
        <p className="draft">
          <span className="tag">内阁票拟</span>
          {paper.draft}
        </p>
      )}
      {paper.rescript && (
        <p className="rescript">
          <span className="tag vermilion">朱批</span>
          {paper.rescript.disposition === "follow_draft" ? (
            <span className="vermilion-text">依拟</span>
          ) : paper.rescript.disposition === "hold" ? (
            <span className="vermilion-text">留中不发</span>
          ) : (
            <span className="vermilion-text">
              {paper.rescript.text ||
                label("court.edict", paper.rescript.edict ?? "")}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function TruthDay({
  day,
  chronicle,
  scenes,
}: {
  day: ChronicleDay;
  chronicle: Chronicle;
  scenes: ReadonlyMap<string, Scene>;
}) {
  return (
    <div className="truth">
      {day.truth.length === 0 && <p className="quiet">今日无人拿主意。</p>}
      {day.truth.map((e, i) => (
        <TruthItem
          key={i}
          entry={e}
          chronicle={chronicle}
          scene={e.type === "decision" ? scenes.get(e.episode) : undefined}
        />
      ))}
      <World world={day.world} />
    </div>
  );
}

const shichen = (at: number) => "子丑寅卯辰巳午未申酉戌亥"[at % 12] + "时";

function highlight(text: string, quote: string | undefined): ReactNode {
  if (!quote) return text;
  const i = text.indexOf(quote);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{quote}</mark>
      {text.slice(i + quote.length)}
    </>
  );
}

function TruthItem({
  entry,
  chronicle,
  scene,
}: {
  entry: TruthEntry;
  chronicle: Chronicle;
  scene: Scene | undefined;
}) {
  const actor = (id: string) => chronicle.actors[id];
  switch (entry.type) {
    case "world":
      return <p className={`world-event ${entry.kind}`}>{entry.text}</p>;
    case "result":
      return (
        <p className={`result ${entry.status}`}>
          <span className="who">{actor(entry.actor)?.name}</span>
          {label("court.cap", entry.capability)}
          {entry.county && `（${entry.county}）`}：
          <strong>{label("court.action", entry.status)}</strong>
          {outcomeText(entry.outcome)}
        </p>
      );
    case "decision": {
      const a = actor(entry.actor);
      return (
        <article className={`decision${scene ? " featured" : ""}`}>
          <header>
            <strong>{a?.name}</strong>
            <span>{entry.office}</span>
            <span className="time">{shichen(entry.at)}</span>
            {entry.final && <span className="tag">最后的决定</span>}
          </header>
          <div className="columns">
            <section>
              <h4>所想</h4>
              <p className="thought">
                {highlight(entry.thought, scene?.thought)}
              </p>
              {entry.report && (
                <p className="said">
                  <span className="tag">口奏御前</span>
                  {highlight(entry.report, scene?.word)}
                </p>
              )}
            </section>
            <section>
              <h4>所言</h4>
              {entry.documents.length === 0 &&
                entry.drafts.length === 0 &&
                !entry.report && <p className="quiet">一字未写</p>}
              {entry.documents.map((d, i) => {
                const toThrone = d.kind !== "letter";
                const quoted = scene?.word && d.text.includes(scene.word);
                return (
                  <details key={i} open={toThrone || Boolean(quoted)}>
                    <summary>
                      <span className="tag">{label("court.kind", d.kind)}</span>
                      {toThrone ? "" : `致${d.to.join("、")} `}《{d.subject}》
                    </summary>
                    <p>{highlight(d.text, scene?.word)}</p>
                  </details>
                );
              })}
              {entry.drafts.map((d, i) => (
                <details
                  key={`d${i}`}
                  open={Boolean(scene?.word && d.text.includes(scene.word))}
                >
                  <summary>
                    <span className="tag">票拟</span>《{d.subject}》
                  </summary>
                  <p>{highlight(d.text, scene?.word)}</p>
                </details>
              ))}
            </section>
            <section>
              <h4>所为</h4>
              {entry.actions.length +
                entry.dispositions.length +
                entry.routes.length ===
                0 && <p className="quiet">按兵不动</p>}
              {entry.actions.map((x, i) => (
                <p
                  key={i}
                  className={`deed ${x.capability === "breach_dike" ? "dark" : ""}`}
                >
                  <strong>{label("court.cap", x.capability)}</strong>
                  {x.county && `（${x.county}）`}
                  {x.status === "impossible" && (
                    <span className="tag">办不成</span>
                  )}
                  {x.description && (
                    <span className="desc">
                      {highlight(x.description, scene?.deed)}
                    </span>
                  )}
                </p>
              ))}
              {entry.dispositions.map((x, i) => (
                <p key={`p${i}`} className="deed">
                  <strong>{label("court.disposition", x.action)}</strong>《
                  {x.subject}》
                </p>
              ))}
              {entry.routes.map((x, i) => (
                <p key={`r${i}`} className="deed">
                  <strong>{label("court.route", x.channel)}</strong>《
                  {x.subject}》
                  {x.note && <span className="desc">{x.note}</span>}
                </p>
              ))}
            </section>
          </div>
          {entry.rejected.length > 0 && (
            <p className="meta">被规则拦下：{entry.rejected.join("；")}</p>
          )}
          {entry.terminal && (
            <details className="terminal">
              <summary>终端记录 · {entry.terminal.length} 条命令</summary>
              {entry.terminal.map((s, i) => (
                <div key={i} className={s.error ? "err" : ""}>
                  <pre className="cmd">$ {s.command}</pre>
                  {s.output && <pre className="out">{s.output}</pre>}
                </div>
              ))}
            </details>
          )}
        </article>
      );
    }
  }
}

function outcomeText(outcome: Record<string, unknown> | undefined): string {
  if (!outcome) return "";
  const o = outcome as Record<
    string,
    number | string | undefined | Record<string, unknown> | string[]
  >;
  const parts: string[] = [];
  if (typeof o.reason === "string") parts.push(o.reason);
  if (typeof o.note === "string") parts.push(o.note);
  if (typeof o.soldMu === "number")
    parts.push(`要买 ${o.requestedMu} 万亩，买到 ${o.soldMu} 万亩`);
  if (typeof o.landTakenMu === "number")
    parts.push(`出粮 ${o.amount} 万石，换得田 ${o.landTakenMu} 万亩`);
  else if (typeof o.amount === "number") parts.push(`${o.amount} 万石`);
  const f = o.findings as Record<string, number | boolean> | undefined;
  if (f)
    parts.push(
      `查得稻田 ${f.paddyMu} 万亩、桑田 ${f.mulberryMu} 万亩、灾民 ${f.homeless} 万、死 ${f.deaths} 人${f.dikeBreached ? "，大堤已决" : ""}`,
    );
  if (Array.isArray(o.testimony)) parts.push(...(o.testimony as string[]));
  return parts.length ? ` — ${parts.join("；")}` : "";
}

function World({ world }: { world: WorldSnapshot }) {
  return (
    <div className="world">
      <h4>当日实况（皇帝看不到）</h4>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>县</th>
              <th>稻田</th>
              <th>桑田</th>
              <th>低价兼并</th>
              <th>大堤</th>
              <th>灾民</th>
              <th>死亡</th>
            </tr>
          </thead>
          <tbody>
            {world.counties.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{round(c.paddyMu)} 万亩</td>
                <td>{round(c.mulberryMu)} 万亩</td>
                <td>{round(c.annexedMu)} 万亩</td>
                <td
                  className={c.breach ? "bad" : c.dikeSabotaged ? "warn" : ""}
                >
                  {c.breach ? "决口" : `${Math.round(c.dikeIntegrity * 100)}%`}
                  {c.dikeSabotaged && !c.breach && " 被掘"}
                </td>
                <td>{round(c.homeless)} 万</td>
                <td className={c.deaths ? "bad" : ""}>{c.deaths} 人</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="meta">
        官仓 {round(world.granary)} 万石 · 军粮 {round(world.militaryGrain)}{" "}
        万石 · 沈一石存粮 {round(world.merchantGrain)} 万石
      </p>
    </div>
  );
}
const round = (n: number) => Math.round(n * 10) / 10;

function Ending({ run, chronicle }: { run: RunMeta; chronicle: Chronicle }) {
  const lastDay = chronicle.days[chronicle.days.length - 1]!;
  const world = lastDay.world;
  const s = chronicle.summary as Record<string, unknown> | undefined;
  const sum = (key: "mulberryMu" | "annexedMu" | "deaths") =>
    round(world.counties.reduce((n, c) => n + c[key], 0));
  const dismissed = useMemo(
    () =>
      chronicle.days
        .flatMap((d) => d.truth)
        .filter((e) => e.type === "world" && e.kind === "dismissed"),
    [chronicle],
  );
  const highlightScene = run.ending
    ? run.scenes[run.ending.highlight]
    : undefined;
  const exposed = run.ending?.deceivers.filter((d) => d.exposed).length ?? 0;
  return (
    <section className="ending">
      {!chronicle.complete && (
        <p className="unfinished">
          本局只跑到第 {lastDay.day} 日，还没有结局。下面是那一天的实况。
        </p>
      )}
      <div className="card">
        <p className="card-title">
          {run.title} · {chronicle.complete ? "御批" : `至第 ${lastDay.day} 日`}
        </p>
        {run.ending && <p className="verdict">{run.ending.verdict}</p>}
        <dl className="stats">
          <div>
            <dt>改桑</dt>
            <dd>
              {String(s?.convertedMu ?? sum("mulberryMu"))} 万亩
              <small> / 旨意 {String(s?.targetMu ?? 50)}</small>
            </dd>
          </div>
          <div>
            <dt>低价兼并</dt>
            <dd>{String(s?.annexedMu ?? sum("annexedMu"))} 万亩</dd>
          </div>
          <div>
            <dt>死亡</dt>
            <dd>{String(s?.deaths ?? sum("deaths"))} 人</dd>
          </div>
          <div>
            <dt>拿问</dt>
            <dd>
              {dismissed.length
                ? dismissed
                    .map((e) =>
                      e.type === "world" ? e.text.replace("革职拿问", "") : "",
                    )
                    .join("、")
                : "无"}
            </dd>
          </div>
          <div>
            <dt>模型调用</dt>
            <dd>{chronicle.calls} 次</dd>
          </div>
        </dl>
        {run.ending && (
          <>
            <h3>
              谁欺瞒了你{" "}
              <small>
                揭穿 {exposed} / {run.ending.deceivers.length}
              </small>
            </h3>
            <ul className="deceivers">
              {run.ending.deceivers.map((d) => (
                <li key={d.actor}>
                  <strong>{chronicle.actors[d.actor]?.name}</strong>
                  <span>{d.line}</span>
                  <span className={`badge ${d.exposed ? "yes" : "no"}`}>
                    {d.exposed ? "已揭穿" : "未揭穿"}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {highlightScene && (
          <>
            <h3>最精彩的一段</h3>
            <a
              className="contrast"
              href={href({
                page: "day",
                slug: run.slug,
                day: highlightScene.day,
                view: "truth",
              })}
            >
              <div>
                <span className="tag">心里</span>
                {highlightScene.thought}
              </div>
              <div>
                <span className="tag">奏疏</span>
                {highlightScene.word}
              </div>
              <p className="meta">
                第 {highlightScene.day} 日 · {highlightScene.title} →
              </p>
            </a>
          </>
        )}
        <p className="card-foot">
          嘉靖朝模拟器 · {repo.replace("https://", "")}
        </p>
      </div>
      <div className="cover-actions">
        <a href={href({ page: "cover", slug: run.slug })}>回到目录</a>
        <a className="primary" href={repo}>
          自己当皇帝 ↗
        </a>
      </div>
    </section>
  );
}
