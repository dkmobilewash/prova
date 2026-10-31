import Anthropic from "@anthropic-ai/sdk";
import { AI_CLIENT_OPTIONS, modelFor } from "./models";
import { reportUsage, type ModelUsageReporter } from "./anthropic";

/**
 * READING A SPEC SECTION FOR WHAT MUST BE SUBMITTED, a separate reader from
 * `specs.ts`, on purpose. That one reports what costs money and its evals pin
 * that it does NOT report a submittals article. Widening it would dilute the
 * cost findings estimators rely on, so this has its own prompt, version, feature
 * key and eval, and shares only the file handling and the page allowance.
 *
 * Output is DRAFT rows. A person accepts each into the register, and no number
 * is issued until they do. The model sees the section and nothing else.
 */
export const SUBMITTAL_READ_PROMPT_VERSION = "submittal-read.1";

/** Mirrors `SubmittalRequirementKind` in `bid-specs.prisma`. */
export const SUBMITTAL_REQUIREMENT_KINDS = [
  "PRODUCT_DATA",
  "SHOP_DRAWINGS",
  "SAMPLES",
  "CERTIFICATES",
  "OTHER",
] as const;

export type SubmittalRequirementKind = (typeof SUBMITTAL_REQUIREMENT_KINDS)[number];

export type SubmittalRequirementExtraction = {
  ordinal: number;
  kind: SubmittalRequirementKind;
  /** What has to be submitted, in the section's own terms. */
  requirement: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  /** The sentence it was read from, so it can be checked. */
  quote: string;
  sourcePageLabel: string | null;
};

export type SubmittalSectionExtraction = {
  requirements: SubmittalRequirementExtraction[];
  readingReason: string;
};

const TOOL_NAME = "record_submittal_requirements";

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Record what this specification section requires the subcontractor to submit for review.",
  input_schema: {
    type: "object",
    properties: {
      requirements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ordinal: { type: "integer", description: "Your own 1-based ordering." },
            kind: { type: "string", enum: [...SUBMITTAL_REQUIREMENT_KINDS] },
            requirement: { type: "string", description: "What must be submitted, in the section's own terms." },
            confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
            quote: { type: "string", description: "The sentence you read this from, copied." },
            sourcePageLabel: { type: ["string", "null"], description: "Where to look, as the document labels it." },
          },
          required: ["ordinal", "kind", "requirement", "confidence", "quote", "sourcePageLabel"],
        },
      },
      readingReason: { type: "string", description: "How you read the document, in one or two sentences." },
    },
    required: ["requirements", "readingReason"],
  },
};

const SYSTEM_PROMPT = `You are reading one section of a project specification on behalf of a specialty-trade SUBCONTRACTOR who has won the work and must now build their submittal register. Their trades are framing and drywall, plaster, EIFS, acoustical ceilings, and spray fireproofing. Report through the record_submittal_requirements tool.

Your job is narrow: list what this section requires to be SUBMITTED for review, usually under an article titled SUBMITTALS or ACTION SUBMITTALS or INFORMATIONAL SUBMITTALS in Part 1. A person will check every row before it enters their register.

1. NEVER INVENT A REQUIREMENT. Every row must correspond to something this document actually states, and the quote field must contain the sentence you read it from, copied from the page. If you cannot quote it, do not report it.

2. ONE ROW PER THING TO SUBMIT. "Product data for each type of framing member" is one row. "Shop drawings for deflection details" is another. If one sentence lists two separate things, report two rows with the same quote.

3. kind: PRODUCT_DATA for product data and manufacturer's literature. SHOP_DRAWINGS for shop or coordination drawings. SAMPLES for physical samples and mock-up panels submitted for review. CERTIFICATES for certificates, test reports, qualification statements and warranties. OTHER for anything else that must be submitted. kind groups a row and never decides whether to report it.

4. A REQUIREMENT TO DO WORK IS NOT A SUBMITTAL. A mock-up built in the field, an inspection, or a quality standard is not a row unless the section requires something to be submitted about it.

5. A STATEMENT THAT SOMETHING IS NOT REQUIRED IS NOT A ROW. "Submittals are not required for accessories" produces no row. A cross-reference to another section is not a row unless this section itself requires the submission.

6. confidence is about this row being real and correctly read. HIGH only when the document plainly states it and you quoted it exactly. MEDIUM when the wording is ambiguous. LOW when the text is unclear or damaged.

7. sourcePageLabel is where to look, as the document labels its pages. Null if the document does not label them.

8. IF THIS IS NOT A SPECIFICATION SECTION, or is a section for work that is not these trades, return an empty list and say so in readingReason.

9. An empty list is a real and useful answer. Never pad it.`;

export async function extractSubmittalRequirements(params: {
  fileBase64: string;
  mediaType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
  fileName: string;
  onUsage?: ModelUsageReporter;
  model?: string;
}): Promise<SubmittalSectionExtraction> {
  const client = new Anthropic(AI_CLIENT_OPTIONS);
  const fileBlock: Anthropic.ContentBlockParam =
    params.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: params.fileBase64 } }
      : { type: "image", source: { type: "base64", media_type: params.mediaType, data: params.fileBase64 } };

  const response = await client.messages.create({
    model: params.model ?? modelFor("SUBMITTAL_READ").model,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [
      {
        role: "user",
        content: [fileBlock, { type: "text", text: `This is "${params.fileName}". List what it requires to be submitted.` }],
      },
    ],
  });

  // Before the result is checked: a call that produced nothing still cost money.
  await reportUsage(params.onUsage, response.usage);

  const block = response.content.find((part) => part.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("the model returned no submittal reading");
  return narrowSubmittalExtraction(block.input);
}

/** Narrowed rather than cast. A row with no quote cannot be checked, so it is
 * dropped; an unknown kind becomes OTHER rather than failing at the enum. */
export function narrowSubmittalExtraction(input: unknown): SubmittalSectionExtraction {
  const raw = (input ?? {}) as Partial<SubmittalSectionExtraction>;
  const rows = Array.isArray(raw.requirements) ? raw.requirements : [];
  return {
    readingReason: typeof raw.readingReason === "string" ? raw.readingReason : "",
    requirements: rows.flatMap((row, index) => {
      const quote = typeof row?.quote === "string" ? row.quote.trim() : "";
      const requirement = typeof row?.requirement === "string" ? row.requirement.trim() : "";
      if (!quote || !requirement) return [];
      return [
        {
          ordinal: typeof row.ordinal === "number" ? row.ordinal : index + 1,
          kind: isSubmittalRequirementKind(row.kind) ? row.kind : "OTHER",
          requirement,
          confidence: row.confidence === "HIGH" || row.confidence === "MEDIUM" ? row.confidence : "LOW",
          quote,
          sourcePageLabel: typeof row.sourcePageLabel === "string" ? row.sourcePageLabel : null,
        },
      ];
    }),
  };
}

export function isSubmittalRequirementKind(value: unknown): value is SubmittalRequirementKind {
  return typeof value === "string" && (SUBMITTAL_REQUIREMENT_KINDS as readonly string[]).includes(value);
}
