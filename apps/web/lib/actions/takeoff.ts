"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
import { isBlank, labelFromKey, parseNumericInput } from "@/lib/numeric-input";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { TakeoffLine } from "@/lib/takeoff";
import { recipeLines, type RecipeArgs, type RecipeInput } from "@/lib/takeoff-recipes";
import { actionFail, actionOk, assertEditableDirectly, assertJobInCompany, type ActionResult } from "./shared";

/**
 * The Estimate tab's refusal, in the house voice. The estimate tab and the
 * bid wizard's pricing step both withhold their content on VIEW_JOB_COSTS, so
 * every write they post asserts that same capability — not MANAGE_ESTIMATING,
 * which would newly refuse an ACCOUNTING member who holds VIEW_JOB_COSTS and
 * can reach these controls today (issue #383).
 */
const JOB_COSTS_ONLY =
  "A job's costs and pricing aren't part of your job function. The account owner sets who sees what, on the Team page.";

/**
 * Creates line items from a takeoff recipe — walls, ceilings, paint, flooring
 * or fixture counts — dispatched by the `recipe` field.
 *
 * THE QUANTITIES ARE RECOMPUTED HERE, from the raw measurements, and never
 * taken from the form. The screen shows a live preview (which runs the same
 * pure `recipeLines` over the same inputs), but a quantity posted from a
 * client is a number a client chose, and these end up in a bid.
 *
 * Lines are created UNPRICED, exactly like the wall/ceiling path this
 * generalises: a takeoff produces quantities, not rates, and filling in a
 * unit price nobody entered is the guess this codebase refuses everywhere
 * else — the estimator prices them, or pulls a price across from the catalog.
 */
export async function addTakeoffLines(jobId: string, formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  if (!can(context, "VIEW_JOB_COSTS")) return actionFail(JOB_COSTS_ONLY);
  const { company } = context;
  const job = await assertJobInCompany(jobId, company.id);
  assertEditableDirectly(job);

  const recipeId = String(formData.get("recipe") ?? "wall");
  const label = String(formData.get("label") ?? "").trim();

  // A FIGURE THIS CANNOT READ IS NAMED, rather than becoming a zero. Every
  // measurement used to go through `Number(...)` and fall back to 0 on
  // anything it disliked, so a length of `2,800` — the thousands comma a
  // contractor writes without thinking — produced no quantities and the
  // message below blamed "the measurements". Five recipes inherited that
  // when #418 generalised the two. Parsing is `lib/numeric-input.ts` now,
  // the same one the Qty box beside this form uses.
  const problems: string[] = [];
  const lines = parseTakeoffLines(recipeId, formData, problems).filter((line) => line.quantity > 0);
  if (problems.length > 0) return actionFail(problems[0]);
  if (lines.length === 0) {
    // RETURNED, not thrown: production redacts a thrown Server Action message
    // to a digest, so throwing here would put "an error occurred" on screen
    // for a person who simply left a field blank.
    return actionFail("Those measurements produce no quantities — check the numbers.");
  }

  await prisma.$transaction(
    lines.map((line) =>
      prisma.jobLineItem.create({
        data: {
          jobId,
          // The label names WHERE it was measured. Without it a bid with four
          // takeoffs on it has four lines called "Paint" and no way to tell
          // which room any of them came from.
          description: label ? `${label} — ${line.label}` : line.label,
          unit: line.unit,
          quantity: line.quantity,
        },
      }),
    ),
  );

  revalidatePath(`/jobs/${jobId}`);
  return actionOk;
}

/**
 * Turns a form post into material lines, recomputed server-side. Mirrors the
 * client preview, which runs the same `recipeLines` over the same inputs —
 * the only difference is where the numbers were read from.
 */
function parseTakeoffLines(
  recipeId: string,
  formData: FormData,
  problems: string[],
): TakeoffLine[] {
  /** A field name as it reads on the form, for a refusal somebody acts on. */
  const LABELS: Record<string, string> = {
    lengthFt: "Length",
    widthFt: "Width",
    heightFt: "Height",
    areaSqFt: "Area",
    perimeterFt: "Perimeter",
    spacingIn: "Stud spacing",
    wastePercent: "Waste",
    coats: "Coats",
    coverageSqFtPerGal: "Coverage",
    openingWidth: "An opening width",
    openingHeight: "An opening height",
    fixtureCount: "A fixture count",
  };

  /** Blank stays 0 — unchanged, and still refused upstream as "no
   * quantities". A figure that is not blank and not readable is RECORDED,
   * so the refusal can name the field instead of the measurements. */
  const num = (key: string): number => read(formData.get(key), key) ?? 0;

  /** A recipe ARGUMENT: blank still reads as undefined so the recipe's own
   * default wins (waste 10%, two coats, 16" stud spacing) rather than a
   * hidden override the form never showed.
   *
   * WHAT CHANGED, and it is a judgement worth seeing: a value that is not
   * blank but cannot be read used to ALSO fall back to the default, so
   * typing `1,0` into Waste quietly bid at 10% instead. Blank still means
   * "use the default"; a typo now says so. */
  const optionalNum = (key: string): number | undefined => {
    const value = read(formData.get(key), key);
    return value === null || value <= 0 ? undefined : value;
  };

  /** null for blank or unreadable; the unreadable case appends a sentence. */
  function read(raw: FormDataEntryValue | null, key: string): number | null {
    if (isBlank(raw)) return null;
    const parsed = parseNumericInput(raw, { label: LABELS[key] ?? labelFromKey(key), min: 0 });
    if (!parsed.ok) {
      problems.push(parsed.error);
      return null;
    }
    return parsed.n;
  }

  switch (recipeId) {
    case "wall": {
      // Openings arrive as parallel arrays. A pair with either side missing
      // is dropped rather than treated as zero: a half-typed opening is an
      // unfinished thought, and deducting it as 0 x height would silently do
      // nothing while looking like it counted.
      const widths = formData.getAll("openingWidth").map((v) => read(v, "openingWidth") ?? NaN);
      const heights = formData.getAll("openingHeight").map((v) => read(v, "openingHeight") ?? NaN);
      const openings = widths
        .map((widthFt, i) => ({ widthFt, heightFt: heights[i] }))
        .filter(
          (o) => Number.isFinite(o.widthFt) && Number.isFinite(o.heightFt) && o.widthFt > 0 && o.heightFt > 0,
        );
      const spacingIn = optionalNum("spacingIn");
      const args: RecipeArgs = {
        wastePercent: optionalNum("wastePercent"),
        spacingFt: spacingIn !== undefined ? spacingIn / 12 : undefined,
      };
      return recipeLines(
        "wall",
        [
          {
            kind: "wall",
            wall: {
              lengthFt: num("lengthFt"),
              heightFt: num("heightFt"),
              sides: String(formData.get("sides")) === "1" ? 1 : 2,
              openings,
            },
          },
        ],
        args,
      );
    }
    case "ceiling":
      return recipeLines(
        "ceiling",
        [{ kind: "ceiling", ceiling: { lengthFt: num("lengthFt"), widthFt: num("widthFt") } }],
        { wastePercent: optionalNum("wastePercent") },
      );
    case "paint":
      return recipeLines("paint", [{ kind: "area", squareFeet: num("areaSqFt") }], {
        coats: optionalNum("coats"),
        coverageSqFtPerGal: optionalNum("coverageSqFtPerGal"),
      });
    case "flooring": {
      const inputs: RecipeInput[] = [{ kind: "area", squareFeet: num("areaSqFt") }];
      const perimeter = num("perimeterFt");
      if (perimeter > 0) inputs.push({ kind: "linear", feet: perimeter });
      return recipeLines("flooring", inputs, { wastePercent: optionalNum("wastePercent") });
    }
    case "fixture-count": {
      // The recipe decides what a valid count is (non-empty name, positive
      // count); here we only coerce the form fields into primitives.
      const names = formData.getAll("fixtureName").map((v) => String(v).trim());
      const counts = formData.getAll("fixtureCount").map((v) => read(v, "fixtureCount") ?? NaN);
      return recipeLines(
        "fixture-count",
        names.map((item, i) => ({ kind: "count" as const, item, count: counts[i] })),
        {},
      );
    }
    default:
      return [];
  }
}
