/**
 * Turning a saved template into estimate lines.
 *
 * A sub bidding tenant improvements bids the same twelve lines every time.
 * Today each is added from the catalog one at a time, so the twelfth bid of
 * the month is typed exactly like the first.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * APPLYING A TEMPLATE APPENDS. IT NEVER SYNCS, AND IT NEVER REPLACES.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * This is the one thing to understand before changing anything here, and it
 * is a deliberate difference from the wall schedule, which looks similar and
 * is not. `syncWallScheduleLines` owns its lines: change a run's length and
 * it finds them by `wallTypeComponentId` and updates them in place. That is
 * right for a wall schedule, where the run IS the source of truth.
 *
 * A template is a STARTING POINT. Once applied, those lines belong to the
 * estimator, who will re-price them, split them, delete half and add three
 * more. So nothing here writes a back-link, and there is no "refresh from
 * template" — that button would silently overwrite the work somebody came to
 * the estimate to do.
 *
 * THE COST OF APPEND SEMANTICS, NAMED RATHER THAN HIDDEN: applying the same
 * template twice adds every line twice. That is a real way to send a bid out
 * double, so `templateApplication` reports which lines the estimate ALREADY
 * has before anything is written, and the screen shows it. Reported, not
 * refused — adding a second floor's worth on purpose is legitimate, and a
 * rule that guessed which case this was would be wrong half the time.
 *
 * Pure. No database, no React.
 */

export type TemplateItemInput = {
  id: string;
  description: string;
  unit: string | null;
  /** Null means "the takeoff decides" — see `quantityFor`. */
  defaultQuantity: number | null;
  catalogEntryId: string | null;
};

/** A line already on the estimate. Only what the comparison needs. */
export type ExistingLine = {
  description: string;
  isDeleted: boolean;
};

/** One row this application will create. Exactly the shape the writer needs,
 * and nothing else — no id, no price, no job. */
export type NewLine = {
  description: string;
  unit: string | null;
  quantity: number;
  catalogEntryId: string | null;
};

export type TemplateApplication = {
  lines: NewLine[];
  /** Descriptions this estimate already carries. The template still adds
   * them; this is what the screen says first. */
  alreadyPresent: string[];
  /** Null when there is nothing to warn about. */
  caution: string | null;
};

/**
 * THE QUANTITY A GENERATED LINE STARTS AT.
 *
 * A template item with no default becomes 1, never 0, and the difference is
 * the whole reason this is a named function rather than `?? 0`. A line
 * reading "1 SF" is obviously unfinished and gets fixed. A line reading
 * "0 SF" prices to nothing, and an estimate total that silently excludes it
 * looks finished. Being visibly wrong is the safe direction.
 *
 * 1 is also `JobLineItem.quantity`'s own schema default, so this agrees with
 * what the database would have done rather than inventing a second rule.
 */
export function quantityFor(defaultQuantity: number | null): number {
  if (defaultQuantity === null || !Number.isFinite(defaultQuantity)) return 1;
  if (defaultQuantity <= 0) return 1;
  return defaultQuantity;
}

const key = (description: string) => description.trim().toLowerCase();

/** "a, b and c" — the form the rest of the app's prose uses. */
function listOf(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * What applying this template to this estimate would do.
 *
 * Computed before anything is written so the screen can show it, which is the
 * same posture the takeoff form takes — a person sees what will be added
 * before they press the button, not after.
 *
 * Deleted lines are IGNORED in the comparison: a line the estimator removed
 * is one they decided against, and warning that the template "already has"
 * it would be arguing with that decision.
 */
export function templateApplication(
  items: TemplateItemInput[],
  existingLines: ExistingLine[],
): TemplateApplication {
  const live = new Set(
    existingLines.filter((line) => !line.isDeleted).map((line) => key(line.description)),
  );

  const lines: NewLine[] = items.map((item) => ({
    description: item.description.trim(),
    unit: item.unit,
    quantity: quantityFor(item.defaultQuantity),
    catalogEntryId: item.catalogEntryId,
  }));

  const alreadyPresent = items
    .filter((item) => live.has(key(item.description)))
    .map((item) => item.description.trim());

  return {
    lines,
    alreadyPresent,
    caution:
      alreadyPresent.length === 0
        ? null
        : alreadyPresent.length === items.length
          ? `This estimate already has every line in this template — ${listOf(alreadyPresent)}. Applying it again will add a second copy of each.`
          : `This estimate already has ${listOf(alreadyPresent)}. Applying the template adds ${alreadyPresent.length === 1 ? "a second copy" : "second copies"} rather than skipping ${alreadyPresent.length === 1 ? "it" : "them"}.`,
  };
}

/**
 * The trade an estimate is mostly about, from the lines already on it.
 *
 * A JOB HAS NO TRADE — `tradeScope` lives on `JobLineItem`, not on `Job`, so
 * there is nothing to read off the job itself. This is what gives
 * `templatesForTrade` something real to filter by; without it that function
 * would have no caller able to supply a trade, which is the
 * written-and-never-called shape this codebase keeps paying for.
 *
 * Returns null on an empty estimate — which is exactly when somebody reaches
 * for a template — and null means "offer everything". A tie also returns
 * null: guessing between two trades to hide half the library is worse than
 * showing all of it.
 */
export function dominantTradeScope(
  lines: { tradeScope: string | null; isDeleted: boolean }[],
): string | null {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line.isDeleted || !line.tradeScope) continue;
    counts.set(line.tradeScope, (counts.get(line.tradeScope) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [scope, count] of counts) {
    if (count > bestCount) {
      best = scope;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return tied ? null : best;
}

/** The templates worth offering on a bid of this trade. A template with no
 * trade is general and always offered; one with a trade is offered only on
 * its own. Never filters everything away silently — the caller shows the
 * full list when this returns nothing. */
export function templatesForTrade<T extends { tradeScope: string | null }>(
  templates: T[],
  tradeScope: string | null,
): T[] {
  if (!tradeScope) return templates;
  return templates.filter((template) => template.tradeScope === null || template.tradeScope === tradeScope);
}

/** What is wrong with a template as typed, or null. */
export function templateProblem(template: { name: string }): string | null {
  if (!template.name.trim()) {
    return "Give the template a name — what kind of job it is for, like “TI, metal stud + drywall”.";
  }
  return null;
}

/** What is wrong with one of its lines as typed, or null. */
export function templateItemProblem(item: {
  description: string;
  defaultQuantity: number | null;
}): string | null {
  if (!item.description.trim()) {
    return "Say what the line is. That is what will appear on the estimate.";
  }
  if (item.defaultQuantity !== null && !Number.isFinite(item.defaultQuantity)) {
    return "A default quantity has to be a number, or blank to let the takeoff decide.";
  }
  if (item.defaultQuantity !== null && item.defaultQuantity <= 0) {
    return "A default quantity of zero or less would price to nothing. Leave it blank instead — the line starts at 1 and is obviously unfinished.";
  }
  return null;
}
