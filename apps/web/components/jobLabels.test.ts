/**
 * What a job picker has to say so a person does not file against the wrong
 * job (issue #65).
 *
 * The thing being tested is a string, which sounds too small to test until
 * you read what goes wrong when it is the bare job name: fifteen jobs, seven
 * of them called "Smith kitchen remodel", and every `<select>` in the app
 * rendering seven identical rows. What gets filed through those pickers is
 * certified payroll, a pay application, a backcharge, an RFI — evidence
 * records, which by this repo's own rule lock their identity fields after
 * creation and never delete once sent. A mis-filed one is not a typo you fix.
 *
 * So the cases below are not "does the function concatenate". They are the
 * four ways two rows can look the same, each one a real shape:
 *
 *   - same name, different GC        two Smith kitchens for two builders
 *   - same name, same GC            two phases / two buildings on one site
 *   - no GC name supplied            a picker that didn't load the contact
 *   - a status nothing recognises    an enum value added later
 *
 * Seed data, not invented data: the names and GCs here are the ones
 * packages/db/scripts/seed-demo.mjs actually creates, `[demo]` suffix and
 * all, because that is what a demo click-through will be looking at.
 */

import { describe, expect, it } from "vitest";
import { jobPickerLabel, type JobOption } from "@/components/jobLabels";

const job = (over: Partial<JobOption> = {}): JobOption => ({
  id: "job_1",
  name: "Smith kitchen remodel",
  clientName: "Brackett Construction",
  status: "IN_PROGRESS",
  ...over,
});

/** The four jobs seed-demo.mjs creates, verbatim. Two GCs, four statuses. */
const SEED_JOBS: JobOption[] = [
  {
    id: "riverside",
    name: "Riverside Medical Office Building [demo]",
    clientName: "Brackett Construction [demo]",
    status: "IN_PROGRESS",
  },
  {
    id: "northgate",
    name: "Northgate Apartments Phase 2 [demo]",
    clientName: "Halvorsen Builders [demo]",
    status: "CONTRACTED",
  },
  {
    id: "lakeshore",
    name: "Lakeshore Retail Fit-Out [demo]",
    clientName: "Brackett Construction [demo]",
    status: "ESTIMATE",
  },
  {
    id: "cedar",
    name: "Cedar Park Elementary [demo]",
    clientName: "Halvorsen Builders [demo]",
    status: "COMPLETE",
  },
];

describe("jobPickerLabel", () => {
  it("tells two same-named jobs apart by their GC", () => {
    const a = jobPickerLabel(job({ id: "a", clientName: "Brackett Construction" }));
    const b = jobPickerLabel(job({ id: "b", clientName: "Halvorsen Builders" }));

    expect(a).not.toEqual(b);
    expect(a).toContain("Brackett Construction");
    expect(b).toContain("Halvorsen Builders");
  });

  it("tells two jobs for the SAME GC apart by status", () => {
    // The issue's own example: "A sub running two phases for the same GC, or
    // two buildings on one site". The GC alone does not separate those.
    const a = jobPickerLabel(job({ id: "a", status: "ESTIMATE" }));
    const b = jobPickerLabel(job({ id: "b", status: "IN_PROGRESS" }));

    expect(a).not.toEqual(b);
    expect(a).toContain("Estimate");
    expect(b).toContain("In progress");
  });

  it("still leads with the job name, because that is what a sub calls the job", () => {
    expect(jobPickerLabel(job({ name: "Riverside Tower" }))).toMatch(/^Riverside Tower\b/);
  });

  it("says so in words when no GC name came through, never 'undefined' or 'null'", () => {
    for (const missing of [null, "", "   "]) {
      const label = jobPickerLabel(job({ clientName: missing }));
      expect(label).not.toMatch(/undefined|null|NaN/);
      expect(label).toContain("Smith kitchen remodel");
      expect(label).toContain("client not recorded");
    }
  });

  it("names an unnamed job rather than rendering an empty gap", () => {
    expect(jobPickerLabel(job({ name: "   " }))).toContain("Untitled job");
    expect(jobPickerLabel(job({ name: "" }))).not.toMatch(/^\s*—/);
  });

  it("drops a status it does not recognise instead of printing the raw enum", () => {
    // A new JobStatus value, or a picker that passed something else in.
    // Showing "WARRANTY" to a contractor is worse than showing nothing;
    // showing "undefined" is worse than both.
    const label = jobPickerLabel(job({ status: "WARRANTY" }));
    expect(label).not.toContain("WARRANTY");
    expect(label).not.toMatch(/undefined|null/);
    expect(label).toEqual("Smith kitchen remodel — Brackett Construction");
  });

  it("drops a null status the same way", () => {
    expect(jobPickerLabel(job({ status: null }))).toEqual(
      "Smith kitchen remodel — Brackett Construction",
    );
  });

  it("never renders a raw enum value for any status the schema has", () => {
    for (const status of ["ESTIMATE", "CONTRACTED", "IN_PROGRESS", "COMPLETE"]) {
      expect(jobPickerLabel(job({ status }))).not.toContain(status);
    }
  });

  it("gives every job in the demo seed a distinct label", () => {
    const labels = SEED_JOBS.map(jobPickerLabel);
    // The size assertion, not just the uniqueness one: a helper returning ""
    // for everything would make `new Set` size 1, and a scan that silently
    // read no jobs would make it 0. Both are red here.
    expect(SEED_JOBS.length).toEqual(4);
    expect(new Set(labels).size).toEqual(4);
    expect(labels).toEqual([
      "Riverside Medical Office Building [demo] — Brackett Construction [demo] · In progress",
      "Northgate Apartments Phase 2 [demo] — Halvorsen Builders [demo] · Contracted",
      "Lakeshore Retail Fit-Out [demo] — Brackett Construction [demo] · Estimate",
      "Cedar Park Elementary [demo] — Halvorsen Builders [demo] · Complete",
    ]);
  });

  it("separates the seven identical rows from the issue, given different GCs", () => {
    const gcs = [
      "Brackett Construction",
      "Halvorsen Builders",
      "Pell Development Group",
      "Kesterson & Sons",
      "Marchetti Builders",
      "Oakline General",
      "Vance Construction",
    ];
    const labels = gcs.map((clientName, i) =>
      jobPickerLabel(job({ id: `job_${i}`, name: "Smith kitchen remodel", clientName })),
    );

    expect(gcs.length).toEqual(7);
    expect(new Set(labels).size).toEqual(7);
  });

  it("is the same string for the same job every time — no date, no clock in it", () => {
    // A label that moved between renders would make the server markup and the
    // client's disagree, which is a hydration error rather than a cosmetic
    // one. Nothing in here may read `new Date()`.
    const fixed = job();
    expect(jobPickerLabel(fixed)).toEqual(jobPickerLabel(fixed));
  });
});
