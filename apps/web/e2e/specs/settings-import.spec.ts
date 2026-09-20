import path from "node:path";
import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { dataTour } from "../lib/dataTour";

// __dirname, not import.meta.url — see playwright.config.ts's comment on
// the same choice: Playwright loads .ts specs as CJS here.
const badFile = path.resolve(__dirname, "../fixtures/bad-file.xls");

/**
 * /settings/import: owner-only. MAIN is seeded as OWNER (lib/seedDatabase.ts).
 * Nothing here submits Confirm, so nothing is written — the
 * preview→Confirm convention means choosing a file only populates a text
 * preview client-side.
 */
test.describe("/settings/import", () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, PERSONAS.main.email);
    await page.goto("/settings/import");
  });

  test("the import boxes render", async ({ page }) => {
    await expect(page.locator(dataTour("import-clients")).getByText("Clients")).toBeVisible();
    await expect(page.locator(dataTour("import-jobs")).getByText("Jobs")).toBeVisible();
    await expect(page.locator(dataTour("import-crew")).getByText("Crew")).toBeVisible();
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
