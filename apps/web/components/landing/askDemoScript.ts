/**
 * The script for the Ask C Stream demo on the public landing page
 * (components/landing/AskDemo.tsx plays it; AskCanDo.tsx lists what else
 * the box can do). A PLAIN MODULE with no "use client" on purpose: a value
 * exported from a client module reaches a server component as a
 * client-reference proxy rather than as itself (lib/client-boundary.test.ts,
 * and CLAUDE.md's Hint.tsx entry), and app/page.test.ts renders the landing
 * page on the server. Everything here is data and pure functions, so the
 * unit tests can drive the whole scene without a browser.
 *
 * EVERY WORD THE SCENE SHOWS IS WHAT THE PRODUCT SHOWS. This is a sales
 * page for software that files certified payroll, and the two things shown
 * here are an RFI — correspondence a GC keeps a copy of — and a person's
 * hours, which are payroll evidence. So the rules are stricter than "looks
 * right":
 *
 *   - Both tasks are REAL Ask commands, registered in lib/ask/commands.ts,
 *     and askDemoScript.test.ts fails if either is renamed or removed.
 *   - The card's heading, its button and its status line are the command's
 *     own `title`, `button` and `verb`, asserted equal in the test rather
 *     than copied by hand and left to drift.
 *   - The preview lines are the ones the command's `resolve` builds, in its
 *     order, with nothing added. `raise_rfi` (lib/ask/commands/rfis.ts)
 *     shows Job, Subject, Question and the Date-sent note; `log_time_entry`
 *     (lib/ask/commands/labor.ts) shows Job, Person, Date, Hours, Pay type.
 *     The subject is what `subjectFromQuestion` derives, and the date is
 *     what `dayLabel` prints — both checked by calling the real function.
 *   - `raise_rfi` is a HANDOFF command: its button opens the RFI form with
 *     the fields filled in, and the RFI gets its number when the person
 *     saves it THERE (components/RfiForm.tsx, `Save RFI`). So the scene
 *     shows the form and that save, and the result is a DRAFT — the form
 *     starts with the sent date blank, and blank keeps it a draft. It does
 *     not pretend the card's tap raised the RFI.
 *   - `log_time_entry` is DIRECT: its tap runs the write. The scene shows
 *     the tap, then the card's own "Working…" and "Done" states, in that
 *     order. Nothing is ever shown as saved before a tap.
 *
 * TIMING IS A SINGLE SCHEDULE. `STEPS` is the whole scene as durations;
 * `frameAt(t)` is a pure function of elapsed milliseconds. One clock in the
 * component advances `t`; nothing else is timed, so pausing is holding one
 * number and unmounting cancels one frame request. The total is about
 * twenty seconds and the test pins it to a band.
 *
 * The job and the names are the landing page's own made-up set
 * (panelChrome.tsx DEMO_JOB). Not a real project, GC, company or person.
 */

import { DEMO_JOB } from "./panelChrome";

/** The two commands the scene performs, by their registry names. */
export const SHOWN_COMMANDS = ["raise_rfi", "log_time_entry"] as const;

/** Milliseconds per typed character: brisk, but readable as typing. */
export const TYPE_MS = { rfi: 34, hours: 26 } as const;

/** What the card and the panel say, verbatim from the product. The test
 * holds each of these equal to its source, so this file cannot drift from
 * the code it describes. */
export const PRODUCT_COPY = {
  /** AskPanel.tsx: the status line before any tool has run. */
  thinking: "Thinking…",
  /** AskPanel.tsx: the input's placeholder. */
  placeholder: "Ask about your jobs, money, drawings, crews — or start an estimate…",
  /** AskPanel.tsx: the send button, at rest and in flight. */
  ask: "Ask",
  asking: "Looking…",
  /** AskProposalCard.tsx: the secondary button, the pending primary, the
   * settled heading and the handoff note. */
  cancel: "Cancel",
  working: "Working…",
  done: "Done",
  handoffNote: "Opens the form with these filled in. Nothing is saved until you save it there.",
  /** RfiForm.tsx: the form's heading and its buttons. */
  rfiFormTitle: "Raise an RFI",
  saveRfi: "Save RFI",
  savingRfi: "Saving…",
  /** RfiFields.tsx: the helper under Date sent. */
  blankKeepsDraft: "Blank keeps it a draft. Backdate it when you're entering an RFI you already sent.",
  /** rfiLabels.ts: the status chip on a row with no sent date. */
  draft: "Draft",
} as const;

/** Task 1 — an RFI, through the HANDOFF card and the form. */
export const RFI = {
  command: "raise_rfi" as const,
  prompt: "Raise an RFI on Northgate Clinic TI — which head-of-wall detail at the rated corridor?",
  /** lib/ask/commands/rfis.ts raiseRfiCommand.title / .verb / .button */
  title: "Raise an RFI",
  verb: "Preparing the RFI",
  button: "Open the RFI form",
  job: DEMO_JOB.name,
  /** The person's question, as the model passes their words through. */
  question: "Which head-of-wall detail applies at the rated corridor?",
  /** `subjectFromQuestion(question)` — the trailing "?" dropped. */
  subject: "Which head-of-wall detail applies at the rated corridor",
  /** The exact line `resolveRaiseRfi` pushes last — `RFI_DATE_SENT_NOTE`
   * in lib/ask/commands/rfis.ts, held equal by askDemoScript.test.ts. Not
   * imported here, because that module reaches the database and this one
   * is rendered by the public page. */
  dateSentNote: "set on the form — starts blank, so it saves as a draft until you enter the date you sent it",
  /** The warning the card carries when the subject was derived. */
  warning: "Subject taken from the question. Change it on the form if it should read differently.",
  /** components/jobLabels.ts jobPickerLabel — name and GC, no status. */
  jobPickerLabel: `${DEMO_JOB.name} — ${DEMO_JOB.gc}`,
  /** The number the form's save issues in the example. RfiRow prints
   * "RFI {number}". Illustrative: the counter on a real job decides. */
  number: 4,
} as const;

export const RFI_PREVIEW: readonly { label: string; value: string }[] = [
  { label: "Job", value: RFI.job },
  { label: "Subject", value: RFI.subject },
  { label: "Question", value: RFI.question },
  { label: "Date sent", value: RFI.dateSentNote },
];

/** Task 2 — one person's hours, through the DIRECT card. */
export const HOURS = {
  command: "log_time_entry" as const,
  prompt: "Log 8 hours for Luis Ortega on Northgate today",
  /** lib/ask/commands/labor.ts logTimeEntryCommand.title / .verb / .button */
  title: "Log hours",
  verb: "Preparing the time entry",
  button: "Log hours",
  job: DEMO_JOB.name,
  person: "Luis Ortega",
  /** A fixed calendar day, never `new Date()`: the server and the browser
   * must agree byte for byte (panelChrome.tsx utcDay's rule). */
  day: "2026-09-21",
  /** `dayLabel(day)` plus the card's own "today" suffix. */
  dateLine: "Sep 21, 2026 (Monday) — today, on your calendar",
  /** `parseHours("8").display` */
  hoursLine: "8 hours",
  /** PAY_TYPES.STRAIGHT in labor.ts */
  payTypeLine: "straight time",
} as const;

export const HOURS_PREVIEW: readonly { label: string; value: string }[] = [
  { label: "Job", value: HOURS.job },
  { label: "Person", value: HOURS.person },
  { label: "Date", value: HOURS.dateLine },
  { label: "Hours", value: HOURS.hoursLine },
  { label: "Pay type", value: HOURS.payTypeLine },
];

/** `executeLogTimeEntry`'s outcome, word for word: the created link's
 * label, then the message. */
export const HOURS_OUTCOME = {
  createdLabel: `${HOURS.person}, ${HOURS.day}`,
  message: `Logged 8 hours for ${HOURS.person} on ${HOURS.job}, ${HOURS.day}.`,
} as const;

/** The honesty line under the stage — real text at rest, never a tooltip,
 * the same rule panelChrome.tsx's figcaption follows. */
export const EXAMPLE_CAPTION = "Example. Your jobs, your crew. Nothing is saved until you tap.";

/** The one sentence under the can-do list. */
export const GATE_LINE = "It shows you what it's about to do. You tap once to approve.";

// ------------------------------------------------------------------ steps

export type StepName =
  | "idle"
  | "typing"
  | "hold"
  | "ask"
  | "thinking"
  | "resolving"
  | "card"
  | "reach"
  | "press"
  | "form"
  | "reachSave"
  | "pressSave"
  | "saving"
  | "saved"
  | "pending"
  | "settled"
  | "rest";

export type Step = { task: 1 | 2; name: StepName; ms: number };

export const STEPS: readonly Step[] = [
  // Task 1: the RFI. A HANDOFF card, then the form it hands off to.
  { task: 1, name: "idle", ms: 500 },
  { task: 1, name: "typing", ms: RFI.prompt.length * TYPE_MS.rfi },
  { task: 1, name: "hold", ms: 300 },
  { task: 1, name: "ask", ms: 200 },
  { task: 1, name: "thinking", ms: 700 },
  { task: 1, name: "resolving", ms: 900 },
  { task: 1, name: "card", ms: 1400 },
  { task: 1, name: "reach", ms: 500 },
  { task: 1, name: "press", ms: 220 },
  { task: 1, name: "form", ms: 1500 },
  { task: 1, name: "reachSave", ms: 500 },
  { task: 1, name: "pressSave", ms: 220 },
  { task: 1, name: "saving", ms: 500 },
  { task: 1, name: "saved", ms: 1600 },
  // Task 2: the hours. A DIRECT card; the tap is the write.
  { task: 2, name: "idle", ms: 400 },
  { task: 2, name: "typing", ms: HOURS.prompt.length * TYPE_MS.hours },
  { task: 2, name: "hold", ms: 250 },
  { task: 2, name: "ask", ms: 200 },
  { task: 2, name: "thinking", ms: 500 },
  { task: 2, name: "resolving", ms: 700 },
  { task: 2, name: "card", ms: 1200 },
  { task: 2, name: "reach", ms: 450 },
  { task: 2, name: "press", ms: 220 },
  { task: 2, name: "pending", ms: 500 },
  { task: 2, name: "settled", ms: 1800 },
  { task: 2, name: "rest", ms: 600 },
];

export const TOTAL_MS = STEPS.reduce((sum, step) => sum + step.ms, 0);

// ------------------------------------------------------------------ frames

/** Everything the stage needs to draw one instant of the scene. */
export type Frame = {
  task: 1 | 2;
  step: StepName;
  /** What is in the box. Empty while the box is idle or already sent. */
  typed: string;
  caret: boolean;
  /** The send button in its pressed instant. */
  askPressed: boolean;
  /** The person's words, shown above the box once sent. */
  asked: string | null;
  /** The panel's status line, or nothing. */
  status: string | null;
  /** The proposal card's state. `pressed` is the tap's own instant. */
  card: "none" | "proposed" | "pressed" | "pending" | "settled";
  /** Task 1 only: the RFI form the card hands off to, then the saved row. */
  view: "panel" | "form" | "saved";
  form: "none" | "open" | "pressed" | "saving";
  /** Where the tap indicator is drawn. */
  tap: "none" | "primary" | "save";
};

export function stepAt(t: number): { step: Step; elapsed: number } {
  const wrapped = ((t % TOTAL_MS) + TOTAL_MS) % TOTAL_MS;
  let start = 0;
  for (const step of STEPS) {
    if (wrapped < start + step.ms) return { step, elapsed: wrapped - start };
    start += step.ms;
  }
  // Unreachable: `wrapped` is below TOTAL_MS. Kept so the return type is
  // honest rather than `| undefined`.
  const last = STEPS[STEPS.length - 1]!;
  return { step: last, elapsed: last.ms };
}

const TASK = { 1: RFI, 2: HOURS } as const;

export function frameAt(t: number): Frame {
  const { step, elapsed } = stepAt(t);
  const task = TASK[step.task];
  const name = step.name;

  const typing = name === "typing";
  const beforeSend = name === "idle" || typing || name === "hold" || name === "ask";
  const perChar = step.task === 1 ? TYPE_MS.rfi : TYPE_MS.hours;
  const typed = typing
    ? task.prompt.slice(0, Math.min(task.prompt.length, Math.floor(elapsed / perChar) + 1))
    : name === "hold" || name === "ask"
      ? task.prompt
      : "";

  const status =
    name === "thinking" ? PRODUCT_COPY.thinking : name === "resolving" ? `${task.verb}…` : null;

  const card: Frame["card"] =
    name === "card" || name === "reach"
      ? "proposed"
      : name === "press"
        ? "pressed"
        : name === "pending"
          ? "pending"
          : name === "settled" || name === "rest"
            ? "settled"
            : "none";

  const view: Frame["view"] =
    step.task === 1 && (name === "form" || name === "reachSave" || name === "pressSave" || name === "saving")
      ? "form"
      : step.task === 1 && name === "saved"
        ? "saved"
        : "panel";

  const form: Frame["form"] =
    name === "form" || name === "reachSave"
      ? "open"
      : name === "pressSave"
        ? "pressed"
        : name === "saving"
          ? "saving"
          : "none";

  const tap: Frame["tap"] =
    name === "reach" || name === "press"
      ? "primary"
      : name === "reachSave" || name === "pressSave"
        ? "save"
        : "none";

  return {
    task: step.task,
    step: name,
    typed,
    caret: name === "idle" || typing || name === "hold",
    askPressed: name === "ask",
    asked: beforeSend ? null : task.prompt,
    status,
    card,
    view,
    form,
    tap,
  };
}

/** The instant the reduced-motion frame, the server render and a browser
 * with no JavaScript all show: the hours card, settled. Read straight off
 * the schedule rather than written as a literal, so it stays a real frame
 * of the scene. */
export function finalFrame(): Frame {
  let start = 0;
  for (const step of STEPS) {
    if (step.task === 2 && step.name === "settled") return frameAt(start + 1);
    start += step.ms;
  }
  throw new Error("the schedule has no settled step for task 2");
}

/** A compact string that changes exactly when something visible changes,
 * so the player re-renders on those instants and not on every frame
 * request. */
export function frameKey(frame: Frame): string {
  return `${frame.task}|${frame.step}|${frame.typed.length}|${frame.card}|${frame.view}|${frame.form}|${frame.tap}`;
}

// ---------------------------------------------------------- what it can do

/**
 * The compact "what you can ask it to do" list, grouped the way a
 * contractor sorts the day rather than the way the registry is filed.
 * Every item names the command(s) it stands for, and askDemoScript.test.ts
 * asserts each one is registered in lib/ask/commands.ts — so removing or
 * renaming a command fails this page's build rather than leaving a promise
 * on it. Words are kept to a minimum on purpose: this sits beside the
 * demo, not instead of it.
 */
export type CanDoItem = { text: string; commands: readonly string[] };
export type CanDoGroup = { group: string; items: readonly CanDoItem[] };

export const CAN_DO: readonly CanDoGroup[] = [
  {
    group: "Billing",
    items: [
      { text: "draft an invoice", commands: ["draft_invoice"] },
      { text: "log a payment", commands: ["log_payment"] },
      { text: "release retainage", commands: ["release_retainage"] },
    ],
  },
  {
    group: "Field",
    items: [
      { text: "log hours", commands: ["log_time_entry"] },
      { text: "today's field report", commands: ["log_daily_field_report"] },
      { text: "punch items", commands: ["add_punch_items"] },
      { text: "schedule or move the crew", commands: ["schedule_crew", "reschedule_job"] },
      { text: "a delivery", commands: ["record_material_delivery"] },
      { text: "equipment out to a job and back", commands: ["send_equipment_to_job", "bring_equipment_back"] },
    ],
  },
  {
    group: "The GC",
    items: [
      { text: "raise an RFI", commands: ["raise_rfi"] },
      { text: "send an email", commands: ["send_email"] },
      { text: "add a contact", commands: ["add_contact"] },
    ],
  },
  {
    group: "Estimating",
    items: [
      { text: "start an estimate", commands: ["create_estimate_job"] },
      { text: "draft line items", commands: ["draft_estimate_lines"] },
      { text: "add a catalog line", commands: ["add_catalog_line"] },
      { text: "log a bid invitation", commands: ["log_bid_invitation"] },
      { text: "track a pursuit", commands: ["add_bid_pursuit", "set_pursuit_stage"] },
    ],
  },
];

/**
 * The plain-text account of the scene for a screen reader, built from the
 * same data the stage draws so the two cannot disagree. The animated layer
 * is aria-hidden — reading out every typed character would be noise — and
 * this is what is read instead.
 */
export function sceneDescription(): string {
  return [
    "An example of Ask C Stream, on made-up jobs and names.",
    `Someone types: ${RFI.prompt}`,
    `A card headed ${RFI.title} shows ${RFI_PREVIEW.map((line) => line.label).join(", ")}, with ${PRODUCT_COPY.cancel} and ${RFI.button} buttons.`,
    `After a tap on ${RFI.button}, the RFI form opens with those fields filled in. A tap on ${PRODUCT_COPY.saveRfi} saves it as RFI ${RFI.number}, a draft.`,
    `Then someone types: ${HOURS.prompt}`,
    `A card headed ${HOURS.title} shows ${HOURS_PREVIEW.map((line) => line.label).join(", ")}, with ${PRODUCT_COPY.cancel} and ${HOURS.button} buttons. Nothing is written until the tap on ${HOURS.button}.`,
    `After the tap the card reads ${PRODUCT_COPY.done}: ${HOURS_OUTCOME.message}`,
  ].join(" ");
}
