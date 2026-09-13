/**
 * What a document that just arrived probably IS — as a pure function.
 *
 * No database, no Prisma, no React, no upload. Storage and the screen are
 * being built against this contract separately; this module is only the
 * part where being wrong is expensive, and it is deliberately the only part
 * that can be exercised exhaustively on a laptop in a second.
 *
 * THE PRODUCT ASKS A PERSON TO CONFIRM, WHICH DECIDES EVERY TRADE-OFF HERE.
 * An honest "I don't know" costs that person one glance. A confident wrong
 * answer costs the feature its credibility, and after the second one nobody
 * reads the guesses at all — at which point the feature is worse than not
 * having shipped. So:
 *
 *   - HIGH means the evidence is unambiguous, not that it is the best guess
 *     available. `scan_0042.pdf` is UNKNOWN/LOW and that is the CORRECT
 *     answer, not a gap;
 *   - `reason` quotes the ACTUAL TEXT MATCHED out of the caller's input, so
 *     it cannot describe evidence that is not there. That is a property of
 *     the construction, not a discipline anyone has to remember: every
 *     quoted fragment comes from `match[0]`, never from the pattern;
 *   - `jobHint` is a fragment of the input or it is null. It is never
 *     assembled, expanded or corrected.
 *
 * Evidence is used cheapest-first: filename, then extension and mime type,
 * then the text preview. Filenames are the strongest signal in practice
 * because construction documents are named by the people who will have to
 * find them again.
 *
 * `sizeBytes` is part of the contract and is deliberately UNUSED. There is
 * no honest classification signal in it — a 40 KB PDF is as likely to be a
 * W-9 as a lien waiver — and inventing one would be exactly the
 * over-claiming this module exists to avoid. It stays in the input because
 * the caller has it and a later, evidenced use may want it.
 */

export type IntakeKind =
  | "DRAWING" // a revision of a drawing set
  | "SUBMITTAL" // a submittal or its returned response
  | "RFI_RESPONSE" // an answered RFI
  | "COMPLIANCE_DOC" // COI, W-9, licence, bond, certification
  | "EXECUTED_SUBCONTRACT" // a signed subcontract or change order
  | "PAY_APP" // an application for payment
  | "LIEN_WAIVER"
  | "CERTIFIED_PAYROLL"
  | "PHOTO"
  | "UNKNOWN";

export type Classification = {
  kind: IntakeKind;
  /** HIGH only when the evidence is unambiguous. Anything a person should
   *  eyeball is MEDIUM or LOW — over-claiming confidence is the failure
   *  mode that matters here. */
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** Shown to the person, in their words, saying WHY. "Filename contains
   *  'COI' and 'expires'." Never "AI determined". */
  reason: string;
  /** A job name the evidence suggests, or null. Never a guess. */
  jobHint: string | null;
  /** e.g. "Rev 4", "ASI 18", or null. */
  revisionHint: string | null;
};

type Confidence = Classification["confidence"];

/** Where a quoted fragment came from. All three are in the caller's input,
 *  which is what makes quoting them safe. */
type EvidenceSource = "filename" | "text" | "type";

type Evidence = { quote: string; source: EvidenceSource };

type Detection = {
  kind: IntakeKind;
  confidence: Confidence;
  evidence: Evidence[];
  /** Replaces the generic "please confirm" tail when there is something
   *  more specific worth saying. */
  note?: string;
};

type Ctx = {
  /** Basename as given, extension included. */
  filename: string;
  /** The same string with every `_` turned into a space, CHARACTER FOR
   *  CHARACTER so the two stay index-aligned. `_` is a word character, so
   *  `\bwaiver\b` does not match `waiver_final_signed(2).pdf` — and
   *  underscores are how half of these files are named. Matching happens
   *  against this; the quote is always sliced back out of `filename` at the
   *  same offsets, so a `reason` still quotes the caller's own text. */
  matchable: string;
  /** Basename with the extension stripped — what job hints are read from. */
  stem: string;
  mimeType: string;
  text: string | null;
};

// ---------------------------------------------------------------------------
// Matching helpers. Everything quoted in a `reason` goes through these, so a
// quote is always a verbatim substring of the input.
// ---------------------------------------------------------------------------

function firstMatch(haystack: string | null, re: RegExp): string | null {
  if (!haystack) return null;
  const m = haystack.match(re);
  return m ? m[0] : null;
}

function fromFilename(ctx: Ctx, ...patterns: RegExp[]): Evidence | null {
  for (const re of patterns) {
    const m = ctx.matchable.match(re);
    if (m && m.index !== undefined) {
      return { quote: ctx.filename.slice(m.index, m.index + m[0].length), source: "filename" };
    }
  }
  return null;
}

function fromText(ctx: Ctx, ...patterns: RegExp[]): Evidence | null {
  for (const re of patterns) {
    const q = firstMatch(ctx.text, re);
    if (q) return { quote: q, source: "text" };
  }
  return null;
}

function present<T>(values: Array<T | null>): T[] {
  return values.filter((v): v is T => v !== null);
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Government and AIA form numbers that LOOK like drawing sheet numbers.
 *  `WH-347` is letters-hyphen-digits exactly as `A-201` is; without this the
 *  sheet heuristic would fire on a certified payroll and drag a correct HIGH
 *  down to MEDIUM for no reason. */
const FORM_NUMBER = /\b(?:WH[-\s_]?347|G-?70[234])\b/i;

const SIGNED = /\b(?:fully\s+)?(?:executed|signed|countersigned)\b/i;
const ANSWERED = /\b(?:response|responses|responded|answers?|answered|reply|replied|returned)\b/i;
const IMAGE_EXTENSION = /\.(?:jpe?g|png|heic|heif|webp|gif|tiff?|bmp)$/i;

/** A sheet number, ignoring form numbers. Requires a separator and at least
 *  two digits, which is what keeps `C-4` (a licence class) and `W-9` out. */
function sheetNumber(ctx: Ctx): string | null {
  for (const m of ctx.matchable.matchAll(/\b[A-Za-z]{1,2}[-.]\d{2,3}(?:\.\d{1,2})?\b/g)) {
    if (m.index === undefined || FORM_NUMBER.test(m[0])) continue;
    return ctx.filename.slice(m.index, m.index + m[0].length);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detectors, in priority order.
//
// Weak (single-word) patterns are read from the FILENAME ONLY. A page of
// extracted text says "bond", "certificate" and "plan" in passing all the
// time; a filename does not. Text is matched only against form titles, which
// are unambiguous by construction.
// ---------------------------------------------------------------------------

function detectCertifiedPayroll(ctx: Ctx): Detection | null {
  const strong = present([
    fromFilename(ctx, /\bWH[-\s_]?347\b/i, /\bcertified\s*payrolls?\b/i),
    fromText(ctx, /\bWH[-\s_]?347\b/i, /\bcertified\s*payrolls?\b/i),
  ]);
  if (strong.length > 0) return { kind: "CERTIFIED_PAYROLL", confidence: "HIGH", evidence: strong };

  const weak = fromFilename(ctx, /\bpayrolls?\b/i);
  return weak ? { kind: "CERTIFIED_PAYROLL", confidence: "MEDIUM", evidence: [weak] } : null;
}

function detectPayApp(ctx: Ctx): Detection | null {
  const strong = present([
    fromFilename(
      ctx,
      /\bG-?70[23]\b/i,
      /\bpay\s*app(?:lication)?/i,
      /\bapplication\s+(?:and\s+certificate\s+)?for\s+payment\b/i,
      /\bpayment\s+application\b/i,
    ),
    fromText(ctx, /\bapplication\s+and\s+certificate\s+for\s+payment\b/i, /\bAIA\s+Document\s+G-?70[23]\b/i),
  ]);
  return strong.length > 0 ? { kind: "PAY_APP", confidence: "HIGH", evidence: strong } : null;
}

function detectLienWaiver(ctx: Ctx): Detection | null {
  const strong = present([
    fromFilename(
      ctx,
      /\b(?:un)?conditional\s+(?:waiver|release)\b/i,
      /\blien\s+(?:waiver|release)\b/i,
      /\bwaiver\s+and\s+release\b/i,
      /\brelease\s+of\s+lien\b/i,
    ),
    fromText(ctx, /\b(?:un)?conditional\s+waiver\s+and\s+release\b/i, /\bwaiver\s+and\s+release\s+(?:on|upon)\b/i),
  ]);
  if (strong.length > 0) return { kind: "LIEN_WAIVER", confidence: "HIGH", evidence: strong };

  const weak = fromFilename(ctx, /\bwaivers?\b/i);
  return weak ? { kind: "LIEN_WAIVER", confidence: "MEDIUM", evidence: [weak] } : null;
}

function detectComplianceDoc(ctx: Ctx): Detection | null {
  const strong = present([
    fromFilename(
      ctx,
      /\bCOI\b/i,
      /\bACORD\b/i,
      /\bcertificate\s+of\s+liability\s+insurance\b/i,
      /\bcert(?:ificate)?\.?\s*of\s*ins(?:urance)?\b/i,
      /\bW-?9\b/i,
      /\b(?:payment|performance|bid)\s+(?:and\s+\w+\s+)?bonds?\b/i,
      /\bcontractors?'?\s+licen[sc]e\b/i,
      /\bOSHA\s*(?:10|30)\b/i,
    ),
    fromText(
      ctx,
      /\bcertificate\s+of\s+liability\s+insurance\b/i,
      /\bACORD\b/i,
      /\brequest\s+for\s+taxpayer\s+identification\s+number\b/i,
      /\bForm\s+W-?9\b/i,
    ),
  ]);

  if (strong.length > 0) {
    // Supporting detail a person recognises at a glance: an expiry word and
    // the year on the certificate.
    const supporting = present([fromFilename(ctx, /\bexpires?\b/i), fromFilename(ctx, /\b20\d{2}\b/)]);
    return { kind: "COMPLIANCE_DOC", confidence: "HIGH", evidence: [...strong, ...supporting] };
  }

  // "bond" is a material term in plaster and EIFS as often as it is an
  // instrument; "license" could be software. Neither gets to be HIGH alone.
  const weak = fromFilename(ctx, /\blicen[sc]e\b/i, /\bbonds?\b/i, /\bcertificat(?:e|ion)s?\b/i, /\binsurance\b/i);
  return weak ? { kind: "COMPLIANCE_DOC", confidence: "MEDIUM", evidence: [weak] } : null;
}

function detectExecutedSubcontract(ctx: Ctx): Detection | null {
  const instrument = fromFilename(ctx, /\bsubcontract\b/i, /\bchange\s*orders?\b/i);
  const fromDoc = present([fromText(ctx, /\bsubcontract\s+agreement\b/i)]);

  if (instrument) {
    const signed = fromFilename(ctx, SIGNED);
    if (signed) {
      return { kind: "EXECUTED_SUBCONTRACT", confidence: "HIGH", evidence: [instrument, signed] };
    }
    const draft = fromFilename(ctx, /\bdrafts?\b/i);
    return {
      kind: "EXECUTED_SUBCONTRACT",
      confidence: "MEDIUM",
      evidence: draft ? [instrument, draft] : [instrument],
      note: draft
        ? `'${draft.quote}' suggests this may not be signed yet — please confirm.`
        : undefined,
    };
  }

  if (fromDoc.length > 0) {
    const witnessed = fromText(ctx, /\bIN WITNESS WHEREOF\b/i);
    return witnessed
      ? { kind: "EXECUTED_SUBCONTRACT", confidence: "HIGH", evidence: [...fromDoc, witnessed] }
      : { kind: "EXECUTED_SUBCONTRACT", confidence: "MEDIUM", evidence: fromDoc };
  }
  return null;
}

function detectSubmittal(ctx: Ctx): Detection | null {
  const strong = present([
    fromFilename(
      ctx,
      /\bsubmittals?\b/i,
      /\bshop\s+drawings?\b/i,
      /\bapproved\s+as\s+noted\b/i,
      /\brevise\s+and\s+resubmit\b/i,
    ),
    fromText(ctx, /\bsubmittal\s+transmittal\b/i, /\bapproved\s+as\s+noted\b/i),
  ]);
  if (strong.length > 0) return { kind: "SUBMITTAL", confidence: "HIGH", evidence: strong };

  const numbered = fromFilename(ctx, /\bSUB[-_ ]?\d{1,4}\b/i);
  if (numbered) {
    return {
      kind: "SUBMITTAL",
      confidence: "MEDIUM",
      evidence: [numbered],
      note: "'SUB-' is used for other things too, so please confirm.",
    };
  }

  const weak = fromFilename(ctx, /\bproduct\s+data\b/i);
  return weak ? { kind: "SUBMITTAL", confidence: "MEDIUM", evidence: [weak] } : null;
}

function detectRfiResponse(ctx: Ctx): Detection | null {
  const marker = present([
    fromFilename(ctx, /\bRFI\b/i),
    fromText(ctx, /\brequest\s+for\s+information\b/i),
  ]);
  if (marker.length === 0) return null;

  const answered = present([fromFilename(ctx, ANSWERED), fromText(ctx, ANSWERED)]);
  if (answered.length > 0) {
    return { kind: "RFI_RESPONSE", confidence: "HIGH", evidence: [...marker, ...answered] };
  }
  return {
    kind: "RFI_RESPONSE",
    confidence: "MEDIUM",
    evidence: marker,
    note: "Nothing says whether this is the answer or the question — please confirm.",
  };
}

function detectDrawing(ctx: Ctx): Detection | null {
  // A shop drawing is a submittal. The word "drawings" in that phrase must
  // not also count as evidence of a drawing set.
  const shopDrawing = /\bshop\s+drawings?\b/i.test(ctx.matchable);

  const strong = present([
    fromFilename(ctx, /\.(?:dwg|dxf)$/i),
    fromFilename(ctx, /\bASI\s*-?\s*#?\s*\d{1,3}\b/i),
    fromFilename(ctx, /\bissued\s+for\s+construction\b/i, /\bIFC\b/),
  ]);

  const sheet = sheetNumber(ctx);
  const revision = fromFilename(ctx, /\brev(?:ision)?\.?\s*-?\s*\d{1,3}\b/i);
  const weak = present([
    shopDrawing ? null : fromFilename(ctx, /\bdrawings?\b/i),
    fromFilename(ctx, /\bplans?\b/i, /\bsheets?\b/i, /\bbulletins?\b/i, /\baddend(?:um|a)\b/i, /\belevations?\b/i),
  ]);

  if (strong.length > 0) {
    return { kind: "DRAWING", confidence: "HIGH", evidence: [...strong, ...weak] };
  }
  if (sheet && (revision || weak.length > 0)) {
    const sheetEvidence: Evidence = { quote: sheet, source: "filename" };
    return {
      kind: "DRAWING",
      confidence: "HIGH",
      evidence: present([sheetEvidence, revision, ...weak]),
    };
  }
  if (sheet) {
    return {
      kind: "DRAWING",
      confidence: "MEDIUM",
      evidence: [{ quote: sheet, source: "filename" }],
    };
  }
  if (weak.length > 0) return { kind: "DRAWING", confidence: "MEDIUM", evidence: weak };
  return null;
}

/** Deliberately NOT in the ordered list below: it is a fallback, not a
 *  competitor. "An image is a photo UNLESS the filename says otherwise"
 *  means the filename always wins, so `COI.jpg` stays a compliance document
 *  at full confidence instead of being dragged into an ambiguity. */
function detectPhoto(ctx: Ctx): Detection | null {
  const byMime = ctx.mimeType.toLowerCase().startsWith("image/");
  if (!byMime && !IMAGE_EXTENSION.test(ctx.filename)) return null;

  const typeEvidence: Evidence = byMime
    ? { quote: ctx.mimeType, source: "type" }
    : { quote: firstMatch(ctx.filename, IMAGE_EXTENSION) ?? ctx.filename, source: "filename" };

  const scanned = fromFilename(ctx, /\bscann?(?:ed)?\b/i);
  if (scanned) {
    return {
      kind: "PHOTO",
      confidence: "MEDIUM",
      evidence: [typeEvidence, scanned],
      note: "A scanned document can arrive as an image, so please confirm this is a site photo.",
    };
  }
  return { kind: "PHOTO", confidence: "HIGH", evidence: [typeEvidence] };
}

/** Priority order. When two families both fire, the more confident one wins
 *  and ties break toward the top of this list. */
const DETECTORS: Array<(ctx: Ctx) => Detection | null> = [
  detectCertifiedPayroll,
  detectPayApp,
  detectLienWaiver,
  detectComplianceDoc,
  detectExecutedSubcontract,
  detectSubmittal,
  detectRfiResponse,
  detectDrawing,
];

// ---------------------------------------------------------------------------
// Hints
// ---------------------------------------------------------------------------

/** Words that lead a filename without naming a job. Case matters below —
 *  these are compared lowercased, and the capitalisation rule in
 *  `jobHintFrom` already excludes the lowercase ones. */
const NOT_A_JOB = new Set([
  "scan", "scanned", "image", "images", "photo", "photos", "picture", "final", "signed", "draft",
  "copy", "untitled", "document", "documents", "docs", "file", "files", "page", "pages", "revision",
  "version", "attachment", "updated", "revised", "temp", "misc", "folder", "download", "downloads",
  "level", "floor", "building", "phase", "area", "zone", "unit", "room", "north", "south", "east",
  "west", "partition", "framing", "ceiling", "wall", "sheet", "plan", "plans", "detail", "details",
  "week", "january", "february", "march", "april", "june", "july", "august", "september", "october",
  "november", "december", "sept", "report", "notes", "stuff", "new",
]);

/**
 * A job name, or null. NEVER assembled and never corrected.
 *
 * Read as the leading run of capitalised words in the filename, stopping at
 * the first token that is not one — a number, an abbreviation, a word that
 * already served as evidence for the document type, or a word from the list
 * above. The capitalisation rule is doing most of the work: a job is a
 * proper noun and the people naming these files capitalise it, while
 * `unconditional lien release final.pdf` is all lower case and yields
 * nothing, which is the right answer.
 *
 * It will occasionally hand back something that is in the filename but is
 * not a job — "Nevada", from a licence issued in that state. That is the
 * deliberate side of the trade: a hint the person rejects in one glance
 * costs a glance, and the alternative is a module that invents names.
 */
function jobHintFrom(ctx: Ctx, evidence: Evidence[]): string | null {
  const explicit = firstMatch(ctx.text, /\b(?:project|job)\s*(?:name)?\s*[:#]\s*[^\n\r]{2,60}/i);
  if (explicit) {
    const value = explicit.replace(/^[^:#]*[:#]\s*/, "").trim();
    if (value.length >= 2) return value;
  }

  const quoted = evidence.map((e) => e.quote.toLowerCase());
  const words: string[] = [];
  for (const token of ctx.stem.split(/[\s_()[\]\-.,]+/)) {
    if (words.length === 3) break;
    if (!/^[A-Za-z]+$/.test(token)) break;
    if (token.length < 4) break;
    if (!/^[A-Z]/.test(token)) break;
    const lower = token.toLowerCase();
    if (NOT_A_JOB.has(lower)) break;
    if (quoted.some((q) => q.includes(lower))) break;
    words.push(token);
  }
  return words.length > 0 ? words.join(" ") : null;
}

/**
 * "Rev 4", "ASI 18", "Bulletin 7", "RFI 042", "SUB-024" — normalised
 * spacing, but the number is always copied out of the input.
 *
 * REVISION MARKERS ARE READ FROM THE FILENAME ONLY, and that restriction is
 * a finding rather than caution. Blank WH-347 payroll forms carry
 * `Form WH-347 (Rev. 12/2008)` in their footer — the FORM's revision date,
 * printed on every copy ever filed — and reading the text turned a
 * certified payroll into "Rev 12". A "Rev" in a filename is the sender
 * telling you which revision they are sending; a "Rev" in body text is
 * usually a printed form's own version. Only the RFI marker is read from
 * text, because "Request for Information No. 42" in a document header
 * identifies THAT document and nothing else.
 */
function revisionHintFrom(ctx: Ctx): string | null {
  const inName = (re: RegExp): string | null => ctx.matchable.match(re)?.[1] ?? null;
  const inAny = (re: RegExp): string | null =>
    inName(re) ?? (ctx.text ? (ctx.text.match(re)?.[1] ?? null) : null);

  const rev = inName(/\brev(?:ision)?\.?\s*-?\s*(\d{1,3})\b/i);
  if (rev) return `Rev ${Number(rev)}`;

  const asi = inName(/\bASI\s*-?\s*#?\s*(\d{1,3})\b/i);
  if (asi) return `ASI ${Number(asi)}`;

  const bulletin = inName(/\bbulletins?\s*-?\s*#?\s*(\d{1,3})\b/i);
  if (bulletin) return `Bulletin ${Number(bulletin)}`;

  const rfi =
    inAny(/\bRFI\s*-?\s*#?\s*(\d{1,4})\b/i) ??
    inAny(/\brequest\s+for\s+information\s*(?:no\.?|#)?\s*(\d{1,4})\b/i);
  if (rfi) return `RFI ${rfi}`;

  const sub = inName(/\bSUB[-_ ]?(\d{1,4})\b/i);
  if (sub) return `SUB-${sub}`;

  return null;
}

// ---------------------------------------------------------------------------
// The sentence the contractor reads
// ---------------------------------------------------------------------------

function listQuotes(quotes: string[]): string {
  if (quotes.length === 1) return `'${quotes[0]}'`;
  const head = quotes.slice(0, -1).map((q) => `'${q}'`).join(", ");
  return `${head} and '${quotes[quotes.length - 1]}'`;
}

/** Drops a quote that is already contained in a longer one, so a reason
 *  never reads "contains 'Payment and Performance Bond' and 'Bond'". */
function dedupe(quotes: string[]): string[] {
  const kept: string[] = [];
  for (const q of quotes) {
    const lower = q.toLowerCase();
    if (kept.some((k) => k.toLowerCase().includes(lower))) continue;
    kept.push(q);
  }
  return kept;
}

function sentencesFor(evidence: Evidence[]): string[] {
  const out: string[] = [];
  const pick = (source: EvidenceSource) =>
    dedupe(evidence.filter((e) => e.source === source).map((e) => e.quote));

  const file = pick("filename");
  const text = pick("text");
  const type = pick("type");

  if (file.length > 0) out.push(`Filename contains ${listQuotes(file)}.`);
  if (text.length > 0) out.push(`The document text contains ${listQuotes(text)}.`);
  if (type.length > 0) out.push(`The file type is ${listQuotes(type)}.`);
  return out;
}

const NOTHING_TO_GO_ON =
  "Nothing in the filename or the file type says what this is. Please pick the type yourself.";

function reasonFor(winner: Detection, rival: Detection | null): string {
  const own = sentencesFor(winner.evidence).join(" ");
  if (rival) {
    const rivalQuotes = dedupe(
      rival.evidence.filter((e) => e.source !== "type").map((e) => e.quote),
    );
    if (rivalQuotes.length > 0) {
      return `${own} But it also contains ${listQuotes(rivalQuotes)}, which points somewhere else — please confirm.`;
    }
  }
  if (winner.confidence === "HIGH") return own;
  return `${own} ${winner.note ?? "That is not conclusive on its own — please confirm."}`;
}

// ---------------------------------------------------------------------------

export function classifyDocument(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** First few KB of extracted text where available; null for images. */
  textPreview?: string | null;
}): Classification {
  const filename = (input.filename ?? "").split(/[/\\]/).pop() ?? "";
  const ctx: Ctx = {
    filename,
    matchable: filename.replace(/_/g, " "),
    stem: filename.replace(/\.[A-Za-z0-9]{1,6}$/, ""),
    mimeType: input.mimeType ?? "",
    text: input.textPreview ?? null,
  };

  const hits = present(DETECTORS.map((d) => d(ctx)));
  const fallback = hits.length === 0 ? detectPhoto(ctx) : null;
  const all = fallback ? [fallback] : hits;

  if (all.length === 0) {
    return {
      kind: "UNKNOWN",
      confidence: "LOW",
      reason: NOTHING_TO_GO_ON,
      jobHint: jobHintFrom(ctx, []),
      revisionHint: revisionHintFrom(ctx),
    };
  }

  const rank: Record<Confidence, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  // Stable within equal confidence, so ties fall to the higher-priority
  // detector rather than to whichever happened to be written first.
  const ordered = [...all].sort((a, b) => rank[a.confidence] - rank[b.confidence]);
  const winner = ordered[0] as Detection;

  // Two different families both fired. Neither of them is unambiguous any
  // more, whatever each thought of itself: "Pay App 4 waiver signed.pdf" is
  // a pay application or a waiver, and a person has to say which.
  const rival = ordered.find((d) => d.kind !== winner.kind) ?? null;
  const confidence: Confidence = rival && winner.confidence === "HIGH" ? "MEDIUM" : winner.confidence;

  const evidence = rival ? [...winner.evidence, ...rival.evidence] : winner.evidence;

  return {
    kind: winner.kind,
    confidence,
    reason: reasonFor({ ...winner, confidence }, rival),
    jobHint: jobHintFrom(ctx, evidence),
    revisionHint: revisionHintFrom(ctx),
  };
}
