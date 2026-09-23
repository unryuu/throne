import { useEffect, useState } from "react";
import type { Locale, MessageKey, Translator } from "@throne/localization";
import {
  formatCourtTime,
  ids,
  type CourtAction,
  type CourtRulerView,
  type CourtState,
  type EdictKind,
  type RescriptSubmission,
  type RulerDocumentView,
} from "@throne/court";
import type { JsonObject } from "@throne/shared-types";
import type { CourtReview, CourtSnapshot } from "../server/court-service.ts";

const storageKey = "throne.courtRun";
function remember(id?: string) {
  try {
    if (id) localStorage.setItem(storageKey, id);
    else localStorage.removeItem(storageKey);
  } catch {
    /* storage may be unavailable */
  }
}
function recall(): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/court" + path, {
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Throne-Client": "local",
          },
          body: JSON.stringify(body),
        }),
  });
  const value = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}

type EdictDraft = { kind: EdictKind; params: JsonObject };
type Choice = {
  disposition: "follow_draft" | "custom" | "hold";
  edict: EdictDraft;
  text: string;
};
type Special = EdictDraft & { text: string };

function defaultParams(kind: EdictKind, view: CourtRulerView): JsonObject {
  switch (kind) {
    case "order_inquiry":
      return { countyId: view.options.counties[0]!.id, agent: "jinyiwei" };
    case "reprimand":
      return { actorId: view.options.reprimandable[0]?.id ?? "" };
    case "arrest":
      return { actorId: view.options.arrestable[0]?.id ?? "" };
    default:
      return {};
  }
}

function initialChoices(view: CourtRulerView): Record<string, Choice> {
  return Object.fromEntries(
    (view.audience?.documents ?? []).map((d) => [
      d.id,
      {
        disposition: d.draft ? "follow_draft" : "hold",
        edict: d.draft
          ? { kind: d.draft.edict.kind, params: d.draft.edict.params }
          : { kind: "acknowledge", params: {} },
        text: d.draft?.text ?? "",
      },
    ]),
  );
}

export function CourtPlay({ locale, t }: { locale: Locale; t: Translator }) {
  const [snapshot, setSnapshot] = useState<CourtSnapshot>();
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [specials, setSpecials] = useState<Special[]>([]);
  const [review, setReview] = useState<CourtReview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [verified, setVerified] = useState(false);
  const audienceId = snapshot?.view.audience?.id;

  useEffect(() => {
    const id = recall();
    if (id)
      void request<CourtSnapshot>("/" + id)
        .then(setSnapshot)
        .catch(() => remember());
  }, []);
  useEffect(() => {
    if (!snapshot) return;
    setChoices(initialChoices(snapshot.view));
    setSpecials([]);
  }, [audienceId]);
  useEffect(() => {
    if (snapshot?.status !== "running") return;
    let cancelled = false;
    const timer = setInterval(() => {
      void request<CourtSnapshot>("/" + snapshot.id)
        .then((next) => {
          if (!cancelled) setSnapshot(next);
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        });
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [snapshot?.id, snapshot?.status]);

  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const start = () =>
    perform(async () => {
      const next = await request<CourtSnapshot>("", { locale });
      setSnapshot(next);
      setReview(undefined);
      setVerified(false);
      remember(next.id);
    });
  const submit = () =>
    perform(async () => {
      if (!snapshot?.view.audience) return;
      const view = snapshot.view;
      const submission: RescriptSubmission = {
        audienceId: view.audience!.id,
        items: view.audience!.documents.map((d) => {
          const c = choices[d.id]!;
          if (c.disposition === "hold")
            return { documentId: d.id, disposition: "hold" };
          if (c.disposition === "follow_draft")
            return {
              documentId: d.id,
              disposition: "follow_draft",
              text: c.text,
            };
          return {
            documentId: d.id,
            disposition: "custom",
            edict: c.edict,
            text: c.text,
          };
        }),
        specials: specials.map((s) => ({
          edict: { kind: s.kind, params: s.params },
          text: s.text,
        })),
      };
      setSnapshot({ ...snapshot, status: "running" });
      setSnapshot(
        await request<CourtSnapshot>(`/${snapshot.id}/rescript`, {
          submission,
        }),
      );
    });
  const retry = () =>
    perform(async () => {
      if (!snapshot) return;
      setSnapshot({ ...snapshot, status: "running" });
      setSnapshot(await request<CourtSnapshot>(`/${snapshot.id}/retry`, {}));
    });

  const pending = busy || snapshot?.status === "running";
  const view = snapshot?.view;
  return (
    <div className="court-play">
      <p className="command-copy">{t("court.intro")}</p>
      {error || snapshot?.error ? (
        <div role="alert" className="play-error">
          <p>{error ?? snapshot?.error}</p>
        </div>
      ) : null}
      {!snapshot || snapshot.status === "complete" ? (
        <button
          className="restart-button"
          disabled={pending}
          onClick={() => void start()}
        >
          {t(snapshot ? "court.new" : "court.start")}
        </button>
      ) : null}
      {snapshot && view ? (
        <>
          <p className="panel-label court-clock">
            {formatCourtTime(view.time, locale)} ·{" "}
            {t(`court.status.${snapshot.status}` as MessageKey)}
          </p>
          {snapshot.status === "running" ? (
            <p role="status" className="court-running">
              {t("court.running", {
                time: formatCourtTime(view.time, locale),
                calls: snapshot.calls,
              })}
            </p>
          ) : null}
          {view.cappedWakes > 0 ? (
            <p role="alert" className="fog-note">
              {t("court.capped", { count: view.cappedWakes })}
            </p>
          ) : null}
          {snapshot.status === "failed" ? (
            <button
              className="restart-button"
              disabled={pending}
              onClick={() => void retry()}
            >
              {t("court.retry")}
            </button>
          ) : null}
          {snapshot.status === "waiting" && view.audience ? (
            <section className="court-desk" aria-label={t("court.desk")}>
              <h3>{t("court.desk")}</h3>
              {view.audience.documents.length === 0 ? (
                <p className="fog-note">{t("court.emptyDesk")}</p>
              ) : null}
              {view.audience.documents.map((doc) => (
                <DeskDocument
                  key={doc.id}
                  doc={doc}
                  view={view}
                  choice={choices[doc.id]}
                  onChange={(next) =>
                    setChoices({ ...choices, [doc.id]: next })
                  }
                  locale={locale}
                  t={t}
                />
              ))}
              <div className="court-specials">
                <h4>{t("court.special")}</h4>
                {specials.map((special, index) => (
                  <div className="court-special" key={index}>
                    <EdictEditor
                      value={special}
                      view={view}
                      kinds={[
                        ...(view.options.policyDecided
                          ? []
                          : (["approve_policy"] as const)),
                        "order_relief",
                        "order_inquiry",
                        "reprimand",
                        "arrest",
                      ]}
                      onChange={(edict) =>
                        setSpecials(
                          specials.map((s, i) =>
                            i === index ? { ...s, ...edict } : s,
                          ),
                        )
                      }
                      t={t}
                    />
                    <textarea
                      value={special.text}
                      placeholder={t("court.vermilionPlaceholder")}
                      onChange={(e) =>
                        setSpecials(
                          specials.map((s, i) =>
                            i === index ? { ...s, text: e.target.value } : s,
                          ),
                        )
                      }
                    />
                    <button
                      className="court-link"
                      onClick={() =>
                        setSpecials(specials.filter((_, i) => i !== index))
                      }
                    >
                      {t("court.remove")}
                    </button>
                  </div>
                ))}
                {specials.length < 6 ? (
                  <button
                    className="court-link"
                    onClick={() =>
                      setSpecials([
                        ...specials,
                        {
                          kind: "order_inquiry",
                          params: defaultParams("order_inquiry", view),
                          text: "",
                        },
                      ])
                    }
                  >
                    + {t("court.addSpecial")}
                  </button>
                ) : null}
              </div>
              <button
                className="restart-button court-submit"
                disabled={pending}
                onClick={() => void submit()}
              >
                {t("court.submit")}
              </button>
            </section>
          ) : null}
          {snapshot.status === "complete" ? (
            <article className="document live-result">
              <h3>{t("court.finished")}</h3>
              <button
                className="restart-button"
                disabled={pending}
                onClick={() =>
                  void perform(async () =>
                    setReview(
                      await request<CourtReview>(`/${snapshot.id}/review`),
                    ),
                  )
                }
              >
                {t("court.reveal")}
              </button>
              <button
                className="restart-button"
                disabled={pending}
                onClick={() =>
                  void perform(async () => {
                    const result = await request<{ verified: boolean }>(
                      `/${snapshot.id}/replay`,
                    );
                    setVerified(result.verified);
                  })
                }
              >
                {t("court.replay")}
              </button>
              {verified ? <p role="status">{t("court.verified")}</p> : null}
            </article>
          ) : null}
          {review ? (
            <CourtReviewView review={review} locale={locale} t={t} />
          ) : null}
          <Archive view={view} locale={locale} t={t} />
        </>
      ) : null}
    </div>
  );
}

function DeskDocument({
  doc,
  view,
  choice,
  onChange,
  locale,
  t,
}: {
  doc: RulerDocumentView;
  view: CourtRulerView;
  choice: Choice | undefined;
  onChange: (next: Choice) => void;
  locale: Locale;
  t: Translator;
}) {
  if (!choice) return null;
  const dispositions = [
    ...(doc.draft ? (["follow_draft"] as const) : []),
    "custom" as const,
    "hold" as const,
  ];
  const customKinds: EdictKind[] = [
    "acknowledge",
    "reject",
    ...(view.options.policyDecided ? [] : (["approve_policy"] as const)),
    "order_relief",
    "order_inquiry",
    "reprimand",
    "arrest",
  ];
  return (
    <article className={`court-doc court-doc-${doc.kind}`}>
      <DocumentHead doc={doc} locale={locale} t={t} />
      <p className="court-text">{doc.text}</p>
      {doc.draft ? (
        <div className="court-draft">
          <span>{t("court.draft")}</span>
          <strong>
            {t(`court.edict.${doc.draft.edict.kind}` as MessageKey)}
          </strong>
          <EdictParams edict={doc.draft.edict} view={view} t={t} />
          <p>{doc.draft.text}</p>
        </div>
      ) : doc.kind === "memorial" ? (
        <p className="fog-note">{t("court.noDraft")}</p>
      ) : null}
      <div className="view-switch court-dispositions">
        {dispositions.map((d) => (
          <button
            key={d}
            className={choice.disposition === d ? "active" : ""}
            onClick={() =>
              onChange({
                ...choice,
                disposition: d,
                text:
                  d === "follow_draft" ? (doc.draft?.text ?? "") : choice.text,
              })
            }
          >
            {t(
              d === "follow_draft"
                ? "court.follow"
                : d === "custom"
                  ? "court.custom"
                  : "court.hold",
            )}
          </button>
        ))}
      </div>
      {choice.disposition === "custom" ? (
        <EdictEditor
          value={choice.edict}
          view={view}
          kinds={customKinds}
          onChange={(edict) => onChange({ ...choice, edict })}
          t={t}
        />
      ) : null}
      {choice.disposition !== "hold" ? (
        <label className="court-vermilion">
          <span>{t("court.vermilion")}</span>
          <textarea
            value={choice.text}
            placeholder={t("court.vermilionPlaceholder")}
            onChange={(e) => onChange({ ...choice, text: e.target.value })}
          />
        </label>
      ) : null}
    </article>
  );
}

function DocumentHead({
  doc,
  locale,
  t,
}: {
  doc: RulerDocumentView;
  locale: Locale;
  t: Translator;
}) {
  return (
    <>
      <p className="panel-label">
        {t(`court.kind.${doc.kind}` as MessageKey)} · {doc.fromName}
        {doc.fromOffice ? ` · ${doc.fromOffice}` : ""} ·{" "}
        {formatCourtTime(doc.arrivedAt, locale)}
      </p>
      <h4 className="court-subject">{doc.subject}</h4>
    </>
  );
}

function EdictEditor({
  value,
  view,
  kinds,
  onChange,
  t,
}: {
  value: EdictDraft;
  view: CourtRulerView;
  kinds: readonly EdictKind[];
  onChange: (edict: EdictDraft) => void;
  t: Translator;
}) {
  const set = (key: string, v: string) =>
    onChange({ ...value, params: { ...value.params, [key]: v } });
  const p = value.params;
  return (
    <div className="court-edict">
      <label>
        <span>{t("court.disposal")}</span>
        <select
          value={value.kind}
          onChange={(e) => {
            const kind = e.target.value as EdictKind;
            onChange({ kind, params: defaultParams(kind, view) });
          }}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>
              {t(`court.edict.${k}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      {value.kind === "order_relief" || value.kind === "order_inquiry" ? (
        <label>
          <span>{t("court.county")}</span>
          <select
            value={String(p.countyId ?? "")}
            onChange={(e) => {
              if (e.target.value) set("countyId", e.target.value);
              else onChange({ ...value, params: {} });
            }}
          >
            {value.kind === "order_relief" ? (
              <option value="">{t("court.anyCounty")}</option>
            ) : null}
            {view.options.counties.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {value.kind === "order_inquiry" ? (
        <label>
          <span>{t("court.agent")}</span>
          <select
            value={String(p.agent)}
            onChange={(e) => set("agent", e.target.value)}
          >
            <option value="jinyiwei">{t("court.agent.jinyiwei")}</option>
            <option value="hu">{t("court.agent.hu")}</option>
          </select>
        </label>
      ) : null}
      {value.kind === "reprimand" || value.kind === "arrest" ? (
        <label>
          <span>{t("court.target")}</span>
          <select
            value={String(p.actorId ?? "")}
            onChange={(e) => set("actorId", e.target.value)}
          >
            {(value.kind === "arrest"
              ? view.options.arrestable
              : view.options.reprimandable
            ).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function EdictParams({
  edict,
  view,
  t,
}: {
  edict: { params: JsonObject };
  view: CourtRulerView;
  t: Translator;
}) {
  const parts: string[] = [];
  const county = view.options.counties.find(
    (c) => c.id === edict.params.countyId,
  );
  if (county) parts.push(county.name);
  if (edict.params.agent === "hu" || edict.params.agent === "jinyiwei")
    parts.push(t(`court.agent.${edict.params.agent}`));
  const target = view.options.reprimandable.find(
    (a) => a.id === edict.params.actorId,
  );
  if (target) parts.push(target.name);
  return parts.length ? <em> · {parts.join(" · ")}</em> : null;
}

function Archive({
  view,
  locale,
  t,
}: {
  view: CourtRulerView;
  locale: Locale;
  t: Translator;
}) {
  if (!view.archive.length && !view.edicts.length) return null;
  return (
    <section className="court-archive">
      <details>
        <summary>
          {t("court.archive")} ({view.archive.length})
        </summary>
        <ol className="document-list">
          {[...view.archive].reverse().map((doc) => (
            <li className="document court-doc" key={doc.id}>
              <DocumentHead doc={doc} locale={locale} t={t} />
              <p className="court-text">{doc.text}</p>
              {doc.rescript ? (
                <p className="court-rescript">
                  {t(
                    `court.rescript.${doc.rescript.disposition}` as MessageKey,
                  )}
                  {doc.rescript.text ? `：${doc.rescript.text}` : ""}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </details>
      <details>
        <summary>
          {t("court.edicts")} ({view.edicts.length})
        </summary>
        <ol className="document-list">
          {[...view.edicts].reverse().map((e) => (
            <li className="document court-doc" key={e.id}>
              <p className="panel-label">
                {formatCourtTime(e.sentAt, locale)} ·{" "}
                {t(`court.edict.${e.edict.kind}` as MessageKey)} ·{" "}
                {t("court.to", { names: e.toNames.join("、") })}
              </p>
              <h4 className="court-subject">{e.subject}</h4>
              <p className="court-rescript">{e.text}</p>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

const reviewOrder = [ids.yanSong, ids.zheng, ids.hu, ids.yang];

function outcomeText(action: CourtAction): string {
  const o = action.outcome ?? {};
  const parts: string[] = [];
  for (const key of [
    "soldMu",
    "amount",
    "landTakenMu",
    "reason",
    "note",
  ] as const)
    if (o[key] !== undefined) parts.push(`${key}: ${String(o[key])}`);
  if (Array.isArray(o.testimony)) parts.push(...o.testimony.map(String));
  return parts.join("；");
}

function CourtReviewView({
  review,
  locale,
  t,
}: {
  review: CourtReview;
  locale: Locale;
  t: Translator;
}) {
  const state: CourtState = review.state;
  const s = state.summary ?? {};
  const name = (id: string) => state.actors[id]?.name ?? id;
  return (
    <div className="debug-panel court-review">
      <p className="debug-banner">{t("court.review.title")}</p>
      <section>
        <h3>{t("court.review.truth")}</h3>
        <p>
          {t("court.summary", {
            converted: String(s.convertedMu ?? 0),
            target: String(s.targetMu ?? 0),
            annexed: String(s.annexedMu ?? 0),
            deaths: String(s.deaths ?? 0),
            riots: String(s.riots ?? 0),
          })}
        </p>
        <table className="court-table">
          <thead>
            <tr>
              {(
                [
                  "county",
                  "dike",
                  "flooded",
                  "mulberry",
                  "annexed",
                  "homeless",
                  "deaths",
                  "riots",
                  "relief",
                  "merchantGrain",
                ] as const
              ).map((k) => (
                <th key={k}>{t(`court.table.${k}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.values(state.counties).map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{t(`court.dike.${c.breach ?? "intact"}`)}</td>
                <td>{c.inundatedMu}</td>
                <td>{c.mulberryMu}</td>
                <td>{c.annexedMu}</td>
                <td>{c.homeless}</td>
                <td>{c.deaths}</td>
                <td>{c.riots}</td>
                <td>{c.reliefDelivered}</td>
                <td>{c.merchantGrainDelivered}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {state.evidence.map((e) => (
          <p key={e.id}>
            {t("court.review.evidence", {
              county: state.counties[e.countyId].name,
              by: name(e.createdBy),
              found: e.discoveredBy.length
                ? e.discoveredBy.map(name).join("、")
                : t("court.review.nobody"),
            })}
          </p>
        ))}
        <p className="panel-label">
          {t("court.review.calls")}: {review.calls.length}
          {state.counters.cappedWakes
            ? ` · ${t("court.capped", { count: state.counters.cappedWakes })}`
            : ""}
        </p>
      </section>
      {reviewOrder.map((actorId) => {
        const decisions = state.decisions.filter((d) => d.actorId === actorId);
        if (!decisions.length) return null;
        return (
          <section key={actorId} className="court-actor">
            <h3>
              {name(actorId)} · {state.actors[actorId]!.office}
            </h3>
            {decisions.map((d) => {
              const output = d.output as { inner?: string };
              return (
                <div className="court-decision" key={d.decisionEpisodeId}>
                  <p className="panel-label">
                    {formatCourtTime(d.at, locale)}
                    {d.final ? ` · ${t("court.review.final")}` : ""}
                  </p>
                  <div className="court-layer court-thought">
                    <span>{t("court.review.thought")}</span>
                    <p>{output.inner}</p>
                  </div>
                  <div className="court-layer">
                    <span>{t("court.review.word")}</span>
                    {d.documentIds.length ? (
                      d.documentIds.map((id) => {
                        const doc = state.documents[id]!;
                        return (
                          <div key={id}>
                            <p className="panel-label">
                              {t(`court.kind.${doc.kind}` as MessageKey)} →{" "}
                              {doc.toIds.map(name).join("、")} · {doc.subject}
                              {doc.rescript
                                ? ` · ${t(`court.rescript.${doc.rescript.disposition}` as MessageKey)}`
                                : ""}
                            </p>
                            <p>{doc.text}</p>
                          </div>
                        );
                      })
                    ) : (
                      <p className="fog-note">{t("court.review.silent")}</p>
                    )}
                  </div>
                  <div className="court-layer">
                    <span>{t("court.review.deed")}</span>
                    {d.actionIds.length ? (
                      <ul>
                        {d.actionIds.map((id) => {
                          const a = state.actions[id]!;
                          const county =
                            state.counties[
                              a.parameters
                                .countyId as keyof CourtState["counties"]
                            ]?.name;
                          return (
                            <li key={id}>
                              <strong>
                                {t(`court.cap.${a.capabilityId}` as MessageKey)}
                              </strong>
                              {county ? ` · ${county}` : ""} ·{" "}
                              {t(`court.action.${a.status}` as MessageKey)}
                              {outcomeText(a) ? ` — ${outcomeText(a)}` : ""}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="fog-note">{t("court.review.nothing")}</p>
                    )}
                    {d.rejected.length ? (
                      <p className="warning">
                        {t("court.review.rejected")}:{" "}
                        {d.rejected
                          .map(
                            (r) =>
                              `${String(r.subject ?? r.memorialId ?? "")} ${String(r.reason)}`,
                          )
                          .join("；")}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      {state.gaps.length ? (
        <section>
          <h3>{t("court.review.gaps")}</h3>
          <ul>
            {state.gaps.map((g) => (
              <li key={g.id}>
                {name(g.actorId)} · {g.capabilityId}
                {g.description ? ` — ${g.description}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
