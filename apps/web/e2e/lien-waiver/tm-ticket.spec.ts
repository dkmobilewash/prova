import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, heading, next, waitForHydration } from "./walk";

/**
 * THE FREE T&M TICKET (apps/lien-waiver/app/tm-ticket), walked the way a
 * foreman on a phone walks it: from the home page's link, crew added as
 * chips, hours on a keypad, the super signs ON THE CANVAS (mouse moves stand
 * in for a finger), then the PDF goes to both. Same server as the other
 * specs, so no Resend key and nothing leaves CI. Then the hand-off: the
 * ticket's hours land in the change order request as lines with no price.
 */

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("a T&M ticket, signed on the glass, to both inboxes, then into a change order", async ({ page }) => {
  const errors = collectPageErrors(page);
  const posted: Array<Record<string, unknown>> = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/tm-ticket")) posted.push(request.postDataJSON());
  });

  await page.goto("start");
  await page.getByRole("link", { name: "Also free: T&M ticket" }).click();
  await expect(page).toHaveURL(/\/lien-waiver\/tm-ticket$/);
  await waitForHydration(page);
  await noSideScroll(page);

  const at = (title: string) => expect(heading(page)).toHaveText(title);

  await at("Your Company");
  await expect(page.getByText(/^Ticket number TM-/)).toBeVisible();
  const number = (await page.getByText(/^Ticket number TM-/).innerText()).replace("Ticket number ", "");
  expect(number).toMatch(/^TM-[0-9A-HJKMNP-TV-Z]{7}-[0-9A-HJKMNP-TV-Z]{3}$/);
  await page.locator("#field-companyName").fill("Desert Drywall LLC");
  await next(page);

  await at("Project");
  await page.locator("#field-project").fill("Mesa Medical Office Building");
  await page.locator("#field-gc").fill("Acme Builders Inc.");
  await next(page);

  await at("Date of Work");
  // A new ticket starts on the user's today, set after hydration.
  const browserToday = await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  });
  await expect(page.locator("#field-date")).toHaveValue(browserToday);
  await page.locator("#field-date").fill("2026-10-17");
  await next(page);

  await at("The Extra Work");
  await page.locator("#field-summary").fill("Patch corridor walls after plumbing reroute");
  await next(page);

  await at("Crew");
  // Next with nobody on the crew stays put and says why.
  await next(page);
  await expect(heading(page)).toHaveText("Crew");
  await expect(page.getByRole("alert").filter({ hasText: "needs another look" })).toBeVisible();
  await page.locator("#field-crewName").fill("Luis Ortega");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.locator("#field-crewName").fill("Sam Reyes");
  await page.locator("#field-crewName").press("Enter");
  await page.locator("#field-crewName").fill("Wrong Person");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Remove Wrong Person" }).click();
  await expect(page.getByRole("list", { name: "Crew" }).getByRole("listitem")).toHaveCount(2);
  await noSideScroll(page);
  await next(page);

  await at("Hours");
  await expect(page.locator("#crew-0-hours")).toHaveAttribute("inputmode", "decimal");
  await page.locator("#crew-0-hours").fill("8");
  await page.locator("#crew-1-hours").fill("7.5");
  await expect(page.getByText("Crew hours: 15.5")).toBeVisible();
  await next(page);

  await at("Material Used");
  await page.getByRole("button", { name: "+ Add material" }).click();
  await expect(page.locator("#material-0-quantity")).toHaveAttribute("inputmode", "decimal");
  await page.locator("#material-0-quantity").fill("3");
  await page.locator("#material-0-unit").fill("bucket");
  await page.locator("#material-0-description").fill("Joint compound");
  await next(page);

  await at("Equipment");
  await next(page);

  await at("Read the Ticket");
  await expect(page.locator("main")).toContainText(number);
  await expect(page.locator("main")).toContainText("Crew hours: 15.5");
  await expect(page.locator("main")).not.toContainText("$");
  await next(page);

  await at("Superintendent Signs");
  // Unsigned: Next is refused.
  await page.locator("#field-superName").fill("Dana Whitfield");
  await page.locator("#field-superTitle").fill("Superintendent");
  await page.locator("#field-superEmail").fill("dana@example.com");
  await next(page);
  await expect(heading(page)).toHaveText("Superintendent Signs");
  await expect(page.getByText("The superintendent signs in the box.")).toBeVisible();
  // Sign: two strokes, with a mouse standing in for a finger.
  const pad = page.locator("canvas");
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  const stroke = async (points: Array<[number, number]>) => {
    await page.mouse.move(box.x + box.width * points[0][0], box.y + box.height * points[0][1]);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 4 });
    await page.mouse.up();
  };
  await stroke([[0.1, 0.7], [0.2, 0.2], [0.3, 0.7], [0.4, 0.2]]);
  await stroke([[0.5, 0.5], [0.8, 0.5]]);
  await expect(page.getByText("Signed.", { exact: true })).toBeVisible();
  await next(page);

  await at("Get Your PDF");
  await page.locator("#send-name").fill("Luis Ortega");
  await page.locator("#send-email").fill("luis@example.com");
  await page.getByRole("button", { name: "Email the PDF to both of us" }).click();
  await expect(heading(page)).toHaveText("Check Your Inbox");
  await expect(page.locator("main")).toContainText("nothing was sent");
  await expect(page.locator("main")).toContainText("dana@example.com");

  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ name: "Luis Ortega", email: "luis@example.com", returning: false, website: "" });
  const ticket = posted[0].ticket as Record<string, unknown>;
  expect(ticket).toMatchObject({ number, superEmail: "dana@example.com", date: "2026-10-17" });
  expect(ticket.signature).toMatch(/^M\d+ \d+( [ML]\d+ \d+){5,}/);
  expect((ticket.signature as string).match(/M/g)).toHaveLength(2);

  // The next ticket starts clean, with a new number; the company is kept.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tm-ticket:draft:v1") ?? "null"));
  expect(stored).toMatchObject({ companyName: "Desert Drywall LLC", project: "", crew: [], signature: "", date: browserToday });
  expect(stored.number).not.toBe(number);

  // The hand-off: hours and quantities, never a price.
  await page.getByRole("link", { name: "Turn this ticket into a change order" }).click();
  await expect(page).toHaveURL(/\/lien-waiver\/change-order$/);
  await waitForHydration(page);
  await expect(page.getByRole("status").filter({ hasText: "Added the hours and quantities from 1 T&M ticket" })).toBeVisible();
  await expect(page.locator("#field-companyName")).toHaveValue("Desert Drywall LLC");
  await next(page);
  await expect(page.locator("#field-project")).toHaveValue("Mesa Medical Office Building");
  await expect(page.locator("#field-gc")).toHaveValue("Acme Builders Inc.");
  const draft = await page.evaluate(() => JSON.parse(localStorage.getItem("change-order:draft:v1") ?? "null"));
  expect(draft.labor).toEqual([
    { description: `Luis Ortega (T&M ${number}, 10/17/2026)`, quantity: "8", unit: "hr", unitPrice: "" },
    { description: `Sam Reyes (T&M ${number}, 10/17/2026)`, quantity: "7.5", unit: "hr", unitPrice: "" },
  ]);
  expect(draft.material).toEqual([{ description: `Joint compound (T&M ${number}, 10/17/2026)`, quantity: "3", unit: "bucket", unitPrice: "" }]);
  // Handed over once: a reload does not add the lines again.
  await page.reload();
  await waitForHydration(page);
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem("change-order:draft:v1") ?? "null"))).labor).toHaveLength(2);

  expect(errors).toEqual([]);
});
