/**
 * No tool description and no KNOWN_GAPS entry says this app lacks something
 * it has.
 *
 * WHY THIS IS NOT A STYLE CHECK. `KNOWN_GAPS` is pasted into the system
 * prompt (`answer.ts`), so an entry there is not a stale comment — it is a
 * standing INSTRUCTION to the model to refuse. A tool description is the same
 * thing one step removed: it is the only account of a tool the model ever
 * reads. So a false negative claim in either place is a feature the product
 * has and the assistant denies, and it is invisible until somebody asks.
 *
 * Three of them shipped at once, found 2026-09-26:
 *
 *   - `KNOWN_GAPS` carried "a vendor's recent price change: the catalog
 *     records what work has cost, not a vendor's price list over time", and
 *     `job_margin` said "Does NOT know vendor price changes — there is no
 *     vendor price history". `priceMovement()` in
 *     `components/vendorPricing.ts` has computed the change between a
 *     vendor's last two quotes since that page was built, and
 *     /vendors/pricing renders it under "Movement";
 *   - the "driving directions or travel time" gap said "job addresses are not
 *     modelled as coordinates", and `Job.siteLatitude`/`siteLongitude` have
 *     existed since a daily report started looking up its own weather;
 *   - `crew_assignments` ended "Does NOT know travel time, addresses, or what
 *     tools to bring; none of those are recorded" — and `Job.siteAddress` is
 *     recorded. The narrower true claim is that no TOOL returns it.
 *
 * `tools.ts` already carries the lesson in a comment on `crew_assignments`,
 * about a DIFFERENT sentence it got wrong in the same place: "a claim about
 * what the app does NOT have expires exactly as fast as a claim about what it
 * does, which this repo has paid for twice." Three times. A comment saying so
 * did not stop the next one, which is why this is a test.
 *
 * HOW IT KEEPS ITSELF HONEST. Every claim below is checked against the CODE
 * that makes it false, read from disk, and each source is asserted to be the
 * file this test thinks it is BEFORE the claim is judged. A test that only
 * matched prose would pass forever by looking in the wrong file — nothing is
 * ever missing from a directory you do not walk. It cannot, and does not try
 * to, find the NEXT stale claim: it pins the three that were found. The
 * general guard against reading a dead column is
 * `supersededFieldCensus.test.ts`; this one is about sentences.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KNOWN_GAPS, TOOLS } from "./tools";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const read = (path: string) => readFileSync(new URL(path, `file://${repoRoot}`), "utf8");

const jobsSchema = read("packages/db/prisma/schema/jobs.prisma");
const vendorPricingSource = read("apps/web/components/vendorPricing.ts");
const vendorPricingPage = read("apps/web/app/(app)/vendors/pricing/page.tsx");

/** Every sentence the model is ever shown: the gap list plus every tool
 * description. Both reach it, so both are checked. */
const CLAIMS: { where: string; text: string }[] = [
  ...KNOWN_GAPS.map((gap) => ({ where: `KNOWN_GAPS "${gap.topic}"`, text: gap.why })),
  ...TOOLS.map((tool) => ({ where: `${tool.name}'s description`, text: tool.description })),
];

function claiming(pattern: RegExp): string[] {
  return CLAIMS.filter((claim) => pattern.test(claim.text)).map((claim) => claim.where);
}

describe("the sources these claims are checked against", () => {
  // FIRST, because a claim judged against the wrong file is judged against
  // nothing, and every assertion below would pass.
  it("is the schema that declares a job's site address and coordinates", () => {
    expect(jobsSchema).toMatch(/^\s*siteAddress\s+String\?/m);
    expect(jobsSchema).toMatch(/^\s*siteLatitude\s+Float\?/m);
    expect(jobsSchema).toMatch(/^\s*siteLongitude\s+Float\?/m);
  });

  it("is the module that computes a vendor's price movement, and the page that shows it", () => {
    expect(vendorPricingSource).toMatch(/export function priceMovement\(/);
    expect(vendorPricingSource).toMatch(/changePercent/);
    // Rendered, not merely computed: a helper nothing calls would make the
    // claim "no vendor price history" true enough in practice.
    expect(vendorPricingPage).toMatch(/priceMovement\(/);
    expect(vendorPricingPage).toMatch(/Movement/);
  });

  it("has claims to check, and they are the ones the model is shown", () => {
    // An empty list passes every assertion after it.
    expect(CLAIMS.length).toBe(KNOWN_GAPS.length + TOOLS.length);
    expect(KNOWN_GAPS.length).toBeGreaterThan(5);
    expect(TOOLS.length).toBeGreaterThan(30);
    // And the matcher is not dead: a pattern that matches nothing would make
    // every test below vacuous, so one is proved to match something real.
    expect(claiming(/\bnot recorded\b|\bcannot\b|\bdoes not\b/i).length).toBeGreaterThan(5);
  });
});

describe("no claim denies a vendor price history", () => {
  it("says nowhere that vendor prices are not kept over time", () => {
    const offenders = claiming(
      /no vendor price history|not a vendor's price list over time|price list over time|does not? know vendor price/i,
    );
    expect(
      offenders,
      `priceMovement() computes a vendor's price change and /vendors/pricing renders it under ` +
        `"Movement". KNOWN_GAPS is injected into the system prompt, so these are instructions to ` +
        `refuse a question on screen: ${offenders.join("; ")}`,
    ).toEqual([]);
  });

  it("and vendor_pricing says it HAS the movement, so the model reaches for it", () => {
    // The other half. Deleting the refusal is not enough — nothing would tell
    // the model the figure exists.
    const tool = TOOLS.find((t) => t.name === "vendor_pricing")!;
    expect(tool.description).toMatch(/moved|movement/i);
    expect(tool.description).toMatch(/changePercent/);
    // And it still forbids the two comparisons that are not movements.
    expect(tool.description).toMatch(/same vendor/i);
    expect(tool.description).toMatch(/unit/i);
  });
});

describe("no claim denies that a job's address is recorded", () => {
  it("says nowhere that addresses or coordinates are not held", () => {
    const offenders = claiming(
      /addresses are not modelled|addresses,? or what tools|none of those are recorded|address(es)? (is|are) not recorded/i,
    );
    expect(
      offenders,
      `Job.siteAddress is recorded and geocoded to siteLatitude/siteLongitude for a daily report's ` +
        `weather. The true claim is narrower — no TOOL returns it — and the wide one is a sentence a ` +
        `model would repeat to somebody looking at the address on the job page: ${offenders.join("; ")}`,
    ).toEqual([]);
  });

  it("still refuses travel time and routing, which really are absent", () => {
    // The conclusion never changed; only the argument for it was false. This
    // is the half that must survive the correction.
    const gap = KNOWN_GAPS.find((entry) => /directions|travel time/i.test(entry.topic));
    expect(gap, "the driving-directions gap must stay on the list").toBeDefined();
    expect(gap!.why).toMatch(/routing|travel-time|distance/i);
    expect(gap!.why).toMatch(/never estimate|do not estimate/i);
  });
});

describe("no claim denies that certified payroll is recorded against a period", () => {
  const alertsQuery = read("apps/web/lib/alerts-query.ts");

  it("is checked against the query that reads those documents", () => {
    expect(alertsQuery).toMatch(/complianceDocument\.findMany/);
    expect(alertsQuery).toMatch(/CERTIFIED_PAYROLL/);
    expect(alertsQuery).toMatch(/periodStart/);
  });

  it("says nowhere that nothing records a certified payroll against a week", () => {
    // `needs_attention` raises the CERTIFIED_PAYROLL alert from exactly those
    // rows, so a refusal here is one tool in the box refusing what another
    // tool in the same box reports.
    const offenders = claiming(/CANNOT say whether a week was FILED|does NOT and CANNOT say whether a week/i);
    expect(offenders, offenders.join("; ")).toEqual([]);
  });

  it("still refuses to call a document on record a SUBMISSION, which nothing records", () => {
    // The half that was true and must not be traded away. A ComplianceDocument
    // is a document somebody put here; it is not a receipt from an agency.
    const tool = TOOLS.find((t) => t.name === "certified_payroll")!;
    expect(tool.description).toMatch(/on record/i);
    expect(tool.description).toMatch(/no agency, no date sent, no receipt/i);
    expect(tool.description).toMatch(/never 'it was filed'|never "it was filed"/i);
  });
});
