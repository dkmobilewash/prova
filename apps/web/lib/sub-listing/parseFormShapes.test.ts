import { describe, expect, it } from "vitest";
import { parseSubListing } from "./parse";
import { rowKeysFor } from "./signals";

/**
 * THE FORM SHAPES, WHICH `parsePartition.test.ts` CANNOT REACH — AND WHICH IS WHERE
 * BOTH OF 5 OCTOBER'S WORST DEFECTS LIVED.
 *
 * `parseSubListing` has three early returns for documents that are FORMS rather than
 * tables: the Caltrans numbered-box shape, the labelled-column shape, and a generic
 * refusal. They are the only paths where `accountedFor` is deliberately not the sum of
 * the four buckets — one label line carries up to six subcontractors' data while one
 * subcontractor is assembled from five lines, so the partition's one-row-per-line
 * premise does not hold and the reader refuses to claim a completeness it cannot
 * compute.
 *
 * A review censused the 6,000 documents `parsePartition.test.ts` generates and found
 * **zero** that reach any of the three. So the file asserting the reader's central
 * guarantee was blind to them, and two of that file's seven properties would go RED on
 * correct code if its generator ever produced one.
 *
 * That gap is not theoretical. The labelled reader is where two rows share a line, and
 * both defects found on 5 October lived in exactly that shape:
 *
 *   - a multi-bidder labelled form could be READ and never IMPORTED, because the
 *     selection travelled as line numbers and the server found more rows than keys;
 *   - and the per-lead claim dedupe had been deleted on the argument that two rows of
 *     one paste always have different line numbers, which is false here.
 *
 * Neither was visible to 483 unit tests or 61 db tests, because no corpus in the repo
 * had the shape.
 *
 * ── SO THIS IS A SECOND GENERATOR, ASSERTING A DIFFERENT INVARIANT ──
 *
 * Not the partition — that is the thing these readers legitimately do not provide.
 * What they do promise is narrower and is what the importer rests on:
 *
 *   1. it never throws;
 *   2. every row has a real, trimmed company name;
 *   3. the counts agree with the arrays they count;
 *   4. every row's `line` is a real non-blank line of the document;
 *   5. **`rowKeysFor` gives every row a distinct identity** even where several share a
 *      line — the property `importSubListing` now keys its selection on;
 *   6. an identifier is either absent or a strict match, never present-and-blank —
 *      `identify` keeps it verbatim where `listingProvenance` blanks it, so a blank one
 *      would make those two disagree. **Stated as insurance rather than as a live
 *      guard**: both readers return `null` or a regex-matched digit string, so the
 *      property is structural, and the mutation that makes `registrationOnly` return a
 *      raw cell reds 51 other tests while leaving this one green. It is here because the
 *      generator feeds it blank-ish cells for free, not because it can fail today;
 *   7. and the reconciliation has the DOCUMENTED form-reader shape:
 *      `accountedFor === ignoredLines`, `agreed === false`, nothing unread. That pins
 *      the difference `parsePartition.test.ts` says is false by construction here,
 *      instead of leaving it as prose in two files.
 *
 * ── THE CONTROLS, WHICH ARE MOST OF THE VALUE ──
 *
 * A generator that produced no FORMS would satisfy every property above by producing no
 * rows, which is precisely the failure this file exists to end. So the corpus must be
 * shown to reach the form readers at a RATE, to produce documents with SEVERAL BIDDER
 * COLUMNS (without which property 5 is vacuous — one row per line needs no ordinal),
 * and to produce multi-slot documents. Those three are asserted before any property is
 * read.
 *
 * Deterministic from one seed, like its sibling.
 */
describe("the labelled-column form, over generated documents rather than four fixtures", () => {
  const CASES = 2000;

  /** Mulberry32 — the same generator `parsePartition.test.ts` uses, same reason: a
   *  failure has to be reproducible rather than a story about a run nobody can repeat. */
  function rng(seed: number) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FIRMS = [
    "Ridgeline Interior Co", "Crest Lathing Co", "Summit Acoustics LLC", "Vantage Fire Co",
    "Dummy Demolition Group", "Notional Power Co", "Mock Acoustics Inc", "Sweep Drywall Co",
    "Harbor Interiors LLC", "Example Wallworks Inc",
  ];
  const SCOPES = [
    "Metal Stud Framing & Drywall", "Lath and Plaster", "Acoustical Ceilings",
    "Spray Applied Fireproofing", "DRYWALL/FRAMING", "Electrical", "Site Demolition", "EIFS",
  ];
  const CITIES = ["Fontana", "COLTON", "Riverside", "Perris", "Chula Vista", "Ontario"];
  /** Blank-ish cells, the shapes this repo has actually seen on these forms. */
  const EMPTY = ["", " ", "   ", "N/A", "n/a", "-", "--", "TBD"];
  const HEADS = [
    "LIST OF SUBCONTRACTORS:",
    "LIST OF SUBCONTRACTORS",
    "Designation of Subcontractors",
    "SUBCONTRACTOR LISTING:",
  ];

  /**
   * One labelled-column form. The columns are placed at FIXED offsets, which is what
   * makes the shape readable at all — this reader matches values by the column they
   * start at, across the label lines, so the padding is the document's structure rather
   * than its formatting.
   */
  function form(next: () => number): { text: string; columns: number; slots: number } {
    const pick = <T,>(list: readonly T[]) => list[Math.floor(next() * list.length)]!;
    const slots = 1 + Math.floor(next() * 3);
    const columns = Math.floor(next() * 5); // 0..4 — zero is a real shape: an unused form
    const width = 30;
    const at = (values: readonly string[]) =>
      values.map((value, index) => (index === values.length - 1 ? value : value.padEnd(width, " "))).join("");

    const lines: string[] = [];
    if (next() < 0.8) lines.push(`Project: ${pick(["Mesa Verde Science Building", "Harbor Elementary", "Lincoln Modernization"])}`);
    if (next() < 0.6) lines.push(`Agency: ${pick(["Example Community College District", "Harbor Unified School District"])}`);
    if (next() < 0.7) lines.push(`Prime Contractor: ${pick(["Northgate Builders", "Swinerton Builders", "Sweep Builders"])}`);
    if (next() < 0.4) lines.push("Bid Date: May 6, 2026");
    if (next() < 0.5) lines.push("");
    lines.push(pick(HEADS));

    for (let slot = 1; slot <= slots; slot += 1) {
      /** A cell per bidder column, blank-ish some of the time — which is the RAGGED
       *  case: a slot used by one bidder and not another. */
      const cells = (source: readonly string[]) =>
        Array.from({ length: columns }, () => (next() < 0.25 ? pick(EMPTY) : pick(source)));
      lines.push(`      Subcontractor ${slot} - Portion of the Work Activity`);
      lines.push(`      (e.g. electrical, mechanical, concrete)       ${at(cells(SCOPES))}`.trimEnd());
      lines.push(`      Subcontractor ${slot} - Name of Business            ${at(cells(FIRMS))}`.trimEnd());
      if (next() < 0.85) {
        lines.push(`      Subcontractor ${slot} - Location of Business (city) ${at(cells(CITIES))}`.trimEnd());
      }
      lines.push(
        `      Subcontractor ${slot} - License No.                 ${at(
          Array.from({ length: columns }, () =>
            next() < 0.2 ? pick(EMPTY) : `${next() < 0.3 ? "C-9 " : ""}${900000 + Math.floor(next() * 99999)}`,
          ),
        )}`.trimEnd(),
      );
      lines.push(
        `      Subcontractor ${slot} - DIR Registration No.        ${at(
          Array.from({ length: columns }, () =>
            next() < 0.2 ? pick(EMPTY) : `${1000000000 + Math.floor(next() * 999999)}`,
          ),
        )}`.trimEnd(),
      );
    }
    if (next() < 0.3) lines.push("Total Base Bid: $12,300,000");
    return { text: lines.join("\n"), columns, slots };
  }

  const next = rng(0x5104f0);
  const listings = Array.from({ length: CASES }, () => form(next));
  const parses = listings.map((listing) => ({ ...listing, parsed: parseSubListing(listing.text) }));

  /**
   * WHICH DOCUMENTS ARE FORMS IS DECIDED BY THE GENERATOR, NOT BY THE PARSE — and that
   * is a correction to this file's first version rather than a style choice.
   *
   * It detected a form reader as `accountedFor === ignoredLines`, which is also one of
   * the properties asserted below. Mutating the reader's `accountedFor` therefore made
   * the DETECTOR return false for all 2,000 documents: the control went red saying the
   * corpus reached no forms, and the reconciliation case passed over an empty set. The
   * mutation disabled the property instead of failing it, which is the circularity this
   * repo keeps paying for — a check must not derive its scope from the thing it checks.
   *
   * The generator knows what it built, so that is the scope now — and it has to match
   * what the DISPATCHER requires, which is a thing worth writing down: `buildingConnected
   * Listing` needs at least **two** "Name of Business" lines and **two** "License No."
   * lines before it will call a document this shape. A ONE-SLOT form therefore goes down
   * the ordinary table path, which is why the first version of this scope (any document
   * with a bidder column) pulled in documents whose `headerLines` are legitimately not
   * zero and red the reconciliation case for the right reason about the wrong set.
   *
   * So: at least one bidder column AND at least two slots. Both are the generator's own
   * facts, so nothing here derives its scope from the thing it checks.
   */
  const built = parses.filter(({ columns, slots }) => columns >= 1 && slots >= 2);

  it("generates a corpus that actually reaches the form reader, with columns to share a line", () => {
    expect(listings).toHaveLength(CASES);
    expect(
      built.length / CASES,
      "the generator built almost no multi-slot, multi-column forms — the dispatcher needs two of each label line",
    ).toBeGreaterThan(0.3);

    const asForm = built.filter(({ parsed }) => parsed.rows.length > 0);
    expect(
      asForm.length / CASES,
      `only ${asForm.length} of ${CASES} documents produced rows — this file would be about nothing`,
    ).toBeGreaterThan(0.15);

    /* SEVERAL ROWS ON ONE LINE, which is what makes the row-key property mean
       anything: with one row per line an ordinal is never needed and property 5 below
       passes for free. */
    const sharing = asForm.filter(
      ({ parsed }) => new Set(parsed.rows.map((row) => row.line)).size < parsed.rows.length,
    );
    expect(
      sharing.length,
      "no generated document put two subcontractors on one line — the row-key property is vacuous",
    ).toBeGreaterThan(CASES / 20);

    /* AND MULTI-SLOT DOCUMENTS, so rows come from more than one label block. */
    const multiLine = asForm.filter(({ parsed }) => new Set(parsed.rows.map((row) => row.line)).size > 1);
    expect(multiLine.length, "every document's rows came off one line").toBeGreaterThan(CASES / 20);

    // A spread of row counts, rather than every document producing the same shape.
    const counts = new Set(asForm.map(({ parsed }) => parsed.rows.length));
    expect(counts.size, "every form produced the same number of rows").toBeGreaterThan(2);
  });

  it("never throws, and every row it returns is nameable, placed and identified", () => {
    const failures: string[] = [];
    for (const { text } of listings) {
      let parsed;
      try {
        parsed = parseSubListing(text);
      } catch (error) {
        failures.push(`threw ${String(error)} on ${JSON.stringify(text)}`);
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (const row of parsed.rows) {
        if (row.name.trim() === "") failures.push(`blank name on ${JSON.stringify(text)}`);
        if (row.name !== row.name.trim()) failures.push(`untrimmed name ${JSON.stringify(row.name)}`);
        const source = lines[row.line - 1];
        if (source === undefined) failures.push(`line ${row.line} is past the end of ${JSON.stringify(text)}`);
        else if (source.trim() === "") failures.push(`line ${row.line} is blank on ${JSON.stringify(text)}`);
        for (const [field, value] of [["licence", row.licence], ["registration", row.registration]] as const) {
          if (value === null) continue;
          if (value.trim() === "") failures.push(`${field} present but blank on ${JSON.stringify(text)}`);
          if (value !== value.trim()) failures.push(`${field} has edge whitespace: ${JSON.stringify(value)}`);
        }
      }
      if (parsed.reconciliation.rowsParsed !== parsed.rows.length) {
        failures.push(`rowsParsed disagrees with rows.length on ${JSON.stringify(text)}`);
      }
      if (parsed.reconciliation.ignoredLines !== parsed.ignored.length) {
        failures.push(`ignoredLines disagrees with ignored.length on ${JSON.stringify(text)}`);
      }
    }
    expect(failures.slice(0, 3)).toEqual([]);
  });

  /**
   * THE PROPERTY `importSubListing` RESTS ON, over the only shape that can break it.
   *
   * The selection a reviewer makes travels as `rowKeysFor` keys, and the server resolves
   * each one back to a row. Two rows sharing a key would resolve to one of them and
   * silently drop the other — which is the shape of the defect this replaced, where the
   * key WAS the line and the whole paste was refused instead.
   */
  it("gives every row a distinct key, including rows that share a line", () => {
    const collisions: string[] = [];
    let sharingDocuments = 0;
    for (const { text, parsed } of parses) {
      const keys = rowKeysFor(parsed.rows);
      if (keys.length !== parsed.rows.length) collisions.push(`key count disagrees on ${JSON.stringify(text)}`);
      if (new Set(keys).size !== keys.length) {
        collisions.push(`duplicate key in ${JSON.stringify(keys)} on ${JSON.stringify(text)}`);
      }
      if (new Set(parsed.rows.map((row) => row.line)).size < parsed.rows.length) sharingDocuments += 1;
    }
    // Restated here rather than only in the control, because this is the case that
    // would pass vacuously without it.
    expect(sharingDocuments, "no document in this run shared a line between rows").toBeGreaterThan(0);
    expect(collisions.slice(0, 3)).toEqual([]);
  });

  /**
   * THE DOCUMENTED DIFFERENCE, PINNED. `parsePartition.test.ts` says in prose that two
   * of its properties are false by construction on these paths; this is the other side
   * of that sentence, so the two files cannot drift into disagreeing about it.
   */
  it("reports the reconciliation the form readers document, not a partition", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const { text, parsed } of built) {
      if (parsed.rows.length === 0) continue;
      checked += 1;
      const r = parsed.reconciliation;
      if (r.agreed) offenders.push(`agreed true on a form: ${JSON.stringify(text)}`);
      if (r.unreadLines !== 0 || parsed.unread.length !== 0) offenders.push(`unread on a form: ${JSON.stringify(text)}`);
      if (r.headerLines !== 0) offenders.push(`headerLines ${r.headerLines} on a form`);
      if (r.accountedFor !== r.ignoredLines) offenders.push(`accountedFor ${r.accountedFor} != ignoredLines ${r.ignoredLines}`);
      if (r.nonBlankLines < r.rowsParsed) offenders.push(`more rows than non-blank lines on ${JSON.stringify(text)}`);
    }
    /* The size assertion, and here it is the one that matters: the scope comes from the
       generator rather than from the reconciliation, so a reader that stopped reporting
       this shape fails the loop above instead of silently emptying it. */
    expect(checked, "no form document produced rows — this case checked nothing").toBeGreaterThan(CASES / 10);
    expect(offenders.slice(0, 3)).toEqual([]);
  });
});
