/**
 * ⚠ STUB. THIS FILE IS BEING WRITTEN IN PARALLEL BY SOMEBODY ELSE.
 *
 * The intake screen, its action, its model and its tests were built against
 * the contract below and nothing in them knows what is behind it. This
 * implementation exists only so this branch can typecheck, test and build
 * on its own; it is a filename matcher and nothing more. Replace the BODY
 * of `classifyDocument` with the real classifier — do not change the
 * signature, the type names or the members of `IntakeKind`, all four of
 * which are pinned by `lib/intake/review.test.ts` against the Prisma enum
 * and the migration that created it.
 *
 * What the caller relies on, stated so the replacement can be checked
 * against it rather than guessed at:
 *
 *   - it is called on the SERVER, once per file, inside
 *     `recordIntakeDocument`, and it must not throw. A classifier that
 *     throws takes the upload down with it; return UNKNOWN instead;
 *   - `reason` is rendered verbatim in a table cell in front of a customer.
 *     It says WHY in their words ("Filename contains 'COI' and 'expires'"),
 *     never "AI determined";
 *   - `confidence: "HIGH"` is a claim that nobody needs to look at this
 *     row. Over-claiming it is the failure that matters: the screen sorts
 *     HIGH to the BOTTOM, so a wrong HIGH is a row a person never reads;
 *   - `jobHint` is matched against this company's job names by the caller
 *     and dropped if nothing matches. A guess costs a wrong filing, so null
 *     is the right answer whenever the evidence is a hunch.
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

/** Filename evidence, in the order it is tested. Deliberately dull: this
 * is a placeholder, and a placeholder that looks clever is one somebody
 * ships. */
const RULES: { kind: IntakeKind; needles: string[] }[] = [
  { kind: "LIEN_WAIVER", needles: ["lien", "waiver"] },
  { kind: "CERTIFIED_PAYROLL", needles: ["certified payroll", "wh-347", "wh347"] },
  { kind: "PAY_APP", needles: ["pay app", "payapp", "g702", "g703", "application for payment"] },
  { kind: "COMPLIANCE_DOC", needles: ["coi", "certificate of insurance", "w-9", "w9", "license", "licence", "bond"] },
  { kind: "EXECUTED_SUBCONTRACT", needles: ["subcontract", "executed", "change order", "signed"] },
  { kind: "RFI_RESPONSE", needles: ["rfi"] },
  { kind: "SUBMITTAL", needles: ["submittal", "transmittal", "shop drawing"] },
  { kind: "DRAWING", needles: ["drawing", "sheet", "asi", "bulletin", "rev "] },
];

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"];

export function classifyDocument(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** First few KB of extracted text where available; null for images. */
  textPreview?: string | null;
}): Classification {
  const name = input.filename.toLowerCase();
  const revision = /\b(rev(?:ision)?\.?\s*-?\s*(\d+|[A-Z])|ASI\s*\d+)\b/i.exec(input.filename);
  const revisionHint = revision ? revision[0].replace(/\s+/g, " ").trim() : null;

  for (const rule of RULES) {
    const hit = rule.needles.find((needle) => name.includes(needle));
    if (!hit) continue;
    return {
      kind: rule.kind,
      // MEDIUM, never HIGH: one word in a filename is not unambiguous
      // evidence, and this stub has no other evidence. The real classifier
      // is what earns a HIGH.
      confidence: "MEDIUM",
      reason: `Filename contains "${hit}".`,
      jobHint: null,
      revisionHint,
    };
  }

  if (PHOTO_TYPES.includes(input.mimeType)) {
    return {
      kind: "PHOTO",
      confidence: "MEDIUM",
      reason: `It is an image (${input.mimeType}), and the filename says nothing else.`,
      jobHint: null,
      revisionHint: null,
    };
  }

  return {
    kind: "UNKNOWN",
    confidence: "LOW",
    reason: "Nothing in the filename or the file type says what this is.",
    jobHint: null,
    revisionHint,
  };
}
