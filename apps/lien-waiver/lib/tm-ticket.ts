import { checkText, EMPTY_LINE, formatHundredths, type ChangeOrderDraft, type ChangeOrderErrors } from "./change-order";
import { isEmail } from "./email";
import { formatDate } from "./fills";

/**
 * THE FREE T&M / EXTRA-WORK TICKET -- the third free tool (Diego's plan,
 * 2026-10-17, section 3). The end-of-day ticket a foreman writes for work
 * outside the scope: who was there and for how long, what was used, what
 * the work was, and the GC superintendent's signature drawn on the phone.
 * The PDF is emailed to the foreman and the super at once.
 *
 * Its shape is the in-app TmTicket's (a snapshot frozen at signing), not
 * its code: this app imports nothing from apps/web.
 *
 * HOURS AND QUANTITIES ONLY. A ticket never prices the work: there is no
 * rate, amount or total money field here, and content.test.ts fails the
 * build on a "$" in its PDF. Pricing happens in the change order request,
 * where the sub types the rates ("Turn these tickets into a change order").
 * Nothing here says a signed ticket gets anyone paid.
 */

export interface CrewMember {
  name: string;
  hours: string;
}

export interface TmLine {
  description: string;
  quantity: string;
  unit: string;
}

export const TM_LINE_KINDS = ["material", "equipment"] as const;
export type TmLineKind = (typeof TM_LINE_KINDS)[number];

/** What the person typed, exactly as typed. */
export interface TicketDraft {
  /** Issued by this browser (issueTicketNumber), not typed. */
  number: string;
  companyName: string;
  project: string;
  gc: string;
  /** The day the work was done, "YYYY-MM-DD" -- entered, never stamped. */
  date: string;
  /** One line: what the extra work was. */
  summary: string;
  details: string;
  crew: CrewMember[];
  material: TmLine[];
  equipment: TmLine[];
  superName: string;
  superTitle: string;
  superEmail: string;
  /** The super's signature as one SVG path in a SIGNATURE_BOX (see below). */
  signature: string;
}

export const EMPTY_TICKET: TicketDraft = {
  number: "",
  companyName: "",
  project: "",
  gc: "",
  date: "",
  summary: "",
  details: "",
  crew: [],
  material: [],
  equipment: [],
  superName: "",
  superTitle: "",
  superEmail: "",
  signature: "",
};

export const EMPTY_TM_LINE: TmLine = { description: "", quantity: "", unit: "" };

export const TM_LINE_LABELS: Record<TmLineKind, { title: string; unit: string; add: string }> = {
  material: { title: "Material", unit: "EA", add: "Add material" },
  equipment: { title: "Equipment", unit: "hr", add: "Add equipment" },
};

export const MAX_CREW = 30;
export const MAX_TM_LINES = 20;
export const MAX_SUMMARY = 120;
export const MAX_DETAILS = 2000;
/** One person, one day. More than 24 is a typo, not overtime. */
export const MAX_HOURS_HUNDREDTHS = 2400n;

/* ------------------------------------------------------------------ *
 * Hours and quantities: hundredths, as BigInt, never a float.
 * ------------------------------------------------------------------ */

/** "8" -> 800n, "7.5" -> 750n, ".25" -> 25n, "1,200" -> 120000n. Digits with
 * optional commas and up to two decimals; a "$", a minus sign or anything
 * else is refused, not guessed -- this is a count, never money. */
export function parseQuantity(raw: string): bigint | null {
  const match = /^(\d{0,7})(?:\.(\d{1,2}))?$/.exec(raw.trim().replace(/,/g, ""));
  if (!match || (!match[1] && !match[2])) return null;
  return BigInt(match[1] || "0") * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

/** Hours for one crew member: more than 0, at most 24. */
export function parseHours(raw: string): bigint | null {
  const hours = parseQuantity(raw);
  return hours === null || hours === 0n || hours > MAX_HOURS_HUNDREDTHS ? null : hours;
}

/* ------------------------------------------------------------------ *
 * The ticket number.
 * ------------------------------------------------------------------ */

/** Crockford's base 32: no I, L, O or U, so a number read over the phone
 * cannot be misheard as a 1 or a 0. */
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TICKET_PATTERN = /^TM-[0-9A-HJKMNP-TV-Z]{7}-[0-9A-HJKMNP-TV-Z]{3}$/;

/**
 * A ticket number, issued by the BROWSER, with no database (the tool must
 * not touch C-Stream's) and no server counter.
 *
 * Shape: "TM-" + the issuing second, base 32 (7 characters, good to the
 * year 3058) + "-" + 3 random characters. For example TM-1NQ8K3P-7QX.
 *
 * WHAT IT GUARANTEES: within one browser whose storage is intact, every
 * number is issued at a second strictly later than the last one this
 * browser issued (`lastIssued + 1` when the clock has not moved on, or has
 * gone backwards), so the time part never repeats and NO TWO TICKETS FROM
 * THAT BROWSER SHARE A NUMBER.
 *
 * WHAT IT DOES NOT: it is not globally unique and is not checked by any
 * server. Two different phones, or one phone after its site data was
 * cleared, collide only if they issue in the same second AND draw the same
 * 3 random characters (1 in 32,768). Numbers are not sequential and a gap
 * means nothing. If the tool ever gets a database, a server-side counter
 * (CLAUDE.md, Sequence numbers) replaces this.
 */
export function issueTicketNumber(lastIssuedSecond: number, nowMs: number, random: () => number = Math.random): { number: string; second: number } {
  const second = Math.max(Math.floor(nowMs / 1000), Math.floor(lastIssuedSecond) + 1);
  let time = "";
  for (let rest = second; time.length < 7; rest = Math.floor(rest / 32)) time = BASE32[rest % 32] + time;
  const tail = Array.from({ length: 3 }, () => BASE32[Math.floor(random() * 32) % 32]).join("");
  return { number: `TM-${time}-${tail}`, second };
}

/* ------------------------------------------------------------------ *
 * The signature, drawn on the glass.
 * ------------------------------------------------------------------ */

/** The pad's own coordinate box. The canvas maps every pointer into it
 * whatever its size on screen, so the PDF draws the same shape at any
 * phone width. */
export const SIGNATURE_BOX = { width: 600, height: 200 } as const;
export const MAX_SIGNATURE_LENGTH = 24_000;
const SIGNATURE_PATTERN = /^M\d{1,3} \d{1,3}(?: [ML]\d{1,3} \d{1,3})*$/;

/** The path if it is a well-formed signature with some ink in it, else null.
 * One SVG path of moves and lines in whole numbers inside SIGNATURE_BOX --
 * untrusted input that goes straight into the PDF, so nothing else passes. */
export function checkSignature(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_SIGNATURE_LENGTH || !SIGNATURE_PATTERN.test(raw)) return null;
  const points = [...raw.matchAll(/[ML](\d+) (\d+)/g)];
  if (points.some(([, x, y]) => Number(x) > SIGNATURE_BOX.width || Number(y) > SIGNATURE_BOX.height)) return null;
  // A tap is not a signature: ask for at least a few strokes' worth of line.
  return (raw.match(/L/g) ?? []).length >= 3 ? raw : null;
}

/* ------------------------------------------------------------------ *
 * Checking: shared by the screens and the API, so they cannot disagree.
 * ------------------------------------------------------------------ */

export interface CheckedTmLine {
  description: string;
  quantity: string;
  unit: string;
}

export interface CheckedTicket {
  number: string;
  companyName: string;
  project: string;
  gc: string;
  /** MM/DD/YYYY. */
  date: string;
  summary: string;
  details: string;
  crew: Array<{ name: string; hours: string }>;
  totalHours: string;
  material: CheckedTmLine[];
  equipment: CheckedTmLine[];
  superName: string;
  superTitle: string;
  superEmail: string;
  signature: string;
}

const isBlank = (line: Partial<TmLine>) =>
  [line.description, line.quantity, line.unit].every((value) => !(typeof value === "string" && value.trim()));

/**
 * Check what was typed. `draft` is untrusted -- it is the API's request
 * body -- so every field is read defensively. Error keys are field names,
 * `crew.0.hours` for one person's hours and `material.0.quantity` for a
 * line, which is how a screen finds its own errors (`stepErrors`).
 */
export function checkTicket(draft: Partial<Record<keyof TicketDraft, unknown>>): { ticket: CheckedTicket | null; errors: ChangeOrderErrors } {
  const errors: ChangeOrderErrors = {};
  const number = typeof draft.number === "string" && TICKET_PATTERN.test(draft.number) ? draft.number : "";
  if (!number) errors.number = "This ticket has no number. Reload the page to get one.";
  const companyName = checkText(errors, "companyName", "Your company name", draft.companyName, true);
  const project = checkText(errors, "project", "Project name", draft.project, true);
  const gc = checkText(errors, "gc", "General contractor", draft.gc, true);
  const summary = checkText(errors, "summary", "What the extra work was", draft.summary, true, MAX_SUMMARY).replace(/\n/g, " ");
  const details = checkText(errors, "details", "Details", draft.details, false, MAX_DETAILS);

  const rawDate = typeof draft.date === "string" ? draft.date : "";
  const date = formatDate(rawDate);
  if (!rawDate.trim()) errors.date = "Date of the work is needed.";
  else if (date === null) errors.date = "Date of the work should be a date.";

  const rawCrew = Array.isArray(draft.crew) ? (draft.crew as unknown[]) : [];
  if (!rawCrew.length) errors.crew = "Add at least one person who did the work.";
  if (rawCrew.length > MAX_CREW) errors.crew = `List up to ${MAX_CREW} people on one ticket.`;
  let total = 0n;
  const crew = rawCrew.slice(0, MAX_CREW).flatMap((item, index) => {
    const member = (item && typeof item === "object" ? item : {}) as Partial<CrewMember>;
    const name = checkText(errors, `crew.${index}.name`, "Name", member.name, true, 80);
    const hours = parseHours(typeof member.hours === "string" ? member.hours : "");
    if (hours === null) errors[`crew.${index}.hours`] = "Hours should be a number from 0.25 to 24, like 8 or 7.5.";
    if (!name || hours === null) return [];
    total += hours;
    return [{ name, hours: formatHundredths(hours) }];
  });

  const lines = { material: [], equipment: [] } as Record<TmLineKind, CheckedTmLine[]>;
  for (const kind of TM_LINE_KINDS) {
    const raw = Array.isArray(draft[kind]) ? (draft[kind] as unknown[]) : [];
    if (raw.length > MAX_TM_LINES) errors[kind] = `${TM_LINE_LABELS[kind].title} has more than ${MAX_TM_LINES} lines.`;
    raw.slice(0, MAX_TM_LINES).forEach((item, index) => {
      const line = (item && typeof item === "object" ? item : {}) as Partial<TmLine>;
      if (isBlank(line)) return;
      const key = `${kind}.${index}`;
      const description = checkText(errors, `${key}.description`, "What it is", line.description, true);
      const unit = checkText(errors, `${key}.unit`, "Unit", line.unit, false, 12);
      const quantity = parseQuantity(typeof line.quantity === "string" ? line.quantity : "");
      if (quantity === null || quantity === 0n) errors[`${key}.quantity`] = "Quantity should be a number like 12 or 2.5.";
      else if (description) lines[kind].push({ description, quantity: formatHundredths(quantity), unit: unit || TM_LINE_LABELS[kind].unit });
    });
  }

  const superName = checkText(errors, "superName", "Superintendent's name", draft.superName, true, 120);
  const superTitle = checkText(errors, "superTitle", "Superintendent's title", draft.superTitle, true, 120);
  const superEmail = typeof draft.superEmail === "string" ? draft.superEmail.trim() : "";
  if (!isEmail(superEmail)) errors.superEmail = superEmail ? "Enter a valid email address." : "The superintendent's email is needed: the PDF goes there too.";
  const signature = checkSignature(draft.signature);
  if (!signature) errors.signature = "The superintendent signs in the box.";

  if (Object.keys(errors).length || date === null || !signature) return { ticket: null, errors };
  return {
    ticket: {
      number,
      companyName,
      project,
      gc,
      date,
      summary,
      details,
      crew,
      totalHours: formatHundredths(total),
      material: lines.material,
      equipment: lines.equipment,
      superName,
      superTitle,
      superEmail,
      signature,
    },
    errors,
  };
}

/** A ticket read back from this browser's memory: only the known fields,
 * well-formed. */
export function restoreTicket(raw: Record<string, unknown> | null): TicketDraft {
  const draft: TicketDraft = { ...EMPTY_TICKET, crew: [], material: [], equipment: [] };
  if (!raw) return draft;
  const str = (item: Record<string, unknown>, key: string) => (typeof item[key] === "string" ? (item[key] as string) : "");
  const records = (value: unknown, max: number) =>
    (Array.isArray(value) ? value : []).slice(0, max).map((item) => (item && typeof item === "object" ? item : {}) as Record<string, unknown>);
  for (const key of Object.keys(EMPTY_TICKET) as Array<keyof TicketDraft>) {
    if (typeof raw[key] === "string") (draft[key] as string) = raw[key] as string;
  }
  draft.crew = records(raw.crew, MAX_CREW).map((item) => ({ name: str(item, "name"), hours: str(item, "hours") }));
  for (const kind of TM_LINE_KINDS) {
    draft[kind] = records(raw[kind], MAX_TM_LINES).map((item) => ({ description: str(item, "description"), quantity: str(item, "quantity"), unit: str(item, "unit") }));
  }
  return draft;
}

/** A new ticket: the sub's company, today's date and a fresh number. Same
 * rule as the change order request's freshDraft -- after a send nothing of
 * the last ticket comes back but who you are. */
export function freshTicket(companyName: string, today: string, number: string): TicketDraft {
  return { ...EMPTY_TICKET, crew: [], material: [], equipment: [], companyName, date: today, number };
}

/* ------------------------------------------------------------------ *
 * The screens.
 * ------------------------------------------------------------------ */

export type TmStepId = "company" | "project" | "date" | "work" | "crew" | "hours" | TmLineKind | "review" | "sign" | "send";

export const TM_STEPS: ReadonlyArray<{ id: TmStepId; title: string; fields: readonly string[] }> = [
  { id: "company", title: "Your Company", fields: ["companyName"] },
  { id: "project", title: "Project", fields: ["project", "gc"] },
  { id: "date", title: "Date of Work", fields: ["date"] },
  { id: "work", title: "The Extra Work", fields: ["summary", "details"] },
  { id: "crew", title: "Crew", fields: ["crew", "crew."] },
  { id: "hours", title: "Hours", fields: ["crew.#hours"] },
  { id: "material", title: "Material Used", fields: ["material", "material."] },
  { id: "equipment", title: "Equipment", fields: ["equipment", "equipment."] },
  { id: "review", title: "Read the Ticket", fields: [] },
  { id: "sign", title: "Superintendent Signs", fields: ["superName", "superTitle", "superEmail", "signature"] },
  { id: "send", title: "Get Your PDF", fields: ["number"] },
];

/** The error keys that belong to one screen: a name error is the crew
 * screen's, an hours error the hours screen's. */
export function tmStepErrors(step: TmStepId, errors: ChangeOrderErrors): string[] {
  const fields = TM_STEPS.find((candidate) => candidate.id === step)?.fields ?? [];
  return Object.keys(errors).filter((key) =>
    fields.some((field) => {
      if (field === "crew.") return key.startsWith("crew.") && !key.endsWith(".hours");
      if (field === "crew.#hours") return key.startsWith("crew.") && key.endsWith(".hours");
      return field.endsWith(".") ? key.startsWith(field) : key === field;
    }),
  );
}

/* ------------------------------------------------------------------ *
 * "Turn these tickets into a change order": the hand-off to tool 2.
 * ------------------------------------------------------------------ */

/** What a sent ticket leaves in this browser for the change order request.
 * No signature and no email address: only what becomes a line. */
export interface HandoffTicket {
  number: string;
  companyName: string;
  date: string;
  project: string;
  gc: string;
  superName: string;
  crew: Array<{ name: string; hours: string }>;
  material: CheckedTmLine[];
  equipment: CheckedTmLine[];
}

export function toHandoff(ticket: CheckedTicket): HandoffTicket {
  const { number, companyName, date, project, gc, superName, crew, material, equipment } = ticket;
  return { number, companyName, date, project, gc, superName, crew, material, equipment };
}

/**
 * The tickets' hours and quantities as change order lines, added to the
 * request in progress -- never replacing anything typed there. Every line's
 * price is left EMPTY: the ticket has none, and the change order screen
 * refuses the line until the sub types a rate. Company, project and GC fill only
 * blanks; each ticket is listed under Backup so the GC can match them.
 *
 * `raw` comes from browser memory, so it is read defensively.
 */
export function addTicketsToChangeOrder(draft: ChangeOrderDraft, raw: unknown): ChangeOrderDraft {
  const tickets = (Array.isArray(raw) ? raw : []).filter((item): item is HandoffTicket => Boolean(item && typeof item === "object" && typeof item.number === "string"));
  if (!tickets.length) return draft;
  const strings = (value: unknown) => (typeof value === "string" ? value : "");
  const list = (value: unknown) => (Array.isArray(value) ? value : []).filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
  const next: ChangeOrderDraft = { ...draft, labor: [...draft.labor], material: [...draft.material], equipment: [...draft.equipment] };
  const backup: string[] = draft.backup.trim() ? [draft.backup.trim()] : [];
  for (const ticket of tickets) {
    const from = `T&M ${ticket.number}, ${strings(ticket.date)}`;
    for (const member of list(ticket.crew)) {
      next.labor.push({ ...EMPTY_LINE, description: `${strings(member.name)} (${from})`, quantity: strings(member.hours), unit: "hr" });
    }
    for (const kind of TM_LINE_KINDS) {
      for (const line of list(ticket[kind])) {
        next[kind].push({ ...EMPTY_LINE, description: `${strings(line.description)} (${from})`, quantity: strings(line.quantity), unit: strings(line.unit) });
      }
    }
    if (!next.companyName) next.companyName = strings(ticket.companyName);
    if (!next.project) next.project = strings(ticket.project);
    if (!next.gc) next.gc = strings(ticket.gc);
    backup.push(`T&M ticket ${ticket.number}, ${strings(ticket.date)}, signed by ${strings(ticket.superName)}`);
  }
  next.backup = backup.join("\n");
  return next;
}
