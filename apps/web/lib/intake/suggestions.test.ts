import { describe, expect, it } from "vitest";
import { ALERT_CAPABILITY, intakeAlerts, type AlertKind } from "@/lib/alerts";
import { ALERT_KIND_LABELS } from "@/components/alertLabels";
import { UNMATCHED_JOB_FLOOR, countIntake, intakeTraySummary } from "./review";

/**
 * "Tell them what you can do for them, and let them click yes, no or later."
 *
 * The yes/no/later is not built here and that is the point: these are
 * ALERTS, so dismiss and snooze already exist and behave the same way they
 * do everywhere else in the app, and `href` is the yes. What is tested here
 * is that the suggestions are true, that they do not double-count, and that
 * they refuse to speak when the evidence is thin.
 */

const row = (
  over: Partial<{
    proposedKind: string;
    proposedConfidence: string;
    status: string;
    jobHint: string | null;
    jobId: string | null;
  }> = {},
) => ({
  proposedKind: "SUBMITTAL",
  proposedConfidence: "HIGH",
  status: "PROPOSED",
  jobHint: null,
  jobId: null,
  ...over,
});

describe("intakeTraySummary", () => {
  it("splits the tray exactly the way the tray's own header does", () => {
    // Through countIntake, not re-derived. The two screens disagreed once —
    // the header read "7 ready to file, 4 need a look" and the alert beside
    // it said 8 and 3, because a MEDIUM-confidence row is "needs a look" to
    // the page and was "routine" to the alert. Same total, different split,
    // and each number defensible on its own. Caught by seeding a tray and
    // reading both screens.
    const summary = intakeTraySummary(
      [
        row(),
        row(),
        row({ proposedKind: "UNKNOWN", proposedConfidence: "LOW" }),
        // Placed, but NOT sure — the row the two screens used to fight over.
        row({ proposedConfidence: "MEDIUM" }),
      ],
      [],
    );
    expect(summary.readyToFile).toBe(2);
    expect(summary.needsALook).toBe(2);

    // And it agrees with countIntake itself, which is the point of routing
    // through it rather than restating the rule.
    const counts = countIntake([
      row(),
      row(),
      row({ proposedKind: "UNKNOWN", proposedConfidence: "LOW" }),
      row({ proposedConfidence: "MEDIUM" }),
    ] as never);
    expect(summary.readyToFile).toBe(counts.readyToFile);
    expect(summary.needsALook).toBe(counts.needALook + counts.couldNotPlace);
  });

  it("does not count a filed or dismissed row as waiting", () => {
    const summary = intakeTraySummary(
      [row(), row({ status: "FILED" }), row({ status: "DISMISSED" })],
      [],
    );
    expect(summary.readyToFile).toBe(1);
    expect(summary.needsALook).toBe(0);
  });

  it("does not call a job name missing on the strength of one file", () => {
    const one = intakeTraySummary([row({ jobHint: "Riverside" })], []);
    expect(one.unmatchedJobNames).toEqual([]);

    // Non-vacuous: the SAME hint at the floor does produce a suggestion, so
    // the silence above is the floor doing its job and not the matcher
    // finding nothing.
    const enough = intakeTraySummary(
      Array.from({ length: UNMATCHED_JOB_FLOOR }, () => row({ jobHint: "Riverside" })),
      [],
    );
    expect(enough.unmatchedJobNames).toEqual([{ name: "Riverside", files: UNMATCHED_JOB_FLOOR }]);
    expect(UNMATCHED_JOB_FLOOR).toBe(3);
  });

  it("says nothing about a job that exists, whatever the case or spacing", () => {
    const summary = intakeTraySummary(
      [row({ jobHint: "  riverside  " }), row({ jobHint: "RIVERSIDE" }), row({ jobHint: "Riverside" })],
      ["Riverside"],
    );
    expect(summary.unmatchedJobNames).toEqual([]);
  });

  it("matches the short hint a filename carries against the long name a job has", () => {
    // THE CASE THIS RULE EXISTS FOR, and it was wrong under exact equality.
    // Jobs are named "Riverside Medical Office Building"; the hint a
    // classifier reads out of `Riverside COI 2027.pdf` is "Riverside",
    // because that is what an office types. Equality made every one of
    // those a MISSING job, so the tray announced three files naming a job
    // you do not have while that job sat in the picker on the same screen.
    // Found by running the real job names through it.
    const jobs = [
      "Riverside Medical Office Building [demo]",
      "Northgate Apartments Phase 2 [demo]",
      "Cedar Park Elementary [demo]",
    ];
    const three = (hint: string) => [row({ jobHint: hint }), row({ jobHint: hint }), row({ jobHint: hint })];

    expect(intakeTraySummary(three("Riverside"), jobs).unmatchedJobNames).toEqual([]);
    expect(intakeTraySummary(three("Northgate"), jobs).unmatchedJobNames).toEqual([]);
    expect(intakeTraySummary(three("Cedar Park"), jobs).unmatchedJobNames).toEqual([]);
  });

  it("stops at a word boundary, so a prefix of a word is not a match", () => {
    // Not a substring and not a fuzzy distance. "River" is not "Riverside",
    // and a suggestion that cannot tell two jobs apart is worse than none.
    const jobs = ["Riverside Medical Office Building [demo]"];
    const three = (hint: string) => [row({ jobHint: hint }), row({ jobHint: hint }), row({ jobHint: hint })];

    expect(intakeTraySummary(three("River"), jobs).unmatchedJobNames).toEqual([
      { name: "River", files: 3 },
    ]);
    // And a genuinely absent job still gets said out loud — the control
    // that stops this rule going quietly permissive.
    expect(intakeTraySummary(three("Oakmont"), jobs).unmatchedJobNames).toEqual([
      { name: "Oakmont", files: 3 },
    ]);
  });

  it("ignores the hint on a row somebody has already put on a job", () => {
    const summary = intakeTraySummary(
      [
        row({ jobHint: "Riverside", jobId: "job-1" }),
        row({ jobHint: "Riverside", jobId: "job-1" }),
        row({ jobHint: "Riverside", jobId: "job-1" }),
      ],
      [],
    );
    // That question has been answered; a hint is not evidence against it.
    expect(summary.unmatchedJobNames).toEqual([]);
  });
});

describe("intakeAlerts", () => {
  it("says nothing at all about an empty tray", () => {
    expect(intakeAlerts({ readyToFile: 0, needsALook: 0, unmatchedJobNames: [] })).toEqual([]);
  });

  it("never counts the same file twice", () => {
    // The two numbers are disjoint by construction now — countIntake puts
    // each row in exactly one bucket — rather than by a subtraction here
    // that could disagree with the tray's own header, and once did.
    const alerts = intakeAlerts({ readyToFile: 10, needsALook: 4, unmatchedJobNames: [] });
    expect(alerts).toHaveLength(2);
    expect(alerts[0].title).toContain("4 dropped files need a look");
    expect(alerts[1].title).toContain("10 documents are ready");
  });

  it("drops the routine line entirely when every file needs a look", () => {
    const alerts = intakeAlerts({ readyToFile: 0, needsALook: 4, unmatchedJobNames: [] });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain("4 dropped files need a look");
  });

  it("gets its singulars right — this is on screen, not in a log", () => {
    const one = intakeAlerts({ readyToFile: 0, needsALook: 1, unmatchedJobNames: [] });
    expect(one[0].title).toBe("1 dropped file needs a look");
    const routine = intakeAlerts({ readyToFile: 1, needsALook: 0, unmatchedJobNames: [] });
    expect(routine[0].title).toBe("1 document is ready to file");
  });

  it("carries no date and no invented urgency", () => {
    const alerts = intakeAlerts({
      readyToFile: 7,
      needsALook: 2,
      unmatchedJobNames: [{ name: "Riverside", files: 4 }],
    });
    expect(alerts).toHaveLength(3);
    // A tray is a standing condition. Nothing here has a deadline, and
    // dressing one up as OVERDUE would make it indistinguishable from a
    // certified payroll filing that genuinely is.
    expect(alerts.every((a) => a.severity === "STANDING")).toBe(true);
    expect(alerts.every((a) => a.dueOn === null && a.daysUntil === null)).toBe(true);
    expect(alerts.every((a) => a.amount === null)).toBe(true);
    // Every suggestion has somewhere to go — that is the "yes".
    expect(alerts.every((a) => a.href === "/intake")).toBe(true);
  });

  it("changes its key when the number changes, so a dismissal cannot outlive the situation", () => {
    const at14 = intakeAlerts({ readyToFile: 14, needsALook: 0, unmatchedJobNames: [] })[0];
    const at8 = intakeAlerts({ readyToFile: 8, needsALook: 0, unmatchedJobNames: [] })[0];
    // Dismiss "14 waiting", file six, and it comes back at 8. That is the
    // whole reason these are alerts rather than a suggestions panel of
    // their own — `alertKey` folds the fact into the key and nobody had to
    // write this behaviour.
    expect(at14.key).not.toBe(at8.key);
    // And the same situation twice is the same key, or a dismissal would
    // never stick at all.
    expect(intakeAlerts({ readyToFile: 8, needsALook: 0, unmatchedJobNames: [] })[0].key).toBe(at8.key);
  });

  it("never puts the raw count in the key, the way every other alert here does not", () => {
    // Issue #109's shape: a key readable in the RSC flight payload must not
    // leak the figure the permission layer may have nulled.
    const alert = intakeAlerts({ readyToFile: 14, needsALook: 0, unmatchedJobNames: [] })[0];
    expect(alert.key).not.toContain("14");
  });

  it("needs the same permission the tray itself does", () => {
    // An alert is a summary of the thing it points at. Without this, a
    // foreman with no access to /intake is still told what is in it.
    expect(ALERT_CAPABILITY.DOCUMENT_INTAKE).toBe("MANAGE_JOBS");
  });

  it("is spelled the same in every list a new kind has to join", () => {
    // The "written, documented, and never called" shape, inverted: a kind
    // added to the union and to nothing else renders its own enum name at
    // the user.
    const kind: AlertKind = "DOCUMENT_INTAKE";
    expect(ALERT_KIND_LABELS[kind]).toBe("Document intake");
    expect(Object.keys(ALERT_KIND_LABELS).sort()).toEqual(Object.keys(ALERT_CAPABILITY).sort());
  });
});
