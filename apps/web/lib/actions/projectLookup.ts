"use server";

import {
  researchProject,
  RESEARCH_FIELD_LABELS,
  RESEARCH_MAX_SEARCHES,
  RESEARCH_PROMPT_VERSION,
} from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { aiGate } from "@/lib/ai/settings";
import { recordAskUsage } from "@/lib/ask/usage";
import type { ActionResultWith } from "@/lib/actions/shared";
import { suggestionsFrom, type WebSuggestion } from "@/lib/ask/webSuggestions";

/**
 * LOOK UP ONE PROJECT ON THE PUBLIC WEB, FOR THE CHASE LIST.
 *
 * `BID_RESEARCH` has existed and been gated and metered since step 0, and until
 * now it was reachable from exactly one place: the Ask box, inside the start-a-bid
 * command. An audit of the estimating lane on 2026-10-01 put it at 2 of 4 — a real
 * prompt, a real gate, no control anywhere and no eval. So a contractor who did
 * not know to phrase a sentence to the assistant could not use it at all.
 *
 * This is the control. `/pipeline` is where it goes because that page's own header
 * says what it is for — "what we are chasing before anybody invites us" — and the
 * seven fields this feature can return map almost exactly onto `BidPursuit`:
 * owner, architect, GCs bidding, bid date. Research is worth most BEFORE an
 * invitation, which is also when the contractor has least: a project name heard
 * from somebody, and a city.
 *
 * ── THIS ACTION WRITES NOTHING, AND THAT IS THE DESIGN ──
 *
 * It returns suggestions. The person ticks what they believe and submits the
 * ORDINARY pursuit form, so the only write goes through `createBidPursuit`, which
 * already validates every field and already refuses without MANAGE_ESTIMATING.
 * There is deliberately no "apply this to the database" path of its own: a second
 * writer for the same rows is how two validators drift apart.
 *
 * It also means nothing is stored about a lookup that nobody acted on, which is
 * the right default for a search over somebody else's project.
 *
 * ── THE PRIVACY BOUNDARY, RESTATED HERE BECAUSE THIS IS THE NEW DOOR TO IT ──
 *
 * `research.ts` says it and enforces it by signature: the project name and the
 * location, exactly as the person typed them, and nothing else. No company name,
 * no GC, no job list, no prior turns. This action adds no argument to that call
 * and must never grow one — in particular it must never "helpfully" pass the
 * company's own name or trade to narrow a search, because that sends a fact about
 * this contractor's books to a web search in exchange for a slightly better query.
 *
 * Both inputs come from the form, so the person can see exactly what leaves.
 */

/**
 * The same sentence every estimating action refuses with, word for word.
 *
 * Not a style point: `action-capability-guards.test.ts` recognises a capability
 * refusal by the shared phrase "part of your job function", and asserting on
 * that rather than on "it failed" is the whole point of the census — an action
 * handed junk arguments fails for a dozen reasons and only one of them is the
 * one under test. A refusal in my own words looked identical to no refusal at
 * all, and the census said so.
 */
const NOT_YOURS =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

/** Long enough to be a project, short enough not to be a paste of a bid package. */
const MAX_INPUT_CHARS = 200;

function field(formData: FormData, name: string): string {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw.trim().slice(0, MAX_INPUT_CHARS) : "";
}

/**
 * NAMED RATHER THAN INLINE IN THE SIGNATURE, and not for tidiness.
 *
 * `action-capability-guards.test.ts` finds an action's body by taking the first
 * `{` after `export async function <name>` and matching braces from there. An
 * inline object type in the return annotation — `ActionResultWith<{ … }>` — is
 * that first brace, so the "body" it reads is the signature, and the capability
 * check inside the real body is invisible to it. The census then reports this
 * action as unguarded when it is guarded.
 *
 * It fails in the SAFE direction (a false alarm, never a false pass), so this is
 * a named type rather than a change to a shared guard. Worth knowing about,
 * because the tempting way to silence that alarm is to add the action to the
 * census's own exception list, which would exempt it for real.
 */
export type ProjectLookupFound = { suggestions: WebSuggestion[]; searches: number };

export async function lookUpProject(formData: FormData): Promise<ActionResultWith<ProjectLookupFound>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) {
    return { ok: false, error: NOT_YOURS };
  }

  const projectName = field(formData, "projectName");
  const location = field(formData, "location");
  if (!projectName) return { ok: false, error: "Give the project's name." };
  // REFUSED BEFORE THE MODEL, not passed as a blank. `research.ts` does not call
  // the API without a location at all — a nationwide search for a project name is
  // how a different state's project with the same name comes back looking right.
  if (!location) {
    return {
      ok: false,
      error: "Give a city or state as well — without one, another project of the same name looks like a match.",
    };
  }

  // THE PER-COMPANY SWITCH, before any spend. A refusal is returned and never
  // thrown: production redacts a thrown Server Action message to a digest, so a
  // feature somebody turned off would reach the person as a dead button.
  const gate = await aiGate(context.company.id, "BID_RESEARCH");
  if (!gate.ok) return { ok: false, error: gate.error };

  const result = await researchProject({
    projectName,
    location,
    maxSearches: RESEARCH_MAX_SEARCHES,
    model: gate.model,
  });

  // REPORTED BEFORE THE RESULT IS READ, and web search is billed per search on
  // top of tokens — so a lookup that found nothing still cost money and a ledger
  // counting only the useful ones understates the bill.
  await recordAskUsage({
    companyId: context.company.id,
    userId: context.id,
    model: gate.model,
    usage: result.usage,
    outcome: result.ok ? "answered" : `error:${result.reason}`,
    feature: "bid-research",
    promptVersion: RESEARCH_PROMPT_VERSION,
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "unavailable"
          ? "Web search isn't available for this workspace, so there is nothing to show."
          : "The lookup couldn't be completed. Try again in a moment.",
    };
  }

  // Through the SAME validator the Ask card uses, rather than mapped by hand:
  // it drops a suggestion that lost its sources, which is the one thing this
  // feature promises never to display.
  const suggestions = suggestionsFrom(
    result.suggestions.map((found) => ({
      key: found.field,
      label: RESEARCH_FIELD_LABELS[found.field],
      value: found.value,
      sources: found.sources,
    })),
  );

  return { ok: true, value: { suggestions, searches: result.searches } };
}
