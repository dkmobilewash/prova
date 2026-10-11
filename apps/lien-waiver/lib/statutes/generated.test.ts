import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildForm, type SourceMeta } from "./build";
import { DEFINITIONS } from "./definitions";
import { htmlToParagraphs } from "./html-text.mjs";
import { buildPacket } from "./packet";
import { reviewDigest } from "./review";
import type { BuiltForm } from "./types";

/**
 * THE CHAIN FROM A LEGISLATURE'S SERVER TO WHAT THE APP PRINTS, re-derived
 * on every test run.
 *
 *   statutes/raw/<id>.html       bytes the official site sent (or rendered)
 *        | sha256 must equal statutes/raw/<id>.meta.json
 *   statutes/text/<id>.txt       one paragraph per line, html-text.mjs
 *        | buildForm + the definitions in states/*.ts
 *   lib/statutes/generated/forms.json   what the app imports
 *
 * Each committed file must equal what this test derives from the step
 * before it. Hand-edit any of them and this fails. To regenerate after a
 * deliberate change (a new capture, a new definition):
 *
 *   pnpm --filter @prova/lien-waiver statutes:update
 *
 * and then READ THE DIFF -- a regenerated form whose text changed has
 * changed what subs sign, and its attorney review no longer applies (see
 * review.ts, which binds a review to the text SHA).
 */

const ROOT = join(__dirname, "..", "..");
const RAW = join(ROOT, "statutes", "raw");
const TEXT = join(ROOT, "statutes", "text");
const GENERATED = join(__dirname, "generated", "forms.json");
const PACKET = join(ROOT, "docs", "attorney-packet.md");
const UPDATE = process.env.UPDATE_STATUTES === "1";

const sources: Array<{ id: string; state: string }> = JSON.parse(readFileSync(join(ROOT, "statutes", "sources.json"), "utf8")).sources;
const htmlSources = sources.filter((source) => existsSync(join(RAW, `${source.id}.html`)));

function readMeta(id: string): SourceMeta {
  return JSON.parse(readFileSync(join(RAW, `${id}.meta.json`), "utf8"));
}

function derivedParagraphs(id: string): string[] {
  return htmlToParagraphs(readFileSync(join(RAW, `${id}.html`)));
}

/** The committed form of the extracted text. A tab-free, newline-free
 * paragraph per line -- checked, since either would corrupt the format. */
function serialize(paragraphs: string[]): string {
  for (const paragraph of paragraphs) {
    if (/[\n\t]/.test(paragraph)) throw new Error("a paragraph contains a newline or tab after whitespace collapse");
  }
  return paragraphs.join("\n") + "\n";
}

describe("captured statute pages", () => {
  it("has every source the definitions use", () => {
    const used = new Set(DEFINITIONS.map((definition) => definition.sourceId));
    for (const id of used) expect(existsSync(join(RAW, `${id}.html`)), `${id}.html`).toBe(true);
    // Not a vacuous pass: four states' forms come from four pages.
    expect(used.size).toBe(4);
  });

  it.each(sources.map((source) => source.id))("%s: the bytes on disk are the bytes that were captured", (id) => {
    const file = ["html", "pdf"].map((ext) => join(RAW, `${id}.${ext}`)).find(existsSync);
    expect(file, `no capture for ${id}`).toBeTruthy();
    const meta = readMeta(id);
    const actual = createHash("sha256").update(readFileSync(file!)).digest("hex");
    expect(actual).toBe(meta.sha256);
  });

  it.each(htmlSources.map((source) => source.id))("%s: statutes/text matches a fresh extraction", (id) => {
    const derived = serialize(derivedParagraphs(id));
    const path = join(TEXT, `${id}.txt`);
    if (UPDATE) writeFileSync(path, derived);
    expect(readFileSync(path, "utf8")).toBe(derived);
  });
});

describe("the generated forms", () => {
  const built: BuiltForm[] = DEFINITIONS.map((definition) =>
    buildForm(definition, derivedParagraphs(definition.sourceId), readMeta(definition.sourceId)),
  );

  it("derives all sixteen forms, four per state", () => {
    expect(built).toHaveLength(16);
    for (const state of ["AZ", "CA", "NV", "TX"]) {
      expect(new Set(built.filter((form) => form.state === state).map((form) => form.form)).size, state).toBe(4);
    }
  });

  it("matches lib/statutes/generated/forms.json exactly", () => {
    const serialized = JSON.stringify(built, null, 2) + "\n";
    if (UPDATE) writeFileSync(GENERATED, serialized);
    expect(readFileSync(GENERATED, "utf8")).toBe(serialized);
  });

  it("docs/attorney-packet.md is the packet for exactly this text", () => {
    const ids = [...new Set([...DEFINITIONS.map((definition) => definition.sourceId), "nm-48-2"])];
    const packet = buildPacket({
      definitions: DEFINITIONS,
      forms: built,
      paragraphs: Object.fromEntries(DEFINITIONS.map((definition) => [definition.sourceId, derivedParagraphs(definition.sourceId)])),
      meta: Object.fromEntries(ids.map((id) => [id, readMeta(id)])),
      digest: reviewDigest,
    });
    if (UPDATE) writeFileSync(PACKET, packet);
    expect(readFileSync(PACKET, "utf8")).toBe(packet);
  });
});
