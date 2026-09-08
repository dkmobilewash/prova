import { describe, expect, it } from "vitest";
import {
  CONTRACT_NOT_EXECUTED_REFUSAL,
  contractExecutionFor,
  contractIsExecuted,
  describeContractExecution,
  formatUtcDate,
  parseExecutedSignedDate,
} from "./contract-execution";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** An ordinary upload: no signing date, so no assertion attached to it. */
const plainDoc = (versionNumber: number) => ({
  versionNumber,
  fileName: `v${versionNumber}.pdf`,
  fileUrl: `https://blob.example/v${versionNumber}.pdf`,
  executedSignedDate: null,
  recordedAt: utc("2026-09-01"),
  recordedByName: "Cyrus",
});

const executedDoc = (versionNumber: number, signed: string) => ({
  ...plainDoc(versionNumber),
  executedSignedDate: utc(signed),
});

describe("which route a contract took", () => {
  it("is NONE when there is neither a signature nor an executed document", () => {
    const execution = contractExecutionFor(null, [plainDoc(1), plainDoc(2)]);
    expect(execution.route).toBe("NONE");
    expect(contractIsExecuted(execution)).toBe(false);
  });

  it("an ordinary uploaded contract file is NOT evidence of execution", () => {
    // The upload form has always existed. If merely having a PDF on file
    // counted, every job with a draft attached would become billable.
    expect(contractExecutionFor(null, [plainDoc(1)]).route).toBe("NONE");
  });

  it("is ESIGN when the GC signed inside Prova", () => {
    const execution = contractExecutionFor(
      { signerName: "Dana at Turner", signedAt: utc("2026-08-20") },
      [plainDoc(1)],
    );
    expect(execution.route).toBe("ESIGN");
    expect(contractIsExecuted(execution)).toBe(true);
  });

  it("is OFF_PLATFORM when an executed subcontract was recorded", () => {
    const execution = contractExecutionFor(null, [executedDoc(1, "2026-07-04")]);
    expect(execution.route).toBe("OFF_PLATFORM");
    expect(contractIsExecuted(execution)).toBe(true);
    if (execution.route !== "OFF_PLATFORM") throw new Error("narrowing");
    expect(execution.document.executedSignedDate).toEqual(utc("2026-07-04"));
    expect(execution.document.recordedAt).toEqual(utc("2026-09-01"));
    expect(execution.document.recordedByName).toBe("Cyrus");
  });

  it("is BOTH when both happened — a reader is owed both, not the first one found", () => {
    const execution = contractExecutionFor(
      { signerName: "Dana at Turner", signedAt: utc("2026-08-20") },
      [executedDoc(2, "2026-07-04")],
    );
    expect(execution.route).toBe("BOTH");
  });

  it("picks the EARLIEST executed version — the original agreement, not an amendment", () => {
    const execution = contractExecutionFor(null, [
      executedDoc(3, "2026-09-01"),
      executedDoc(1, "2026-07-04"),
      plainDoc(2),
    ]);
    if (execution.route !== "OFF_PLATFORM") throw new Error("expected OFF_PLATFORM");
    expect(execution.document.versionNumber).toBe(1);
    expect(execution.document.executedSignedDate).toEqual(utc("2026-07-04"));
  });
});

describe("what the page tells a reader", () => {
  it("never leaves an e-signature and an off-platform assertion looking the same", () => {
    const esign = describeContractExecution(
      contractExecutionFor({ signerName: "Dana", signedAt: utc("2026-08-20") }, []),
    );
    const offPlatform = describeContractExecution(
      contractExecutionFor(null, [executedDoc(1, "2026-08-20")]),
    );

    expect(esign).toContain("E-signed in Prova");
    expect(esign).not.toContain("off-platform");
    expect(offPlatform).toContain("Executed off-platform");
    expect(offPlatform).not.toContain("E-signed in Prova");
    expect(esign).not.toBe(offPlatform);
  });

  it("the off-platform sentence names the signing date, the recorder and the recording date", () => {
    const text = describeContractExecution(
      contractExecutionFor(null, [executedDoc(1, "2026-07-04")]),
    );
    expect(text, "the GC's signing date").toContain("Jul 4, 2026");
    expect(text, "who asserted it").toContain("Cyrus");
    expect(text, "when Prova was told").toContain("Sep 1, 2026");
  });

  it("says both when both happened", () => {
    const text = describeContractExecution(
      contractExecutionFor({ signerName: "Dana", signedAt: utc("2026-08-20") }, [
        executedDoc(1, "2026-07-04"),
      ]),
    );
    expect(text).toContain("E-signed in Prova");
    expect(text).toContain("Jul 4, 2026");
  });

  it("says plainly that nothing is executed rather than saying nothing", () => {
    expect(describeContractExecution({ route: "NONE" })).toBe("Not executed yet.");
  });

  it("renders dates at UTC — a UTC-midnight date must not slip back a day", () => {
    // Rendered in local time on a US machine this reads "Jul 3".
    expect(formatUtcDate(utc("2026-07-04"))).toBe("Jul 4, 2026");
    expect(formatUtcDate(utc("2026-01-01"))).toBe("Jan 1, 2026");
  });

  it("the refusal names BOTH routes — the old one named only the signature", () => {
    expect(CONTRACT_NOT_EXECUTED_REFUSAL).toContain("signing link");
    expect(CONTRACT_NOT_EXECUTED_REFUSAL).toContain("executed subcontract");
    expect(CONTRACT_NOT_EXECUTED_REFUSAL).toContain("date the GC signed");
  });
});

describe("the entered signing date", () => {
  const now = new Date("2026-09-05T18:00:00.000Z");

  it("stores at UTC midnight so a comparison is a calendar-day comparison", () => {
    const parsed = parseExecutedSignedDate("2026-07-04", now);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected ok");
    expect(parsed.value.toISOString()).toBe("2026-07-04T00:00:00.000Z");
  });

  it("accepts today", () => {
    expect(parseExecutedSignedDate("2026-09-05", now).ok).toBe(true);
  });

  it("refuses tomorrow — a GC cannot have signed in the future", () => {
    const parsed = parseExecutedSignedDate("2026-09-06", now);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected refusal");
    expect(parsed.error).toContain("can't be in the future");
  });

  it("refuses a year typo, which is the real-world version of that", () => {
    expect(parseExecutedSignedDate("2027-07-04", now).ok).toBe(false);
  });

  it("refuses an empty date and says what to enter", () => {
    const parsed = parseExecutedSignedDate("   ", now);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("expected refusal");
    expect(parsed.error).toContain("date the GC signed");
  });

  it("refuses a date that does not exist — JS silently rolls 2026-02-31 into March", () => {
    expect(new Date("2026-02-31T00:00:00.000Z").getTime()).not.toBeNaN();
    expect(parseExecutedSignedDate("2026-02-31", now).ok).toBe(false);
  });

  it("refuses anything that is not a plain YYYY-MM-DD", () => {
    for (const raw of ["07/04/2026", "2026-7-4", "yesterday", "2026-07-04T12:00:00Z"]) {
      expect(parseExecutedSignedDate(raw, now).ok, `${raw} must be refused`).toBe(false);
    }
  });

  it("accepts an old date — subcontracts arrive long after they were signed", () => {
    expect(parseExecutedSignedDate("2024-01-15", now).ok).toBe(true);
  });
});
