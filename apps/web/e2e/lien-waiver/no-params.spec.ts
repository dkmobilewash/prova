import { expect, test } from "@playwright/test";
import { collectPageErrors, heading, waitForHydration, walkToSend } from "./walk";

/**
 * THE REGRESSION GUARD FOR URL PRE-FILL (Diego, 2026-10-14): a person who
 * opens the tool WITHOUT any parameters gets exactly what they got before
 * pre-fill existed -- the state picker, the same screens, the same browser
 * memory, the same request to the server. Written and run BEFORE pre-fill
 * was built, then again after it, so it describes the tool as it was rather
 * than as the new code happens to behave.
 */

test("no parameters: picker, every screen, a sent waiver, and the browser remembers", async ({ page }) => {
  const errors = collectPageErrors(page);
  const posted: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/waiver")) posted.push(request.postDataJSON());
  });

  // The picker, with its states, and nothing skipped.
  await page.goto("start");
  await expect(page).toHaveURL(/\/lien-waiver\/start$/);
  await expect(page.getByRole("heading", { name: "Pick your state" })).toBeVisible();
  for (const name of ["Arizona", "California", "Nevada"]) await expect(page.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();

  await page.getByRole("link", { name: /^Arizona/ }).click();
  await expect(page).toHaveURL(/\/lien-waiver\/arizona$/);
  await waitForHydration(page);

  // Nothing is pre-selected and nothing is filled in.
  await expect(heading(page)).toHaveText("Waiver Type");
  for (const radio of await page.locator("input[type=radio]").all()) await expect(radio).not.toBeChecked();
  await page.getByLabel("A progress payment").check();
  await page.getByLabel("Not yet").check();
  await expect(page.getByText("Conditional waiver", { exact: false }).first()).toBeVisible();

  const screens = await walkToSend(page);
  expect(screens).toEqual(["Waiver Type", "Your Company", "Project Details", "Payment Details", "Last Details", "Read Your Waiver", "Get Your PDF"]);

  await page.locator("#send-name").fill("Pat Sub");
  await page.locator("#send-email").fill("pat@example.com");
  await page.getByRole("button", { name: "Email me the PDF" }).click();
  await expect(heading(page)).toHaveText("Check Your Inbox");

  // The request carries what it always carried and nothing new.
  expect(posted).toHaveLength(1);
  expect(Object.keys(posted[0]).sort()).toEqual(["company", "email", "fills", "form", "marketingOptIn", "name", "returning", "state", "website"]);
  expect(posted[0]).toMatchObject({ state: "AZ", form: "CONDITIONAL_PROGRESS", returning: false, email: "pat@example.com" });

  // Browser memory works as before: answers saved as they were typed, the
  // contact saved once the server accepted it.
  const memory = await page.evaluate(() => ({
    fields: JSON.parse(localStorage.getItem("lien-waiver:fields:v1") ?? "{}"),
    contact: JSON.parse(localStorage.getItem("lien-waiver:contact:v1") ?? "null"),
  }));
  expect(memory.fields.companyName).toBe("Test companyName");
  expect(memory.contact).toMatchObject({ email: "pat@example.com", name: "Pat Sub" });

  // And a second visit is filled in from that memory.
  await page.goto("arizona");
  await waitForHydration(page);
  await page.getByLabel("A progress payment").check();
  await page.getByLabel("Not yet").check();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator("#field-companyName")).toHaveValue("Test companyName");

  expect(errors).toEqual([]);
});
