import { describe, expect, it } from "vitest";
import { nullableMoneyFromForm } from "./shared";

/**
 * The parser behind every optional money field on a form.
 *
 * Worth its own test for two reasons. It is the one place that decides
 * whether a blank field means "nobody recorded an amount" or "zero
 * dollars", which is the difference between an honest total and a wrong
 * one. And it is the returning twin of `nullableDecimalFromForm`, written
 * because that one throws and a thrown Server Action message is redacted
 * to a digest in production — so the sentence telling somebody to delete
 * the comma out of "120,000" only reaches them if it comes back as a
 * value.
 */

function form(value?: string) {
  const data = new FormData();
  if (value !== undefined) data.set("bidAmount", value);
  return data;
}

const parse = (value?: string) => nullableMoneyFromForm(form(value), "bidAmount", "Bid amount");

describe("nullableMoneyFromForm", () => {
  it("takes a plain number", () => {
    expect(parse("120000")).toEqual({ ok: true, value: "120000" });
  });

  it("keeps the string rather than the parsed float", () => {
    // The column is a Prisma Decimal. Round-tripping through a JS number
    // would be the one place in this path that could lose a cent.
    expect(parse("0.07")).toEqual({ ok: true, value: "0.07" });
  });

  it("reads blank as ABSENT, never as zero", () => {
    // The whole reason this returns `string | null` and not `string`. A
    // bid nobody has priced is not a bid of $0, and every total that ever
    // reads it depends on the difference.
    expect(parse("")).toEqual({ ok: true, value: null });
    expect(parse("   ")).toEqual({ ok: true, value: null });
    expect(parse(undefined)).toEqual({ ok: true, value: null });
  });

  it("refuses a thousands separator, and says which field and what to do", () => {
    // "120,000" is what a person actually types. Number() gives NaN, and
    // before this the refusal was thrown — a digest in production.
    const result = parse("120,000");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toContain("Bid amount");
    expect(result.error).toContain("120,000");
    expect(result.error).toContain("blank");
  });

  it("refuses INFINITY, which Number.isNaN would have let through", () => {
    // The reason the guard is Number.isFinite and not !Number.isNaN.
    // Number("Infinity") is Infinity, Prisma.Decimal accepts it, Postgres
    // numeric stores it, and every total it is added to becomes Infinity
    // for good. This is not hypothetical input to defend against so much
    // as the one value that slips past the obvious check.
    for (const word of ["Infinity", "-Infinity", "1e400"]) {
      const result = nullableMoneyFromForm(form(word), "bidAmount", "Bid amount");
      expect(result.ok, `expected "${word}" to be refused`).toBe(false);
    }
  });

  it("refuses text", () => {
    expect(parse("tbd").ok).toBe(false);
    expect(parse("$50").ok).toBe(false);
  });
});
