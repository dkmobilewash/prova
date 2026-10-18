"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement, type ReactNode } from "react";
import {
  clearSentTickets,
  forgetEverything,
  loadChangeOrder,
  loadContact,
  loadFields,
  loadSentTickets,
  saveChangeOrder,
  saveContact,
  type Contact,
} from "@/lib/browser-memory";
import { addTicketsToChangeOrder } from "@/lib/tm-ticket";
import {
  checkChangeOrder,
  EMPTY_DRAFT,
  EMPTY_LINE,
  formatCents,
  freshDraft,
  LINE_KINDS,
  LINE_LABELS,
  lineAmount,
  liveTotals,
  PCO_STATUSES,
  startDraft,
  STEPS,
  stepErrors,
  type ChangeOrderDraft,
  type Line,
  type LineKind,
} from "@/lib/change-order";
import { isEmail } from "@/lib/email";
import { localToday } from "@/lib/fills";
import { BASE_PATH } from "@/lib/site";
import { Card, INPUT, PRIMARY, SendFields, StepShell } from "./StepShell";

/**
 * The free change order request (PCO), one screen at a time, in the same
 * frame as the lien waiver (StepShell): who you are, which job, what
 * changed, the labor / material / equipment lines, markup, the days it adds,
 * the backup, then read it and get the PDF by email. As with the waiver
 * there is no download -- lib/change-order-request.ts emails it.
 *
 * Next checks only the screen it is on (lib/change-order.ts `stepErrors`);
 * Back never checks anything. The request in progress is kept in this
 * browser so a reload on site does not lose it.
 *
 * Money on screen comes from the same integer-cent functions as the PDF, so
 * the running totals here and the printed ones cannot differ.
 */

const STEP_FORM = "change-order-step";

export function ChangeOrderTool() {
  const [draft, setDraft] = useState<ChangeOrderDraft>(EMPTY_DRAFT);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [tried, setTried] = useState(false);
  const [contact, setContact] = useState<Contact | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<{ to: string; notConfigured: boolean } | null>(null);
  const [handedOff, setHandedOff] = useState(0);

  // This browser's memory, after mount only: the server has no localStorage.
  useEffect(() => {
    const known = loadContact();
    // A sub who made a waiver here already told us their company.
    let start = startDraft(loadChangeOrder(), localToday(), known?.company || loadFields().companyName || "");
    // "Turn these tickets into a change order" (TmTicketTool): the sent
    // tickets' hours and quantities are ADDED as lines with no price, and
    // handed over once. Only the flag is in the URL, never the data.
    if (new URLSearchParams(window.location.search).get("from") === "tm-ticket") {
      const tickets = loadSentTickets();
      start = addTicketsToChangeOrder(start, tickets);
      // Saved BEFORE the tickets are cleared, so the lines exist in exactly
      // one place at every moment: an effect run twice (React's dev mode
      // does) or a tab closed right now cannot lose them.
      saveChangeOrder(start);
      clearSentTickets();
      setHandedOff(tickets.length);
      window.history.replaceState(null, "", window.location.pathname);
    }
    setDraft(start);
    setContact(known);
    if (known) {
      setName(known.name);
      setEmail(known.email);
      setCompany(known.company);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveChangeOrder(draft);
  }, [draft, loaded]);

  const checked = useMemo(() => checkChangeOrder(draft), [draft]);
  const totals = useMemo(() => liveTotals(draft), [draft]);
  const step = STEPS[index];
  const errors = stepErrors(step.id, checked.errors);
  const returning = contact !== null && contact.email.toLowerCase() === email.trim().toLowerCase();

  const set = (patch: Partial<ChangeOrderDraft>) => setDraft((existing) => ({ ...existing, ...patch }));
  const setLine = (kind: LineKind, at: number, patch: Partial<Line>) =>
    setDraft((existing) => ({ ...existing, [kind]: existing[kind].map((line, i) => (i === at ? { ...line, ...patch } : line)) }));

  function go(to: number) {
    setTried(false);
    setSendError(null);
    setIndex(to);
  }

  function next() {
    if (errors.length) return setTried(true);
    if (step.id === "send") return void send();
    go(index + 1);
  }

  async function send() {
    setTried(true);
    if (!name.trim() || !isEmail(email)) return;
    setBusy(true);
    setSendError(null);
    try {
      const response = await fetch(`${BASE_PATH}/api/change-order`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          order: draft,
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
      // Sent: the request is finished, so it is no longer a draft to restore.
      // Saved here as well as by the effect, so closing the tab right now
      // cannot leave the sent request behind.
      const fresh = freshDraft(draft.companyName, localToday());
      saveChangeOrder(fresh);
      setDraft(fresh);
      setSentTo({ to: body.sentTo, notConfigured: body.notConfigured === true });
    } catch {
      setSendError("Could not reach the server. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  /** The message for one field, once Next was tried or something was typed. */
  const errorFor = (key: string, value: string) => (tried || value.trim() ? checked.errors[key] : undefined);

  const done = sentTo !== null;
  type TextKey = "companyName" | "project" | "projectAddress" | "gc" | "pcoNumber" | "title";
  /** A one-line text question. The `<input>` is written out at each call
   * with a LITERAL `name`, so C-Stream's repo-wide numeric-input census
   * (apps/web/lib/numericInputCensus.test.ts) can read that it is free
   * text -- it cannot evaluate `name={key}`, and checks what it cannot read. */
  const text = (key: TextKey, label: string, opts: { optional?: boolean; help?: string }, input: ReactElement) => {
    const id = `field-${key}`;
    const error = errorFor(key, draft[key]);
    return (
      <Card htmlFor={id} label={label} optional={opts.optional} help={opts.help} helpId={`${id}-help`} error={error} errorId={`${id}-error`}>
        {input}
      </Card>
    );
  };
  const textProps = (key: TextKey) => ({
    id: `field-${key}`,
    type: "text",
    autoComplete: "off",
    value: draft[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) => set({ [key]: event.target.value } as Partial<ChangeOrderDraft>),
    "aria-invalid": Boolean(errorFor(key, draft[key])),
    "aria-describedby": errorFor(key, draft[key]) ? `field-${key}-error` : undefined,
    className: INPUT,
  });

  return (
    <StepShell
      toolName="Change order request"
      formId={STEP_FORM}
      index={index}
      total={STEPS.length}
      done={done}
      title={done ? "Check Your Inbox" : step.title}
      notice={
        handedOff && !done ? (
          <p role="status" className="rounded-md bg-warn-ground p-3 font-semibold text-ink">
            Added the hours and quantities from {handedOff === 1 ? "1 T&M ticket" : `${handedOff} T&M tickets`} as lines. Tickets carry no
            prices: type a rate on each one.
          </p>
        ) : null
      }
      onBack={index > 0 ? () => go(index - 1) : null}
      busy={busy}
      nextLabel={step.id === "send" ? (busy ? "Sending..." : "Email me the PDF") : step.id === "review" ? "Looks right" : "Next"}
    >
      {sentTo ? (
        <div className="mt-6 space-y-5" role="status">
          <div className="rounded-xl bg-paper p-5 ring-1 ring-rule">
            {sentTo.notConfigured ? (
              <p className="text-lg text-ink">
                This preview has no email set up, so nothing was sent. On the live site your change order request would go
                to <strong>{sentTo.to}</strong>.
              </p>
            ) : (
              <>
                <p className="text-lg text-ink">
                  Your change order request is on its way to <strong className="break-all">{sentTo.to}</strong>.
                </p>
                <p className="mt-2 text-quiet">It usually arrives in a minute. If it is not there, check your spam folder.</p>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              // Exactly what coming back fresh gives: your company and today.
              setDraft((existing) => freshDraft(existing.companyName, localToday()));
              setSentTo(null);
              go(0);
            }}
            className={`${PRIMARY} w-full`}
          >
            Make another change order request
          </button>
          <p className="text-sm text-quiet">
            This browser remembers your company, name and email for next time.{" "}
            <button
              type="button"
              onClick={() => {
                forgetEverything();
                setDraft(freshDraft("", localToday()));
                setContact(null);
                setName("");
                setEmail("");
                setCompany("");
                setSentTo(null);
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
                Free, no account. Fill in a change order request one screen at a time and we email you a PDF to send the GC,
                with a blank signature block for them.
              </p>
              {text("companyName", "Your company name", {}, <input name="companyName" {...textProps("companyName")} autoComplete="organization" />)}
            </>
          ) : null}

          {step.id === "project" ? (
            <>
              {text("project", "Project name", {}, <input name="project" {...textProps("project")} placeholder="Mesa Medical Office Building" />)}
              {text("projectAddress", "Project address", { optional: true }, <input name="projectAddress" {...textProps("projectAddress")} />)}
              {text("gc", "General contractor", { help: "The company this request goes to." }, <input name="gc" {...textProps("gc")} />)}
            </>
          ) : null}

          {step.id === "request" ? (
            <>
              {text("pcoNumber", "Your change order number", { optional: true, help: "Your own numbering, if you keep one, like PCO-07." }, <input name="pcoNumber" {...textProps("pcoNumber")} />)}
              <Card htmlFor="field-date" label="Date of this request" error={errorFor("date", draft.date)} errorId="field-date-error">
                <input id="field-date" type="date" name="date" value={draft.date} onChange={(event) => set({ date: event.target.value })} aria-invalid={Boolean(errorFor("date", draft.date))} className={INPUT} />
              </Card>
            </>
          ) : null}

          {step.id === "scope" ? (
            <>
              {text("title", "Title", {}, <input name="title" {...textProps("title")} placeholder="Add rated head-of-wall at corridor" />)}
              <Card htmlFor="field-description" label="Description of the change" help="What changed, where, and who asked for it." helpId="field-description-help" error={errorFor("description", draft.description)} errorId="field-description-error">
                <textarea
                  id="field-description"
                  name="description"
                  rows={6}
                  value={draft.description}
                  onChange={(event) => set({ description: event.target.value })}
                  aria-invalid={Boolean(errorFor("description", draft.description))}
                  aria-describedby="field-description-help"
                  className={`${INPUT} resize-y`}
                />
              </Card>
            </>
          ) : null}

          {(LINE_KINDS as readonly string[]).includes(step.id) ? (
            <Lines
              kind={step.id as LineKind}
              lines={draft[step.id as LineKind]}
              subtotal={totals.subtotals[step.id as LineKind]}
              errorFor={errorFor}
              onChange={(at, patch) => setLine(step.id as LineKind, at, patch)}
              onAdd={() => set({ [step.id]: [...draft[step.id as LineKind], { ...EMPTY_LINE }] } as Partial<ChangeOrderDraft>)}
              onRemove={(at) => set({ [step.id]: draft[step.id as LineKind].filter((_, i) => i !== at) } as Partial<ChangeOrderDraft>)}
            />
          ) : null}

          {step.id === "markup" ? (
            <>
              <Card htmlFor="field-markupPercent" label="Markup percent" optional help="Overhead and profit on the lines above. Leave empty for none." helpId="field-markupPercent-help" error={errorFor("markupPercent", draft.markupPercent)} errorId="field-markupPercent-error">
                <div className="flex items-center">
                  <input id="field-markupPercent" type="text" inputMode="decimal" name="markupPercent" autoComplete="off" placeholder="15" value={draft.markupPercent} onChange={(event) => set({ markupPercent: event.target.value })} aria-invalid={Boolean(errorFor("markupPercent", draft.markupPercent))} aria-describedby="field-markupPercent-help" className={INPUT} />
                  <span className="ml-2 text-lg text-quiet">%</span>
                </div>
              </Card>
              <Totals subtotal={totals.subtotal} markup={totals.markup} total={totals.total} />
            </>
          ) : null}

          {step.id === "schedule" ? (
            <Card htmlFor="field-scheduleDays" label="Days this adds to your schedule" help="Enter 0 if the schedule does not move." helpId="field-scheduleDays-help" error={errorFor("scheduleDays", draft.scheduleDays)} errorId="field-scheduleDays-error">
              <div className="flex items-center">
                <input id="field-scheduleDays" type="text" inputMode="numeric" name="scheduleDays" autoComplete="off" placeholder="0" value={draft.scheduleDays} onChange={(event) => set({ scheduleDays: event.target.value })} aria-invalid={Boolean(errorFor("scheduleDays", draft.scheduleDays))} aria-describedby="field-scheduleDays-help" className={INPUT} />
                <span className="ml-2 text-lg text-quiet">days</span>
              </div>
            </Card>
          ) : null}

          {step.id === "backup" ? (
            <Card htmlFor="field-backup" label="Backup you will send with it" optional help="One per line: photos, the RFI, the GC's email, quotes, T&M tickets. They are listed on the PDF by name; send the files themselves with it." helpId="field-backup-help" error={errorFor("backup", draft.backup)} errorId="field-backup-error">
              <textarea id="field-backup" name="backup" rows={5} value={draft.backup} onChange={(event) => set({ backup: event.target.value })} aria-invalid={Boolean(errorFor("backup", draft.backup))} aria-describedby="field-backup-help" className={`${INPUT} resize-y`} placeholder={"RFI 14 response\nSite photos, Oct 12"} />
            </Card>
          ) : null}

          {step.id === "review" && checked.order ? (
            <>
              <p className="text-quiet">This is what the PDF will say. The GC&apos;s signature block prints blank.</p>
              <div className="flex flex-wrap gap-2">
                {STEPS.slice(0, -2).map((candidate, i) => (
                  <button key={candidate.id} type="button" onClick={() => go(i)} className="min-h-touch rounded-full border-2 border-line bg-paper px-4 text-sm font-semibold text-ink hover:border-ink">
                    Change {candidate.title.toLowerCase()}
                  </button>
                ))}
              </div>
              <Review order={checked.order} />
            </>
          ) : null}
          {step.id === "review" && !checked.order ? (
            <p role="alert" className="font-semibold text-danger">
              Something on an earlier screen needs another look. Use Back to find it.
            </p>
          ) : null}

          {step.id === "send" ? (
            <SendFields
              {...{ tried, returning, name, setName, email, setEmail, company, setCompany, marketing, setMarketing, website, setWebsite, sendError }}
              readFirst="Read the whole request before you send it to the GC."
            />
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

function Lines({
  kind,
  lines,
  subtotal,
  errorFor,
  onChange,
  onAdd,
  onRemove,
}: {
  kind: LineKind;
  lines: Line[];
  subtotal: bigint;
  errorFor: (key: string, value: string) => string | undefined;
  onChange: (at: number, patch: Partial<Line>) => void;
  onAdd: () => void;
  onRemove: (at: number) => void;
}) {
  const labels = LINE_LABELS[kind];
  return (
    <>
      <p className="text-quiet">{lines.length ? "A line left completely empty is skipped." : `No ${labels.title.toLowerCase()} on this change? Leave it empty and tap Next.`}</p>
      {lines.map((line, at) => {
        const id = `${kind}-${at}`;
        const amount = lineAmount(line);
        const field = (key: keyof Line) => ({ id: `${id}-${key}`, error: errorFor(`${kind}.${at}.${key}`, line[key]) });
        const description = field("description");
        const quantity = field("quantity");
        const unit = field("unit");
        const price = field("unitPrice");
        return (
          <fieldset key={at} className="rounded-xl bg-paper px-5 py-4 ring-1 ring-rule focus-within:ring-2 focus-within:ring-focus">
            <legend className="sr-only">
              {labels.title} line {at + 1}
            </legend>
            <p className="text-sm font-semibold uppercase tracking-wide text-quiet" aria-hidden="true">
              {labels.title} line {at + 1}
            </p>
            <LineField htmlFor={description.id} label="What it is" error={description.error}>
              <input id={description.id} type="text" name="lineDescription" autoComplete="off" value={line.description} onChange={(event) => onChange(at, { description: event.target.value })} aria-invalid={Boolean(description.error)} className={INPUT} />
            </LineField>
            <div className="grid grid-cols-2 gap-x-4">
              <LineField htmlFor={quantity.id} label={labels.quantity} error={quantity.error}>
                <input id={quantity.id} type="text" inputMode="decimal" name="quantity" autoComplete="off" value={line.quantity} onChange={(event) => onChange(at, { quantity: event.target.value })} aria-invalid={Boolean(quantity.error)} className={INPUT} />
              </LineField>
              <LineField htmlFor={unit.id} label="Unit" error={unit.error}>
                <input id={unit.id} type="text" name="unit" autoComplete="off" placeholder={labels.unit} value={line.unit} onChange={(event) => onChange(at, { unit: event.target.value })} aria-invalid={Boolean(unit.error)} className={INPUT} />
              </LineField>
            </div>
            <LineField htmlFor={price.id} label={labels.unitPrice} error={price.error}>
              <div className="flex items-center">
                <span className="mr-2 text-lg text-quiet">$</span>
                <input id={price.id} type="text" inputMode="decimal" name="unitPrice" autoComplete="off" value={line.unitPrice} onChange={(event) => onChange(at, { unitPrice: event.target.value })} aria-invalid={Boolean(price.error)} className={INPUT} />
              </div>
            </LineField>
            <div className="mt-3 flex items-center justify-between gap-4">
              <p className="text-lg font-semibold text-ink" aria-live="polite">
                {amount === null ? <span className="font-normal text-quiet">Amount shows here</span> : `$${formatCents(amount)}`}
              </p>
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
      {lines.length ? (
        <p className="text-right text-lg font-semibold text-ink">
          {labels.title} subtotal: ${formatCents(subtotal)}
        </p>
      ) : null}
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

function Totals({ subtotal, markup, total }: { subtotal: bigint; markup: bigint; total: bigint }) {
  return (
    <dl className="rounded-xl bg-paper p-5 text-lg ring-1 ring-rule" aria-live="polite">
      <div className="flex justify-between">
        <dt className="text-quiet">Subtotal</dt>
        <dd className="text-ink">${formatCents(subtotal)}</dd>
      </div>
      <div className="mt-1 flex justify-between">
        <dt className="text-quiet">Markup</dt>
        <dd className="text-ink">${formatCents(markup)}</dd>
      </div>
      <div className="mt-2 flex justify-between border-t border-rule pt-2 font-bold">
        <dt className="text-ink">Total requested</dt>
        <dd className="text-ink">${formatCents(total)}</dd>
      </div>
    </dl>
  );
}

function Review({ order }: { order: NonNullable<ReturnType<typeof checkChangeOrder>["order"]> }) {
  const row = (label: string, value: string) =>
    value ? (
      <div className="flex flex-wrap justify-between gap-x-4 py-1">
        <dt className="text-quiet">{label}</dt>
        <dd className="text-right text-ink">{value}</dd>
      </div>
    ) : null;
  return (
    <div className="space-y-5 rounded-xl bg-paper p-5 ring-2 ring-ink">
      <div>
        <p className="text-xl font-bold text-ink">Change order request{order.pcoNumber ? ` ${order.pcoNumber}` : ""}</p>
        <p className="text-sm text-quiet">Status: {PCO_STATUSES[0]} until you send it. The PDF prints as {PCO_STATUSES[1]}.</p>
      </div>
      <dl>
        {row("Date", order.date)}
        {row("From", order.companyName)}
        {row("To", order.gc)}
        {row("Project", order.project)}
        {row("Address", order.projectAddress)}
      </dl>
      <div>
        <p className="font-bold text-ink">{order.title}</p>
        <p className="mt-1 whitespace-pre-line text-ink">{order.description}</p>
      </div>
      {LINE_KINDS.filter((kind) => order.lines[kind].length).map((kind) => (
        <div key={kind}>
          <p className="font-bold text-ink">{LINE_LABELS[kind].title}</p>
          <ul className="mt-1 space-y-1">
            {order.lines[kind].map((line, i) => (
              <li key={i} className="flex justify-between gap-4 text-ink">
                <span>
                  {line.description}
                  <span className="block text-sm text-quiet">
                    {line.quantity} {line.unit} x ${line.unitPrice}
                  </span>
                </span>
                <span>${formatCents(line.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Totals subtotal={order.subtotalCents} markup={order.markupCents} total={order.totalCents} />
      <dl>
        {row("Schedule impact", `${order.scheduleDays} ${order.scheduleDays === 1 ? "day" : "days"}`)}
        {row("Backup listed", order.backup.length ? order.backup.join(", ") : "None")}
      </dl>
    </div>
  );
}
