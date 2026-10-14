"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { forgetEverything, loadContact, loadFields, saveContact, saveFields, type Contact } from "@/lib/browser-memory";
import { FINAL_WARNING, FORM_MEANINGS, FORM_NAMES, UNCONDITIONAL_WARNING } from "@/lib/content";
import { isEmail } from "@/lib/email";
import { checkFills } from "@/lib/fills";
import { BASE_PATH } from "@/lib/site";
import { fieldSteps, type FieldStep } from "@/lib/steps";
import { getForm } from "@/lib/statutes/forms";
import { SLOTS } from "@/lib/statutes/slots";
import type { FormKey, StateCode } from "@/lib/statutes/types";
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
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveFields(raw);
  }, [raw, loaded]);

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

  // Move focus to the new screen's heading, so a screen reader announces it
  // and the keyboard starts at the top. Not on first load: that would steal
  // focus from whatever the person was reaching for.
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    heading.current?.focus();
  }, [index, sentTo]);

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
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; sentTo?: string; notConfigured?: boolean };
      if (!response.ok || !body.sentTo) {
        setSendError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      const saved = { email: email.trim(), name: name.trim(), company: company.trim() };
      saveContact(saved);
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
    <>
      <div className="sticky top-0 z-10 border-b border-rule bg-paper">
        <div className="mx-auto flex min-h-touch max-w-2xl items-center justify-between gap-4 px-4 py-2">
          <Link href="/" className="inline-flex min-h-touch items-center font-bold text-ink">
            C-Stream
          </Link>
          <h1 className="text-sm font-semibold text-quiet">{stateName} lien waiver</h1>
        </div>
        <div
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={shownIndex + 1 > total ? total : shownIndex + 1}
          aria-valuetext={done ? "Sent" : `Step ${shownIndex + 1} of ${total}`}
          className="h-1.5 bg-rule"
        >
          <div className="h-full bg-progress transition-[width] duration-300" style={{ width: `${(Math.min(shownIndex + 1, total) / total) * 100}%` }} />
        </div>
      </div>

      <main className="mx-auto max-w-2xl px-4 pb-36 pt-6">
        {notice}
        {!done ? (
          <p className="mt-2 text-sm font-semibold text-quiet">
            Step {shownIndex + 1} of {total}
          </p>
        ) : null}
        <h2 ref={heading} tabIndex={-1} className="mt-1 text-3xl font-bold leading-tight text-ink focus:outline-none">
          {title}
        </h2>

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
              <>
                <p className="text-quiet">
                  We email your PDF. There is no download, so use an address you can open on the job.
                </p>
                <Card htmlFor="send-name" label="Your name" error={tried && !name.trim() ? "Enter your name." : undefined} errorId="send-name-error">
                  <input id="send-name" type="text" name="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={tried && !name.trim()} aria-describedby={tried && !name.trim() ? "send-name-error" : undefined} className={INPUT} placeholder="First and last name" />
                </Card>
                <Card htmlFor="send-email" label="Email" error={tried && !isEmail(email) ? "Enter a valid email address." : undefined} errorId="send-email-error">
                  <input id="send-email" type="email" inputMode="email" name="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={tried && !isEmail(email)} aria-describedby={tried && !isEmail(email) ? "send-email-error" : undefined} className={INPUT} placeholder="you@company.com" />
                </Card>
                <Card htmlFor="send-company" label="Company" optional>
                  <input id="send-company" type="text" name="company" autoComplete="organization" value={company} onChange={(event) => setCompany(event.target.value)} className={INPUT} />
                </Card>
                {returning ? null : (
                  <label className="flex min-h-touch items-start gap-4 rounded-xl bg-paper p-5 text-ink ring-1 ring-rule">
                    <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-ink" checked={marketing} onChange={(event) => setMarketing(event.target.checked)} />
                    <span>
                      Send me occasional emails from C-Stream about running a subcontracting business.{" "}
                      <span className="text-quiet">(Optional. You get your PDF either way.)</span>
                    </span>
                  </label>
                )}
                {/* Honeypot: hidden from people and from screen readers. */}
                <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden">
                  <label htmlFor="send-website">Website</label>
                  <input id="send-website" type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
                </div>
                <p className="text-sm text-quiet">
                  Read the whole form before you sign it. C-Stream is not a law firm and this is not legal advice. See our{" "}
                  <Link className="underline" href="/privacy">
                    privacy notice
                  </Link>
                  .
                </p>
                {sendError ? (
                  <p role="alert" className="rounded-md bg-warn-ground p-3 font-semibold text-danger">
                    {sendError}
                  </p>
                ) : null}
              </>
            ) : null}
          </form>
        )}
      </main>

      <nav aria-label="Steps" className="fixed inset-x-0 bottom-0 z-10 border-t border-rule bg-paper">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          {!done && index > 0 ? (
            <button type="button" onClick={() => go(index - 1)} disabled={busy} className="inline-flex min-h-primary items-center gap-1 rounded-lg px-3 text-lg font-semibold text-ink hover:bg-canvas">
              <span aria-hidden="true">‹</span> Back
            </button>
          ) : (
            <span />
          )}
          {done ? null : (
            <button type="submit" form={STEP_FORM} disabled={busy} aria-busy={busy} className={PRIMARY}>
              {current.kind === "send" ? (busy ? "Sending..." : "Email me the PDF") : current.kind === "review" ? "Looks right" : "Next"}
            </button>
          )}
        </div>
      </nav>
    </>
  );
}

const INPUT =
  "min-h-touch w-full bg-transparent py-2 text-lg text-ink placeholder:text-quiet/70 focus:outline-none focus-visible:outline-none";
const PRIMARY =
  "min-h-primary rounded-lg bg-ink px-8 text-lg font-bold text-paper hover:bg-quiet disabled:cursor-not-allowed disabled:opacity-60";

/** One question: its label on top, a rule, then the answer -- the shape of
 * every screen. The whole card shows focus, since the input itself has no
 * border of its own. */
function Card({
  htmlFor,
  label,
  optional,
  help,
  helpId,
  error,
  errorId,
  children,
}: {
  htmlFor: string;
  label: string;
  optional?: boolean;
  help?: string;
  helpId?: string;
  error?: string;
  errorId?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-xl bg-paper focus-within:ring-2 focus-within:ring-focus ${error ? "ring-2 ring-danger" : "ring-1 ring-rule"}`}>
      <div className="px-5 pb-4 pt-5">
        <label htmlFor={htmlFor} className="block text-lg font-semibold text-ink">
          {label}
          {optional ? <span className="font-normal text-quiet"> (optional)</span> : null}
        </label>
        {help ? (
          <p id={helpId} className="mt-1 text-sm text-quiet">
            {help}
          </p>
        ) : null}
      </div>
      <div className="border-t border-rule px-5 py-2">{children}</div>
      {error ? (
        <p id={errorId} className="px-5 pb-4 text-sm font-semibold text-danger">
          {error}
        </p>
      ) : null}
    </div>
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
