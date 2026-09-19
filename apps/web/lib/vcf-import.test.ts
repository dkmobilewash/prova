import { describe, expect, it } from "vitest";
import {
  VCF_SSN_REFUSAL,
  looksLikeVcf,
  parseVcards,
  planVcfImport,
  vcfDisplayRows,
  vcfWriteCount,
} from "./vcf-import";
import { MAX_IMPORT_ROWS } from "./spreadsheet-import";

/**
 * The vCard path: the parser against the three formats phones actually
 * export (2.1 with quoted-printable, 3.0, 4.0), and the plan against the
 * app's contact shape — a card with a company creates or matches that
 * company's Contact and attaches the person; a card without one becomes a
 * Contact of its own. Same idempotency rule as every import: the same file
 * twice adds nothing the second time.
 */

const IPHONE_CARD = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:Smith;John;;;",
  "FN:John Smith",
  "ORG:Acme Builders;Estimating",
  "TITLE:Chief Estimator",
  "TEL;TYPE=CELL;TYPE=VOICE:(775) 555-0123",
  "TEL;TYPE=WORK:775-555-0100",
  "EMAIL;TYPE=INTERNET;TYPE=WORK:john@acmebuilders.com",
  "ADR;TYPE=WORK:;;100 Main St;Reno;NV;89501;USA",
  "END:VCARD",
].join("\r\n");

describe("parseVcards", () => {
  it("reads an iPhone-style 3.0 card: FN, first TEL with its type, EMAIL, ORG's first component, joined ADR", () => {
    const [card] = parseVcards(IPHONE_CARD);
    expect(card.personName).toBe("John Smith");
    expect(card.org).toBe("Acme Builders"); // never "Acme Builders;Estimating"
    expect(card.title).toBe("Chief Estimator");
    expect(card.phone).toBe("(775) 555-0123"); // the FIRST TEL
    expect(card.phoneType).toBe("cell");
    expect(card.email).toBe("john@acmebuilders.com");
    expect(card.address).toBe("100 Main St, Reno, NV 89501, USA");
  });

  it("unfolds RFC-folded lines (continuation starts with one space)", () => {
    const folded = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Maria Elena Lop",
      " ez",
      "ORG:Sierra Plas",
      "\ttering",
      "END:VCARD",
    ].join("\r\n");
    const [card] = parseVcards(folded);
    expect(card.personName).toBe("Maria Elena Lopez");
    expect(card.org).toBe("Sierra Plastering");
  });

  it("decodes a folded quoted-printable 2.1 card the way old Android wrote it — soft breaks and UTF-8 bytes", () => {
    const android = [
      "BEGIN:VCARD",
      "VERSION:2.1",
      // "Müller;Jürgen" in QP UTF-8, split by a soft line break (`=` at end,
      // continuation WITHOUT a leading space — 2.1's folding, not RFC's).
      "N;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:M=C3=BCller;J=C3=", "=BCrgen",
      "TEL;CELL:+49 170 5550123",
      "END:VCARD",
    ].join("\r\n");
    const [card] = parseVcards(android);
    expect(card.personName).toBe("Jürgen Müller");
    expect(card.phone).toBe("+49 170 5550123");
    expect(card.phoneType).toBe("cell"); // 2.1's bare CELL, no TYPE=
  });

  it("reads a 4.0 card: tel: URI stripped, quoted TYPE list, name assembled from N when FN is absent", () => {
    const v4 = [
      "BEGIN:VCARD",
      "VERSION:4.0",
      "N:Nguyen;Kim;T.;;",
      'TEL;VALUE=uri;TYPE="cell,voice":tel:+17755550188',
      "EMAIL:kim@example.com",
      "END:VCARD",
    ].join("\r\n");
    const [card] = parseVcards(v4);
    expect(card.personName).toBe("Kim T. Nguyen");
    expect(card.phone).toBe("+17755550188");
    expect(card.phoneType).toBe("cell");
  });

  it("reads every card in a multi-card file, unescaping \\, and \\;", () => {
    const two = [
      "BEGIN:VCARD",
      "FN:Solo Contact",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Ana Ruiz",
      "ORG:Ruiz\\, Sons \\; Co",
      "END:VCARD",
    ].join("\n");
    const cards = parseVcards(two);
    expect(cards).toHaveLength(2);
    expect(cards[1].org).toBe("Ruiz, Sons ; Co");
  });

  it("flags a card whose NOTE mentions a whole SSN", () => {
    const noted = [
      "BEGIN:VCARD",
      "FN:Bad Idea",
      "NOTE:payroll ssn 123-45-6789 do not lose",
      "END:VCARD",
    ].join("\n");
    expect(parseVcards(noted)[0].mentionsSsn).toBe(true);
    expect(parseVcards(IPHONE_CARD)[0].mentionsSsn).toBe(false);
  });
});

describe("looksLikeVcf", () => {
  it("accepts a vCard (BOM included), rejects a CSV", () => {
    expect(looksLikeVcf(IPHONE_CARD)).toBe(true);
    expect(looksLikeVcf("﻿BEGIN:VCARD\nEND:VCARD")).toBe(true);
    expect(looksLikeVcf("Name,Type\nAcme,GC")).toBe(false);
  });
});

function card(lines: string[]): string {
  return ["BEGIN:VCARD", ...lines, "END:VCARD"].join("\n");
}

describe("planVcfImport", () => {
  it("a card with ORG creates the company's contact with the person attached; without ORG the person is the contact", () => {
    const text = [
      card(["FN:John Smith", "ORG:Acme Builders", "TITLE:PM", "TEL;TYPE=CELL:555-0123", "EMAIL:john@acme.com", "ADR:;;100 Main St;Reno;NV;89501;"]),
      card(["FN:Dave Plumber", "TEL:555-0199"]),
    ].join("\n");
    const plan = planVcfImport(text, [], []);
    expect(plan.problems).toEqual([]);
    expect(plan.createContacts).toHaveLength(2);

    const [acme, dave] = plan.createContacts;
    expect(acme.name).toBe("Acme Builders");
    expect(acme.fromOrg).toBe(true);
    expect(acme.address).toBe("100 Main St, Reno, NV 89501");
    // The person's phone and email are the PERSON's, not the company's.
    expect(acme.phone).toBeNull();
    expect(acme.people).toEqual([
      { card: 1, name: "John Smith", title: "PM", email: "john@acme.com", phone: "555-0123" },
    ]);

    expect(dave.name).toBe("Dave Plumber");
    expect(dave.fromOrg).toBe(false);
    expect(dave.phone).toBe("555-0199");
    expect(dave.people).toEqual([]);

    expect(vcfWriteCount(plan)).toBe(3); // 2 contacts + 1 person
    expect(vcfDisplayRows(plan)).toHaveLength(3); // the table shows every write
  });

  it("five cards from one company are one contact and five people", () => {
    const text = [1, 2, 3, 4, 5]
      .map((n) => card([`FN:Person ${n}`, "ORG:Acme Builders"]))
      .join("\n");
    const plan = planVcfImport(text, [], []);
    expect(plan.createContacts).toHaveLength(1);
    expect(plan.createContacts[0].people).toHaveLength(5);
  });

  it("matches an existing contact by name — case-insensitively — and only attaches the new person", () => {
    const text = card(["FN:John Smith", "ORG:ACME  builders"]);
    const plan = planVcfImport(text, ["Acme Builders"], []);
    expect(plan.createContacts).toEqual([]);
    expect(plan.attachPeople).toEqual([
      { card: 1, name: "John Smith", title: null, email: null, phone: null, contactName: "ACME builders" },
    ]);
  });

  it("importing the same file twice adds nothing the second time", () => {
    const text = [card(["FN:John Smith", "ORG:Acme Builders"]), card(["FN:Dave Plumber"])].join("\n");
    const first = planVcfImport(text, [], []);
    expect(vcfWriteCount(first)).toBe(3);
    // As after the first Confirm: contact and person now exist.
    const second = planVcfImport(
      text,
      ["Acme Builders", "Dave Plumber"],
      [{ contactName: "Acme Builders", name: "John Smith" }],
    );
    expect(vcfWriteCount(second)).toBe(0);
    expect(second.existing.map((row) => row.label)).toEqual(["John Smith at Acme Builders", "Dave Plumber"]);
    expect(second.problems).toEqual([]);
  });

  it("dedupes within the file: a repeated person-card is a problem naming the earlier card", () => {
    const text = [card(["FN:Dave Plumber"]), card(["FN:dave  plumber"])].join("\n");
    const plan = planVcfImport(text, [], []);
    expect(plan.createContacts).toHaveLength(1);
    expect(plan.problems).toEqual([
      { line: 2, message: "dave plumber — same name as card 1, so they're only added once." },
    ]);
  });

  it("refuses a card mentioning a whole SSN — in a NOTE — without repeating the number", () => {
    const text = [
      card(["FN:Bad Idea", "NOTE:ssn 123-45-6789", "TEL:555-0100"]),
      card(["FN:Fine Card"]),
    ].join("\n");
    const plan = planVcfImport(text, [], []);
    expect(plan.createContacts.map((c) => c.name)).toEqual(["Fine Card"]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0].message).toBe(`Bad Idea — ${VCF_SSN_REFUSAL}`);
    expect(plan.problems[0].message).not.toContain("6789");
  });

  it("skips a card with no name at all, saying which card", () => {
    const text = [card(["TEL:555-0100"]), card(["FN:Fine Card"])].join("\n");
    const plan = planVcfImport(text, [], []);
    expect(plan.createContacts.map((c) => c.name)).toEqual(["Fine Card"]);
    expect(plan.problems).toEqual([{ line: 1, message: "Card 1 has no name — skipped." }]);
  });

  it("caps at the same 500 as every import, counted in cards", () => {
    const text = Array.from({ length: MAX_IMPORT_ROWS + 3 }, (_, i) => card([`FN:Person ${i + 1}`])).join("\n");
    const plan = planVcfImport(text, [], []);
    expect(plan.createContacts).toHaveLength(MAX_IMPORT_ROWS);
    expect(plan.problems.map((p) => p.message).join(" ")).toContain(
      `Only the first ${MAX_IMPORT_ROWS} contacts`,
    );
  });

  it("says so when the text holds no cards", () => {
    const plan = planVcfImport("BEGIN:VCARD", [], []);
    expect(plan.problems).toEqual([{ line: 1, message: "No contacts found in that file." }]);
  });
});
