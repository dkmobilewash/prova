import { findJob } from "./findJob";
import type {
  CommandContext,
  CommandDefinition,
  HandoffCommandDefinition,
  CommandInput,
  Exclusion,
  PreviewLine,
  Resolution,
} from "../commands";

/**
 * Raising an RFI, as a HANDOFF over Cyrus's page.
 *
 * `createRfi` throws its refusals and issues the RFI's number from a
 * counter inside its own transaction. Production redacts a thrown Server
 * Action message, so a card that executed it could only ever show a
 * digest — which is why commands.coverage.test.ts refuses to register it
 * as DIRECT. Instead the card's primary is a link: /rfis?draft=<card>. The
 * page loads the server-held payload (lib/ask/drafts.ts) and RfiForm opens
 * with the subject, question and references filled in; Save is the form's
 * own submit, so the action's guards, its number and its sentences are
 * exactly what the person would meet typing it by hand.
 *
 * What the model supplies is the person's own words — the subject, the
 * question, a drawing or spec reference they dictated. It never supplies a
 * date: the sent date stays the form's default, the person's calendar day,
 * and blanking it there keeps the RFI a draft, which is the form's rule
 * and not one restated here.
 */

/** A subject taken from the question when the person gave only the
 * question. Cut at a word boundary, and the card says where it came
 * from, because the person edits it on the form either way. */
const SUBJECT_MAX = 80;

export function subjectFromQuestion(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  if (oneLine.length <= SUBJECT_MAX) return oneLine.replace(/[.?!]+$/, "");
  const cut = oneLine.slice(0, SUBJECT_MAX);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > 40 ? cut.slice(0, atWord) : cut).replace(/[,;:.?!]+$/, "")}…`;
}

async function resolveRaiseRfi(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const question = input.question ?? "";
  const subjectGiven = input.subject ?? "";
  if (!(input.jobName || input.jobId)) {
    return { kind: "need", missing: "which job the RFI is about" };
  }
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;

  // An RFI is a question. A subject alone ("about the head-of-wall
  // detail") is a topic, and the model is told to ask rather than pad it
  // into a question on the person's behalf.
  if (!question) {
    return {
      kind: "need",
      missing: subjectGiven
        ? `the question itself — what needs deciding about "${subjectGiven}"`
        : "what the RFI is asking, in a sentence",
    };
  }

  const warnings: string[] = [];
  let subject = subjectGiven;
  if (!subject) {
    subject = subjectFromQuestion(question);
    warnings.push("Subject taken from the question. Change it on the form if it should read differently.");
  }

  const drawingReference = input.drawingReference ?? null;
  const specSection = input.specSection ?? null;

  const preview: PreviewLine[] = [
    { label: "Job", value: job.name },
    { label: "Subject", value: subject },
    { label: "Question", value: question },
  ];
  if (drawingReference) preview.push({ label: "Drawing", value: drawingReference });
  if (specSection) preview.push({ label: "Spec section", value: specSection });
  preview.push({ label: "Date sent", value: "set on the form — defaults to today; blank keeps it a draft" });

  return {
    kind: "ready",
    resolved: { jobId: job.id, jobName: job.name, subject, question, drawingReference, specSection },
    preview,
    warnings,
  };
}

export const raiseRfiCommand: HandoffCommandDefinition = {
  name: "raise_rfi",
  description:
    "Prepares an RFI — a question to the GC or architect about a job's drawings or specs — and opens the RFI form with the job, subject, question, drawing reference and spec section filled in. The person reviews and saves it there, where it gets its number. Needs the job and the question in the person's own words; a drawing reference (\"A-501 / 3\") or spec section (\"09 21 16\") only if they said one. Does not send anything, does not choose a date (the form's sent date defaults to today), does not answer, close, edit or delete an existing RFI, and does not invent a question from a topic.",
  capability: "MANAGE_JOBS",
  tier: "T3_MONEY_EVIDENCE",
  mode: "HANDOFF",
  action: "createRfi",
  handoffHref: (proposalId) => `/rfis?draft=${proposalId}`,
  title: "Raise an RFI",
  verb: "Preparing the RFI",
  button: "Open the RFI form",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job the RFI is about, as the person named it." },
      subject: {
        type: "string",
        description: "A short subject line, in the person's words, if they gave one separately from the question.",
      },
      question: {
        type: "string",
        description: "The question to the GC or architect, in the person's words: the conflict and what needs deciding.",
      },
      drawingReference: {
        type: "string",
        description: "A drawing sheet or detail the person cited, exactly as they said it, e.g. A-501 / 3. Omit if not given.",
      },
      specSection: {
        type: "string",
        description: "A spec section the person cited, exactly as they said it, e.g. 09 21 16. Omit if not given.",
      },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveRaiseRfi,
};

export const rfiCommands: CommandDefinition[] = [raiseRfiCommand];

/** The rest of lib/actions/rfis.ts, each with its reason. */
export const rfiExclusions: Exclusion[] = [
  {
    action: "updateRfi",
    reason: "Edits the RFI being looked at, on its own row; identity fields lock once it is sent. A page edit, not a command.",
  },
  {
    action: "markRfiSent",
    reason: "Stamps a draft as sent today from its row — one tap on the page, and the date is evidence a card should not restate.",
  },
  {
    action: "answerRfi",
    reason: "Records the GC's answer with its date and cost or schedule impact: evidence entered from the correspondence, on the RFI's own row.",
  },
  {
    action: "setRfiClosed",
    reason: "Closing and reopening is a reversible toggle on the row; a card would be slower than the tap.",
  },
  { action: "deleteRfi", reason: "T5: deletes are never commands, and a sent RFI cannot be deleted at all." },
];
