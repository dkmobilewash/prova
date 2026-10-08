import { createHash } from "node:crypto";
import { segmentForm } from "./render";
import type { BuiltForm, FormDefinition, FormParagraph, ParagraphRole } from "./types";

/**
 * Derive a form's text from a captured statute page and its definition.
 *
 * Run only by generated.test.ts, never at request time. Every check here
 * THROWS: a form that cannot be derived exactly as described is not
 * shipped in some approximate shape, it fails the build with the reason.
 */

export interface SourceMeta {
  id: string;
  requestedUrl: string;
  finalUrl: string;
  citation: string;
  retrievedAt: string;
  sha256: string;
  capturedVia?: "headless-render";
}

/** A paragraph that is nothing but parenthesised captions, printed under a
 * blank: "(maker of check)", "(owner) (job description)", "(Title)". */
const CAPTION = /^\([^()]+\)(?: \([^()]+\))*$/;

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function buildForm(definition: FormDefinition, paragraphs: string[], meta: SourceMeta): BuiltForm {
  const where = `${definition.state} ${definition.form}`;
  const [first, last] = definition.span;
  if (!(first >= 0 && last < paragraphs.length && first <= last)) {
    throw new Error(`${where}: span ${first}-${last} is outside the source's ${paragraphs.length} paragraphs`);
  }
  const inSpan = (index: number) => index >= first && index <= last;
  const drafting = new Set(definition.drafting.map((entry) => entry.index));
  for (const index of drafting) {
    if (!inSpan(index)) throw new Error(`${where}: drafting paragraph ${index} is outside the span`);
  }
  const marked = [
    ...definition.titleIndices,
    ...definition.noticeIndices,
    ...(definition.headingIndices ?? []),
    ...(definition.labelIndices ?? []),
  ];
  for (const index of marked) {
    if (!inSpan(index) || drafting.has(index)) {
      throw new Error(`${where}: paragraph ${index} is marked as part of the form but is not in it`);
    }
  }

  const texts = new Map<number, string>();
  for (let index = first; index <= last; index += 1) {
    if (!drafting.has(index)) texts.set(index, paragraphs[index]);
  }

  for (const edit of definition.edits) {
    const current = texts.get(edit.index);
    if (current === undefined) throw new Error(`${where}: edit on paragraph ${edit.index}, which is not in the form`);
    const matches = edit.at === "start" ? current.startsWith(edit.text) : current.endsWith(edit.text);
    if (!matches) {
      throw new Error(`${where}: paragraph ${edit.index} does not ${edit.at === "start" ? "start" : "end"} with ${JSON.stringify(edit.text)}`);
    }
    texts.set(edit.index, edit.at === "start" ? current.slice(edit.text.length) : current.slice(0, current.length - edit.text.length));
  }

  const roleOf = (index: number, text: string): ParagraphRole => {
    if (definition.titleIndices.includes(index)) return "title";
    if (definition.noticeIndices.includes(index)) return "notice";
    if (definition.headingIndices?.includes(index)) return "heading";
    if (CAPTION.test(text)) return "caption";
    return "body";
  };
  const labels = new Set(definition.labelIndices ?? []);

  const built: FormParagraph[] = [];
  for (const [index, text] of texts) {
    if (text.length === 0) throw new Error(`${where}: paragraph ${index} is empty after its edits`);
    if (text !== text.trim()) throw new Error(`${where}: paragraph ${index} has edge whitespace after its edits`);
    const paragraph: FormParagraph = { index, text, role: roleOf(index, text) };
    if (labels.has(index)) paragraph.label = true;
    built.push(paragraph);
  }

  const title = built
    .filter((paragraph) => paragraph.role === "title")
    .map((paragraph) => paragraph.text)
    .join(" ");
  if (title !== definition.expectedTitle) {
    throw new Error(`${where}: title reads ${JSON.stringify(title)}, expected ${JSON.stringify(definition.expectedTitle)} -- the statute page has moved under its paragraph numbers`);
  }

  const form: BuiltForm = {
    state: definition.state,
    form: definition.form,
    citation: definition.citation,
    sourceId: definition.sourceId,
    sourceUrl: meta.requestedUrl,
    sourceCitation: meta.citation,
    retrievedAt: meta.retrievedAt,
    capturedVia: meta.capturedVia ?? "fetch",
    rawSha256: meta.sha256,
    blankStyle: definition.blankStyle,
    noticeRule: definition.noticeRule,
    slots: definition.slots,
    paragraphs: built,
    textSha256: sha256(built.map((paragraph) => paragraph.text).join("\n")),
  };
  // Throws when the number of blanks and the number of slots differ.
  segmentForm(form);
  return form;
}
