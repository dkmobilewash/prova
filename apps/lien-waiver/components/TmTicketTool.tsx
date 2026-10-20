"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import {
  addSentTicket,
  forgetEverything,
  loadContact,
  loadFields,
  loadLastIssued,
  loadSentTickets,
  loadTicket,
  saveContact,
  saveLastIssued,
  saveTicket,
  type Contact,
} from "@/lib/browser-memory";
import { formatHundredths } from "@/lib/change-order";
import { isEmail } from "@/lib/email";
import { formatDate, localToday } from "@/lib/fills";
import { BASE_PATH } from "@/lib/site";
import {
  checkTicket,
  EMPTY_TICKET,
  EMPTY_TM_LINE,
  freshTicket,
  issueTicketNumber,
  MAX_CREW,
  MAX_SIGNATURE_LENGTH,
  parseHours,
  restoreTicket,
  SIGNATURE_BOX,
  TM_LINE_LABELS,
  TM_STEPS,
  tmStepErrors,
  toHandoff,
  type TicketDraft,
  type TmLine,
  type TmLineKind,
} from "@/lib/tm-ticket";
import { Card, INPUT, PRIMARY, SendFields, StepShell } from "./StepShell";

/**
 * The free T&M / extra-work ticket, one screen at a time in the same frame
 * as the waiver and the change order request (StepShell): who you are,
 * which job, the day, what the work was, the crew as chips, each person's
 * hours, material and equipment, read it, then the GC superintendent signs
 * on the glass, and the PDF is emailed to the foreman and the super at once.
 *
 * No prices anywhere: hours and quantities only (lib/tm-ticket.ts). A photo
 * is NOT attached -- the app has no file storage and a phone photo is near
 * the function's request-size limit -- and the work screen says to send
 * photos with the ticket.
 */

const STEP_FORM = "tm-ticket-step";

/** A new number from this browser, recorded before it is used, so it can
 * never be issued again here (lib/tm-ticket.ts issueTicketNumber). */
function issueNumber(): string {
  const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  const { number, second } = issueTicketNumber(loadLastIssued(), Date.now(), random);
  saveLastIssued(second);
  return number;
}

export function TmTicketTool() {
  const [draft, setDraft] = useState<TicketDraft>(EMPTY_TICKET);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [tried, setTried] = useState(false);
  const [crewName, setCrewName] = useState("");
  const [contact, setContact] = useState<Contact | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ to: string; superEmail: string; number: string; notConfigured: boolean; waiting: number } | null>(null);

  // This browser's memory, after mount only: the server has no localStorage.
  useEffect(() => {
    const known = loadContact();
    const restored = restoreTicket(loadTicket());
    // An unfinished ticket keeps its number and its date of work (yesterday's
    // work written up this morning is a real ticket); a new one gets both.
    if (!restored.number) restored.number = issueNumber();
    if (!restored.date) restored.date = localToday();
    if (!restored.companyName) restored.companyName = known?.company || loadFields().companyName || "";
    setDraft(restored);
    setContact(known);
    if (known) {
      setName(known.name);
      setEmail(known.email);
      setCompany(known.company);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveTicket(draft);
  }, [draft, loaded]);

  const checked = useMemo(() => checkTicket(draft), [draft]);
  const step = TM_STEPS[index];
  const errors = tmStepErrors(step.id, checked.errors);
  const reviewIndex = TM_STEPS.findIndex((candidate) => candidate.id === "review");
  const earlierErrors = TM_STEPS.slice(0, reviewIndex).flatMap((candidate) => tmStepErrors(candidate.id, checked.errors));
  const returning = contact !== null && contact.email.toLowerCase() === email.trim().toLowerCase();

  const set = (patch: Partial<TicketDraft>) => setDraft((existing) => ({ ...existing, ...patch }));
  const errorFor = (key: string, value: string) => (tried || value.trim() ? checked.errors[key] : undefined);

  function go(to: number) {
    setTried(false);
    setSendError(null);
    setIndex(to);
  }

  function addCrew(): TicketDraft["crew"] {
    const typed = crewName.replace(/\s+/g, " ").trim();
    if (!typed || draft.crew.length >= MAX_CREW) return draft.crew;
    const crew = [...draft.crew, { name: typed, hours: "" }];
    set({ crew });
    setCrewName("");
    return crew;
  }

  function next() {
    // A name typed but not added yet is added, not lost.
    if (step.id === "crew" && crewName.trim()) {
      const crew = addCrew();
      if (tmStepErrors("crew", checkTicket({ ...draft, crew }).errors).length) return setTried(true);
      return go(index + 1);
    }
    if (step.id === "review" && earlierErrors.length) return setTried(true);
    if (errors.length) return setTried(true);
    if (step.id === "send") return void send();
    go(index + 1);
  }

  async function send() {
    setTried(true);
    if (!name.trim() || !isEmail(email) || !checked.ticket) return;
    setBusy(true);
    setSendError(null);
    try {
      const response = await fetch(`${BASE_PATH}/api/tm-ticket`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticket: draft,
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
      // Kept for "Turn these tickets into a change order": lines, no signature.
      addSentTicket(toHandoff(checked.ticket));
      // Sent: this ticket is finished. The next one starts clean, with a new number.
      const fresh = freshTicket(draft.companyName, localToday(), issueNumber());
      saveTicket(fresh);
      setDraft(fresh);
      setSent({ to: body.sentTo, superEmail: checked.ticket.superEmail, number: checked.ticket.number, notConfigured: body.notConfigured === true, waiting: loadSentTickets().length });
    } catch {
      setSendError("Could not reach the server. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  const done = sent !== null;
  return (
    <StepShell
      toolName="T&M ticket"
      formId={STEP_FORM}
      index={index}
      total={TM_STEPS.length}
      done={done}
      title={done ? "Check Your Inbox" : step.title}
      onBack={index > 0 ? () => go(index - 1) : null}
      busy={busy}
      nextLabel={step.id === "send" ? (busy ? "Sending..." : "Email the PDF to both of us") : step.id === "review" ? "Looks right" : "Next"}
    >
      {sent ? (
        <div className="mt-6 space-y-5" role="status">
          <div className="rounded-xl bg-paper p-5 ring-1 ring-rule">
            {sent.notConfigured ? (
              <p className="text-lg text-ink">
                This preview has no email set up, so nothing was sent. On the live site ticket {sent.number} would go to{" "}
                <strong className="break-all">{sent.to}</strong> and <strong className="break-all">{sent.superEmail}</strong>.
              </p>
            ) : (
              <>
                <p className="text-lg text-ink">
                  Ticket {sent.number} is on its way to <strong className="break-all">{sent.to}</strong> and{" "}
                  <strong className="break-all">{sent.superEmail}</strong>.
                </p>
                <p className="mt-2 text-quiet">It usually arrives in a minute. If it is not there, check your spam folder.</p>
              </>
            )}
          </div>
          {sent.waiting ? (
            <Link href="/change-order?from=tm-ticket" className="flex min-h-primary w-full items-center justify-center rounded-lg border-2 border-ink bg-paper px-4 text-center text-lg font-semibold text-ink hover:bg-brand">
              {sent.waiting === 1 ? "Turn this ticket into a change order" : `Turn these ${sent.waiting} tickets into a change order`}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setSent(null);
              go(0);
            }}
            className={`${PRIMARY} w-full`}
          >
            Make another T&amp;M ticket
          </button>
          <p className="text-sm text-quiet">
            This browser remembers your company, name and email for next time.{" "}
            <button
              type="button"
              onClick={() => {
                forgetEverything();
                setDraft(freshTicket("", localToday(), issueNumber()));
                setContact(null);
                setName("");
                setEmail("");
                setCompany("");
                setSent(null);
                go(0);
              }}
              className="inline-flex min-h-touch items-center underline"
            >
              Forget them
            </button>
          </p>
        </div>
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
          {step.id === "company" ? (
            <>
              <p className="text-quiet">
                Free, no account. Write up today&apos;s extra work one screen at a time, have the GC&apos;s superintendent sign
                it on this phone, and we email the PDF to you both. Hours and quantities only: no prices go on a ticket.
              </p>
              {draft.number ? <p className="text-sm font-semibold text-quiet">Ticket number {draft.number}</p> : null}
              <Card htmlFor="field-companyName" label="Your company name" error={errorFor("companyName", draft.companyName)} errorId="field-companyName-error">
                <input id="field-companyName" type="text" name="companyName" autoComplete="organization" value={draft.companyName} onChange={(event) => set({ companyName: event.target.value })} aria-invalid={Boolean(errorFor("companyName", draft.companyName))} className={INPUT} />
              </Card>
            </>
          ) : null}

          {step.id === "project" ? (
            <>
              <Card htmlFor="field-project" label="Project name" error={errorFor("project", draft.project)} errorId="field-project-error">
                <input id="field-project" type="text" name="project" autoComplete="off" value={draft.project} onChange={(event) => set({ project: event.target.value })} aria-invalid={Boolean(errorFor("project", draft.project))} className={INPUT} placeholder="Mesa Medical Office Building" />
              </Card>
              <Card htmlFor="field-gc" label="General contractor" error={errorFor("gc", draft.gc)} errorId="field-gc-error">
                <input id="field-gc" type="text" name="gc" autoComplete="off" value={draft.gc} onChange={(event) => set({ gc: event.target.value })} aria-invalid={Boolean(errorFor("gc", draft.gc))} className={INPUT} />
              </Card>
            </>
          ) : null}

          {step.id === "date" ? (
            <Card htmlFor="field-date" label="Date the work was done" error={errorFor("date", draft.date)} errorId="field-date-error">
              <input id="field-date" type="date" name="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} aria-invalid={Boolean(errorFor("date", draft.date))} className={INPUT} />
            </Card>
          ) : null}

          {step.id === "work" ? (
            <>
              <Card htmlFor="field-summary" label="What the extra work was" help="One line. Like: Patch and re-tape corridor walls after the plumber's reroute." helpId="field-summary-help" error={errorFor("summary", draft.summary)} errorId="field-summary-error">
                <input id="field-summary" type="text" name="summary" autoComplete="off" value={draft.summary} onChange={(event) => set({ summary: event.target.value })} aria-invalid={Boolean(errorFor("summary", draft.summary))} aria-describedby="field-summary-help" className={INPUT} />
              </Card>
              <Card htmlFor="field-details" label="Details" optional help="Where, who asked for it, anything the GC's office will want. Send any photos with the PDF: this tool does not attach them." helpId="field-details-help" error={errorFor("details", draft.details)} errorId="field-details-error">
                <textarea id="field-details" name="details" rows={5} value={draft.details} onChange={(event) => set({ details: event.target.value })} aria-invalid={Boolean(errorFor("details", draft.details))} aria-describedby="field-details-help" className={`${INPUT} resize-y`} />
              </Card>
            </>
          ) : null}

          {step.id === "crew" ? (
            <>
              <Card htmlFor="field-crewName" label="Who did the work" help="Type a name and tap Add. Add everyone, yourself too if you worked it." helpId="field-crewName-help" error={tried ? checked.errors.crew : undefined} errorId="field-crew-error">
                <div className="flex items-center gap-3">
                  <input
                    id="field-crewName"
                    type="text"
                    name="crewName"
                    autoComplete="off"
                    value={crewName}
                    onChange={(event) => setCrewName(event.target.value)}
                    onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                      // Enter adds the name; on an empty box it is Next, as everywhere.
                      if (event.key === "Enter" && crewName.trim()) {
                        event.preventDefault();
                        addCrew();
                      }
                    }}
                    aria-describedby="field-crewName-help"
                    className={INPUT}
                    placeholder="First and last name"
                  />
                  <button type="button" onClick={addCrew} className="min-h-touch shrink-0 rounded-lg border-2 border-ink px-4 font-semibold text-ink hover:bg-brand">
                    Add
                  </button>
                </div>
              </Card>
              {draft.crew.length ? (
                <ul className="flex flex-wrap gap-2" aria-label="Crew">
                  {draft.crew.map((member, at) => (
                    <li key={at} className="inline-flex min-h-touch items-center gap-1 rounded-full bg-paper pl-4 text-ink ring-1 ring-line">
                      <span className="font-semibold">{member.name}</span>
                      <button type="button" onClick={() => set({ crew: draft.crew.filter((_, i) => i !== at) })} aria-label={`Remove ${member.name}`} className="inline-flex min-h-touch min-w-[2.75rem] items-center justify-center rounded-full text-xl text-quiet hover:text-danger">
                        <span aria-hidden="true">×</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {Object.keys(checked.errors)
                .filter((key) => /^crew\.\d+\.name$/.test(key))
                .map((key) => (
                  <p key={key} className="font-semibold text-danger">
                    {draft.crew[Number(key.split(".")[1])]?.name}: {checked.errors[key]}
                  </p>
                ))}
            </>
          ) : null}

          {step.id === "hours" ? (
            draft.crew.length ? (
              <>
                <p className="text-quiet">Hours each person spent on the extra work today. Quarter hours are fine, like 7.5 or 0.25.</p>
                {draft.crew.map((member, at) => {
                  const id = `crew-${at}-hours`;
                  const error = errorFor(`crew.${at}.hours`, member.hours);
                  return (
                    <Card key={at} htmlFor={id} label={member.name} error={error} errorId={`${id}-error`}>
                      <div className="flex items-center">
                        <input
                          id={id}
                          type="text"
                          inputMode="decimal"
                          name="hours"
                          autoComplete="off"
                          value={member.hours}
                          onChange={(event) => set({ crew: draft.crew.map((m, i) => (i === at ? { ...m, hours: event.target.value } : m)) })}
                          aria-invalid={Boolean(error)}
                          className={INPUT}
                        />
                        <span className="ml-2 text-lg text-quiet">hours</span>
                      </div>
                    </Card>
                  );
                })}
                <p className="text-right text-lg font-semibold text-ink" aria-live="polite">
                  Crew hours: {formatHundredths(draft.crew.reduce((sum, member) => sum + (parseHours(member.hours) ?? 0n), 0n))}
                </p>
              </>
            ) : (
              <p role="alert" className="font-semibold text-danger">
                Nobody is on the crew yet. Use Back to add them.
              </p>
            )
          ) : null}

          {step.id === "material" || step.id === "equipment" ? (
            <Lines
              kind={step.id}
              lines={draft[step.id]}
              errorFor={errorFor}
              onChange={(at, patch) => set({ [step.id]: draft[step.id as TmLineKind].map((line, i) => (i === at ? { ...line, ...patch } : line)) } as Partial<TicketDraft>)}
              onAdd={() => set({ [step.id]: [...draft[step.id as TmLineKind], { ...EMPTY_TM_LINE }] } as Partial<TicketDraft>)}
              onRemove={(at) => set({ [step.id]: draft[step.id as TmLineKind].filter((_, i) => i !== at) } as Partial<TicketDraft>)}
            />
          ) : null}

          {step.id === "review" ? (
            earlierErrors.length ? (
              <p role="alert" className="font-semibold text-danger">
                Something on an earlier screen needs another look. Use Back to find it.
              </p>
            ) : (
              <>
                <p className="text-quiet">This is what the PDF will say. Next, hand the phone to the GC&apos;s superintendent to read and sign.</p>
                <Review draft={draft} />
              </>
            )
          ) : null}

          {step.id === "sign" ? (
            <>
              <p className="text-quiet">Superintendent: read the ticket (Back shows it), then sign with your finger and type your name and title.</p>
              <div className={`rounded-xl bg-paper ${errorFor("signature", draft.signature) ? "ring-2 ring-danger" : "ring-1 ring-rule"}`}>
                <p id="signature-label" className="px-5 pt-5 text-lg font-semibold text-ink">
                  Superintendent&apos;s signature
                </p>
                <div className="px-5 py-3">
                  <SignaturePad value={draft.signature} onChange={(signature) => set({ signature })} />
                </div>
                <div className="flex items-center justify-between px-5 pb-4">
                  <span className="text-sm text-quiet">{draft.signature ? "Signed." : "Sign inside the box."}</span>
                  <button type="button" onClick={() => set({ signature: "" })} className="inline-flex min-h-touch items-center rounded-lg px-3 font-semibold text-ink underline">
                    Clear signature
                  </button>
                </div>
                {errorFor("signature", draft.signature) ? <p className="px-5 pb-4 text-sm font-semibold text-danger">{checked.errors.signature}</p> : null}
              </div>
              <Card htmlFor="field-superName" label="Superintendent's name" error={errorFor("superName", draft.superName)} errorId="field-superName-error">
                <input id="field-superName" type="text" name="superName" autoComplete="off" value={draft.superName} onChange={(event) => set({ superName: event.target.value })} aria-invalid={Boolean(errorFor("superName", draft.superName))} className={INPUT} />
              </Card>
              <Card htmlFor="field-superTitle" label="Title" error={errorFor("superTitle", draft.superTitle)} errorId="field-superTitle-error">
                <input id="field-superTitle" type="text" name="superTitle" autoComplete="off" value={draft.superTitle} onChange={(event) => set({ superTitle: event.target.value })} aria-invalid={Boolean(errorFor("superTitle", draft.superTitle))} className={INPUT} placeholder="Superintendent" />
              </Card>
              <Card htmlFor="field-superEmail" label="Superintendent's email" help="A copy of the PDF goes here at the same time as the foreman's." helpId="field-superEmail-help" error={errorFor("superEmail", draft.superEmail)} errorId="field-superEmail-error">
                <input id="field-superEmail" type="email" inputMode="email" name="superEmail" autoComplete="off" value={draft.superEmail} onChange={(event) => set({ superEmail: event.target.value })} aria-invalid={Boolean(errorFor("superEmail", draft.superEmail))} aria-describedby="field-superEmail-help" className={INPUT} />
              </Card>
            </>
          ) : null}

          {step.id === "send" ? (
            <>
              <p className="text-quiet">Foreman: hand the phone back. This is who the PDF is from.</p>
              <SendFields
                {...{ tried, returning, name, setName, email, setEmail, company, setCompany, marketing, setMarketing, website, setWebsite, sendError }}
                readFirst="Read the whole ticket before you send it."
              />
            </>
          ) : null}

          {tried && errors.length ? (
            <p role="alert" className="font-semibold text-danger">
              {errors.length === 1 ? "One answer on this page needs" : `${errors.length} answers on this page need`} another look.
            </p>
          ) : null}
        </form>
      )}
    </StepShell>
  );
}

/**
 * The superintendent's signature, drawn with a finger (or a mouse) on a
 * canvas. Pointer events, one SVG path for every stroke, mapped into
 * SIGNATURE_BOX whatever the canvas measures on screen -- that path is what
 * the API checks and the PDF draws. No library.
 */
function SignaturePad({ value, onChange }: { value: string; onChange: (path: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const path = useRef(value);
  const last = useRef<string | null>(null);

  // Paint whatever the value is: a restored draft, a cleared pad.
  useEffect(() => {
    path.current = value;
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, SIGNATURE_BOX.width, SIGNATURE_BOX.height);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111111";
    context.beginPath();
    for (const [, op, x, y] of value.matchAll(/([ML])(\d+) (\d+)/g)) {
      if (op === "M") context.moveTo(Number(x), Number(y));
      else context.lineTo(Number(x), Number(y));
    }
    context.stroke();
  }, [value]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const clamp = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(n)));
    return `${clamp(((event.clientX - box.left) * SIGNATURE_BOX.width) / box.width, SIGNATURE_BOX.width)} ${clamp(((event.clientY - box.top) * SIGNATURE_BOX.height) / box.height, SIGNATURE_BOX.height)}`;
  };

  const extend = (op: "M" | "L", at: string) => {
    if (op === "L" && at === last.current) return;
    if (path.current.length + 10 > MAX_SIGNATURE_LENGTH) return;
    const context = canvas.current?.getContext("2d");
    const [x, y] = at.split(" ").map(Number);
    if (context && op === "L" && last.current) {
      const [fromX, fromY] = last.current.split(" ").map(Number);
      context.beginPath();
      context.moveTo(fromX, fromY);
      context.lineTo(x, y);
      context.stroke();
    }
    path.current = `${path.current}${path.current ? " " : ""}${op}${at}`;
    last.current = at;
  };

  return (
    <canvas
      ref={canvas}
      width={SIGNATURE_BOX.width}
      height={SIGNATURE_BOX.height}
      role="img"
      aria-labelledby="signature-label"
      className="block aspect-[3/1] w-full cursor-crosshair touch-none rounded-lg bg-canvas ring-1 ring-line"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        extend("M", point(event));
      }}
      onPointerMove={(event) => {
        if (last.current !== null) extend("L", point(event));
      }}
      onPointerUp={() => {
        last.current = null;
        onChange(path.current);
      }}
      onPointerCancel={() => {
        last.current = null;
        onChange(path.current);
      }}
    />
  );
}

function Lines({
  kind,
  lines,
  errorFor,
  onChange,
  onAdd,
  onRemove,
}: {
  kind: TmLineKind;
  lines: TmLine[];
  errorFor: (key: string, value: string) => string | undefined;
  onChange: (at: number, patch: Partial<TmLine>) => void;
  onAdd: () => void;
  onRemove: (at: number) => void;
}) {
  const labels = TM_LINE_LABELS[kind];
  return (
    <>
      <p className="text-quiet">
        {lines.length ? "Quantities only, no prices. A line left completely empty is skipped." : `No ${labels.title.toLowerCase()} on this ticket? Tap Next.`}
      </p>
      {lines.map((line, at) => {
        const id = `${kind}-${at}`;
        const description = { id: `${id}-description`, error: errorFor(`${kind}.${at}.description`, line.description) };
        const quantity = { id: `${id}-quantity`, error: errorFor(`${kind}.${at}.quantity`, line.quantity) };
        const unit = { id: `${id}-unit`, error: errorFor(`${kind}.${at}.unit`, line.unit) };
        return (
          <fieldset key={at} className="rounded-xl bg-paper px-5 py-4 ring-1 ring-rule focus-within:ring-2 focus-within:ring-focus">
            <legend className="sr-only">
              {labels.title} line {at + 1}
            </legend>
            <p className="text-sm font-semibold uppercase tracking-wide text-quiet" aria-hidden="true">
              {labels.title} line {at + 1}
            </p>
            <div className="grid grid-cols-2 gap-x-4">
              <LineField htmlFor={quantity.id} label="Quantity" error={quantity.error}>
                <input id={quantity.id} type="text" inputMode="decimal" name="quantity" autoComplete="off" value={line.quantity} onChange={(event) => onChange(at, { quantity: event.target.value })} aria-invalid={Boolean(quantity.error)} className={INPUT} />
              </LineField>
              <LineField htmlFor={unit.id} label="Unit" error={unit.error}>
                <input id={unit.id} type="text" name="unit" autoComplete="off" placeholder={labels.unit} value={line.unit} onChange={(event) => onChange(at, { unit: event.target.value })} aria-invalid={Boolean(unit.error)} className={INPUT} />
              </LineField>
            </div>
            <LineField htmlFor={description.id} label="What it is" error={description.error}>
              <input id={description.id} type="text" name="lineDescription" autoComplete="off" value={line.description} onChange={(event) => onChange(at, { description: event.target.value })} aria-invalid={Boolean(description.error)} className={INPUT} />
            </LineField>
            <div className="mt-3 flex justify-end">
              <button type="button" onClick={() => onRemove(at)} className="inline-flex min-h-touch items-center rounded-lg px-3 font-semibold text-danger underline">
                Remove line
              </button>
            </div>
          </fieldset>
        );
      })}
      <button type="button" onClick={onAdd} className="flex min-h-primary w-full items-center justify-center rounded-lg border-2 border-ink bg-paper px-4 text-lg font-semibold text-ink hover:bg-brand">
        + {labels.add}
      </button>
    </>
  );
}

function LineField({ htmlFor, label, error, children }: { htmlFor: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <label htmlFor={htmlFor} className="block font-semibold text-ink">
        {label}
      </label>
      <div className={`border-b-2 ${error ? "border-danger" : "border-line"}`}>{children}</div>
      {error ? <p className="mt-1 text-sm font-semibold text-danger">{error}</p> : null}
    </div>
  );
}

/** The ticket as typed, before the signature: what the super reads. */
function Review({ draft }: { draft: TicketDraft }) {
  const row = (label: string, value: string) =>
    value.trim() ? (
      <div className="flex flex-wrap justify-between gap-x-4 py-1">
        <dt className="text-quiet">{label}</dt>
        <dd className="text-right text-ink">{value}</dd>
      </div>
    ) : null;
  const used = (kind: TmLineKind) => draft[kind].filter((line) => line.description.trim() || line.quantity.trim());
  return (
    <div className="space-y-5 rounded-xl bg-paper p-5 ring-2 ring-ink">
      <p className="text-xl font-bold text-ink">T&amp;M ticket {draft.number}</p>
      <dl>
        {row("Date of work", formatDate(draft.date) ?? draft.date)}
        {row("From", draft.companyName)}
        {row("To", draft.gc)}
        {row("Project", draft.project)}
      </dl>
      <div>
        <p className="font-bold text-ink">{draft.summary}</p>
        {draft.details.trim() ? <p className="mt-1 whitespace-pre-line text-ink">{draft.details}</p> : null}
      </div>
      <div>
        <p className="font-bold text-ink">Crew</p>
        <ul className="mt-1 space-y-1">
          {draft.crew.map((member, at) => (
            <li key={at} className="flex justify-between gap-4 text-ink">
              <span>{member.name}</span>
              <span>{formatHundredths(parseHours(member.hours) ?? 0n)} hr</span>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-right font-semibold text-ink">
          Crew hours: {formatHundredths(draft.crew.reduce((sum, member) => sum + (parseHours(member.hours) ?? 0n), 0n))}
        </p>
      </div>
      {(["material", "equipment"] as const).map((kind) =>
        used(kind).length ? (
          <div key={kind}>
            <p className="font-bold text-ink">{TM_LINE_LABELS[kind].title}</p>
            <ul className="mt-1 space-y-1">
              {used(kind).map((line, at) => (
                <li key={at} className="text-ink">
                  {line.quantity} {line.unit || TM_LINE_LABELS[kind].unit} {line.description}
                </li>
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}
