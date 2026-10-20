import { formatDate } from "./fills";
import { unsupportedCharacters } from "./winansi";

/**
 * THE FREE CHANGE ORDER REQUEST (PCO) -- the second free tool (Diego's plan,
 * 2026-10-17, section 3). A sub fills in a change order request on a phone
 * and it is EMAILED as a PDF to hand the GC, exactly like the waiver.
 *
 * Its shape is copied from C-Stream's in-app ChangeOrder (number, title,
 * description, an ENTERED date, priced lines, Draft -> Pending GC ->
 * Executed), not its code: this app imports nothing from apps/web.
 *
 * Not statutory, so there is no attorney gate -- but it is still a document
 * a GC reads, so nothing here says the GC must pay, that the sub is
 * entitled to anything, or that the paper binds anyone. content.test.ts
 * fails the build on that kind of phrase in every file this tool shows.
 *
 * MONEY IS INTEGER CENTS, as BigInt, from the typed string to the printed
 * total. No float ever holds an amount: "0.1 + 0.2" is not a rounding rule.
 * A line is quantity x unit price rounded half-up to the cent, the subtotal
 * is the sum of those rounded lines (so the printed lines add up to the
 * printed subtotal), and the markup is the subtotal x percent, rounded
 * half-up once.
 */

export const LINE_KINDS = ["labor", "material", "equipment"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

/** The in-app ChangeOrder's status vocabulary, in plain words. This tool
 * only ever produces the first two: on screen it is a Draft, and the PDF it
 * emails is Pending GC. Executed is the GC's signature, on paper. */
export const PCO_STATUSES = ["Draft", "Pending GC", "Executed"] as const;

export interface Line {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

/** What the person typed, exactly as typed. */
export interface ChangeOrderDraft {
  companyName: string;
  project: string;
  projectAddress: string;
  gc: string;
  pcoNumber: string;
  date: string;
  title: string;
  description: string;
  labor: Line[];
  material: Line[];
  equipment: Line[];
  markupPercent: string;
  scheduleDays: string;
  /** Backup documents, one name per line. Listed on the PDF, not attached. */
  backup: string;
}

export const EMPTY_LINE: Line = { description: "", quantity: "", unit: "", unitPrice: "" };

export const EMPTY_DRAFT: ChangeOrderDraft = {
  companyName: "",
  project: "",
  projectAddress: "",
  gc: "",
  pcoNumber: "",
  date: "",
  title: "",
  description: "",
  labor: [],
  material: [],
  equipment: [],
  markupPercent: "",
  scheduleDays: "",
  backup: "",
};

export const LINE_LABELS: Record<LineKind, { title: string; quantity: string; unit: string; unitPrice: string; add: string }> = {
  labor: { title: "Labor", quantity: "Hours", unit: "hr", unitPrice: "Rate per hour", add: "Add a labor line" },
  material: { title: "Material", quantity: "Quantity", unit: "EA", unitPrice: "Price each", add: "Add a material line" },
  equipment: { title: "Equipment", quantity: "Quantity", unit: "day", unitPrice: "Rate", add: "Add an equipment line" },
};

/* ------------------------------------------------------------------ *
 * Money: integer cents, never a float.
 * ------------------------------------------------------------------ */

/** "1,234.5" -> 123450n (hundredths). Digits with optional commas, a
 * leading "$", up to two decimals; anything else is refused, not guessed. */
export function parseHundredths(raw: string): bigint | null {
  const cleaned = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

/** n / d rounded half-up, for n >= 0. */
function roundHalfUp(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (d * 2n);
}

/** Quantity (hundredths) x unit price (cents), to the cent. */
export function lineCents(quantityHundredths: bigint, unitPriceCents: bigint): bigint {
  return roundHalfUp(quantityHundredths * unitPriceCents, 100n);
}

/** Subtotal (cents) x percent (hundredths of a percent, i.e. basis points). */
export function markupCents(subtotalCents: bigint, basisPoints: bigint): bigint {
  return roundHalfUp(subtotalCents * basisPoints, 10_000n);
}

/** 123450n -> "1,234.50". */
export function formatCents(cents: bigint): string {
  // Grouped here rather than through fills.ts formatMoney, which refuses
  // past twelve digits -- a product of two large typed numbers printed as
  // an empty string until change-order.test.ts caught it.
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** Hundredths -> plain decimal: 1250n -> "12.5" (a 12.5% markup, or 12.5 hours). */
export function formatHundredths(hundredths: bigint): string {
  const whole = hundredths / 100n;
  const fraction = (hundredths % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

/** One line's amount while it is being typed, or null until both numbers read. */
export function lineAmount(line: Line): bigint | null {
  const quantity = parseHundredths(line.quantity);
  const price = parseHundredths(line.unitPrice);
  return quantity === null || price === null ? null : lineCents(quantity, price);
}

/** The running figures the screens show as the person types: lines that do
 * not read yet count as nothing, and an unreadable markup as 0%. The PDF's
 * figures come from checkChangeOrder, which refuses those instead. */
export function liveTotals(draft: ChangeOrderDraft): { subtotals: Record<LineKind, bigint>; subtotal: bigint; markup: bigint; total: bigint } {
  const subtotals = { labor: 0n, material: 0n, equipment: 0n } as Record<LineKind, bigint>;
  for (const kind of LINE_KINDS) for (const line of draft[kind]) subtotals[kind] += lineAmount(line) ?? 0n;
  const subtotal = subtotals.labor + subtotals.material + subtotals.equipment;
  const basisPoints = parseHundredths(draft.markupPercent.trim().replace(/%$/, "")) ?? 0n;
  const markup = basisPoints <= MAX_MARKUP_BP ? markupCents(subtotal, basisPoints) : 0n;
  return { subtotals, subtotal, markup, total: subtotal + markup };
}

/** A draft read back from this browser's memory, which may be from an older
 * version of this page or hand-edited: only the known string fields and
 * well-formed lines are kept. */
export function restoreDraft(raw: Record<string, unknown> | null): ChangeOrderDraft {
  const draft: ChangeOrderDraft = { ...EMPTY_DRAFT };
  if (!raw) return draft;
  for (const key of Object.keys(EMPTY_DRAFT) as Array<keyof ChangeOrderDraft>) {
    const value = raw[key];
    if ((LINE_KINDS as readonly string[]).includes(key)) {
      if (!Array.isArray(value)) continue;
      (draft[key] as Line[]) = value.slice(0, MAX_LINES).map((line) => {
        const item = (line && typeof line === "object" ? line : {}) as Record<string, unknown>;
        const str = (field: keyof Line) => (typeof item[field] === "string" ? (item[field] as string) : "");
        return { description: str("description"), quantity: str("quantity"), unit: str("unit"), unitPrice: str("unitPrice") };
      });
    } else if (typeof value === "string") {
      (draft[key] as string) = value;
    }
  }
  return draft;
}

/**
 * A NEW request: the sub's own company and today's date, nothing else. Used
 * after a successful send and by "Make another change order request", so
 * the two cannot drift -- the last request's job, lines, markup and date
 * must never sit in the boxes waiting to be appended to and re-sent.
 */
export function freshDraft(companyName: string, today: string): ChangeOrderDraft {
  return { ...EMPTY_DRAFT, companyName, date: today };
}

/**
 * The draft a visit starts from. An UNFINISHED draft (never sent; a sent one
 * was replaced by freshDraft) is restored, so a reload on site loses
 * nothing -- but its date is moved up to today when it is in the past. A
 * request is dated the day it goes out, and yesterday's date kept silently
 * is how a stale date reaches a GC. A date later than today was picked on
 * purpose and is kept. `today` and the dates are both "YYYY-MM-DD", which
 * compare correctly as strings.
 */
export function startDraft(stored: Record<string, unknown> | null, today: string, knownCompany: string): ChangeOrderDraft {
  const draft = restoreDraft(stored);
  if (!draft.companyName) draft.companyName = knownCompany;
  if (!draft.date || draft.date < today) draft.date = today;
  return draft;
}

/* ------------------------------------------------------------------ *
 * Checking: shared by the screens and the API, so they cannot disagree.
 * ------------------------------------------------------------------ */

export interface CheckedLine {
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  amountCents: bigint;
}

export interface CheckedChangeOrder {
  companyName: string;
  project: string;
  projectAddress: string;
  gc: string;
  pcoNumber: string;
  /** MM/DD/YYYY, the date the person picked -- entered, never stamped. */
  date: string;
  title: string;
  description: string;
  lines: Record<LineKind, CheckedLine[]>;
  subtotals: Record<LineKind, bigint>;
  subtotalCents: bigint;
  markupBasisPoints: bigint;
  markupCents: bigint;
  totalCents: bigint;
  scheduleDays: number;
  backup: string[];
}

export const MAX_TEXT = 200;
export const MAX_DESCRIPTION = 2000;
export const MAX_LINES = 20;
export const MAX_BACKUP = 20;
/** 100% markup is already far past any real one; past it is a typo. */
const MAX_MARKUP_BP = 10_000n;

export type ChangeOrderErrors = Record<string, string>;

/** One typed text field, checked for the PDF: whitespace collapsed (newlines
 * kept), length, and characters the standard fonts can print. Shared with
 * the T&M ticket (lib/tm-ticket.ts). */
export function checkText(errors: ChangeOrderErrors, key: string, label: string, raw: unknown, required: boolean, max = MAX_TEXT): string {
  const value = typeof raw === "string" ? raw.replace(/[^\S\n]+/g, " ").trim() : "";
  if (!value) {
    if (required) errors[key] = `${label} is needed.`;
    return "";
  }
  if (value.length > max) {
    errors[key] = `${label} is longer than ${max} characters.`;
    return "";
  }
  const bad = unsupportedCharacters(value.replace(/\n/g, " "));
  if (bad.length) {
    errors[key] = `${label} has characters the PDF cannot print (${bad.join(" ")}). Use plain letters, numbers and punctuation.`;
    return "";
  }
  return value;
}

const isBlankLine = (line: Partial<Line>) =>
  [line.description, line.quantity, line.unit, line.unitPrice].every((value) => !(typeof value === "string" && value.trim()));

/**
 * Check what was typed and work out every amount. `draft` is untrusted --
 * it is the API's request body -- so every field is read defensively.
 *
 * Error keys are field names, and `labor.0.quantity` for a line, which is
 * how a screen finds the errors that belong to it (`stepErrors`). A line
 * left completely blank is dropped rather than refused: an "Add a line"
 * tapped by mistake should not block the request.
 */
export function checkChangeOrder(draft: Partial<Record<keyof ChangeOrderDraft, unknown>>): {
  order: CheckedChangeOrder | null;
  errors: ChangeOrderErrors;
} {
  const errors: ChangeOrderErrors = {};
  const companyName = checkText(errors, "companyName", "Your company name", draft.companyName, true);
  const project = checkText(errors, "project", "Project name", draft.project, true);
  const projectAddress = checkText(errors, "projectAddress", "Project address", draft.projectAddress, false);
  const gc = checkText(errors, "gc", "General contractor", draft.gc, true);
  const pcoNumber = checkText(errors, "pcoNumber", "Change order number", draft.pcoNumber, false, 40);
  const title = checkText(errors, "title", "Title", draft.title, true);
  const description = checkText(errors, "description", "Description of the change", draft.description, true, MAX_DESCRIPTION);

  const rawDate = typeof draft.date === "string" ? draft.date : "";
  const date = formatDate(rawDate);
  if (!rawDate.trim()) errors.date = "Date is needed.";
  else if (date === null) errors.date = "Date should be a date.";

  const lines = { labor: [], material: [], equipment: [] } as Record<LineKind, CheckedLine[]>;
  const subtotals = { labor: 0n, material: 0n, equipment: 0n } as Record<LineKind, bigint>;
  for (const kind of LINE_KINDS) {
    const raw = Array.isArray(draft[kind]) ? (draft[kind] as unknown[]) : [];
    if (raw.length > MAX_LINES) errors[kind] = `${LINE_LABELS[kind].title} has more than ${MAX_LINES} lines.`;
    raw.slice(0, MAX_LINES).forEach((item, index) => {
      const line = (item && typeof item === "object" ? item : {}) as Partial<Line>;
      if (isBlankLine(line)) return;
      const key = `${kind}.${index}`;
      const labels = LINE_LABELS[kind];
      const lineDescription = checkText(errors, `${key}.description`, "What it is", line.description, true);
      const unit = checkText(errors, `${key}.unit`, "Unit", line.unit, false, 12);
      const quantity = parseHundredths(typeof line.quantity === "string" ? line.quantity : "");
      if (quantity === null || quantity === 0n) errors[`${key}.quantity`] = `${labels.quantity} should be a number like 8 or 12.5.`;
      const price = parseHundredths(typeof line.unitPrice === "string" ? line.unitPrice : "");
      if (price === null) errors[`${key}.unitPrice`] = `${labels.unitPrice} should be an amount like 85.00.`;
      if (quantity === null || quantity === 0n || price === null) return;
      const amountCents = lineCents(quantity, price);
      lines[kind].push({
        description: lineDescription,
        quantity: formatHundredths(quantity),
        unit: unit || labels.unit,
        unitPrice: formatCents(price),
        amountCents,
      });
      subtotals[kind] += amountCents;
    });
  }

  const rawMarkup = typeof draft.markupPercent === "string" ? draft.markupPercent.trim().replace(/%$/, "") : "";
  const markupBasisPoints = rawMarkup ? parseHundredths(rawMarkup) : 0n;
  if (markupBasisPoints === null || markupBasisPoints > MAX_MARKUP_BP) {
    errors.markupPercent = "Markup should be a percent from 0 to 100, like 15.";
  }

  const rawDays = typeof draft.scheduleDays === "string" ? draft.scheduleDays.trim() : "";
  if (!/^\d{1,3}$/.test(rawDays)) {
    errors.scheduleDays = rawDays ? "Days should be a whole number, like 0 or 3." : "Days is needed. Enter 0 if the schedule does not move.";
  }

  const backupRaw = typeof draft.backup === "string" ? draft.backup : "";
  const backup = backupRaw
    .split("\n")
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (backup.length > MAX_BACKUP) errors.backup = `List up to ${MAX_BACKUP} backup documents.`;
  else if (backup.some((name) => name.length > MAX_TEXT)) errors.backup = `Each backup name should be under ${MAX_TEXT} characters.`;
  else if (backup.some((name) => unsupportedCharacters(name).length)) {
    errors.backup = "A backup name has characters the PDF cannot print. Use plain letters, numbers and punctuation.";
  }

  if (Object.keys(errors).length || markupBasisPoints === null || date === null) return { order: null, errors };

  const subtotalCents = subtotals.labor + subtotals.material + subtotals.equipment;
  const markup = markupCents(subtotalCents, markupBasisPoints);
  return {
    order: {
      companyName,
      project,
      projectAddress,
      gc,
      pcoNumber,
      date,
      title,
      description,
      lines,
      subtotals,
      subtotalCents,
      markupBasisPoints,
      markupCents: markup,
      totalCents: subtotalCents + markup,
      scheduleDays: Number(rawDays),
      backup,
    },
    errors,
  };
}

/* ------------------------------------------------------------------ *
 * The screens.
 * ------------------------------------------------------------------ */

export type StepId =
  | "company"
  | "project"
  | "request"
  | "scope"
  | LineKind
  | "markup"
  | "schedule"
  | "backup"
  | "review"
  | "send";

/** Every screen, in order, and the fields whose errors stop its Next.
 * A key ending in "." owns every error under it (a step's lines). */
export const STEPS: ReadonlyArray<{ id: StepId; title: string; fields: readonly string[] }> = [
  { id: "company", title: "Your Company", fields: ["companyName"] },
  { id: "project", title: "Project", fields: ["project", "projectAddress", "gc"] },
  { id: "request", title: "This Request", fields: ["pcoNumber", "date"] },
  { id: "scope", title: "The Change", fields: ["title", "description"] },
  { id: "labor", title: "Labor", fields: ["labor", "labor."] },
  { id: "material", title: "Material", fields: ["material", "material."] },
  { id: "equipment", title: "Equipment", fields: ["equipment", "equipment."] },
  { id: "markup", title: "Markup", fields: ["markupPercent"] },
  { id: "schedule", title: "Schedule Impact", fields: ["scheduleDays"] },
  { id: "backup", title: "Backup", fields: ["backup"] },
  { id: "review", title: "Read Your Change Order", fields: [] },
  { id: "send", title: "Get Your PDF", fields: [] },
];

/** The error keys that belong to one screen. Next on that screen is
 * refused while this is non-empty; Back never checks anything. */
export function stepErrors(step: StepId, errors: ChangeOrderErrors): string[] {
  const fields = STEPS.find((candidate) => candidate.id === step)?.fields ?? [];
  return Object.keys(errors).filter((key) => fields.some((field) => (field.endsWith(".") ? key.startsWith(field) : key === field)));
}
