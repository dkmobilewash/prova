import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, heading, next, waitForHydration } from "./walk";

/**
 * THE FREE CHANGE ORDER REQUEST (apps/lien-waiver/app/change-order), walked
 * the way a sub on a phone walks it: from the waiver tool's home page, one
 * screen at a time, to a sent PDF. Same server as the waiver specs, so no
 * Resend key: the API answers "nothing was sent" and no email leaves CI.
 *
 * The money is asserted on screen to the cent; the unit tests in
 * apps/lien-waiver/lib/change-order.test.ts prove the arithmetic, this
 * proves the person sees the same figures the PDF will print.
 */

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("a change order request, start to inbox, priced to the cent", async ({ page }) => {
  const errors = collectPageErrors(page);
  const posted: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/change-order")) posted.push(request.postDataJSON());
  });

  // The one link on the waiver tool's home page.
  await page.goto("start");
  await page.getByRole("link", { name: "Also free: change order request" }).click();
  await expect(page).toHaveURL(/\/lien-waiver\/change-order$/);
  await waitForHydration(page);
  await noSideScroll(page);

  const seen: string[] = [];
  const at = async (title: string) => {
    await expect(heading(page)).toHaveText(title);
    seen.push(title);
  };

  await at("Your Company");
  // Next on an empty required field stays put and says why.
  await page.locator("#field-companyName").fill("");
  await next(page);
  await expect(heading(page)).toHaveText("Your Company");
  await expect(page.getByRole("alert")).toContainText("needs another look");
  await page.locator("#field-companyName").fill("Desert Drywall LLC");
  await next(page);

  await at("Project");
  await page.locator("#field-project").fill("Mesa Medical Office Building");
  await page.locator("#field-gc").fill("Acme Builders Inc.");
  await next(page);

  await at("This Request");
  await page.locator("#field-pcoNumber").fill("PCO-07");
  await page.locator("#field-date").fill("2026-10-17");
  await next(page);

  await at("The Change");
  await page.locator("#field-title").fill("Add rated head-of-wall at corridor");
  await page.locator("#field-description").fill("Per RFI 14, add 2-hr rated deflection track at the level 2 corridor.");
  await next(page);

  await at("Labor");
  await page.getByRole("button", { name: "+ Add a labor line" }).click();
  await expect(page.locator("#labor-0-quantity")).toHaveAttribute("inputmode", "decimal");
  await page.locator("#labor-0-description").fill("Framers");
  await page.locator("#labor-0-quantity").fill("8");
  await page.locator("#labor-0-unitPrice").fill("85");
  await expect(page.getByText("$680.00").first()).toBeVisible();
  await noSideScroll(page);
  await next(page);

  await at("Material");
  await page.getByRole("button", { name: "+ Add a material line" }).click();
  await page.locator("#material-0-description").fill("Deflection track");
  await page.locator("#material-0-quantity").fill("12");
  await page.locator("#material-0-unitPrice").fill("14.37");
  await next(page);

  await at("Equipment");
  // Optional: nothing to add, Next moves on.
  await next(page);

  await at("Markup");
  await expect(page.locator("#field-markupPercent")).toHaveAttribute("inputmode", "decimal");
  await page.locator("#field-markupPercent").fill("15");
  // 680.00 + 172.44 = 852.44; 15% = 127.866 -> 127.87; total 980.31.
  await expect(page.getByText("$980.31")).toBeVisible();
  await next(page);

  await at("Schedule Impact");
  await page.locator("#field-scheduleDays").fill("2");
  await next(page);

  await at("Backup");
  await page.locator("#field-backup").fill("RFI 14 response\nSite photos");
  await next(page);

  await at("Read Your Change Order");
  await expect(page.locator("main")).toContainText("Acme Builders Inc.");
  await expect(page.locator("main")).toContainText("$980.31");
  await next(page);

  await at("Get Your PDF");
  await page.locator("#send-name").fill("Pat Sub");
  await page.locator("#send-email").fill("pat@example.com");
  await page.getByRole("button", { name: "Email me the PDF" }).click();
  await expect(heading(page)).toHaveText("Check Your Inbox");
  await expect(page.locator("main")).toContainText("nothing was sent");

  expect(seen).toHaveLength(12);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ name: "Pat Sub", email: "pat@example.com", returning: false, website: "" });
  expect(posted[0].order).toMatchObject({ gc: "Acme Builders Inc.", markupPercent: "15", scheduleDays: "2" });

  // A reload keeps the company and job for the next request.
  await page.getByRole("button", { name: "Make another change order request" }).click();
  await page.reload();
  await waitForHydration(page);
  await expect(page.locator("#field-companyName")).toHaveValue("Desert Drywall LLC");

  expect(errors).toEqual([]);
});
