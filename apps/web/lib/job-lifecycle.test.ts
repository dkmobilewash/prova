import { describe, expect, it } from "vitest";
import { STAGE_LABELS, jobLifecycle, warrantyEndsOn, type JobLifecycleInput } from "./job-lifecycle";

/**
 * The lifecycle is DERIVED, so the whole risk is that it says something
 * the underlying data does not. Most of what is pinned here is the
 * difference between a fact and a plan, and between "no" and "we cannot
 * tell".
 */

const base: JobLifecycleInput = {
  status: "IN_PROGRESS",
  substantialCompletionDate: null,
  closeoutSubmissions: [],
  warranty: null,
  todayIso: "2026-09-26",
};

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("the plain statuses", () => {
  it("maps each one to a stage a person would recognise", () => {
    expect(jobLifecycle({ ...base, status: "ESTIMATE" }).label).toBe("Bidding");
    expect(jobLifecycle({ ...base, status: "CONTRACTED" }).label).toBe("Awarded");
    expect(jobLifecycle({ ...base, status: "IN_PROGRESS" }).label).toBe("In progress");
  });

  it("always says what put it there", () => {
    // A stage label with no evidence is the app asserting something about
    // somebody's job.
    for (const status of ["ESTIMATE", "CONTRACTED", "IN_PROGRESS", "COMPLETE"]) {
      const result = jobLifecycle({ ...base, status });
      expect(result.because, status).not.toBe("");
    }
  });

  it("says it does not know, rather than guessing, on a status it has never seen", () => {
    const result = jobLifecycle({ ...base, status: "MOTHBALLED" });
    expect(result.label).toBe("Status unknown");
    expect(result.because).toContain("MOTHBALLED");
    expect(result.because).toMatch(/does not recognise/);
  });
});

describe("substantial completion is a date, and a date can be in the future", () => {
  it("counts a date that has arrived", () => {
    const result = jobLifecycle({ ...base, substantialCompletionDate: utc("2026-09-01") });
    expect(result.stage).toBe("substantially_complete");
    expect(result.because).toContain("2026-09-01");
  });

  it("counts TODAY as arrived", () => {
    const result = jobLifecycle({ ...base, substantialCompletionDate: utc("2026-09-26") });
    expect(result.stage).toBe("substantially_complete");
  });

  it("does NOT count a date still in the future", () => {
    // A pencilled-in date is a plan. Reading it as a fact would tell
    // somebody a job is substantially complete because of a forecast.
    const result = jobLifecycle({ ...base, substantialCompletionDate: utc("2026-12-01") });
    expect(result.stage).toBe("in_progress");
    expect(result.because).not.toContain("2026-12-01");
  });

  it("advances a job that is still IN_PROGRESS, because both are true at once", () => {
    // Substantially complete while punching out is the normal case, not a
    // contradiction.
    const result = jobLifecycle({
      ...base,
      status: "IN_PROGRESS",
      substantialCompletionDate: utc("2026-08-01"),
    });
    expect(result.stage).toBe("substantially_complete");
  });
});

describe("closeout", () => {
  it("is in closeout while the package is with the GC", () => {
    const result = jobLifecycle({ ...base, closeoutSubmissions: [{ status: "SUBMITTED" }] });
    expect(result.stage).toBe("closeout");
    expect(result.because).toMatch(/with the GC/);
  });

  it("says a rejected package came back, which is the sentence somebody needs", () => {
    const result = jobLifecycle({ ...base, closeoutSubmissions: [{ status: "REJECTED" }] });
    expect(result.stage).toBe("closeout");
    expect(result.because).toMatch(/rejected/);
  });

  it("is closed once any attempt was accepted, even after an earlier rejection", () => {
    // Several rows per job is the design — "we sent it, they bounced it,
    // we sent it again". One acceptance closes it.
    const result = jobLifecycle({
      ...base,
      closeoutSubmissions: [{ status: "REJECTED" }, { status: "ACCEPTED" }],
    });
    expect(result.stage).toBe("closed");
  });

  it("does not read an acceptance as still in flight", () => {
    const result = jobLifecycle({ ...base, closeoutSubmissions: [{ status: "ACCEPTED" }] });
    expect(result.because).not.toMatch(/with the GC/);
  });
});

describe("warranty", () => {
  it("is in warranty while the period is running", () => {
    const result = jobLifecycle({
      ...base,
      closeoutSubmissions: [{ status: "ACCEPTED" }],
      warranty: { startsOn: utc("2026-06-01"), months: 12 },
    });
    expect(result.stage).toBe("warranty");
    expect(result.because).toContain("2027-06-01");
  });

  it("does not start before the warranty does", () => {
    const result = jobLifecycle({
      ...base,
      closeoutSubmissions: [{ status: "ACCEPTED" }],
      warranty: { startsOn: utc("2026-12-01"), months: 12 },
    });
    expect(result.stage).toBe("closed");
  });

  it("an EXPIRED warranty leaves the job closed, not in a state of its own", () => {
    // "Warranty expired" would put every old job into something that
    // reads like an event just happened. The obligation is over; the job
    // is closed.
    const result = jobLifecycle({
      ...base,
      closeoutSubmissions: [{ status: "ACCEPTED" }],
      warranty: { startsOn: utc("2024-01-01"), months: 12 },
    });
    expect(result.stage).toBe("closed");
  });
});

describe("warrantyEndsOn clamps rather than overflowing the month", () => {
  it("ends a one-month warranty from 31 January on 28 February", () => {
    // Naive month arithmetic gives 3 March, which would report a warranty
    // as live for three days after it ended.
    expect(warrantyEndsOn(utc("2026-01-31"), 1).toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("handles a leap year", () => {
    expect(warrantyEndsOn(utc("2028-01-31"), 1).toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("rolls the year over", () => {
    expect(warrantyEndsOn(utc("2026-06-15"), 12).toISOString().slice(0, 10)).toBe("2027-06-15");
  });
});

describe("the furthest stage wins", () => {
  it("prefers warranty over every earlier signal that is also true", () => {
    const result = jobLifecycle({
      status: "IN_PROGRESS",
      substantialCompletionDate: utc("2026-01-01"),
      closeoutSubmissions: [{ status: "ACCEPTED" }],
      warranty: { startsOn: utc("2026-03-01"), months: 24 },
      todayIso: "2026-09-26",
    });
    expect(result.stage).toBe("warranty");
  });

  it("cannot go backwards when a status is edited to something earlier", () => {
    // Somebody flipping a closed job back to CONTRACTED does not un-accept
    // the closeout package the GC signed.
    const result = jobLifecycle({
      ...base,
      status: "CONTRACTED",
      closeoutSubmissions: [{ status: "ACCEPTED" }],
    });
    expect(result.stage).toBe("closed");
  });

  it("labels every stage it can return", () => {
    // Vacuity guard: a stage with no label would render blank.
    for (const [stage, label] of Object.entries(STAGE_LABELS)) {
      expect(label, stage).toBeTruthy();
    }
    expect(Object.keys(STAGE_LABELS)).toHaveLength(7);
  });
});

describe("today is a parameter, not the clock", () => {
  it("gives a different answer for the same job on two different days", () => {
    const job = { ...base, substantialCompletionDate: utc("2026-10-15") };
    expect(jobLifecycle({ ...job, todayIso: "2026-09-26" }).stage).toBe("in_progress");
    expect(jobLifecycle({ ...job, todayIso: "2026-10-15" }).stage).toBe("substantially_complete");
  });

  it("never reads the clock itself", () => {
    // Pinned by behaviour rather than by inspection: a far-future today
    // must change the answer. If this module ever called `new Date()` the
    // second assertion would report today's real stage instead.
    const job = {
      ...base,
      closeoutSubmissions: [{ status: "ACCEPTED" }],
      warranty: { startsOn: utc("2030-01-01"), months: 12 },
    };
    expect(jobLifecycle({ ...job, todayIso: "2026-09-26" }).stage).toBe("closed");
    expect(jobLifecycle({ ...job, todayIso: "2030-06-01" }).stage).toBe("warranty");
  });
});

describe("source — so the header does not restate the status pill", () => {
  it("reports `status` when nothing beyond the status is known", () => {
    // The header already shows "In progress". A lifecycle line here would
    // read "In progress — the job's status is in progress", which teaches
    // a reader that this line is filler.
    expect(jobLifecycle({ ...base, status: "IN_PROGRESS" }).source).toBe("status");
    expect(jobLifecycle({ ...base, status: "ESTIMATE" }).source).toBe("status");
  });

  it("names the input that actually decided, when it is not the status", () => {
    expect(jobLifecycle({ ...base, substantialCompletionDate: utc("2026-08-01") }).source).toBe(
      "substantial-completion",
    );
    expect(jobLifecycle({ ...base, closeoutSubmissions: [{ status: "SUBMITTED" }] }).source).toBe("closeout");
    expect(
      jobLifecycle({ ...base, warranty: { startsOn: utc("2026-01-01"), months: 24 } }).source,
    ).toBe("warranty");
  });

  it("flags an unrecognised status as its own source, not as `status`", () => {
    // "Status unknown" must never be suppressed as redundant: it is the
    // one case where the header's own pill is the thing that is wrong.
    expect(jobLifecycle({ ...base, status: "MOTHBALLED" }).source).toBe("unknown");
  });

  it("reports the winner's source, not the first candidate's", () => {
    const result = jobLifecycle({
      ...base,
      status: "COMPLETE",
      substantialCompletionDate: utc("2026-01-01"),
      closeoutSubmissions: [{ status: "ACCEPTED" }],
    });
    expect(result.stage).toBe("closed");
    expect(result.source).toBe("closeout");
  });
});
