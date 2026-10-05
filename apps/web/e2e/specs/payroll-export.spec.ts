import { test, expect } from "@playwright/test";
import { signInAs } from "../lib/signIn";
import { PERSONAS } from "../lib/personas";
import { E2E_TAG, PAYROLL_WEEK_START } from "../lib/seedDatabase";
import { HealthMonitor, expectHealthy } from "../lib/health";
import { PAYROLL_EXPORT_COLUMNS } from "@/lib/payroll-export";

/**
 * THE PAYROLL EXPORT, FETCHED RATHER THAN ARGUED ABOUT.
 *
 * #596 shipped the hours-out half of payroll with 198 lines of unit tests on
 * the row builder and NOBODY HAVING ASKED THE ROUTE FOR A FILE. The pure
 * half is well covered; what was not covered is everything that only exists
 * once it is an HTTP response — the capability gate, the content type, the
 * filename, and the header row a payroll clerk opens in Excel.
 *
 * **THE ASSERTION WORTH THE FILE IS THE REFUSAL ONE**, and it is a trap this
 * repo has written down: a route that refuses by REDIRECTING sends the
 * sign-in page with a 200, and the browser saves that HTML as
 * `payroll-….csv`. The clerk opens a spreadsheet full of markup and has no
 * way to tell that from an export bug. So the refusal must be plain text
 * with a 403 status, and this asserts the status, the body and — the part a
 * status code alone would miss — that no redirect happened.
 */

async function exportHref(page: import("@playwright/test").Page, jobPath: string) {
  await page.goto(`${jobPath}/certified-payroll`);
  // The link says what it DOES, not what the route is called: "Download
  // hours for payroll (CSV)". Matching on /export/i found nothing — which
  // is the spec being wrong about the product, not the product being wrong.
  const link = page.getByRole("link", { name: /Download hours for payroll/i }).first();
  await expect(link, "the certified-payroll page offers no export link").toBeVisible();
  const href = await link.getAttribute("href");
  expect(href, "the export link has no href").toBeTruthy();
  return href as string;
}

test("the payroll export returns a CSV a clerk can open, and refuses in plain text", async ({
  page,
}) => {
  const monitor = new HealthMonitor(page);
  await signInAs(page, PERSONAS.main.email);

  await page.goto("/schedule");
  await page.getByRole("link", { name: new RegExp(`${E2E_TAG} Seeded Job`) }).first().click();
  await page.waitForURL(/\/jobs\/[^/]+$/);
  const jobPath = new URL(page.url()).pathname;

  // 1. the page renders and offers the export
  const href = await exportHref(page, jobPath);
  await expectHealthy(page, "certified payroll", { monitor });
  expect(href, "the export link is not job- and week-scoped").toMatch(
    /^\/api\/payroll-export\?jobId=[^&]+&weekStart=\d{4}-\d{2}-\d{2}$/,
  );

  // 2. THE FILE. `page.request` shares the signed-in context's cookies, so
  //    this is the same fetch the browser makes when the link is clicked.
  const res = await page.request.get(href);
  expect(res.status(), "the export did not return 200").toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");

  const disposition = res.headers()["content-disposition"] ?? "";
  expect(disposition, "the response is not an attachment").toContain("attachment");
  // A clerk ends up with this on disk; it has to say which job and which week.
  expect(disposition, "the filename is not a dated .csv").toMatch(/filename="payroll-.*\d{4}-\d{2}-\d{2}\.csv"/);

  // 3. the header row IS the column list, in order — derived from the same
  //    export the route uses, so adding a column cannot silently reorder it.
  const body = await res.text();
  const header = body.split(/\r?\n/)[0];
  expect(PAYROLL_EXPORT_COLUMNS.length, "the column list is empty — every check below is vacuous").toBeGreaterThanOrEqual(
    10,
  );
  expect(header).toBe(PAYROLL_EXPORT_COLUMNS.map((c) => c.label).join(","));
  // The two that exist to stop a 0 being read as free labour, and a per diem
  // being paid twice. If either header disappears the file still opens.
  expect(header, "the rate-known column is gone").toContain("Rate known");
  expect(header, "the per-diem column is no longer marked as an employee total").toContain(
    "Per diem (employee total)",
  );

  // 4. a malformed week is refused rather than guessed at
  const bad = await page.request.get(href.replace(/weekStart=.*/, "weekStart=last-tuesday"));
  expect(bad.status(), "a junk weekStart was accepted").toBe(400);
});

test("a field user gets a plain-text refusal, not a sign-in page saved as .csv", async ({
  page,
}) => {
  // FIELD holds MANAGE_FIELD and MANAGE_JOBS — never MANAGE_COMPLIANCE.
  //
  // Signed in ONLY as FIELD, in this test's own fresh context. An earlier
  // version signed in as MAIN first and then called `clearCookies()`, which
  // does NOT end a Clerk session — the second sign-in threw "You're already
  // signed in". Worth leaving written down: clearing cookies looks like
  // signing out and is not.
  await signInAs(page, PERSONAS.field.email);

  // FIELD can reach a job (MANAGE_JOBS) but NOT its certified-payroll page,
  // so the URL is built rather than read off a link they cannot see. That is
  // also the realistic shape of the attack: a guessed or shared URL.
  await page.goto("/jobs");
  const jobLink = page.locator('a[href^="/jobs/"]').first();
  await expect(jobLink, "a field user cannot see any job to scope this to").toBeVisible();
  const jobId = ((await jobLink.getAttribute("href")) ?? "").split("/")[2];
  expect(jobId, "no job id could be read").toBeTruthy();

  const href = `/api/payroll-export?jobId=${jobId}&weekStart=2026-09-28`;
  const res = await page.request.get(href);

  expect(res.status(), "a field user was handed payroll records").toBe(403);
  expect(res.headers()["content-type"]).toContain("text/plain");
  expect(await res.text()).toContain("do not have access to payroll records");
  // THE TRAP: a refusal that REDIRECTS arrives as 200 text/html, and the
  // browser saves the sign-in page as `payroll-….csv`. The clerk opens a
  // spreadsheet full of markup with no way to tell that from an export bug.
  // The 403 above rules it out; this names it so a refactor cannot quietly
  // reintroduce it.
  expect(res.url(), "the refusal redirected instead of refusing").toContain("/api/payroll-export");
});

/** Minimal RFC-4180 reader — enough for one row, and quote-aware rather
 * than a `split(",")`, because a craft label or an employee name is exactly
 * the sort of field that grows a comma later. */
function csvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * THE NUMBERS, not just the shape.
 *
 * The three tests above prove the route answers correctly — status, type,
 * filename, header order, the refusal. None of them could look at a figure,
 * because until the seed grew a week of hours there were none to look at.
 * Verifying these on 2026-10-03 took a real production job and a human
 * downloading a CSV. It takes this file now.
 *
 * The seeded week is ONE employee in TWO classifications, which is the
 * smallest shape that can catch both of the mistakes #596 exists to prevent.
 */
test("the exported figures match the week that was logged", async ({ page }) => {
  await signInAs(page, PERSONAS.main.email);
  await page.goto("/schedule");
  await page.getByRole("link", { name: new RegExp(`${E2E_TAG} Seeded Job`) }).first().click();
  await page.waitForURL(/\/jobs\/[^/]+$/);
  const jobId = new URL(page.url()).pathname.split("/")[2];

  const res = await page.request.get(
    `/api/payroll-export?jobId=${jobId}&weekStart=${PAYROLL_WEEK_START}`,
  );
  expect(res.status()).toBe(200);

  const lines = (await res.text()).trim().split(/\r?\n/);
  const header = csvRow(lines[0]);
  const rows = lines.slice(1).map(csvRow);
  const col = (r: string[], label: string) => r[header.indexOf(label)];

  // SIZE, before anything is read off it: a file that came back with no data
  // rows would make every assertion below vacuously true.
  expect(rows.length, "the export returned no data rows — the seed did not land").toBe(2);

  // "No craft tag" is the LABEL an untagged row carries, not a blank —
  // `certified-payroll.ts` fills it in so the column never reads as a
  // missing value. Asserted here rather than assumed: the first version of
  // this test looked for an empty Classification and found no such row.
  const UNTAGGED = "No craft tag";
  const priced = rows.find((r) => col(r, "Classification") !== UNTAGGED);
  const unpriced = rows.find((r) => col(r, "Classification") === UNTAGGED);
  expect(priced, "no classified row in the export").toBeTruthy();
  expect(unpriced, "no unclassified row in the export").toBeTruthy();
  if (!priced || !unpriced) return;

  // Both rows are the same person and the same week.
  expect(col(priced, "Employee")).toBe(col(unpriced, "Employee"));
  expect(col(priced, "Classification"), "the priced row lost its craft label").toContain(
    "Drywall Finisher",
  );
  expect(col(priced, "Period start")).toBe(PAYROLL_WEEK_START);
  expect(col(priced, "Period end")).toBe("2026-08-29");

  // The hours as logged: 8 under the craft, 6 without one.
  expect(col(priced, "Straight hours")).toBe("8");
  expect(col(priced, "Total hours")).toBe("8");
  expect(col(unpriced, "Straight hours")).toBe("6");
  expect(col(unpriced, "Total hours")).toBe("6");

  // THE FIRST REFUSAL. A rate IS in force for the craft row, so it prices.
  expect(col(priced, "Rate known")).toBe("yes");
  expect(Number(col(priced, "Wage cost")), "a priced row came out with no wage").toBeGreaterThan(0);

  // THE SECOND. No craft means no schedule in force, and an unknown wage is
  // NOT zero — a 0 here reads as free labour in a pay run.
  expect(col(unpriced, "Rate known")).toBe("no");
  expect(col(unpriced, "Wage cost"), "an unknown wage was written as a number").toBe("");

  // AND THE THIRD, which only a multi-row employee can show: per diem and
  // travel are EMPLOYEE totals, so they sit on the first row and nowhere
  // else. Repeated, they are paid twice.
  expect(col(priced, "Per diem (employee total)")).toBe("75");
  expect(col(priced, "Travel pay (employee total)")).toBe("50");
  expect(col(unpriced, "Per diem (employee total)"), "per diem was repeated on a second row").toBe("");
  expect(col(unpriced, "Travel pay (employee total)"), "travel pay was repeated on a second row").toBe("");
});
