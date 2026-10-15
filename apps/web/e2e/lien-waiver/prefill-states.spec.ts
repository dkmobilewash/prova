import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, fillEmptyBlanks, heading, next, waitForHydration } from "./walk";

/**
 * Every pre-fill parameter, in a real browser, for all four states
 * (Diego, 2026-10-15). Written after a live test of the example link showed
 * the company missing: prefill.spec.ts proved `company` and `gc` on
 * California only, and nothing proved `owner`, `project`, `address` or
 * `license` on any screen at all.
 *
 * The cause that test turned up is the last spec in this file: a phone
 * showed the page before its JavaScript ran, Next was tapped, and the
 * BROWSER submitted the step form itself -- a GET carrying only the two
 * radio answers, which dropped company=, gc= and ref=.
 */

const PARAMS = {
  type: "cp",
  company: "Test Drywall Inc",
  license: "123456",
  owner: "Test Owner",
  project: "Test Project",
  address: "123 Main St, San Diego",
  gc: "Test GC",
  ref: "TEST-0002",
};
const link = (state: string, extra: Record<string, string> = {}) =>
  `start?${new URLSearchParams({ state, ...PARAMS, ...extra }).toString()}`;

/** Where each value must land, read off each state's forms (lib/prefill.ts's
 * PREFILL_MAP, which prefill.test.ts checks against all sixteen forms).
 * `null` means that state's forms have no such blank, so the value must not
 * appear anywhere. */
const EXPECTED: Record<string, { slug: string; owner: string | null; project: string | null; address: string }> = {
  CA: { slug: "california", owner: "owner", project: null, address: "jobLocation" },
  AZ: { slug: "arizona", owner: "owner", project: "project", address: "jobDescription" },
  NV: { slug: "nevada", owner: null, project: "project", address: "jobLocation" },
  TX: { slug: "texas", owner: "owner", project: "project", address: "jobLocation" },
};

async function bodyText(page: Page) {
  return page.locator("body").innerText();
}

for (const [state, expected] of Object.entries(EXPECTED)) {
  test(`${state}: every parameter in its blank, editable, and the company on the send step`, async ({ page }) => {
    const errors = collectPageErrors(page);
    const posted: Array<Record<string, unknown>> = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/api/waiver")) posted.push(request.postDataJSON());
    });

    await page.goto(link(state));
    await expect(page).toHaveURL(new RegExp(`/lien-waiver/${expected.slug}\\?`));
    await waitForHydration(page);

    // type=cp pre-selects both answers; the screen itself is still shown.
    await expect(heading(page)).toHaveText("Waiver Type");
    await expect(page.getByLabel("A progress payment")).toBeChecked();
    await expect(page.getByLabel("Not yet")).toBeChecked();
    await next(page);

    // The claimant blank -- every state's form has one.
    await expect(heading(page)).toHaveText("Your Company");
    await expect(page.locator("#field-companyName")).toHaveValue(PARAMS.company);
    await next(page);

    await expect(heading(page)).toHaveText("Project Details");
    await expect(page.locator("#field-customer")).toHaveValue(PARAMS.gc);
    await expect(page.locator(`#field-${expected.address}`)).toHaveValue(PARAMS.address);
    if (expected.owner) await expect(page.locator(`#field-${expected.owner}`)).toHaveValue(PARAMS.owner);
    else expect(await bodyText(page)).not.toContain(PARAMS.owner);
    if (expected.project) await expect(page.locator(`#field-${expected.project}`)).toHaveValue(PARAMS.project);
    else expect(await bodyText(page)).not.toContain(PARAMS.project);

    // Editable: a typed value replaces the link's.
    await page.locator("#field-customer").fill("Another GC");
    await expect(page.locator("#field-customer")).toHaveValue("Another GC");

    // On to the send step, filling only what the link did not.
    for (let guard = 0; guard < 8 && (await heading(page).innerText()) !== "Get Your PDF"; guard += 1) {
      const title = await heading(page).innerText();
      if (title !== "Read Your Waiver") await fillEmptyBlanks(page);
      await next(page);
    }
    await expect(heading(page)).toHaveText("Get Your PDF");
    await expect(page.locator("#send-company")).toHaveValue(PARAMS.company);

    // No state has a licence blank, and the ref is never on screen.
    const text = await bodyText(page);
    expect(text).not.toContain(PARAMS.license);
    expect(text).not.toContain(PARAMS.ref);

    await page.locator("#send-name").fill("Pat Sub");
    await page.locator("#send-email").fill("pat@example.com");
    await page.getByRole("button", { name: "Email me the PDF" }).click();
    await expect(heading(page)).toHaveText("Check Your Inbox");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ state, ref: PARAMS.ref, company: PARAMS.company });
    expect((posted[0].fills as Record<string, string>).companyName).toBe(PARAMS.company);
    expect(errors).toEqual([]);
  });
}

for (const [label, saved] of [
  ["a different saved company", { fields: { companyName: "Old Co LLC" }, contact: { email: "a@b.com", name: "Pat", company: "Old Co LLC" } }],
  ["an empty saved company", { fields: { companyName: "" }, contact: { email: "a@b.com", name: "Pat", company: "" } }],
] as const) {
  test(`the link's company wins over ${label}, in the blank and on the send step`, async ({ page }) => {
    await page.goto("start");
    await page.evaluate((memory) => {
      localStorage.setItem("lien-waiver:fields:v1", JSON.stringify(memory.fields));
      localStorage.setItem("lien-waiver:contact:v1", JSON.stringify(memory.contact));
    }, saved);
    await page.goto(link("CA"));
    await waitForHydration(page);
    await next(page);
    await expect(page.locator("#field-companyName")).toHaveValue(PARAMS.company);
    for (let guard = 0; guard < 8 && (await heading(page).innerText()) !== "Get Your PDF"; guard += 1) {
      const title = await heading(page).innerText();
      if (title !== "Read Your Waiver") await fillEmptyBlanks(page);
      await next(page);
    }
    await expect(page.locator("#send-company")).toHaveValue(PARAMS.company);
    // And memory itself is untouched until the person sends.
    const fields = await page.evaluate(() => JSON.parse(localStorage.getItem("lien-waiver:fields:v1") ?? "{}"));
    expect(fields.companyName).toBe(saved.fields.companyName);
  });
}

test("Next tapped before the page's JavaScript has run does not throw the link away", async ({ page }) => {
  // Hold every script, the way a slow phone does: the server-rendered page
  // is on screen and tappable, and nothing of React has run yet.
  let hold = true;
  await page.route("**/_next/static/chunks/**", async (route) => {
    while (hold) await new Promise((resolve) => setTimeout(resolve, 50));
    await route.continue();
  });
  await page.goto(link("CA"), { waitUntil: "commit" });
  await expect(heading(page)).toHaveText("Waiver Type");
  const before = page.url();
  expect(before).toContain("company=Test+Drywall+Inc");

  await page.getByLabel("A progress payment").check();
  await page.getByLabel("Not yet").check();
  // `force`, because the point is what a tap does, not whether Playwright
  // thinks the button is clickable: before the fix this submitted the form
  // natively and the URL became ?stage=PROGRESS&cleared=no.
  await page.getByRole("button", { name: "Next" }).click({ force: true });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(before);

  // Once the JavaScript arrives, the link's values are all there.
  hold = false;
  await waitForHydration(page);
  await page.getByLabel("A progress payment").check();
  await page.getByLabel("Not yet").check();
  await next(page);
  await expect(page.locator("#field-companyName")).toHaveValue(PARAMS.company);
});
