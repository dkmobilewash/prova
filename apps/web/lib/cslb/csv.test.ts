import { describe, expect, it } from "vitest";
import { createCsvReader, csvRows, rowsByHeader } from "./csv";

/**
 * The reader is hand-written, so these are not decoration. Each case is one of the
 * ways a hand-rolled CSV reader is wrong, and the chunk-boundary sweep at the
 * bottom is the one that found a real bug.
 */

describe("csvRows", () => {
  it("reads the plain case", () => {
    expect(csvRows("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps a comma that is inside quotes", () => {
    /* A business name in the real file: splitting on commas makes this 3 fields. */
    expect(csvRows('"ACME DRYWALL, INC",9165551234\n')).toEqual([
      ["ACME DRYWALL, INC", "9165551234"],
    ]);
  });

  it("reads a doubled quote as one literal quote", () => {
    expect(csvRows('"5"" TYPE X",b\n')).toEqual([['5" TYPE X', "b"]]);
  });

  it("reads a quoted field that is only an escaped quote", () => {
    expect(csvRows('""""\n')).toEqual([['"']]);
  });

  it("keeps a NEWLINE that is inside quotes", () => {
    /* The case that makes this a reader rather than text.split("\n"). */
    expect(csvRows('a,"two\nlines",c\n')).toEqual([["a", "two\nlines", "c"]]);
  });

  it("distinguishes an empty quoted field from a missing one", () => {
    expect(csvRows('a,"",c\n')).toEqual([["a", "", "c"]]);
  });

  it("handles CRLF", () => {
    expect(csvRows("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("returns the last record when the file does not end with a newline", () => {
    expect(csvRows("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not invent a phantom record from a trailing newline", () => {
    /* The bug this guards: an `end()` that always flushes gives every caller one
       extra row of a single empty field, and a downstream parser then reports a
       refusal for a row that does not exist. */
    expect(csvRows("a,b\n")).toEqual([["a", "b"]]);
    expect(csvRows("a,b\r\n")).toEqual([["a", "b"]]);
  });

  it("keeps an empty trailing field", () => {
    expect(csvRows("a,b,\n")).toEqual([["a", "b", ""]]);
  });
});

describe("the reader across chunk boundaries", () => {
  /**
   * A stream splits wherever it likes. This drives the SAME document split at
   * every single position and requires every split to produce the identical
   * result — which is a stronger claim than any handful of chosen boundaries, and
   * it is how the `\r`/`\n` straddle was settled.
   */
  const document = 'LicenseNo,BusinessName,BusinessPhone\r\n884201,"ACME DRYWALL, INC","(916) 555 1234"\r\n92,"O""BRIEN LATH",(530) 555 0101\r\n1162318,"TWO\nLINES CO",\r\n';
  const whole = csvRows(document);

  it("reads the reference document", () => {
    expect(whole).toEqual([
      ["LicenseNo", "BusinessName", "BusinessPhone"],
      ["884201", "ACME DRYWALL, INC", "(916) 555 1234"],
      ["92", 'O"BRIEN LATH', "(530) 555 0101"],
      ["1162318", "TWO\nLINES CO", ""],
    ]);
  });

  it("gives the same answer at every one of the possible split points", () => {
    const splits: number[] = [];
    for (let at = 0; at <= document.length; at += 1) {
      const reader = createCsvReader();
      const got = [
        ...reader.push(document.slice(0, at)),
        ...reader.push(document.slice(at)),
        ...reader.end(),
      ];
      if (JSON.stringify(got) !== JSON.stringify(whole)) splits.push(at);
    }
    expect(splits).toEqual([]);
    /* The sweep is only meaningful if it actually swept: a document of length 0
       would pass this vacuously. */
    expect(document.length).toBeGreaterThan(100);
  });

  it("gives the same answer when fed one character at a time", () => {
    const reader = createCsvReader();
    const got: string[][] = [];
    for (const char of document) got.push(...reader.push(char));
    got.push(...reader.end());
    expect(got).toEqual(whole);
  });
});

describe("rowsByHeader", () => {
  it("keys cells by the header row", () => {
    expect(rowsByHeader(csvRows("a,b\n1,2\n"))).toEqual([{ a: "1", b: "2" }]);
  });

  it("leaves a short row's missing cells undefined rather than empty", () => {
    /* A 52-column file whose row lost a column is a parse failure worth seeing.
       `""` would hide it as an ordinary blank. */
    expect(rowsByHeader(csvRows("a,b,c\n1,2\n"))).toEqual([
      { a: "1", b: "2", c: undefined },
    ]);
  });

  it("returns nothing for an empty document", () => {
    expect(rowsByHeader([])).toEqual([]);
  });

  it("returns nothing when the file is a header and no rows", () => {
    expect(rowsByHeader(csvRows("a,b\n"))).toEqual([]);
  });
});
