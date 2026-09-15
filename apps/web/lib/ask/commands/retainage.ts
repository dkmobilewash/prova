import { prisma } from "@prova/db";
import { plural } from "@/lib/actions/shared";
import {
  createRetainageReleaseRecord,
  loadJobRetainage,
  overReleaseSentence,
} from "@/lib/billing/retainage-release";
import { money } from "@/lib/money";
import { dayLabel, parseDateWords } from "../dates";
import { parseAmount } from "../numbers";
import { findJob } from "./findJob";
import type {
  CommandContext,
  CommandInput,
  DirectCommandDefinition,
  PreviewLine,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * Diego's lane, phase 4d: the retainage release, the last money command
 * the billing exclusions were holding back — "a later phase once a card
 * can show the balance it draws down". Phase 3's cards showed a balance
 * owing and a retainage withheld computed by the app's own arithmetic, so
 * the condition is met and the line is gone.
 *
 * What the record IS, read off the schema and the job page rather than
 * the name: a `RetainageRelease` row — a lump sum the GC paid back
 * against the job's WHOLE withheld balance, never against one invoice —
 * logged from the form at the foot of the job page's Retainage section
 * ("Log release") with an amount, a date and an optional note. The panel
 * above that form shows three figures, Total withheld / Total released /
 * Outstanding balance, from `calculateRetainageSummary` over every
 * invoice's snapshot and every release's amount. This card shows the same
 * three, from the same call over the same rows (`loadJobRetainage`), plus
 * the two it exists for: what this release is, and what is held after.
 *
 * THE MODEL NEVER SUPPLIES A FIGURE, restated where a wrong one costs the
 * most. The amount is the person's own typed digits through
 * lib/ask/numbers.ts — "12,500" and "$12,500.00" are one amount, "12.5k"
 * is a question back — or NO figure at all when they asked for "the
 * retainage held", "the balance" or "all of it", in which case the app
 * uses the full balance it just computed and the card says so in words.
 * A release above the balance held is refused before any card exists, in
 * the core's own sentence, and the core refuses it again on the tap.
 *
 * THE DATE IS ENTERED, NOT STAMPED, as the form's date field is. The
 * person's words go through lib/ask/dates.ts against their own today (a
 * month-day already past is this year, since a release has happened; a
 * question back for a relative phrase, since a new row has nothing to
 * count from). No words means today — the person's calendar day, not the
 * server's clock — and the card says "today" beside it so a release the
 * GC sent last week is not silently dated this morning.
 *
 * THE TAP RE-CHECKS. The payload carries the balance the card was made
 * from; the core re-reads the job's rows inside a serializable
 * transaction and refuses, naming what is held now, if another release or
 * another invoice landed in between. T3, on MANAGE_BILLING — the
 * capability the job page's Retainage section demands (`showsBilling`) —
 * and `confirmAskProposal` refuses anyone without it in a returned
 * sentence before anything is claimed.
 */

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const utcMidnight = (day: string) => new Date(`${day}T00:00:00.000Z`);

/**
 * The person asking for the whole balance in WORDS. Not a figure and not
 * parsed as one: "all of it" is a decision about which number to use, and
 * the number itself is still the app's. Anything not on this list that is
 * also not digits is a question back, never a guess.
 */
const ALL_OF_IT =
  /^(?:all(?: of it)?|everything|in full|(?:the )?(?:full|whole|entire|remaining|outstanding) (?:balance|amount|retainage)(?: held| withheld| outstanding)?|the (?:balance|retainage|amount)(?: held| withheld| outstanding)?|what(?:'s| is) (?:held|left|outstanding|withheld))$/;

export function asksForAllOfIt(text: string): boolean {
  return ALL_OF_IT.test(text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.]+$/, ""));
}

/** The release date the person gave, as a day, or the Resolution that
 * stops here. A new row has no stored date, so a relative phrase is a
 * question rather than a count from anything.
 *
 * A month-day already past this year is THIS year, not a which-year chip
 * row as it is for a due date or a schedule: the schema's own words for
 * this row are "retainage actually paid back", so "September 8" said on
 * the 11th is three days ago and never next year. The year is on the card
 * either way, so the reading is visible before the tap. */
function releasedDayFor(text: string, today: string): { day: string } | Resolution {
  const parsed = parseDateWords(text, today);
  if (!parsed) {
    return {
      kind: "need",
      missing: `the date the retainage was released as a calendar day — "${text}" isn't one this app can read. Say it like "September 8", "9/8/2026" or "today"`,
    };
  }
  switch (parsed.kind) {
    case "on":
      return { day: parsed.day };
    case "which-year":
      return { day: parsed.thisYear };
    case "shift":
    case "shift-either-way":
      return {
        kind: "need",
        missing: `the release date itself — "${text}" is counted from a date this release doesn't have yet. Say it like "September 8" or "9/8/2026"`,
      };
  }
}

async function resolveReleaseRetainage(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  if (!(input.jobName || input.jobId)) return { kind: "need", missing: "which job the retainage is held on" };
  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const { job } = located;

  const detail = await prisma.job.findFirst({
    where: { id: job.id, companyId: ctx.companyId },
    select: { status: true, contact: { select: { name: true } } },
  });
  if (!detail) return { kind: "refuse", reason: "That job isn't on your account." };
  if (detail.status === "ESTIMATE") {
    // The page hides its Retainage section on an estimate: nothing has
    // been invoiced, so nothing has been withheld.
    return {
      kind: "refuse",
      reason: `${job.name} is still an estimate — nothing has been invoiced on it, so no retainage is held.`,
      href: `/jobs/${job.id}`,
    };
  }

  // The job page's own read and arithmetic, in cents for the comparisons.
  const held = await loadJobRetainage(prisma, job.id);
  if (held.balanceCents <= 0) {
    const reason =
      held.withheldCents === 0
        ? `No retainage has been withheld on ${job.name} — nothing to release.`
        : held.balanceCents === 0
          ? `All ${money(held.summary.totalWithheld)} of retainage withheld on ${job.name} has already been released — nothing is held.`
          : `${job.name}'s releases (${money(held.summary.totalReleased)}) already exceed what was withheld (${money(
              held.summary.totalWithheld,
            )}) — nothing is held.`;
    return { kind: "refuse", reason, href: `/jobs/${job.id}` };
  }

  // The amount: the person's digits, or the full balance when they asked
  // for all of it in words. Never a figure of the model's.
  let amountCents: number;
  let fullBalance = false;
  if (!input.amount || asksForAllOfIt(input.amount)) {
    amountCents = held.balanceCents;
    fullBalance = true;
  } else {
    const parsed = parseAmount(input.amount);
    if (!parsed) {
      return {
        kind: "need",
        missing: `the amount released as a plain number — "${input.amount}" isn't one. Say the figure, or "all of it" for the ${money(
          held.summary.balance,
        )} still held`,
      };
    }
    amountCents = parsed.cents;
  }

  // The core's own ceiling, checked first with the same cents so the
  // person gets the sentence instead of a card whose button can only
  // fail. The core checks again on the tap regardless.
  if (amountCents > held.balanceCents) {
    return { kind: "refuse", reason: overReleaseSentence(job.name, amountCents, held), href: `/jobs/${job.id}` };
  }

  // The date: the person's words against their own today, or today.
  let releasedAt = ctx.today;
  let dateSaid = false;
  const warnings: string[] = [];
  if (input.releasedAt) {
    const result = releasedDayFor(input.releasedAt, ctx.today);
    if (!("day" in result)) return result;
    releasedAt = result.day;
    dateSaid = true;
    if (releasedAt > ctx.today) warnings.push(`That release date, ${dayLabel(releasedAt)}, is in the future.`);
  }

  const note = input.note ?? "";
  const afterCents = held.balanceCents - amountCents;
  const preview: PreviewLine[] = [
    { label: "Job", value: `${job.name} · ${detail.contact.name}` },
    // The three figures the job page's panel shows, from the same call.
    {
      label: "Withheld to date",
      value: `${money(held.summary.totalWithheld)} across ${plural(held.invoicesWithRetainage, "invoice", "invoices")}`,
    },
    {
      label: "Released to date",
      value:
        held.releases === 0
          ? "nothing yet"
          : `${money(held.summary.totalReleased)} across ${plural(held.releases, "release", "releases")}`,
    },
    { label: "Still held", value: money(held.summary.balance) },
    { label: "This release", value: fullBalance ? `${money(amountCents / 100)} — the full balance held` : money(amountCents / 100) },
    { label: "Held after", value: afterCents === 0 ? "nothing — this clears it" : money(afterCents / 100) },
    {
      label: "Released on",
      value: dateSaid ? dayLabel(releasedAt) : `${dayLabel(releasedAt)} — today; say a date if the GC released it on another day`,
    },
  ];
  if (note) preview.push({ label: "Note", value: note });

  return {
    kind: "ready",
    resolved: {
      jobId: job.id,
      jobName: job.name,
      amount: (amountCents / 100).toFixed(2),
      fullBalance,
      releasedAt,
      note: note || null,
      // What the tap will require the job to still hold.
      expectedBalance: (held.balanceCents / 100).toFixed(2),
    },
    preview,
    warnings,
  };
}

async function executeReleaseRetainage(ctx: CommandContext, payload: ResolvedPayload) {
  const jobId = str(payload, "jobId");
  const jobName = str(payload, "jobName");
  const amount = str(payload, "amount");
  const releasedAt = str(payload, "releasedAt");
  const expectedBalance = str(payload, "expectedBalance");
  if (!jobId || !jobName || !amount || !releasedAt || !ISO_DAY.test(releasedAt) || !expectedBalance) {
    return { ok: false as const, error: "That card can't be executed. Ask again." };
  }
  const result = await createRetainageReleaseRecord(
    ctx.companyId,
    jobId,
    { amount, releasedAt: utcMidnight(releasedAt), note: str(payload, "note"), createdByUserId: ctx.userId },
    { expectedBalance, refuseOverRelease: true },
  );
  if (!result.ok) return { ok: false as const, error: result.error };
  const { releaseId, balanceAfterCents } = result.value;
  return {
    ok: true as const,
    message: `Released ${money(Number(amount))} of retainage on ${jobName}; ${
      balanceAfterCents > 0 ? `${money(balanceAfterCents / 100)} is still held` : "nothing is still held"
    }.`,
    // The action revalidates the job page only; the confirm action
    // covers it through `created.href`.
    created: { label: `Retainage release, ${jobName}`, href: `/jobs/${jobId}`, targetType: "RetainageRelease", targetId: releaseId },
  };
}

export const releaseRetainageCommand: DirectCommandDefinition = {
  name: "release_retainage",
  description:
    "Logs retainage the GC has released — paid back — on a job, as the job page's Retainage section records it: a lump sum against the job's whole withheld balance, never against one invoice. Needs the job. The amount is the person's own figure, digits only; when they said to release the retainage held, the balance, or all of it without a figure, omit the amount and the app uses the full balance held and says so on the card. The app reads what has been withheld, what has been released and what is still held off the job's own rows and shows all three; it refuses an amount above the balance held in its own words. The release date is the person's own words if they gave one, otherwise today. Does NOT withhold retainage (each invoice does that at the job's rate), does not change the job's retainage rate or expected completion date, does not log a payment against an invoice, does not send anything to the GC, and does not delete or edit a release already logged.",
  capability: "MANAGE_BILLING",
  tier: "T3_MONEY_EVIDENCE",
  mode: "DIRECT",
  action: "createRetainageRelease",
  core: "createRetainageReleaseRecord",
  title: "Log the retainage release",
  verb: "Reading the retainage held",
  button: "Log release",
  input_schema: {
    type: "object",
    properties: {
      jobName: { type: "string", description: "The job the retainage is held on, as the person named it. Required." },
      amount: {
        type: "string",
        description:
          "The amount released exactly as the person said it, digits only, e.g. 12500 or 12,500.00. Never compute, round or complete it. OMIT it when the person asked for the retainage held, the balance, or all of it without giving a figure — the app then uses the full balance.",
      },
      releasedAt: {
        type: "string",
        description:
          "When the GC released it, in the person's exact words, e.g. 'September 8', '9/8', 'yesterday', 'today'. Omit if they did not say when; the app then uses today.",
      },
      note: {
        type: "string",
        description: "A check number, remittance reference or anything else the person said about the release, in their words. Omit if nothing.",
      },
    },
  },
  continuationKeys: ["jobId"],
  resolve: resolveReleaseRetainage,
  execute: executeReleaseRetainage,
};

export const retainageCommands: DirectCommandDefinition[] = [releaseRetainageCommand];
