import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, heading, next, waitForHydration, walkToSend } from "./walk";

/**
 * URL PRE-FILL (Diego, 2026-10-14), in a real browser at phone and desktop
 * width. The unit tests in apps/lien-waiver/lib/prefill.test.ts prove the
 * mapping for all sixteen forms; these prove a person opening a link sees
 * it: the picker skipped, the values in their blanks and editable, nothing
 * sent on its own, and the tracking code nowhere on screen but on the lead.
 */

// Diego's example link, exactly as he wrote it.
const EXAMPLE = "start?state=CA&company=Test%20Drywall%20Inc&gc=Test%20GC&ref=TEST-0001";

/** Collected on every screen: the ref must never be readable on the page. */
async function expectNoRef(page: Page, ref: string) {
  expect(await page.locator("body").innerText()).not.toContain(ref);
  expect(await page.locator("main").innerHTML()).not.toContain(ref);
}

test("the example link: picker skipped, blanks filled and editable, ref carried to the lead only", async ({ page }) => {
  const errors = collectPageErrors(page);
  const events: unknown[] = [];
  const posted: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (request.url().endsWith("/api/prefill-opened")) events.push(request.postDataJSON());
    if (request.url().endsWith("/api/waiver")) posted.push(request.postDataJSON());
  });

  // What this browser already remembers, from an earlier waiver of its own.
  await page.goto("start");
  await page.evaluate(() => localStorage.setItem("lien-waiver:fields:v1", JSON.stringify({ companyName: "Old Co LLC", customer: "Old GC" })));

  await page.goto(EXAMPLE);
  // Straight to California, carrying the link's values -- and `state` itself
  // is not forwarded, it has done its job.
  await expect(page).toHaveURL(/\/lien-waiver\/california\?company=Test\+Drywall\+Inc&gc=Test\+GC&ref=TEST-0001$/);
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Pick your state" })).toHaveCount(0);
  await expect(heading(page)).toHaveText("Waiver Type");

  // No `type` in the link, so the person answers as always; nothing is picked.
  for (const radio of await page.locator("input[type=radio]").all()) await expect(radio).not.toBeChecked();
  await expectNoRef(page, "TEST-0001");
  await expect.poll(() => events).toEqual([{ ref: "TEST-0001", state: "CA" }]);

  // Nothing was sent on its own.
  expect(posted).toEqual([]);

  await page.getByLabel("A progress payment").check();
  await page.getByLabel("Not yet").check();
  await next(page);

  // Your Company: the link's company, over what memory had, and editable.
  await expect(heading(page)).toHaveText("Your Company");
  const company = page.locator("#field-companyName");
  await expect(company).toHaveValue("Test Drywall Inc");
  await company.fill("Test Drywall Inc.");
  await expect(company).toHaveValue("Test Drywall Inc.");
  await expectNoRef(page, "TEST-0001");

  // Memory has NOT been overwritten by the link, or by the edit, yet.
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("lien-waiver:fields:v1") ?? "{}"));
  expect(before).toMatchObject({ companyName: "Old Co LLC", customer: "Old GC" });

  await next(page);
  await expect(heading(page)).toHaveText("Project Details");
  await expect(page.locator("#field-customer")).toHaveValue("Test GC");
  await expectNoRef(page, "TEST-0001");

  const screens = await walkToSend(page);
  expect(screens.at(-1)).toBe("Get Your PDF");
  await expect(page.locator("#send-company")).toHaveValue("Test Drywall Inc");
  await expect(page.locator("#send-email")).toHaveValue("");
  await expectNoRef(page, "TEST-0001");

  await page.locator("#send-name").fill("Pat Sub");
  await page.locator("#send-email").fill("pat@example.com");
  await page.getByRole("button", { name: "Email me the PDF" }).click();
  await expect(heading(page)).toHaveText("Check Your Inbox");
  await expectNoRef(page, "TEST-0001");

  // The ref went with the waiver, for the lead.
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ state: "CA", ref: "TEST-0001", company: "Test Drywall Inc" });
  expect((posted[0].fills as Record<string, string>).companyName).toBe("Test Drywall Inc.");

  // Sending is what makes the link's values this browser's own.
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("lien-waiver:fields:v1") ?? "{}"));
  expect(after).toMatchObject({ companyName: "Test Drywall Inc.", customer: "Test GC" });

  expect(errors).toEqual([]);
});

test("type= pre-selects the answers but still shows the waiver-type screen and its warnings", async ({ page }) => {
  await page.goto("start?state=AZ&type=uf&owner=Mesa%20Partners&project=Mesa%20Medical&address=1%20Main%20St&ref=SD-PL-0001");
  await expect(page).toHaveURL(/\/lien-waiver\/arizona\?/);
  await waitForHydration(page);
  await expect(heading(page)).toHaveText("Waiver Type");
  await expect(page.getByLabel("The final payment")).toBeChecked();
  await expect(page.getByLabel("Yes, it has cleared")).toBeChecked();
  // The warnings for an unconditional, final waiver are on screen, as always.
  await expect(page.getByText("Unconditional waiver", { exact: false }).first()).toBeVisible();
  await expect(page.locator(".bg-warn-ground")).toHaveCount(2);
  // And the answer can still be changed.
  await page.getByLabel("Not yet").check();
  await expect(page.getByLabel("Not yet")).toBeChecked();
  await page.getByLabel("Yes, it has cleared").check();

  await next(page);
  // No `company` in this link, so the required blank is empty and Next holds
  // -- a link fills blanks, it never skips the checks on them.
  await expect(heading(page)).toHaveText("Your Company");
  await next(page);
  await expect(heading(page)).toHaveText("Your Company");
  await page.locator("#field-companyName").fill("Desert Drywall LLC");
  await next(page);
  await expect(heading(page)).toHaveText("Project Details");
  await expect(page.locator("#field-owner")).toHaveValue("Mesa Partners");
  await expect(page.locator("#field-project")).toHaveValue("Mesa Medical");
  // Arizona has no separate location blank: the address goes in "located at".
  await expect(page.locator("#field-jobDescription")).toHaveValue("1 Main St");
});

test("an unknown state falls back to the picker, still carrying the link's values", async ({ page }) => {
  await page.goto("start?state=ZZ&company=Acme%20Drywall");
  await expect(page).toHaveURL(/\/lien-waiver\/start\?state=ZZ/);
  await expect(page.getByRole("heading", { name: "Pick your state" })).toBeVisible();
  await page.getByRole("link", { name: /^Nevada/ }).click();
  await expect(page).toHaveURL(/\/lien-waiver\/nevada\?company=Acme\+Drywall$/);
  await waitForHydration(page);
  await page.getByLabel("A progress payment").check();
  await page.getByLabel("Not yet").check();
  await next(page);
  await expect(page.locator("#field-companyName")).toHaveValue("Acme Drywall");
});

test("email, phone and script are not taken from a link", async ({ page }) => {
  const errors = collectPageErrors(page);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const evil = encodeURIComponent("<script>alert('x')</script>Test Drywall Inc");
  const long = "x".repeat(400);
  await page.goto(`start?state=TX&company=${evil}&gc=${long}&email=someone%40example.com&phone=5555551234`);
  // The unknown keys are not even carried to the state page.
  await expect(page).toHaveURL(/\/lien-waiver\/texas\?company=[^&]+&gc=x+$/);
  await waitForHydration(page);
  await page.getByLabel("A progress payment").check();
  await page.getByLabel("Not yet").check();
  await next(page);
  await expect(page.locator("#field-companyName")).toHaveValue("Test Drywall Inc");
  await next(page);
  await expect(page.locator("#field-customer")).toHaveValue("x".repeat(120));
  await walkToSend(page);
  await expect(page.locator("#send-email")).toHaveValue("");
  expect(await page.locator("body").innerText()).not.toMatch(/5555551234|someone@example\.com/);
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});
