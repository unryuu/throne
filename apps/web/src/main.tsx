import {
  runAppointmentScenario,
  type AppointmentRun,
  contradictoryOrdersIds,
  decisionRevisionIds,
  dynamicPromotionIds,
  lossOfControlIds,
  partialImplementationIds,
  playerDecisionIds,
  runContradictoryOrdersScenario,
  runDecisionRevisionScenario,
  runDynamicPromotionScenario,
  runLossOfControlScenario,
  runPartialImplementationScenario,
  startPlayerDecisionSession,
  type ContradictoryOrdersActorView,
  type ContradictoryOrdersRun,
  type DecisionRevisionActorView,
  type DecisionRevisionRun,
  type DynamicPromotionRun,
  type LossOfControlActorView,
  type LossOfControlRun,
  type PartialImplementationActorView,
  type PartialImplementationRun,
  type PlayerChoiceId,
  type PlayerDecisionRun,
  type PlayerDecisionSession,
} from "@throne/scenario-mvp";
import {
  createTranslator,
  defaultLocale,
  isLocale,
  translateToken,
  type Locale,
  type Translator,
} from "@throne/localization";
import {
  StrictMode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { LivePlay } from "./live-play.tsx";
import { CourtPlay } from "./court-play.tsx";
import { AppointmentView } from "./appointment-view.tsx";
import { RunFailure, reportRunError } from "./run-failure.tsx";

type ScenarioKey =
  | "court"
  | "play"
  | "live"
  | "appointment"
  | "promotion"
  | "control"
  | "revision"
  | "conflict"
  | "partial";

const modes = ["play", "observe", "batch"] as const;
const localeStorageKey = "throne.locale";
const I18nContext = createContext<Translator>(createTranslator(defaultLocale));

function useT(): Translator {
  return useContext(I18nContext);
}

function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    const stored = window.localStorage.getItem(localeStorageKey);
    return isLocale(stored) ? stored : defaultLocale;
  });
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [partialRun, setPartialRun] = useState<PartialImplementationRun>();
  const [conflictRun, setConflictRun] = useState<ContradictoryOrdersRun>();
  const [revisionRun, setRevisionRun] = useState<DecisionRevisionRun>();
  const [controlRun, setControlRun] = useState<LossOfControlRun>();
  const [appointmentRun, setAppointmentRun] = useState<AppointmentRun>();
  const [promotionRun, setPromotionRun] = useState<DynamicPromotionRun>();
  const [playerSession, setPlayerSession] = useState<PlayerDecisionSession>();
  const [playerRun, setPlayerRun] = useState<PlayerDecisionRun>();
  const [playerResolving, setPlayerResolving] = useState(false);
  const [playerError, setPlayerError] = useState<Error>();
  const [playerSessionNumber, setPlayerSessionNumber] = useState(1);
  const [scenario, setScenario] = useState<ScenarioKey>("court");
  const [view, setView] = useState<"ruler" | "debug">("ruler");
  const [moment, setMoment] = useState<"before" | "after">("before");

  useEffect(() => {
    void Promise.all([
      runAppointmentScenario({ runId: "web-appointments" }),
      runPartialImplementationScenario("web-partial-implementation"),
      runContradictoryOrdersScenario("web-contradictory-orders"),
      runDecisionRevisionScenario("web-decision-revision"),
      runLossOfControlScenario("web-loss-of-control"),
      runDynamicPromotionScenario({
        runId: "web-dynamic-promotion",
        outputLanguage: locale,
      }),
    ])
      .then(
        ([appointment, partial, conflict, revision, control, promotion]) => {
          setAppointmentRun(appointment);
          setPartialRun(partial);
          setConflictRun(conflict);
          setRevisionRun(revision);
          setControlRun(control);
          setPromotionRun(promotion);
        },
      )
      .catch((error: unknown) => setPlayerError(reportRunError(error)));
  }, [playerSessionNumber]);

  useEffect(() => {
    let active = true;
    void startPlayerDecisionSession({
      runId: `web-player-decision-${playerSessionNumber}`,
      outputLanguage: locale,
    })
      .then((session) => {
        if (active) setPlayerSession(session);
      })
      .catch((error: unknown) => {
        if (active) setPlayerError(reportRunError(error));
      });
    return () => {
      active = false;
    };
  }, [playerSessionNumber]);

  useEffect(() => {
    window.localStorage.setItem(localeStorageKey, locale);
    document.documentElement.lang = locale;
  }, [locale]);

  const chooseScenario = (next: ScenarioKey) => {
    setScenario(next);
    setMoment("before");
    setView("ruler");
  };
  const submitPlayerChoice = async (choiceId: PlayerChoiceId) => {
    if (!playerSession || playerRun || playerResolving) return;
    setPlayerResolving(true);
    setPlayerError(undefined);
    try {
      setPlayerRun(await playerSession.choose(choiceId));
    } catch (error) {
      setPlayerError(reportRunError(error));
    } finally {
      setPlayerResolving(false);
    }
  };
  const restartPlayerScenario = () => {
    setPlayerSession(undefined);
    setPlayerRun(undefined);
    setPlayerError(undefined);
    setPlayerResolving(false);
    setView("ruler");
    setPlayerSessionNumber((value) => value + 1);
  };
  const playing = scenario === "play";
  const appointment = scenario === "appointment";
  const promotion = scenario === "promotion";
  const control = scenario === "control";
  const revision = scenario === "revision";
  const conflict = scenario === "conflict";
  const scenarioTitle =
    scenario === "court"
      ? t("court.title")
      : scenario === "live"
        ? t("live.title")
        : appointment
          ? t("appointment.title")
          : playing
            ? t("scenario.play.title")
            : promotion
              ? t("scenario.promotion.title")
              : control
                ? t("scenario.control.title")
                : revision
                  ? t("scenario.revision.short")
                  : conflict
                    ? t("scenario.conflict.short")
                    : t("scenario.partial.short");
  const momentLabels = appointment
    ? [t("appointment.before"), t("appointment.after")]
    : promotion
      ? [t("scenario.promotion.before"), t("scenario.promotion.after")]
      : control
        ? [t("scenario.control.before"), t("scenario.control.after")]
        : revision
          ? [t("scenario.revision.before"), t("scenario.revision.after")]
          : conflict
            ? [t("scenario.conflict.before"), t("scenario.conflict.after")]
            : [t("scenario.partial.before"), t("scenario.partial.after")];

  return (
    <I18nContext.Provider value={t}>
      <main>
        <header>
          <div className="header-topline">
            <p className="eyebrow">{t("app.eyebrow")}</p>
            <div className="language-switch" aria-label={t("language.label")}>
              <button
                className={locale === "zh-CN" ? "active" : ""}
                onClick={() => setLocale("zh-CN")}
              >
                {t("language.zh-CN")}
              </button>
              <button
                className={locale === "en" ? "active" : ""}
                onClick={() => setLocale("en")}
              >
                {t("language.en")}
              </button>
            </div>
          </div>
          <h1>{t("app.title")}</h1>
          <p className="lede">{t("app.lede")}</p>
        </header>

        <nav className="scenario-picker" aria-label={t("app.scenarioPicker")}>
          <button
            className={scenario === "court" ? "active" : ""}
            onClick={() => chooseScenario("court")}
          >
            <span>{t("court.badge")}</span>
            {t("court.short")}
          </button>
          <button
            className={scenario === "live" ? "active" : ""}
            onClick={() => chooseScenario("live")}
          >
            <span>DeepSeek</span>
            {t("live.short")}
          </button>
          <button
            className={appointment ? "active" : ""}
            onClick={() => chooseScenario("appointment")}
          >
            <span>{t("appointment.badge")}</span>
            {t("appointment.short")}
          </button>
          <button
            className={playing ? "active" : ""}
            onClick={() => chooseScenario("play")}
          >
            <span>{t("scenario.play.badge")}</span>
            {t("scenario.play.short")}
          </button>
          <button
            className={promotion ? "active" : ""}
            onClick={() => chooseScenario("promotion")}
          >
            <span>Demo F</span>
            {t("scenario.promotion.short")}
          </button>
          <button
            className={control ? "active" : ""}
            onClick={() => chooseScenario("control")}
          >
            <span>Demo E</span>
            {t("scenario.control.short")}
          </button>
          <button
            className={revision ? "active" : ""}
            onClick={() => chooseScenario("revision")}
          >
            <span>Demo D</span>
            {t("scenario.revision.short")}
          </button>
          <button
            className={conflict ? "active" : ""}
            onClick={() => chooseScenario("conflict")}
          >
            <span>Demo C</span>
            {t("scenario.conflict.short")}
          </button>
          <button
            className={
              scenario !== "live" &&
              scenario !== "court" &&
              !playing &&
              !appointment &&
              !promotion &&
              !control &&
              !revision &&
              !conflict
                ? "active"
                : ""
            }
            onClick={() => chooseScenario("partial")}
          >
            <span>Demo B</span>
            {t("scenario.partial.short")}
          </button>
        </nav>

        <section className={`scenario ${view === "debug" ? "debug" : ""}`}>
          <div className="section-heading scenario-heading">
            <div>
              <p className="eyebrow">{t("app.liveSlice")}</p>
              <h2>{scenarioTitle}</h2>
            </div>
            <div
              className="scenario-controls"
              hidden={scenario === "live" || scenario === "court"}
              style={
                scenario === "live" || scenario === "court"
                  ? { display: "none" }
                  : undefined
              }
            >
              {!playing ? (
                <div className="view-switch" aria-label={t("app.momentPicker")}>
                  <button
                    className={moment === "before" ? "active" : ""}
                    onClick={() => setMoment("before")}
                  >
                    {momentLabels[0]}
                  </button>
                  <button
                    className={moment === "after" ? "active" : ""}
                    onClick={() => setMoment("after")}
                  >
                    {momentLabels[1]}
                  </button>
                </div>
              ) : null}
              <div
                className="view-switch"
                aria-label={t("app.perspectivePicker")}
              >
                <button
                  className={view === "ruler" ? "active" : ""}
                  onClick={() => setView("ruler")}
                >
                  {t("app.rulerView")}
                </button>
                <button
                  className={view === "debug" ? "active" : ""}
                  onClick={() => setView("debug")}
                  disabled={playing && !playerRun}
                >
                  {t("app.debugView")}
                </button>
              </div>
            </div>
          </div>

          {scenario === "court" ? (
            <CourtPlay locale={locale} t={t} />
          ) : scenario === "live" ? (
            <LivePlay locale={locale} t={t} />
          ) : playerError ? (
            <RunFailure
              error={playerError}
              t={t}
              onRestart={restartPlayerScenario}
            />
          ) : !appointmentRun ||
            !partialRun ||
            !conflictRun ||
            !revisionRun ||
            !controlRun ||
            !promotionRun ||
            !playerSession ? (
            <p className="loading">{t("app.loading")}</p>
          ) : appointment ? (
            <AppointmentView
              run={appointmentRun}
              view={view}
              moment={moment}
              t={t}
            />
          ) : playing ? (
            view === "ruler" ? (
              <PlayableRulerView
                session={playerSession}
                run={playerRun}
                resolving={playerResolving}
                onChoose={submitPlayerChoice}
                onRestart={restartPlayerScenario}
              />
            ) : playerRun ? (
              <PlayableDebugView run={playerRun} />
            ) : null
          ) : promotion ? (
            view === "ruler" ? (
              <PromotionRulerView
                view={
                  moment === "before"
                    ? promotionRun.rulerViewBeforeDecision
                    : promotionRun.rulerViewFinal
                }
              />
            ) : (
              <PromotionDebugView run={promotionRun} moment={moment} />
            )
          ) : control ? (
            view === "ruler" ? (
              <ControlRulerView
                view={
                  moment === "before"
                    ? controlRun.rulerViewAfterFirstDecision
                    : controlRun.rulerViewFinal
                }
              />
            ) : (
              <ControlDebugView run={controlRun} moment={moment} />
            )
          ) : revision ? (
            view === "ruler" ? (
              <RevisionRulerView
                view={
                  moment === "before"
                    ? revisionRun.rulerViewAfterFirstOrder
                    : revisionRun.rulerViewFinal
                }
              />
            ) : (
              <RevisionDebugView run={revisionRun} moment={moment} />
            )
          ) : conflict ? (
            view === "ruler" ? (
              <ConflictRulerView
                view={
                  moment === "before"
                    ? conflictRun.rulerViewBeforeResponse
                    : conflictRun.rulerViewAfterResponse
                }
              />
            ) : (
              <ConflictDebugView run={conflictRun} moment={moment} />
            )
          ) : view === "ruler" ? (
            <PartialRulerView
              view={
                moment === "before"
                  ? partialRun.rulerViewBeforeAudit
                  : partialRun.rulerViewAfterAudit
              }
            />
          ) : (
            <PartialDebugView run={partialRun} moment={moment} />
          )}
        </section>

        <section aria-labelledby="modes-heading">
          <div className="section-heading">
            <h2 id="modes-heading">{t("app.runtimeModes")}</h2>
            <span>{t("app.scaffold")}</span>
          </div>
          <div className="mode-grid">
            {modes.map((mode) => (
              <article key={mode}>
                <div className="card-topline">
                  <h3>{t(`mode.${mode}.name`)}</h3>
                  <span>{t(`mode.${mode}.status`)}</span>
                </div>
                <p>{t(`mode.${mode}.description`)}</p>
              </article>
            ))}
          </div>
        </section>

        <section
          className="boundary"
          aria-labelledby="boundary-heading"
          hidden={scenario === "live"}
          style={scenario === "live" ? { display: "none" } : undefined}
        >
          <div>
            <p className="eyebrow">{t("app.currentBoundary")}</p>
            <h2 id="boundary-heading">
              {appointment
                ? t("appointment.boundary")
                : playing
                  ? t("boundary.play.title")
                  : promotion
                    ? t("boundary.promotion.title")
                    : control
                      ? t("boundary.control.title")
                      : revision
                        ? t("boundary.revision.title")
                        : conflict
                          ? t("boundary.conflict.title")
                          : t("boundary.partial.title")}
            </h2>
          </div>
          {appointment ? (
            <ol>
              {([1, 2, 3, 4] as const).map((n) => (
                <li key={n}>{t(`appointment.boundary${n}`)}</li>
              ))}
            </ol>
          ) : playing ? (
            <ol>
              <li>{t("boundary.play.1")}</li>
              <li>{t("boundary.play.2")}</li>
              <li>{t("boundary.play.3")}</li>
              <li>{t("boundary.play.4")}</li>
            </ol>
          ) : promotion ? (
            <ol>
              <li>{t("boundary.promotion.1")}</li>
              <li>{t("boundary.promotion.2")}</li>
              <li>{t("boundary.promotion.3")}</li>
              <li>{t("boundary.promotion.4")}</li>
            </ol>
          ) : control ? (
            <ol>
              <li>{t("boundary.control.1")}</li>
              <li>{t("boundary.control.2")}</li>
              <li>{t("boundary.control.3")}</li>
              <li>{t("boundary.control.4")}</li>
            </ol>
          ) : revision ? (
            <ol>
              <li>{t("boundary.revision.1")}</li>
              <li>{t("boundary.revision.2")}</li>
              <li>{t("boundary.revision.3")}</li>
              <li>{t("boundary.revision.4")}</li>
            </ol>
          ) : conflict ? (
            <ol>
              <li>{t("boundary.conflict.1")}</li>
              <li>{t("boundary.conflict.2")}</li>
              <li>{t("boundary.conflict.3")}</li>
              <li>{t("boundary.conflict.4")}</li>
            </ol>
          ) : (
            <ol>
              <li>{t("boundary.partial.1")}</li>
              <li>{t("boundary.partial.2")}</li>
              <li>{t("boundary.partial.3")}</li>
              <li>{t("boundary.partial.4")}</li>
            </ol>
          )}
        </section>
      </main>
    </I18nContext.Provider>
  );
}

function PlayableRulerView({
  session,
  run,
  resolving,
  onChoose,
  onRestart,
}: {
  session: PlayerDecisionSession;
  run: PlayerDecisionRun | undefined;
  resolving: boolean;
  onChoose(choiceId: PlayerChoiceId): void;
  onRestart(): void;
}) {
  const t = useT();
  const view = run?.rulerViewFinal ?? session.rulerView;
  const secured = view.knownOutcome === "palace_secured";
  const resolved = view.decisionStatus === "resolved";

  return (
    <div className="playable-layout">
      <div className="decision-docket">
        <div className="play-time">
          <span>{t("play.simulationTime")}</span>
          <strong>{view.simulationTime}</strong>
        </div>
        <p className="panel-label">{t("play.docket")}</p>
        <h3>{t("play.crisisTitle")}</h3>
        <p className="command-copy">{t("play.crisisCopy")}</p>
        <div className="intelligence-grid">
          <article>
            <div className="card-topline">
              <span>{t("common.time", { time: 10 })}</span>
              <span>{t("play.eastSource")}</span>
            </div>
            <h3>{t("play.eastReportTitle")}</h3>
            <p>{t("play.eastReportCopy")}</p>
          </article>
          <article>
            <div className="card-topline">
              <span>{t("common.time", { time: 10 })}</span>
              <span>{t("play.palaceSource")}</span>
            </div>
            <h3>{t("play.palaceReportTitle")}</h3>
            <p>{t("play.palaceReportCopy")}</p>
          </article>
        </div>
      </div>

      <div className="player-choice-panel">
        {!resolved ? (
          <>
            <p className="panel-label">{t("play.awaiting")}</p>
            <h3>{t("play.chooseTitle")}</h3>
            <p>{t("play.chooseCopy")}</p>
            <div className="player-choice-grid">
              <button
                disabled={resolving}
                onClick={() => onChoose("hold_imperial_palace")}
              >
                <span>{t("play.holdTitle")}</span>
                <small>{t("play.holdCopy")}</small>
                <strong>
                  {resolving ? t("play.resolving") : t("play.issue")}
                </strong>
              </button>
              <button
                disabled={resolving}
                onClick={() => onChoose("move_to_east_gate")}
              >
                <span>{t("play.eastTitle")}</span>
                <small>{t("play.eastCopy")}</small>
                <strong>
                  {resolving ? t("play.resolving") : t("play.issue")}
                </strong>
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="panel-label">{t("play.resultLabel")}</p>
            <h3>
              {secured ? t("play.securedTitle") : t("play.breachedTitle")}
            </h3>
            <p>{secured ? t("play.securedCopy") : t("play.breachedCopy")}</p>
            <div
              className={`outcome-report ${secured ? "secured" : "breached"}`}
            >
              <span>{t("play.selectedOrder")}</span>
              <strong>
                {view.selectedChoiceId === "hold_imperial_palace"
                  ? t("play.holdTitle")
                  : t("play.eastTitle")}
              </strong>
              <span>{t("play.reportTitle")}</span>
              <p>
                {secured ? t("play.reportSecured") : t("play.reportBreached")}
              </p>
            </div>
            <button className="restart-button" onClick={onRestart}>
              {t("play.restart")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function PlayableDebugView({ run }: { run: PlayerDecisionRun }) {
  const t = useT();
  const order = run.debugTruth.order;
  return (
    <div className="debug-panel playable-debug">
      <p className="debug-banner">{t("play.debugBanner")}</p>
      <div className="playable-truth-grid">
        <article>
          <span>{t("play.trueThreat")}</span>
          <h3>{t("play.hiddenThreat")}</h3>
          <code>{run.debugTruth.trueThreat}</code>
        </article>
        <article>
          <span>{t("play.actualOutcome")}</span>
          <h3>
            {run.debugTruth.outcome === "palace_secured"
              ? t("play.securedTitle")
              : t("play.breachedTitle")}
          </h3>
          <code>{run.debugTruth.outcome}</code>
        </article>
        <article>
          <span>{t("play.unitLocation")}</span>
          <h3>
            {run.debugTruth.unit.locationId === playerDecisionIds.palace
              ? t("control.holdPalace")
              : t("revision.moveEast")}
          </h3>
          <code>{run.debugTruth.unit.locationId}</code>
        </article>
      </div>
      <div className="playable-record-grid">
        <div>
          <p className="panel-label">{t("play.decisionRecord")}</p>
          <div className="recorded-decision">
            <span>{t("promotion.capability")}</span>
            <strong>
              {order.choiceId === "hold_imperial_palace"
                ? t("play.holdTitle")
                : t("play.eastTitle")}
            </strong>
            <span>
              {t("common.time", { time: order.lifecycle[0]?.occurredAt ?? 10 })}
            </span>
          </div>
        </div>
        <div>
          <p className="panel-label">{t("play.orderLifecycle")}</p>
          <div className="compact-lifecycle">
            {order.lifecycle.map((entry) => (
              <span key={entry.eventId}>
                {t("common.time", { time: entry.occurredAt })} ·{" "}
                {tokenLabel(entry.status, t)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="debug-caption">{t("play.debugCaption")}</p>
    </div>
  );
}

function PromotionRulerView({
  view,
}: {
  view: DynamicPromotionRun["rulerViewFinal"];
}) {
  const t = useT();
  const received = view.knownOutcome === "sealed_evidence_received";
  return (
    <div className="promotion-player-layout">
      <div className="command-panel">
        <p className="panel-label">{t("promotion.playerTitle")}</p>
        <h3>
          {received ? t("promotion.reportReceived") : t("promotion.noReport")}
        </h3>
        <p className="command-copy">
          {received
            ? t("promotion.reportReceivedCopy")
            : t("promotion.noReportCopy")}
        </p>
        <div className="status-banner conflict-status">
          <span>{t("promotion.knownOutcome")}</span>
          <strong className={received ? "success-text" : "pending-text"}>
            {tokenLabel(view.knownOutcome, t)}
          </strong>
        </div>
        <p className="fog-note">
          {received ? t("promotion.rulerFog") : t("promotion.waitingCopy")}
        </p>
      </div>
      <div className="document-panel">
        <p className="panel-label">{t("promotion.documents")}</p>
        {received ? (
          <article className="document urgent-document">
            <div className="card-topline">
              <span>
                {t("common.time", {
                  time: view.observations[0]?.observedAt ?? "?",
                })}
              </span>
              <span>{t("common.clerkShen")}</span>
            </div>
            <h3>{t("promotion.evidenceTitle")}</h3>
            <p>{t("promotion.evidenceCopy")}</p>
          </article>
        ) : (
          <div className="silence-card">
            <span>{t("promotion.noReport")}</span>
            <h3>{t("promotion.waiting")}</h3>
            <p>{t("promotion.waitingCopy")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PromotionDebugView({
  run,
  moment,
}: {
  run: DynamicPromotionRun;
  moment: "before" | "after";
}) {
  const t = useT();
  const snapshot =
    moment === "before" ? run.actorBeforePromotion : run.actorAfterPromotion;
  const promoted = moment === "after";
  return (
    <div className="debug-panel promotion-debug">
      <p className="debug-banner">{t("promotion.debugBanner")}</p>
      <div className="promotion-profile">
        <div className="promotion-identity">
          <p className="panel-label">{t("promotion.identity")}</p>
          <h3>{t("common.clerkShen")}</h3>
          <code>{snapshot.actorId}</code>
        </div>
        <div className="cognition-shift">
          <span>{t("promotion.cognition")}</span>
          <strong>{tokenLabel(snapshot.cognition.tier, t)}</strong>
          <small>{snapshot.cognition.policyId}</small>
        </div>
      </div>

      <div className="continuity-grid">
        <article>
          <span>{t("promotion.office")}</span>
          <strong>{snapshot.officeHistory.length}</strong>
          <small>{dynamicPromotionIds.clerkOffice}</small>
        </article>
        <article>
          <span>{t("promotion.memories")}</span>
          <strong>{snapshot.memoryIds.length}</strong>
          <small>{snapshot.memoryIds.join(" · ")}</small>
        </article>
        <article>
          <span>{t("promotion.policy")}</span>
          <strong>{promoted ? "Tier 2" : "Tier 1"}</strong>
          <small>{snapshot.cognition.policyId}</small>
        </article>
      </div>

      {promoted ? (
        <div className="promotion-after-grid">
          <div>
            <p className="panel-label">{t("promotion.signalTitle")}</p>
            <div className="promotion-signals">
              {run.debugTruth.promotionSignals.map((signal) => (
                <article key={signal.id}>
                  <span>{signal.strength.toFixed(2)}</span>
                  <h3>
                    {signal.kind === "critical_information"
                      ? t("promotion.signal.critical_information")
                      : t("promotion.signal.high_potential_impact")}
                  </h3>
                  <code>{signal.id}</code>
                </article>
              ))}
            </div>
          </div>
          <div className="recorded-decision">
            <p className="panel-label">{t("promotion.decisionTitle")}</p>
            <span>{t("promotion.capability")}</span>
            <strong>
              {tokenLabel(
                run.debugTruth.decisionEpisode.selectedCapabilityId ??
                  "unknown",
                t,
              )}
            </strong>
            <span>{t("promotion.confidence")}</span>
            <strong>
              {run.debugTruth.decisionOutput.confidence?.toFixed(2) ?? "—"}
            </strong>
          </div>
        </div>
      ) : null}

      <p className="debug-caption">
        {promoted ? t("promotion.afterCaption") : t("promotion.beforeCaption")}
      </p>
    </div>
  );
}

function ControlRulerView({ view }: { view: LossOfControlActorView }) {
  const t = useT();
  const overruled = view.knownOutcome === "later_command_overruled";
  return (
    <div className="control-layout">
      <div className="control-command-panel">
        <div className="formal-seal">
          <span>{t("common.formalAuthority")}</span>
          <strong>{t("common.ruler")}</strong>
          <small>
            {t("control.formalNote", {
              organization: t("common.imperialGuard"),
            })}
          </small>
        </div>
        <p className="panel-label">{t("control.royalOrders")}</p>
        <div className="control-orders">
          {view.issuedOrders.map((order) => (
            <article
              className={`control-order ${order.round === 2 ? "latest" : ""}`}
              key={order.id}
            >
              <div className="card-topline">
                <span>{t("control.command", { round: order.round })}</span>
                <span>
                  {tokenLabel(order.targetLocationId.split(":")[1] ?? "", t)}
                </span>
              </div>
              <h3>{t("control.holdPalace")}</h3>
              <p>
                {order.round === 1
                  ? t("control.firstOrderCopy")
                  : t("control.secondOrderCopy")}
              </p>
            </article>
          ))}
        </div>
        <div className="status-banner conflict-status">
          <span>{t("common.knownOutcome")}</span>
          <strong className={overruled ? "danger-text" : "success-text"}>
            {tokenLabel(view.knownOutcome, t)}
          </strong>
        </div>
        <p className="fog-note">
          {overruled ? t("control.playerAfter") : t("control.playerBefore")}
        </p>
      </div>

      <div className="document-panel">
        <p className="panel-label">{t("control.reports")}</p>
        <div className="document-list">
          {view.observations.map((observation, index) => {
            const refused = index > 0;
            return (
              <article
                className={`document ${refused ? "refusal" : ""}`}
                key={observation.id}
              >
                <div className="card-topline">
                  <span>
                    {t("common.time", { time: observation.observedAt })}
                  </span>
                  <span>{t("common.commander")}</span>
                </div>
                <h3>
                  {refused
                    ? t("control.reportRefused")
                    : t("control.reportObeyed")}
                </h3>
                <p>
                  {refused
                    ? t("control.reportRefusedCopy")
                    : t("control.reportObeyedCopy")}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ControlDebugView({
  run,
  moment,
}: {
  run: LossOfControlRun;
  moment: "before" | "after";
}) {
  const t = useT();
  const assessment =
    moment === "before" ? run.controlAfterFirstDecision : run.controlFinal;
  const episodeId =
    moment === "before"
      ? lossOfControlIds.firstDecision
      : lossOfControlIds.secondDecision;
  const episode = run.debugTruth.decisionEpisodes[episodeId];
  const funding =
    run.debugTruth.relationships[lossOfControlIds.fundingRelationship];
  const visibleObedience = run.debugTruth.obedienceRecords.filter((record) => {
    const order = run.debugTruth.orders[record.orderId];
    return moment === "after" || order?.round === 1;
  });
  const leaderName =
    assessment.leadingActorId === lossOfControlIds.ruler
      ? t("common.ruler")
      : t("common.chancellor");

  return (
    <div className="debug-panel control-debug">
      <p className="debug-banner">{t("control.debugBanner")}</p>
      <div className="authority-comparison">
        <article>
          <span>{t("common.formalAuthority")}</span>
          <h3>{t("common.ruler")}</h3>
          <p>{t("control.formalDetail")}</p>
        </article>
        <div className="not-equal">≠</div>
        <article className={moment === "after" ? "shifted" : ""}>
          <span>{t("control.practicalLead")}</span>
          <h3>{leaderName}</h3>
          <p>{t("control.practicalDetail")}</p>
        </article>
      </div>

      <div className="control-evidence-grid">
        <div>
          <p className="panel-label">{t("control.evidence")}</p>
          <div className="candidate-control-list">
            {assessment.candidates.map((candidate) => (
              <div key={candidate.actorId}>
                <span>
                  {candidate.actorId === lossOfControlIds.ruler
                    ? t("common.ruler")
                    : t("common.chancellor")}
                </span>
                <strong>{candidate.score.toFixed(3)}</strong>
                <small>
                  {t("control.evidenceDetail", {
                    score: candidate.relationshipSupport.toFixed(3),
                    obedience: tokenLabel(candidate.latestObedience, t),
                  })}
                </small>
              </div>
            ))}
          </div>
        </div>
        <div className="payroll-card">
          <p className="panel-label">{t("control.materialDependency")}</p>
          <span>{t("control.fundingRelationship")}</span>
          <strong>
            {moment === "before"
              ? funding?.history[0]?.strength.toFixed(2)
              : funding?.strength.toFixed(2)}
          </strong>
          <p>
            {moment === "before"
              ? t("control.payrollBefore")
              : t("control.payrollAfter")}
          </p>
        </div>
      </div>

      <div className="control-decision-grid">
        {episode?.evaluations.map((evaluation) => {
          const selected = episode.selectedOrderId === evaluation.orderId;
          const chancellor = evaluation.orderId.includes("chancellor");
          return (
            <article
              className={`score-card ${selected ? "selected" : ""}`}
              key={evaluation.orderId}
            >
              <div className="card-topline">
                <span>
                  {chancellor ? t("common.chancellor") : t("common.ruler")}
                </span>
                <strong>{evaluation.total.toFixed(3)}</strong>
              </div>
              <h3>{selected ? t("common.selected") : t("common.rejected")}</h3>
              <div className="factor-list">
                {evaluation.factors.map((factor) => (
                  <div key={`${evaluation.orderId}:${factor.kind}`}>
                    <span>{tokenLabel(factor.kind, t)}</span>
                    <strong>{factor.score.toFixed(3)}</strong>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      <div className="obedience-history">
        <p className="panel-label">{t("control.obedienceHistory")}</p>
        {visibleObedience.map((record) => (
          <span
            className={record.obeyed ? "obeyed" : "refused"}
            key={record.id}
          >
            {t("control.obedienceEntry", {
              round: run.debugTruth.orders[record.orderId]?.round ?? "?",
              actor: tokenLabel(
                record.issuerId === lossOfControlIds.ruler
                  ? "ruler"
                  : "chancellor",
                t,
              ),
              outcome: tokenLabel(record.obeyed ? "obeyed" : "not_obeyed", t),
            })}
          </span>
        ))}
      </div>
      <p className="debug-caption">
        {moment === "before"
          ? t("control.beforeCaption")
          : t("control.afterCaption")}
      </p>
    </div>
  );
}

function RevisionRulerView({ view }: { view: DecisionRevisionActorView }) {
  const t = useT();
  const confirmed = view.knownOutcome === "revision_confirmed";
  return (
    <div className="revision-layout">
      <div className="revision-command-panel">
        <p className="panel-label">{t("revision.record")}</p>
        <div className="revision-orders">
          {view.issuedOrders.map((order) => (
            <article
              className={`revision-order ${order.revision > 0 ? "current" : "superseded"}`}
              key={order.id}
            >
              <div className="card-topline">
                <span>
                  {t("revision.number", { revision: order.revision })}
                </span>
                <span>{t("common.time", { time: order.issuedAt })}</span>
              </div>
              <h3>
                {order.objective === "hold_imperial_palace"
                  ? t("revision.holdPalace")
                  : t("revision.moveEast")}
              </h3>
              <p>
                {order.revision > 0
                  ? t("revision.secondCopy")
                  : t("revision.firstCopy")}
              </p>
              <span className="order-reference">{order.id}</span>
            </article>
          ))}
        </div>
        <div className="status-banner conflict-status">
          <span>{t("common.knownOutcome")}</span>
          <strong className={confirmed ? "success-text" : "pending-text"}>
            {tokenLabel(view.knownOutcome, t)}
          </strong>
        </div>
        <p className="fog-note">
          {confirmed ? t("revision.playerAfter") : t("revision.playerBefore")}
        </p>
      </div>

      <div className="document-panel">
        <p className="panel-label">{t("revision.intelligence")}</p>
        <div className="document-list">
          {view.observations.map((observation) => {
            const correcting =
              observation.id === decisionRevisionIds.correctingObservation;
            const report = observation.sourceType === "revision_report";
            return (
              <article
                className={`document ${correcting ? "urgent-document" : ""}`}
                key={observation.id}
              >
                <div className="card-topline">
                  <span>
                    {t("common.time", { time: observation.observedAt })}
                  </span>
                  <span>{tokenLabel(observation.sourceType, t)}</span>
                </div>
                <h3>
                  {report
                    ? t("revision.confirmed")
                    : correcting
                      ? t("revision.decoy")
                      : t("revision.armedMovement")}
                </h3>
                <p>
                  {report
                    ? t("revision.confirmedCopy")
                    : correcting
                      ? t("revision.decoyCopy")
                      : t("revision.armedMovementCopy")}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RevisionDebugView({
  run,
  moment,
}: {
  run: DecisionRevisionRun;
  moment: "before" | "after";
}) {
  const t = useT();
  const first = run.debugTruth.orders[decisionRevisionIds.firstOrder];
  const revised = run.debugTruth.orders[decisionRevisionIds.revisedOrder];
  const unit = run.debugTruth.units[decisionRevisionIds.unit];
  const episode = run.debugTruth.decisionEpisodes[decisionRevisionIds.decision];
  const firstArrival = first?.lifecycle.find(
    (entry) => entry.status === "received",
  )?.occurredAt;
  const revisedArrival = revised?.lifecycle.find(
    (entry) => entry.status === "received",
  )?.occurredAt;

  return (
    <div className="debug-panel revision-debug">
      <p className="debug-banner">{t("revision.debugBanner")}</p>
      <div className="courier-race">
        <article className="courier-card late">
          <div className="card-topline">
            <span>{t("revision.original")}</span>
            <strong>
              {t("common.arrivesAt", { time: firstArrival ?? "?" })}
            </strong>
          </div>
          <h3>{t("revision.moveEastShort")}</h3>
          <p>{t("revision.originalTravel")}</p>
        </article>
        <div className="overtake-mark" aria-label={t("revision.overtaken")}>
          {t("revision.overtaken")}
        </div>
        <article className="courier-card winner">
          <div className="card-topline">
            <span>{t("revision.countermand")}</span>
            <strong>
              {t("common.arrivesAt", { time: revisedArrival ?? "?" })}
            </strong>
          </div>
          <h3>{t("revision.holdPalaceShort")}</h3>
          <p>{t("revision.countermandTravel")}</p>
        </article>
      </div>
      <div className="revision-truth-grid">
        <div>
          <p className="panel-label">{t("revision.history")}</p>
          <div className="truth-number">
            {episode?.finalIntentIds.length ?? 0}
          </div>
          <p>{t("revision.historyDetail")}</p>
        </div>
        <div className="selected-action">
          <span>{t("revision.effectiveOrder")}</span>
          <strong>{tokenLabel(unit?.acceptedOrderId ?? "unknown", t)}</strong>
          <span>{t("revision.objectiveLocation")}</span>
          <strong>
            {tokenLabel(unit?.locationId.split(":")[1] ?? "unknown", t)}
          </strong>
        </div>
      </div>
      <div className="revision-lifecycles">
        {[first, revised].map((order) => (
          <div key={order?.id}>
            <p className="panel-label">
              {t("revision.number", { revision: order?.revision ?? "?" })}
            </p>
            <div className="compact-lifecycle">
              {order?.lifecycle.map((entry) => (
                <span key={entry.eventId}>
                  {t("common.time", { time: entry.occurredAt })}{" "}
                  {tokenLabel(entry.status, t)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="debug-caption">
        {moment === "before"
          ? t("revision.beforeCaption")
          : t("revision.afterCaption")}
      </p>
    </div>
  );
}

function ConflictRulerView({ view }: { view: ContradictoryOrdersActorView }) {
  const t = useT();
  const order = view.issuedOrders[0];
  const overruled = view.knownOutcome === "order_overruled";
  return (
    <div className="order-layout conflict-layout">
      <div className="command-panel">
        <p className="panel-label">{t("conflict.royalCommand")}</p>
        <h3>{t("conflict.holdPalace")}</h3>
        <p className="command-copy">{t("conflict.commandCopy")}</p>
        <div className="status-banner conflict-status">
          <span>{t("common.knownOutcome")}</span>
          <strong className={overruled ? "danger-text" : "pending-text"}>
            {tokenLabel(view.knownOutcome, t)}
          </strong>
        </div>
        <p className="fog-note">
          {overruled ? t("conflict.playerAfter") : t("conflict.playerBefore")}
        </p>
        <p className="order-reference">{order?.id}</p>
      </div>

      <div className="document-panel">
        <p className="panel-label">{t("conflict.messages")}</p>
        {view.observations.length === 0 ? (
          <div className="silence-card">
            <span>{t("conflict.noReply")}</span>
            <h3>{t("conflict.waits")}</h3>
            <p>{t("conflict.waitsCopy")}</p>
          </div>
        ) : (
          <div className="document-list">
            {view.observations.map((observation) => (
              <article className="document refusal" key={observation.id}>
                <div className="card-topline">
                  <span>
                    {t("common.time", { time: observation.observedAt })}
                  </span>
                  <span>{t("common.commander")}</span>
                </div>
                <h3>{t("conflict.notFollowed")}</h3>
                <p>{t("conflict.notFollowedCopy")}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConflictDebugView({
  run,
  moment,
}: {
  run: ContradictoryOrdersRun;
  moment: "before" | "after";
}) {
  const t = useT();
  const episode =
    run.debugTruth.decisionEpisodes[contradictoryOrdersIds.decision];
  const unit = run.debugTruth.units[contradictoryOrdersIds.unit];
  const evaluations = episode?.evaluations ?? [];
  return (
    <div className="debug-panel conflict-debug">
      <p className="debug-banner">{t("conflict.debugBanner")}</p>
      <div className="decision-summary">
        <div>
          <p className="panel-label">{t("conflict.ordersTogether")}</p>
          <div className="truth-number">2</div>
          <p>{t("conflict.ordersTogetherCopy")}</p>
        </div>
        <div className="selected-action">
          <span>{t("conflict.selectedOperation")}</span>
          <strong>{t("conflict.secureGranary")}</strong>
          <span>{t("revision.objectiveLocation")}</span>
          <strong>
            {tokenLabel(unit?.locationId.split(":")[1] ?? "unknown", t)}
          </strong>
        </div>
      </div>
      <div className="score-grid">
        {evaluations.map((evaluation, index) => {
          const chancellor =
            evaluation.orderId === contradictoryOrdersIds.chancellorOrder;
          return (
            <article
              className={`score-card ${index === 0 ? "selected" : ""}`}
              key={evaluation.orderId}
            >
              <div className="card-topline">
                <span>
                  {chancellor ? t("common.chancellor") : t("common.ruler")}
                </span>
                <strong>{evaluation.total.toFixed(3)}</strong>
              </div>
              <h3>
                {chancellor
                  ? t("conflict.secureGranaryShort")
                  : t("conflict.holdPalaceShort")}
              </h3>
              <div className="factor-list">
                {evaluation.factors.map((factor) => (
                  <div key={`${evaluation.orderId}:${factor.kind}`}>
                    <span>{tokenLabel(factor.kind, t)}</span>
                    <strong>{factor.score.toFixed(3)}</strong>
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      <p className="debug-caption">
        {moment === "before"
          ? t("conflict.beforeCaption")
          : t("conflict.afterCaption")}
      </p>
    </div>
  );
}

function PartialRulerView({ view }: { view: PartialImplementationActorView }) {
  const t = useT();
  const completed = view.order.reportedFulfilledAmount ?? 0;
  const verified = view.order.verifiedFulfilledAmount;
  return (
    <div className="order-layout">
      <div className="command-panel">
        <p className="panel-label">{t("partial.royalCommand")}</p>
        <h3>{t("partial.sendGrain")}</h3>
        <p className="command-copy">{t("partial.commandCopy")}</p>
        <div className="order-metrics">
          <div>
            <span>{t("partial.ordered")}</span>
            <strong>{view.order.requestedAmount}</strong>
          </div>
          <div>
            <span>
              {verified === undefined
                ? t("partial.reported")
                : t("partial.auditFound")}
            </span>
            <strong>{verified ?? completed}</strong>
          </div>
        </div>
        <div
          className={`status-banner ${verified === undefined ? "success" : "warning"}`}
        >
          <span>{t("partial.knownStatus")}</span>
          <strong>{tokenLabel(view.order.knownStatus, t)}</strong>
        </div>
        <p className="fog-note">
          {verified === undefined
            ? t("partial.beforeCopy")
            : t("partial.afterCopy", { amount: completed - verified })}
        </p>
      </div>

      <div className="document-panel">
        <p className="panel-label">{t("partial.documents")}</p>
        <div className="document-list">
          {view.observations.map((observation) => {
            const report = readOrderReport(observation.payload.report);
            return (
              <article className="document" key={observation.id}>
                <div className="card-topline">
                  <span>
                    {t("common.time", { time: observation.observedAt })}
                  </span>
                  <span>
                    {tokenLabel(report?.basis ?? observation.sourceType, t)}
                  </span>
                </div>
                <h3>
                  {observation.sourceType === "acknowledgement"
                    ? t("partial.acknowledged")
                    : report?.basis === "independent_audit"
                      ? t("partial.verified", { amount: report.amount })
                      : t("partial.complete", {
                          amount: report?.amount ?? "—",
                        })}
                </h3>
                <p>
                  {observation.sourceType === "acknowledgement"
                    ? t("partial.acknowledgedCopy")
                    : report?.basis === "independent_audit"
                      ? t("partial.verifiedCopy")
                      : t("partial.completeCopy")}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PartialDebugView({
  run,
  moment,
}: {
  run: PartialImplementationRun;
  moment: "before" | "after";
}) {
  const t = useT();
  const order = run.debugTruth.orders[partialImplementationIds.order];
  const northern =
    run.debugTruth.accounts[partialImplementationIds.northernGranary];
  const capital =
    run.debugTruth.accounts[partialImplementationIds.capitalGranary];
  return (
    <div className="debug-panel order-debug">
      <p className="debug-banner">{t("partial.debugBanner")}</p>
      <div className="debug-order-grid">
        <div>
          <p className="panel-label">{t("partial.transferred")}</p>
          <div className="truth-number">{order?.fulfilledAmount}</div>
          <p>
            {t("partial.transferredCopy", {
              amount: order?.requestedAmount ?? "?",
            })}
          </p>
        </div>
        <div className="ledger">
          <p className="panel-label">{t("partial.ledger")}</p>
          <div>
            <span>{t("partial.northernGranary")}</span>
            <strong>{northern?.balance}</strong>
          </div>
          <div>
            <span>{t("partial.capitalGranary")}</span>
            <strong>{capital?.balance}</strong>
          </div>
          <div>
            <span>{t("partial.falseReport")}</span>
            <strong>{order?.reportedFulfilledAmount}</strong>
          </div>
        </div>
      </div>
      <div className="lifecycle">
        <p className="panel-label">{t("partial.lifecycle")}</p>
        <div className="lifecycle-track">
          {order?.lifecycle.map((entry) => (
            <div key={entry.eventId}>
              <span>{t("common.time", { time: entry.occurredAt })}</span>
              <strong>{tokenLabel(entry.status, t)}</strong>
            </div>
          ))}
        </div>
      </div>
      <p className="debug-caption">
        {moment === "before"
          ? t("partial.beforeCaption")
          : t("partial.afterCaption")}
      </p>
    </div>
  );
}

function readOrderReport(
  value: unknown,
): { basis: string; amount: number } | undefined {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return undefined;
  }
  const report = value as {
    basis?: unknown;
    claimedFulfilledAmount?: unknown;
  };
  if (
    typeof report.basis !== "string" ||
    typeof report.claimedFulfilledAmount !== "number"
  ) {
    return undefined;
  }
  return { basis: report.basis, amount: report.claimedFulfilledAmount };
}

function tokenLabel(value: string, translator: Translator): string {
  return translateToken(translator, value);
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
