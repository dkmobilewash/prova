import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { checkChangeOrder, EMPTY_DRAFT } from "./change-order";
import { renderChangeOrderPdf } from "./change-order-pdf";
import { MemoryRateStore } from "./rate-limit";
import { checkTicket } from "./tm-ticket";
import { renderTicketPdf } from "./tm-ticket-pdf";
import { handleTicketRequest } from "./tm-ticket-request";

/**
 * THIS TOOL NEVER SAYS A WAIVER IS SAFE TO SIGN -- the rule C-Stream's own
 * lien waiver feature lives under (apps/web/lib/lien-waiver.ts), carried
 * over whole. A census of every source file a visitor or a PDF can see,
 * for the phrases that reassure.
 *
 * Its scope is asserted, not assumed: the set of files must include the
 * copy file and the pages, so a census that silently walked nothing would
 * fail rather than pass.
 */

const ROOT = join(__dirname, "..");
const SCANNED_DIRS = ["app", "components", "lib"];
const REASSURING = [
  /safe to sign/i,
  /you(?:'|’)re all set/i,
  /looks good/i,
  /no issues/i,
  /fully compliant/i,
  /guaranteed/i,
  /legally binding/i,
  /attorney[- ]approved/i,
  /lawyer[- ]approved/i,
  /100% (?:legal|compliant|accurate)/i,
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : walk(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("no reassurance", () => {
  const files = SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir)));

  it("is looking at the files a visitor sees", () => {
    const names = files.map((file) => relative(ROOT, file));
    expect(names).toContain("lib/content.ts");
    expect(names).toContain("lib/pdf.ts");
    expect(names.some((name) => name.startsWith("app/"))).toBe(true);
    expect(names.some((name) => name.startsWith("components/"))).toBe(true);
  });

  it.each(REASSURING.map((pattern) => [pattern.source, pattern] as const))("never says /%s/", (_source, pattern) => {
    const hits = files.filter((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        // Comments quoting the rule are not copy.
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .some((line) => pattern.test(line)),
    );
    expect(hits.map((file) => relative(ROOT, file))).toEqual([]);
  });
});

/**
 * THE CHANGE ORDER REQUEST NEVER GIVES LEGAL ADVICE OR PROMISES PAYMENT
 * (Diego's plan, 2026-10-17: no attorney gate, but a guard). A PCO is the
 * sub's own request; the tool lays it out and says nothing about what the
 * GC must do, what the sub is owed, or what the paper binds anyone to.
 *
 * Stricter than REASSURING above, and scoped to the tool's own files plus
 * the frame it renders in, because "guarantee" or "entitled" can be a fair
 * word in a statute the waiver quotes and is never one here. The scope is
 * asserted as an exact list, so a renamed file cannot drop out of it
 * silently -- and the PDF's own text is checked too, since that is what a
 * GC actually reads.
 */
const PROMISING = [
  /guarantee/i,
  /\bentitle/i,
  /legally/i,
  /\bbinding\b/i,
  /\benforceab/i,
  /\bliab(?:le|ility)\b/i,
  /\bowe[sd]?\b/i,
  /\bmust (?:pay|approve|accept|sign)\b/i,
  /\b(?:will|shall) (?:be )?pa(?:y|id)\b/i,
  /\bgets? paid\b/i,
  /\byou have (?:a |the )?right\b/i,
  /\bclaim/i,
  /\bin breach\b/i,
];

describe("the change order request and the T&M ticket promise nothing", () => {
  const files = SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir))).filter((file) =>
    /change-order|ChangeOrder|StepShell|tm-ticket|TmTicket/.test(relative(ROOT, file)),
  );

  it("is looking at every file of both tools", () => {
    expect(files.map((file) => relative(ROOT, file)).sort()).toEqual([
      "app/api/change-order/route.ts",
      "app/api/tm-ticket/route.ts",
      "app/change-order/page.tsx",
      "app/tm-ticket/page.tsx",
      "components/ChangeOrderTool.tsx",
      "components/StepShell.tsx",
      "components/TmTicketTool.tsx",
      "lib/change-order-pdf.ts",
      "lib/change-order-request.ts",
      "lib/change-order.ts",
      "lib/tm-ticket-pdf.ts",
      "lib/tm-ticket-request.ts",
      "lib/tm-ticket.ts",
    ]);
  });

  it.each(PROMISING.map((pattern) => [pattern.source, pattern] as const))("never says /%s/ on screen or in email", (_source, pattern) => {
    const hits = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line))
        .filter((line) => pattern.test(line))
        .map((line) => `${relative(ROOT, file)}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it.each(PROMISING.map((pattern) => [pattern.source, pattern] as const))("never prints /%s/ in the PDF", async (_source, pattern) => {
    expect(pdfText).not.toMatch(pattern);
  });

  // Rendered once, from neutral values, so every hit is the tool's own words.
  let pdfText = "";
  beforeAll(async () => {
    const { order } = checkChangeOrder({
      ...EMPTY_DRAFT,
      companyName: "A",
      project: "B",
      gc: "C",
      date: "2026-10-17",
      title: "D",
      description: "E",
      labor: [{ description: "F", quantity: "1", unit: "", unitPrice: "1" }],
      scheduleDays: "1",
      backup: "G",
    });
    const standardFontDataUrl = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";
    const doc = await getDocument({ data: await renderChangeOrderPdf(order!, "H"), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl }).promise;
    for (let n = 1; n <= doc.numPages; n += 1) {
      for (const item of (await (await doc.getPage(n)).getTextContent()).items) if ("str" in item) pdfText += ` ${item.str}`;
    }
    expect(pdfText).toContain("General contractor acceptance");
  });

  it.each(PROMISING.map((pattern) => [pattern.source, pattern] as const))("never prints /%s/ on a T&M ticket or its email", async (_source, pattern) => {
    expect(tm.pdf).not.toMatch(pattern);
    expect(tm.email).not.toMatch(pattern);
  });

  /**
   * A T&M TICKET IS HOURS AND QUANTITIES, NEVER MONEY, AND ITS SIGNATURE IS
   * NOT A PAYMENT PROMISE (Diego's spec, 2026-10-17). Checked on what the GC
   * actually reads -- the PDF and the email both people get -- rather than on
   * the source, whose own copy says "no prices go on a ticket" to the sub.
   */
  const NOT_ON_A_TICKET = [/\$/, /\bprice/i, /\bcost/i, /\brate\b/i, /\bamount/i, /\bpaid\b/i, /\bpayment/i, /\bapprov/i, /\bauthori[sz]/i, /\bbill/i, /\binvoice/i];
  it.each(NOT_ON_A_TICKET.map((pattern) => [pattern.source, pattern] as const))("a T&M ticket never says /%s/", (_source, pattern) => {
    expect(tm.pdf).not.toMatch(pattern);
    expect(tm.email).not.toMatch(pattern);
  });

  const tm = { pdf: "", email: "" };
  beforeAll(async () => {
    const draft = {
      number: "TM-1NQ8K3P-7QX",
      companyName: "A",
      project: "B",
      gc: "C",
      date: "2026-10-18",
      summary: "D",
      details: "E",
      crew: [{ name: "F", hours: "8" }],
      material: [{ description: "G", quantity: "1", unit: "" }],
      equipment: [{ description: "H", quantity: "1", unit: "" }],
      superName: "J",
      superTitle: "K",
      superEmail: "l@example.com",
      signature: "M10 10 L20 20 L30 30 L40 40",
    };
    const standardFontDataUrl = join(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";
    const doc = await getDocument({ data: await renderTicketPdf(checkTicket(draft).ticket!, "N"), useSystemFonts: false, isEvalSupported: false, standardFontDataUrl }).promise;
    for (let n = 1; n <= doc.numPages; n += 1) {
      for (const item of (await (await doc.getPage(n)).getTextContent()).items) if ("str" in item) tm.pdf += ` ${item.str}`;
    }
    expect(tm.pdf).toContain("General contractor's superintendent");
    // The email both people get, through the real handler with a fake send.
    await handleTicketRequest(
      { ticket: draft, email: "n@example.com", name: "N" },
      {
        env: {},
        ip: "1",
        rate: { store: new MemoryRateStore(), salt: "s" },
        send: async (message) => {
          if (message.cc) tm.email = `${message.subject}\n${message.text}`;
          return { status: "sent", id: "x" };
        },
        subscribe: async () => ({ status: "sent", id: "c" }),
      },
    );
    expect(tm.email).toContain("TM-1NQ8K3P-7QX");
  });
});
