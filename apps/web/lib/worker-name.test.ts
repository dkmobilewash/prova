import { describe, expect, it } from "vitest";
import { NAME_NOT_RECORDED, payrollWorkerName } from "./worker-name";

describe("the name printed on certified payroll", () => {
  it("uses the recorded name", () => {
    expect(payrollWorkerName({ name: "Maria Ortiz", email: "m@example.com" })).toEqual({
      label: "Maria Ortiz",
      nameMissing: false,
    });
  });

  it("NEVER falls back to the email address", () => {
    // The whole point. A WH-347 is a statement to a government agency about
    // who did the work; an email address is not a person's name, and a wrong
    // name on a filed form is a correction to an agency, not a patch.
    const result = payrollWorkerName({ name: null, email: "dave@example.com" });
    expect(result.label).not.toContain("dave@example.com");
    expect(result.label).not.toContain("@");
    expect(result.label).toBe(NAME_NOT_RECORDED);
    expect(result.nameMissing).toBe(true);
  });

  it("treats a blank or whitespace name as missing", () => {
    // An empty cell reads as a formatting bug and gets skimmed past; a
    // sentence gets acted on.
    for (const name of ["", "   ", "\t", "\n "]) {
      const result = payrollWorkerName({ name, email: "x@example.com" });
      expect(result.nameMissing, JSON.stringify(name)).toBe(true);
      expect(result.label, JSON.stringify(name)).toBe(NAME_NOT_RECORDED);
    }
  });

  it("trims a padded name rather than printing the padding", () => {
    expect(payrollWorkerName({ name: "  Maria Ortiz  ", email: "m@example.com" }).label).toBe(
      "Maria Ortiz",
    );
  });

  it("does not treat a name that merely looks like an email as missing", () => {
    // If somebody genuinely typed their address into the name field, that is
    // their recorded name and this is not the place to second-guess it — the
    // rule here is only about the silent FALLBACK.
    expect(payrollWorkerName({ name: "dave@example.com", email: "dave@example.com" })).toEqual({
      label: "dave@example.com",
      nameMissing: false,
    });
  });
});
