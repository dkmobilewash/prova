import type { DocuSignEnvelopeDefinition } from "@prova/integrations";
import { DATE_SIGNED_ANCHOR, SIGN_HERE_ANCHOR } from "./documents";

/**
 * The envelope-definition body for POST /envelopes. Pure, so the exact
 * request is asserted in a test rather than inferred from a mocked call.
 *
 * Field names from DocuSign's SDK models (EnvelopeDefinition, Document,
 * Signer, SignHere, EventNotification, ConnectEventData), read 2026-09-18.
 *
 * `status: "sent"` sends immediately — there is no draft step in this app,
 * the person already pressed Send. One document, one or more signers in
 * routing order 1, 2, … as entered.
 *
 * TABS. A generated document (contract summary, change order) carries the
 * `/sn1/` anchor, so signer 1 gets a Sign Here and a Date Signed on it. An
 * UPLOADED file is the GC's own PDF and C Stream cannot know where its
 * signature lines are, so its signers get NO tabs — which DocuSign documents
 * as free-form signing: the signer places their own signature ("the only
 * requirement for free-form signers is that they place at least one tab").
 *
 * WEBHOOKS. `eventNotification` is included only when this install has an
 * HMAC key to verify with (lib/docusign/setup.ts) — sending DocuSign a URL
 * whose messages would all be refused helps nobody. It asks for JSON SIM
 * (Connect 2.0), the five envelope events tracked, `includeHMAC`, and
 * `integratorManaged` so the messages are signed with C Stream's own HMAC
 * keys rather than the customer account's (see the unverified note in
 * packages/integrations/src/docusign.ts). No documents in the payload: the
 * webhook re-reads the envelope with the company's token instead.
 */

export const DOCUSIGN_TRACKED_EVENTS = [
  "envelope-sent",
  "envelope-delivered",
  "envelope-completed",
  "envelope-declined",
  "envelope-voided",
] as const;

export type EnvelopeSigner = { name: string; email: string };

export type EnvelopeDocument = {
  /** base64 of the file's bytes. */
  base64: string;
  /** Shown to the signer, and DocuSign's name for the document. */
  name: string;
  /** "pdf", "html", "png", … — DocuSign converts by extension. */
  fileExtension: string;
  /** True for a document C Stream generated with the signing anchor in it. */
  anchored: boolean;
};

export function buildEnvelopeDefinition(input: {
  emailSubject: string;
  emailBlurb?: string;
  document: EnvelopeDocument;
  signers: EnvelopeSigner[];
  /** Absolute https URL of /api/docusign/connect, or null to send none. */
  connectUrl: string | null;
}): DocuSignEnvelopeDefinition {
  const signers = input.signers.map((signer, index) => {
    const recipientId = String(index + 1);
    const base: Record<string, unknown> = {
      email: signer.email,
      name: signer.name,
      recipientId,
      routingOrder: recipientId,
    };
    // Only the first signer has an anchor on a generated document; any
    // further signer signs free-form beside them.
    if (input.document.anchored && index === 0) {
      base.tabs = {
        signHereTabs: [
          { anchorString: SIGN_HERE_ANCHOR, anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "0", anchorIgnoreIfNotPresent: "false" },
        ],
        dateSignedTabs: [
          { anchorString: DATE_SIGNED_ANCHOR, anchorUnits: "pixels", anchorXOffset: "0", anchorYOffset: "0", anchorIgnoreIfNotPresent: "true" },
        ],
      };
    }
    return base;
  });

  const definition: DocuSignEnvelopeDefinition = {
    emailSubject: input.emailSubject,
    ...(input.emailBlurb ? { emailBlurb: input.emailBlurb } : {}),
    documents: [
      {
        documentBase64: input.document.base64,
        documentId: "1",
        name: input.document.name,
        fileExtension: input.document.fileExtension,
      },
    ],
    recipients: { signers },
    status: "sent",
  };

  if (input.connectUrl) {
    definition.eventNotification = {
      url: input.connectUrl,
      requireAcknowledgment: "true",
      loggingEnabled: "true",
      includeHMAC: "true",
      integratorManaged: "true",
      deliveryMode: "SIM",
      events: [...DOCUSIGN_TRACKED_EVENTS],
      eventData: { version: "restv2.1", format: "json" },
    };
  }

  return definition;
}

/** Kept to 100 characters, the email-subject limit DocuSign's web app
 * enforces. NOT re-verified against the REST reference on this branch —
 * cutting is harmless either way. */
export function emailSubjectFor(title: string): string {
  const subject = `Please sign: ${title}`;
  return subject.length > 100 ? `${subject.slice(0, 99)}…` : subject;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Signers from the form, refused with a sentence rather than sent to
 * DocuSign to be refused there. */
export function readSigners(formData: FormData): { ok: true; value: EnvelopeSigner[] } | { ok: false; error: string } {
  const names = formData.getAll("signerName").map((v) => String(v).trim());
  const emails = formData.getAll("signerEmail").map((v) => String(v).trim());
  const signers: EnvelopeSigner[] = [];
  for (let i = 0; i < Math.max(names.length, emails.length); i++) {
    const name = names[i] ?? "";
    const email = emails[i] ?? "";
    if (!name && !email) continue;
    if (!name) return { ok: false, error: "Enter the signer's name." };
    if (!EMAIL.test(email)) return { ok: false, error: `Enter a real email address for ${name}.` };
    if (name.length > 100 || email.length > 100) return { ok: false, error: "A signer's name or email is too long (100 characters at most)." };
    signers.push({ name, email });
  }
  if (signers.length === 0) return { ok: false, error: "Add who should sign — a name and an email." };
  if (signers.length > 5) return { ok: false, error: "Up to five signers per envelope." };
  return { ok: true, value: signers };
}
