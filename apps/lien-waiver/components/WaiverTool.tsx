"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { forgetEverything, loadContact, loadFields, saveContact, saveFields, type Contact } from "@/lib/browser-memory";
import { FINAL_WARNING, FORM_MEANINGS, FORM_NAMES, UNCONDITIONAL_WARNING } from "@/lib/content";
import { isEmail } from "@/lib/email";
import { checkFills } from "@/lib/fills";
import { hasPrefill, parsePrefill, prefillAnswers } from "@/lib/prefill";
import { BASE_PATH } from "@/lib/site";
import { fieldSteps, type FieldStep } from "@/lib/steps";
import { getForm } from "@/lib/statutes/forms";
import { SLOTS } from "@/lib/statutes/slots";
import type { FormKey, StateCode } from "@/lib/statutes/types";
import { Card, INPUT, PRIMARY, SendFields, StepShell } from "./StepShell";
import { WaiverPreview } from "./WaiverPreview";

/**
 * The whole tool for one state, one screen at a time (Diego, 2026-10-13):
 * pick the waiver, fill in each section, read the whole form, then give a
 * name and an email and the PDF is EMAILED. There is no download button and
 * the server never returns the PDF -- see lib/waiver-request.ts -- so every
 * waiver made here reaches an inbox.
 *
 * Next checks only the screen it is on; Back never checks anything, so a
 * person can always go back and change an answer. What was typed is saved in
 * this browser (lib/browser-memory.ts) for next pay period, and a browser
 * that has sent before gets its name and email filled in -- but still sends.
 *
 * Nothing here says a waiver is safe to sign. The warnings describe what the
 * chosen form does, in the same words every time.
 */

type Stage = "PROGRESS" | "FINAL";
type Step = { kind: "type" } | { kind: "fields"; step: FieldStep } | { kind: "review" } | { kind: "send" };

const STEP_FORM = "waiver-step";

export function WaiverTool({
  state,
  stateName,
  notice,
  about,
}: {
  state: StateCode;
  stateName: string;
  /** Shown above every screen (the unreviewed-preview warning). */
  notice?: ReactNode;
  /** Shown under the first screen only. */
  about?: ReactNode;
}) {
  const [stage, setStage] = useState<Stage | null>(null);
  const [cleared, setCleared] = useState<boolean | null>(null);
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [contact, setContact] = useState<Contact | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [tried, setTried] = useState(false);
  const [sentTo, setSentTo] = useState<{ to: string; notConfigured: boolean } | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // URL pre-fill (lib/prefill.ts). `ref` is a tracking code: it is carried to
  // the server with the waiver and never rendered. `persist` is false while
  // a link's values are on screen, so they reach this browser's memory only
  // if the person actually sends -- a link must not overwrite what they had.
  const [ref, setRef] = useState<string | null>(null);
  const [persist, setPersist] = useState(true);
  const prefillLogged = useRef(false);

  // Read this browser's memory after mount, never during render: the server
  // has no localStorage, so reading it in render would hydrate differently.
  useEffect(() => {
    const fields = loadFields();
    const known = loadContact();
    setRaw(fields);
    setContact(known);
    if (known) {
      setName(known.name);
      setEmail(known.email);
      setCompany(known.company);
    } else if (fields.companyName) {
      setCompany(fields.companyName);
    }

    // A pre-fill link. With no query string none of this runs, and the page
    // is exactly what it was before links existed.
    const prefill = parsePrefill(new URLSearchParams(window.location.search));
    if (hasPrefill(prefill)) {
      const answers = prefillAnswers(state, prefill.values);
      if (Object.keys(answers).length) {
        // The link wins over memory for this visit only.
        setRaw({ ...fields, ...answers });
        setPersist(false);
      }
      if (prefill.values.company) setCompany(prefill.values.company);
      if (prefill.form) {
        // Pre-SELECTS the two answers; the waiver-type screen and its
        // warnings are still shown, and either answer can be changed.
        setStage(prefill.form.endsWith("FINAL") ? "FINAL" : "PROGRESS");
        setCleared(prefill.form.startsWith("UNCONDITIONAL"));
      }
      if (prefill.ref) {
        setRef(prefill.ref);
        if (!prefillLogged.current) {
          prefillLogged.current = true;
          // The code and nothing else: no name, no address, no values.
          void fetch(`${BASE_PATH}/api/prefill-opened`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ref: prefill.ref, state }),
            keepalive: true,
          }).catch(() => undefined);
        }
      }
    }
    setLoaded(true);
  }, [state]);

  useEffect(() => {
    if (loaded && persist) saveFields(raw);
  }, [raw, loaded, persist]);

  const formKey: FormKey | null =
    stage && cleared !== null ? (`${cleared ? "UNCONDITIONAL" : "CONDITIONAL"}_${stage}` as FormKey) : null;
  const form = formKey ? getForm(state, formKey) : null;
  const checked = useMemo(() => (form ? checkFills(form, raw) : null), [form, raw]);

  const steps: Step[] = useMemo(
    () => [
      { kind: "type" },
      ...(form ? fieldSteps(form).map((step) => ({ kind: "fields" as const, step })) : []),
      { kind: "review" },
      { kind: "send" },
    ],
    [form],
  );
  // Before the waiver is chosen the field screens are unknown; the bar
  // assumes the usual three so it does not jump backwards once they appear.
  const total = form ? steps.length : 6;
  const current = steps[Math.min(index, steps.length - 1)];

  function go(to: number) {
    setTried(false);
    setSendError(null);
    setIndex(to);
  }

  const stepErrors =
    current.kind === "fields" && checked
      ? current.step.fields.filter(({ slot }) => checked.errors[slot]).map(({ slot }) => slot)
      : [];

  function next() {
    if (current.kind === "type" && !form) return setTried(true);
    if (current.kind === "fields" && stepErrors.length) return setTried(true);
    if (current.kind === "send") return void send();
    go(index + 1);
  }

  const returning = contact !== null && contact.email.toLowerCase() === email.trim().toLowerCase();

  async function send() {
    setTried(true);
    if (!name.trim() || !isEmail(email) || !formKey) return;
    setBusy(true);
    setSendError(null);
    try {
      const response = await fetch(`${BASE_PATH}/api/waiver`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state,
          form: formKey,
          fills: raw,
          returning,
          email: email.trim(),
          name: name.trim(),
          company: company.trim(),
          marketingOptIn: returning ? undefined : marketing,
          website,
          // Only present when the page was opened from a pre-fill link.
          ref: ref ?? undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; sentTo?: string; notConfigured?: boolean };
      if (!response.ok || !body.sentTo) {
        setSendError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      const saved = { email: email.trim(), name: name.trim(), company: company.trim() };
      saveContact(saved);
      // Sending is the moment a link's values become this person's own.
      if (!persist) {
        saveFields(raw);
        setPersist(true);
      }
      setContact(saved);
      setSentTo({ to: body.sentTo, notConfigured: body.notConfigured === true });
    } catch {
      setSendError("Could not reach the server. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  const done = sentTo !== null;
  const shownIndex = done ? total : Math.min(index, steps.length - 1);
  const title = done
    ? "Check Your Inbox"
    : current.kind === "type"
      ? "Waiver Type"
      : current.kind === "fields"
        ? current.step.title
        : current.kind === "review"
          ? "Read Your Waiver"
          : "Get Your PDF";

  return (
    <StepShell
      toolName={`${stateName} lien waiver`}
      formId={STEP_FORM}
      index={shownIndex}
      total={total}
      done={done}
      title={title}
      notice={notice}
      onBack={index > 0 ? () => go(index - 1) : null}
      busy={busy}
      nextLabel={current.kind === "send" ? (busy ? "Sending..." : "Email me the PDF") : current.kind === "review" ? "Looks right" : "Next"}
    >
      {sentTo ? (
        <Sent
          to={sentTo.to}
          notConfigured={sentTo.notConfigured}
          formName={formKey ? FORM_NAMES[formKey] : "waiver"}
          onAnother={() => {
            setSentTo(null);
            go(0);
          }}
          onForget={() => {
            forgetEverything();
            setRaw({});
            setContact(null);
            setName("");
            setEmail("");
            setCompany("");
            setSentTo(null);
            setStage(null);
            setCleared(null);
            go(0);
          }}
        />
      ) : (
        <form
          id={STEP_FORM}
          noValidate
          className="mt-6 space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) next();
          }}
        >
          {current.kind === "type" ? (
            <>
              <Choice
                name="stage"
                question="Which payment is this waiver for?"
                value={stage}
                onChange={(value) => setStage(value as Stage)}
                options={[
                  { value: "PROGRESS", label: "A progress payment" },
                  { value: "FINAL", label: "The final payment" },
                ]}
                missing={tried && stage === null}
              />
              <Choice
                name="cleared"
                question="Has this payment cleared your bank?"
                help="Cleared means the money is in your account, not just that a check is in the mail."
                value={cleared === null ? null : cleared ? "yes" : "no"}
                onChange={(value) => setCleared(value === "yes")}
                options={[
                  { value: "no", label: "Not yet" },
                  { value: "yes", label: "Yes, it has cleared" },
                ]}
                missing={tried && cleared === null}
              />
              {formKey && form ? (
                <div className="rounded-xl bg-paper p-5 ring-2 ring-ink" aria-live="polite">
                  <p className="text-sm font-semibold uppercase tracking-wide text-quiet">Your form</p>
                  <p className="mt-1 text-xl font-bold text-ink">{FORM_NAMES[formKey]}</p>
                  <p className="text-sm text-quiet">{form.citation}</p>
                  <p className="mt-3 text-ink">{FORM_MEANINGS[formKey]}</p>
                  {cleared ? <p className="mt-3 rounded-md bg-warn-ground p-3 font-semibold text-warn">{UNCONDITIONAL_WARNING}</p> : null}
                  {stage === "FINAL" ? <p className="mt-3 rounded-md bg-warn-ground p-3 font-semibold text-warn">{FINAL_WARNING}</p> : null}
                </div>
              ) : null}
              {about}
            </>
          ) : null}

          {current.kind === "fields" && checked ? (
            <>
              <p className="text-quiet">Saved in this browser for next pay period.</p>
              {current.step.fields.map(({ slot, label }) => {
                const spec = SLOTS[slot];
                const id = `field-${slot}`;
                const error = checked.errors[slot];
                const showError = Boolean(error && (tried || raw[slot]?.trim()));
                const inputProps = {
                  id,
                  autoComplete: "off",
                  placeholder: spec.placeholder,
                  value: raw[slot] ?? "",
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                    setRaw((existing) => ({ ...existing, [slot]: event.target.value })),
                  "aria-describedby": [spec.help ? `${id}-help` : null, showError ? `${id}-error` : null].filter(Boolean).join(" ") || undefined,
                  "aria-invalid": showError,
                  className: INPUT,
                };
                return (
                  <Card key={slot} htmlFor={id} label={label} optional={!spec.required} help={spec.help} helpId={`${id}-help`} error={showError ? error : undefined} errorId={`${id}-error`}>
                    <div className="flex items-center">
                      {spec.kind === "money" ? <span className="mr-2 text-lg text-quiet">$</span> : null}
                      {/* Three literal branches rather than one input with
                          computed type/inputMode, so C-Stream's repo-wide
                          numeric-input census (apps/web/lib/
                          numericInputCensus.test.ts) can READ that a money
                          field opens a keypad -- it cannot evaluate an
                          expression, and an unreadable attribute is checked,
                          not trusted. */}
                      {spec.kind === "money" ? (
                        <input type="text" inputMode="decimal" name={slot} {...inputProps} />
                      ) : spec.kind === "date" ? (
                        <input type="date" name={slot} {...inputProps} />
                      ) : (
                        <input type="text" name={slot} {...inputProps} />
                      )}
                    </div>
                  </Card>
                );
              })}
              {tried && stepErrors.length ? (
                <p role="alert" className="font-semibold text-danger">
                  {stepErrors.length === 1 ? "One answer on this page needs" : `${stepErrors.length} answers on this page need`} another look.
                </p>
              ) : null}
            </>
          ) : null}

          {current.kind === "review" && form && checked ? (
            <>
              <p className="text-quiet">
                This is the whole form as it will print. Your answers are highlighted. The signature line stays blank
                for your pen.
              </p>
              <div className="flex flex-wrap gap-2">
                {steps.slice(0, -2).map((step, i) => (
                  <button key={i} type="button" onClick={() => go(i)} className="min-h-touch rounded-full border-2 border-line bg-paper px-4 text-sm font-semibold text-ink hover:border-ink">
                    Change {step.kind === "fields" ? step.step.title.toLowerCase() : "waiver type"}
                  </button>
                ))}
              </div>
              <WaiverPreview form={form} fills={checked.fills} />
            </>
          ) : null}

          {current.kind === "send" ? (
            <SendFields
              {...{ tried, returning, name, setName, email, setEmail, company, setCompany, marketing, setMarketing, website, setWebsite, sendError }}
              readFirst="Read the whole form before you sign it."
            />
          ) : null}
        </form>
      )}
    </StepShell>
  );
}

function Choice({
  name,
  question,
  help,
  value,
  onChange,
  options,
  missing,
}: {
  name: string;
  question: string;
  help?: string;
  value: string | null;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  missing: boolean;
}) {
  return (
    <fieldset className={`rounded-xl bg-paper ${missing ? "ring-2 ring-danger" : "ring-1 ring-rule"}`}>
      <legend className="sr-only">{question}</legend>
      <div className="px-5 pb-4 pt-5" aria-hidden="true">
        <p className="text-lg font-semibold text-ink">{question}</p>
        {help ? <p className="mt-1 text-sm text-quiet">{help}</p> : null}
      </div>
      <div className="border-t border-rule px-5 py-2">
        {options.map((option) => (
          <label key={option.value} className="flex min-h-touch cursor-pointer items-center gap-4 py-2 text-lg text-ink">
            <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="h-6 w-6 shrink-0 accent-ink" />
            {option.label}
          </label>
        ))}
      </div>
      {missing ? <p className="px-5 pb-4 text-sm font-semibold text-danger">Pick one to continue.</p> : null}
    </fieldset>
  );
}

function Sent({
  to,
  notConfigured,
  formName,
  onAnother,
  onForget,
}: {
  to: string;
  notConfigured: boolean;
  formName: string;
  onAnother: () => void;
  onForget: () => void;
}) {
  return (
    <div className="mt-6 space-y-5" role="status">
      <div className="rounded-xl bg-paper p-5 ring-1 ring-rule">
        {notConfigured ? (
          <p className="text-lg text-ink">
            This preview has no email set up, so nothing was sent. On the live site your {formName.toLowerCase()} would
            go to <strong>{to}</strong>.
          </p>
        ) : (
          <>
            <p className="text-lg text-ink">
              Your {formName.toLowerCase()} is on its way to <strong className="break-all">{to}</strong>.
            </p>
            <p className="mt-2 text-quiet">It usually arrives in a minute. If it is not there, check your spam folder.</p>
          </>
        )}
      </div>
      <button type="button" onClick={onAnother} className={`${PRIMARY} w-full`}>
        Make another waiver
      </button>
      <p className="text-sm text-quiet">
        This browser remembers your answers and email for next pay period.{" "}
        <button type="button" onClick={onForget} className="inline-flex min-h-touch items-center underline">
          Forget them
        </button>
      </p>
    </div>
  );
}
