"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@prova/db";
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

  const lines = parseTakeoffLines(recipeId, formData).filter((line) => line.quantity > 0);
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
function parseTakeoffLines(recipeId: string, formData: FormData): TakeoffLine[] {
  // A REQUIRED measurement: blank reads as 0, which produces no quantities
  // and is refused upstream.
  const num = (key: string): number => {
    const raw = Number(String(formData.get(key) ?? ""));
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  };
  // A recipe ARGUMENT: blank reads as undefined so the recipe's own default
  // wins (waste 10%, two coats, 16" stud spacing) rather than a hidden
  // override the form never showed.
  const optionalNum = (key: string): number | undefined => {
    const raw = String(formData.get(key) ?? "").trim();
    if (raw === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  switch (recipeId) {
    case "wall": {
      // Openings arrive as parallel arrays. A pair with either side missing
      // is dropped rather than treated as zero: a half-typed opening is an
      // unfinished thought, and deducting it as 0 x height would silently do
      // nothing while looking like it counted.
      const widths = formData.getAll("openingWidth").map((v) => Number(v));
      const heights = formData.getAll("openingHeight").map((v) => Number(v));
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
      const counts = formData.getAll("fixtureCount").map((v) => Number(v));
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
