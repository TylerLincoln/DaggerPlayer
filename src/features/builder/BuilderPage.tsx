import { useEffect, useMemo } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { TRAITS } from "../../../content/schema/index.ts";
import { useContent } from "../../content/ContentProvider.tsx";
import { createLocal, type SaveStatus, useAutosave, useCharacterRecord } from "../../data/characters.ts";
import { BUILDER_STEPS, type BuildIssue, canFinish, finishBuild, type StepId, validateBuild } from "../../rules/builder.ts";
import { newCharacter } from "../../rules/character.ts";
import { derive } from "../../rules/derive.ts";
import { formatMod } from "../../rules/traits.ts";
import { useAuth } from "../auth/AuthProvider.tsx";
import { BackgroundStep, BuilderContext, CardsStep, ClassStep, ConnectionsStep, GearStep, HeritageStep, TraitsStep } from "./steps.tsx";

const STEP_COMPONENTS: Record<Exclude<StepId, "review">, () => React.ReactNode> = {
  class: ClassStep,
  heritage: HeritageStep,
  traits: TraitsStep,
  gear: GearStep,
  background: BackgroundStep,
  cards: CardsStep,
  connections: ConnectionsStep,
};

export function NewCharacterPage() {
  const { user } = useAuth();
  const { enabledPacks } = useContent();
  const doc = useMemo(() => newCharacter(enabledPacks), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => createLocal(doc, user?.id ?? null), [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Navigate to={`/build/${doc.id}/class`} replace />;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  "local-only": "Saved on this device. Sign in to save to your account.",
  saving: "Saving…",
  saved: "Saved",
  unsaved: "Unsaved changes…",
  error: "Couldn't save. Your changes are kept on this device.",
  conflict: "Changed on another device",
  "other-account": "This draft belongs to another account and won't be uploaded.",
};

export function SaveIndicator({ status, error }: { status: SaveStatus; error: string | null }) {
  return (
    <p className={`save-status save-${status}`} role="status" aria-live="polite">
      {STATUS_TEXT[status]}
      {error && status === "error" && <small> ({error})</small>}
    </p>
  );
}

export function BuilderPage() {
  const { id, step = "class" } = useParams();
  const { registry } = useContent();
  const { user } = useAuth();
  const [rec, update] = useCharacterRecord(id);
  const { status, error, save, resolve } = useAutosave(id, user?.id ?? null);
  const navigate = useNavigate();

  if (!rec) return (
    <>
      <h1>Character not found</h1>
      <p>This draft isn't on this device. <Link to="/characters">Your characters</Link></p>
    </>
  );
  if (!registry) return <p role="status">Loading content…</p>;
  if (!BUILDER_STEPS.some((s) => s.id === step)) return <Navigate to={`/build/${id}/class`} replace />;

  const c = rec.doc;
  const derived = derive(c, registry);
  const issues = validateBuild(c, registry);
  const idx = BUILDER_STEPS.findIndex((s) => s.id === step);
  const stepState = (s: StepId) => (s === "review" ? null : issues.some((i) => i.step === s && i.severity === "error") ? "todo" : "done");
  const done = BUILDER_STEPS.filter((s) => s.id !== "review" && stepState(s.id) === "done").length;
  const Step = step !== "review" ? STEP_COMPONENTS[step as Exclude<StepId, "review">] : null;

  const finish = async () => {
    update((d) => finishBuild(d, registry));
    if (user) await save("builder-finish");
    navigate(`/characters/${c.id}`);
  };

  return (
    <BuilderContext.Provider value={{ c, update, reg: registry, derived }}>
      <div className="builder">
        <header className="builder-head">
          <h1>{c.identity.name || "New character"}{c.finishedAt && <small> (editing)</small>}</h1>
          <SaveIndicator status={status} error={error} />
        </header>
        {rec.conflict && (
          <div className="conflict" role="alert">
            <p>This character was changed on another device ({new Date(rec.conflict.updated_at).toLocaleString()}). Which version do you want to keep?</p>
            <button type="button" onClick={() => resolve("mine")}>Keep this device's version</button>{" "}
            <button type="button" onClick={() => resolve("theirs")}>Use the other device's version</button>
          </div>
        )}
        <nav aria-label="Builder steps" className="steps">
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={BUILDER_STEPS.length - 1} aria-valuenow={done} aria-label="Steps complete">
            <div style={{ width: `${(done / (BUILDER_STEPS.length - 1)) * 100}%` }} />
          </div>
          <ol>
            {BUILDER_STEPS.map((s, i) => (
              <li key={s.id} className={stepState(s.id) ?? ""}>
                <Link to={`/build/${c.id}/${s.id}`} aria-current={s.id === step ? "step" : undefined}>
                  <span aria-hidden="true">{stepState(s.id) === "done" ? "✓" : stepState(s.id) === "todo" ? "!" : ""}</span> {i + 1}. {s.label}
                  <span className="visually-hidden">{stepState(s.id) === "done" ? " (complete)" : stepState(s.id) === "todo" ? " (needs attention)" : ""}</span>
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <section className="step-body" aria-label={BUILDER_STEPS[idx].label}>
          {Step ? <Step /> : <Review issues={issues} onFinish={finish} />}
          {step !== "review" && <StepIssues issues={issues.filter((i) => i.step === step)} />}
        </section>
        <nav className="prevnext" aria-label="Previous and next step">
          {idx > 0 ? <Link to={`/build/${c.id}/${BUILDER_STEPS[idx - 1].id}`}>← {BUILDER_STEPS[idx - 1].label}</Link> : <span />}
          {idx < BUILDER_STEPS.length - 1 ? <Link className="button primary" to={`/build/${c.id}/${BUILDER_STEPS[idx + 1].id}`}>{BUILDER_STEPS[idx + 1].label} →</Link> : <span />}
        </nav>
      </div>
    </BuilderContext.Provider>
  );
}

function StepIssues({ issues }: { issues: BuildIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="issues" aria-label="Still to do on this step">
      {issues.map((i) => <li key={i.message} className={i.severity}>{i.message}</li>)}
    </ul>
  );
}

function Review({ issues, onFinish }: { issues: BuildIssue[]; onFinish: () => void }) {
  const { user } = useAuth();
  return (
    <BuilderContext.Consumer>
      {({ c, reg, derived }) => {
        const name = (id: string | null) => (id ? reg.byId.get(id)?.name ?? id : "—");
        const a = c.build.ancestry;
        const heritage = !a ? "—" : a.kind === "single" ? name(a.id) : `${a.label || "Mixed"} (top: ${name(a.topFrom)}, bottom: ${name(a.bottomFrom)})`;
        const errors = issues.filter((i) => i.severity === "error");
        const warnings = issues.filter((i) => i.severity === "warning");
        const rows: [string, React.ReactNode, StepId][] = [
          ["Class", `${name(c.build.classId)} · ${name(c.build.subclassId)}`, "class"],
          ["Heritage", `${heritage} · ${name(c.build.communityId)}${c.build.transformationId ? ` · ${name(c.build.transformationId)}` : ""}`, "heritage"],
          ["Traits", TRAITS.map((t) => `${t.slice(0, 3).toUpperCase()} ${formatMod(derived.traits[t].total)}`).join("  "), "traits"],
          ["Weapons", [c.build.gear.primaryId, c.build.gear.secondaryId].filter(Boolean).map(name).join(" + ") || "—", "gear"],
          ["Armor", name(c.build.gear.armorId), "gear"],
          ["Items", [c.build.gear.potion ? (c.build.gear.potion === "health" ? "Minor Health Potion" : "Minor Stamina Potion") : null, c.build.gear.classItem].filter(Boolean).join(", ") || "—", "gear"],
          ["Experiences", c.build.experiences.map((x) => `${x.name || "?"} +${x.bonus}`).join(", "), "background"],
          ["Domain cards", c.build.domainCardIds.map(name).join(", ") || "—", "cards"],
        ];
        return (
          <>
            <h2>Review</h2>
            <dl className="review">
              {rows.map(([k, v, s]) => (
                <div key={k}><dt>{k}</dt><dd>{v} <Link to={`/build/${c.id}/${s}`} aria-label={`Change ${k}`}>Change</Link></dd></div>
              ))}
            </dl>
            <h3>Your numbers</h3>
            <dl className="stats">
              {[["Level", derived.level], ["Evasion", derived.evasion.total], ["Hit Points", derived.hpMax.total], ["Stress", derived.stressMax.total], ["Hope", "2 of 6"], ["Armor Score", derived.armorScore.total], ["Thresholds", `${derived.thresholds.major.total} / ${derived.thresholds.severe.total}`], ["Proficiency", derived.proficiency.total]].map(([k, v]) => (
                <div key={k as string}><dt>{k}</dt><dd title={k === "Evasion" ? derived.evasion.parts.map((p) => `${p.source} ${formatMod(p.value)}`).join(", ") : undefined}>{v}</dd></div>
              ))}
            </dl>
            {errors.length > 0 && (
              <section aria-labelledby="missing-h">
                <h3 id="missing-h">Still missing</h3>
                <ul className="issues">{errors.map((i) => <li key={i.message} className="error"><Link to={`/build/${c.id}/${i.step}`}>{i.message}</Link></li>)}</ul>
              </section>
            )}
            {warnings.length > 0 && (
              <section aria-labelledby="notes-h">
                <h3 id="notes-h">Worth a look</h3>
                <ul className="issues">{warnings.map((i) => <li key={i.message} className="warning"><Link to={`/build/${c.id}/${i.step}`}>{i.message}</Link></li>)}</ul>
              </section>
            )}
            {!c.finishedAt ? (
              <button type="button" className="primary" disabled={!canFinish(issues)} onClick={onFinish}>Finish character</button>
            ) : (
              <p><Link to={`/characters/${c.id}`}>Back to the character</Link></p>
            )}
            {!user && <p className="hint">You're not signed in: this character is saved on this device only. <Link to={`/auth/sign-in?next=/build/${c.id}/review`}>Sign in</Link> to save it to your account.</p>}
          </>
        );
      }}
    </BuilderContext.Consumer>
  );
}
