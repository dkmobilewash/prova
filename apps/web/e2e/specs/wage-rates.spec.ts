import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { E2E_TAG } from "../lib/seedDatabase";
import { HealthMonitor, expectHealthy } from "../lib/health";

/**
 * THE RATES A DETERMINATION PUBLISHES, clicked.
 *
 * #598 reversed a decision written into the schema — "there is no rate
 * column and none is planned" — and shipped with 547 files of unit tests
 * green and NOBODY HAVING TYPED A RATE IN. This is that typing.
 *
 * The assertion worth the whole file is the REFUSAL one. `formActionCensus`
 * caught the first version of this component using `<form action={…}>`,
 * which in React 19 resets the form BEFORE the action runs — so "a base
 * wage of 0 is not a rate" would have arrived over six emptied boxes, after
 * somebody had copied those figures off a government PDF. The census can
 * see the shape of the code. Only a browser can see that the figures are
 * still on screen when the refusal lands, which is what step 3 asserts.
 */
test("a determination carries its rates, and a refusal keeps what you typed", async ({ page }) => {
  const monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.main.email);

  await page.goto("/schedule");
  await page.getByRole("link", { name: new RegExp(`${E2E_TAG} Seeded Job`) }).first().click();
  await page.waitForURL(/\/jobs\/[^/]+$/);
  const jobPath = new URL(page.url()).pathname;

  // 1. the Compliance tab renders at all
  await page.goto(`${jobPath}/compliance`);
  await expectHealthy(page, "compliance tab", { monitor });
  await expect(
    page.getByRole("heading", { name: "Prevailing wage determination", exact: true }),
  ).toBeVisible();

  // 2. attach a determination — a link is enough, per the form's own copy
  await page.getByPlaceholder("e.g. California, federal (Davis-Bacon)").fill("Nevada");
  await page.getByPlaceholder("https://sam.gov/...").fill("https://sam.gov/e2e-wage-rates");
  await page.getByRole("button", { name: "Attach" }).click();
  await expect(page.getByText("Nevada", { exact: true }).first()).toBeVisible();

  // The empty state says what the absence COSTS, rather than just "none".
  await expect(page.getByText(/No rates recorded off this determination yet/)).toBeVisible();

  // 3. THE REFUSAL, AND WHAT SURVIVES IT.
  await page.getByRole("button", { name: /Add a rate from this determination/ }).click();
  const classification = page.getByPlaceholder("Drywall Finisher/Taper");
  const baseWage = page.getByPlaceholder("52.34");
  await classification.fill("Drywall Finisher/Taper");
  await baseWage.fill("0");
  await page.getByRole("button", { name: "Save rate" }).click();

  await expect(page.getByText(/A base wage of 0 is not a rate/)).toBeVisible();
  // THE POINT: the refusal arrived over the figures, not over an emptied
  // form. A `<form action={…}>` would have blanked both of these first.
  await expect(classification, "the classification was wiped by the refusal").toHaveValue(
    "Drywall Finisher/Taper",
  );
  await expect(baseWage, "the base wage was wiped by the refusal").toHaveValue("0");

  // 4. a real rate saves, and currency furniture is accepted rather than refused
  await baseWage.fill("$52.34");
  await page.getByPlaceholder("optional").first().fill("1,200.00");
  await page.getByRole("button", { name: "Save rate" }).click();

  await expect(page.getByRole("cell", { name: "Drywall Finisher/Taper" })).toBeVisible();
  // Unmapped is a legitimate state, not an error: the document's names
  // are not ours.
  await expect(page.getByText("not mapped to a craft")).toBeVisible();
  await expectHealthy(page, "compliance tab after saving a rate", { monitor });

  // 5. NULL IS NOT ZERO. An omitted fringe renders as a dash, never $0.00 —
  // "the document does not say" and "the document says none" are different
  // facts and a pay clerk acts differently on each.
  const row = page.getByRole("row", { name: /Drywall Finisher\/Taper/ });
  await expect(row.getByText("—")).toHaveCount(3);
});

/**
 * The alerts #599 moved onto the pages their subject lives on.
 *
 * The assertion that matters is the NEGATIVE one: with nothing outstanding
 * the component must render NOTHING, not an empty box announcing it has
 * nothing to say. That is the half a unit test cannot check, because what
 * is wrong with an empty box is how it looks on a clean page.
 */
test("page alerts render where their subject lives, and nothing when there is nothing", async ({
  page,
}) => {
  const monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.main.email);

  await page.goto("/wip");
  await expectHealthy(page, "wip", { monitor });
  await expect(page.getByRole("heading", { name: "Work in progress" })).toBeVisible();
  // No alerts outstanding on the seeded company -> no section at all.
  await expect(page.getByLabel("Alerts about this")).toHaveCount(0);
});
