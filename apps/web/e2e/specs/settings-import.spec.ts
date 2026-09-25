import path from "node:path";
import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { dataTour } from "../lib/dataTour";
import { HealthMonitor, expectHealthy } from "../lib/health";

// __dirname, not import.meta.url — see playwright.config.ts's comment on
// the same choice: Playwright loads .ts specs as CJS here.
const badFile = path.resolve(__dirname, "../fixtures/bad-file.xls");

/**
 * /settings/import: owner-only. MAIN is seeded as OWNER (lib/seedDatabase.ts).
 * Nothing here submits Confirm, so nothing is written — the
 * preview→Confirm convention means choosing a file only populates a text
 * preview client-side.
 *
 * WHY EVERY TEST HERE NOW CALLS `expectHealthy`, and it is the useful half
 * of this file's history. #495 recorded this spec's failure as
 * "/settings/import still hits the error boundary", and it never did: the
 * failure was a Playwright STRICT MODE violation in the locator on the line
 * below, thrown before the page was ever read. A boundary and an ambiguous
 * selector are opposite defects — one is a broken page, one is a broken
 * spec — and nothing in this file could tell them apart, so a note saying
 * the page was broken sat on main for two weeks pointing at the wrong half
 * of the product. `expectHealthy` is the assertion that CAN tell them
 * apart: it reads the rendered page for this app's own boundary copy and
 * fails naming the sentence it found.
 */
test.describe("/settings/import", () => {
  // Attached before the first navigation, so an uncaught exception on the
  // way in is recorded rather than missed — see lib/health.ts.
  let monitor: HealthMonitor;

  test.beforeEach(async ({ page }) => {
    monitor = new HealthMonitor(page);
    await signInAs(page, PERSONAS.main.email);
    await page.goto("/settings/import");
    await expectHealthy(page, "/settings/import", { monitor });
  });

  test("the import boxes render", async ({ page }) => {
    // THE BOX HEADING, BY ROLE. `getByText("Clients")` is what this asserted
    // until today, and a bare string handed to `getByText` is a
    // case-insensitive SUBSTRING match — so inside the clients box it
    // matched both the `<h2>Clients</h2>` and the `Import clients` button
    // (components/SpreadsheetImport.tsx renders both from one `COPY` entry),
    // resolved to two elements, and died in strict mode. All three lines had
    // it: "Jobs" is inside "Import jobs" and "Crew" inside "Import crew".
    // `getByRole(…, { name })` matches the whole accessible name, so the
    // heading is the only thing each of these can reach.
    await expect(
      page.locator(dataTour("import-clients")).getByRole("heading", { name: "Clients" }),
    ).toBeVisible();
    await expect(page.locator(dataTour("import-jobs")).getByRole("heading", { name: "Jobs" })).toBeVisible();
    await expect(page.locator(dataTour("import-crew")).getByRole("heading", { name: "Crew" })).toBeVisible();
  });

  test("choosing an old .xls file shows the refusal sentence", async ({ page }) => {
    await page.locator(dataTour("import-clients")).getByRole("button", { name: "Import clients" }).click();

    const fileInput = page.getByLabel("Choose a spreadsheet or phone-contacts file of clients");
    await fileInput.setInputFiles(badFile);

    await expect(
      page.getByText(
        "That is an older Excel file (.xls). In Excel choose File → Save As and pick Excel Workbook (.xlsx), then choose that file here — it works as-is.",
      ),
    ).toBeVisible();
  });
});
