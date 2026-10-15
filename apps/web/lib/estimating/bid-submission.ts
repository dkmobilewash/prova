import { DOCUMENT_UPLOAD_MAX_BYTES } from "@/lib/document-uploads";
import { looksLikeEmail } from "@prova/integrations";

/**
 * SENDING THE BID PACKAGE TO THE GENERAL CONTRACTOR — the parts that are
 * decisions rather than plumbing.
 *
 * Step 9 of the estimating workflow ends "submit through the GC's specified
 * channel before the deadline", and until now the app stopped one step short:
 * the package could be assembled (#785) and nothing sent it. Marking a bid
 * SUBMITTED was a dropdown with no date and no record of what went out, so the
 * question a GC's "we never got it" actually asks — what did we send, to whom,
 * and when — had no answer anywhere.
 *
 * Pure. No database, no network, no model. The action in `actions/messages.ts`
 * does the I/O; everything here is a decision somebody could argue with, which
 * is why it is where a test can reach it.
 */

/**
 * What the provider will carry in one message, including its encoding.
 *
 * Resend's documented ceiling. Named here rather than guessed at the call site
 * because the number this app must stay under is the PROVIDER's, and a second
 * opinion about it stored somewhere else is the two-lists shape CLAUDE.md
 * names.
 */
export const PROVIDER_MAX_MESSAGE_BYTES = 40 * 1024 * 1024;

/** Base64 is 4 bytes out for every 3 in, rounded up to the next quad. The
 *  exact figure, not "about a third more": the point of this module is that
 *  the margin below is checked rather than assumed. */
export function base64Bytes(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4;
}

/**
 * THE SEND HAS NO CEILING OF ITS OWN, AND THAT IS THE DESIGN.
 *
 * The obvious thing is a `SEND_MAX_BYTES` constant. It would be a second list
 * of one value: the upload token already caps a `bid-package` at
 * `DOCUMENT_UPLOAD_MAX_BYTES`, enforced where this repo decided such limits
 * belong — at token minting, after five in-action guards shipped unreachable
 * behind the framework's 1 MB body cap (`document-uploads.ts`'s own header).
 * A send-side number would drift from it and the one that drifted LOWER would
 * refuse a file the uploader had just accepted.
 *
 * So instead of a rival constant, the RELATIONSHIP is asserted: whatever the
 * upload ceiling becomes, its base64 form must still fit one message. Raising
 * the upload cap past the provider's limit fails this, which is the moment
 * somebody needs to know — not the send that bounces afterwards.
 */
export const BIGGEST_UPLOAD_BASE64 = base64Bytes(DOCUMENT_UPLOAD_MAX_BYTES);
export const UPLOAD_CEILING_FITS_ONE_MESSAGE = BIGGEST_UPLOAD_BASE64 < PROVIDER_MAX_MESSAGE_BYTES;

/** Somebody at the GC who might receive a bid. */
export type Recipient = { address: string; name: string | null };

export type RecipientChoice =
  | { ok: true; recipient: Recipient; alternatives: Recipient[] }
  | { ok: false; problem: string };

/**
 * Who the bid goes to.
 *
 * ── THE ADDRESS IS NEVER TYPED AND NEVER SUPPLIED BY A CALLER ──
 *
 * It is read off the bid's own `Contact` and the people recorded against it.
 * `ask/commands/messages.ts` states the rule for `send_email` and the reason
 * is the same one here: a bid is the one write in this app that cannot be
 * undone by anybody, so the set of addresses it can reach has to be a set the
 * company already wrote down. A free-text box would make "who did we send it
 * to" a question about somebody's typing.
 *
 * NAMED PEOPLE FIRST. An estimator sends to the PM they have been dealing
 * with, not to `info@`, and a `ContactPerson` row exists precisely because
 * "the six people there we actually talk to" are not the company record
 * (`crm.prisma`). The company's own address is the fallback, and every other
 * usable address comes back as an alternative so the screen can offer them.
 *
 * REFUSES WITH A SENTENCE rather than returning nothing, because "no address"
 * has two very different causes — nobody recorded one, or the one recorded is
 * not an address — and the fix differs.
 */
export function recipientFor(input: {
  contactName: string;
  contactEmail: string | null;
  people: readonly { name: string; email: string | null }[];
}): RecipientChoice {
  const usable: Recipient[] = [];

  for (const person of input.people) {
    const address = person.email?.trim();
    if (address && looksLikeEmail(address)) usable.push({ address, name: person.name });
  }

  const companyAddress = input.contactEmail?.trim();
  if (companyAddress && looksLikeEmail(companyAddress)) {
    usable.push({ address: companyAddress, name: input.contactName });
  }

  if (usable.length === 0) {
    // The two causes, told apart, because they are fixed in different places.
    const hadSomething =
      (input.contactEmail?.trim().length ?? 0) > 0 ||
      input.people.some((person) => (person.email?.trim().length ?? 0) > 0);
    return {
      ok: false,
      problem: hadSomething
        ? `The email address on file for ${input.contactName} doesn't look like an address. Fix it on their contact record, then send.`
        : `There's no email address on file for ${input.contactName}. Add one to their contact record, then send.`,
    };
  }

  // DEDUPED BY ADDRESS, keeping the first — a PM listed both as a person and
  // as the company address is one recipient, and offering them twice invites
  // somebody to wonder which is which.
  const seen = new Set<string>();
  const unique = usable.filter((one) => {
    const key = one.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { ok: true, recipient: unique[0]!, alternatives: unique.slice(1) };
}

/** The subject line a GC sees in a crowded inbox on bid day.
 *
 *  THE PROJECT FIRST, because that is what they are sorting by — a GC taking
 *  bids on four jobs gets forty emails, and "Bid — Our Company" is four of
 *  them indistinguishable. The trade name is second so they can tell which
 *  scope arrived. */
export function submissionSubject(projectName: string, companyName: string): string {
  return `${projectName} — bid from ${companyName}`;
}

/**
 * The message the package rides in on.
 *
 * NAMES THE ATTACHMENT, because `OutboundMessage` stores what was sent as
 * text and the file itself is not kept. The filename in the body is what makes
 * the log answer "what did we send them" a year later.
 *
 * Deliberately short and editable. A long auto-written letter is one the
 * estimator has to read before every send to make sure it still fits, and the
 * proposal inside the package is where the actual terms live.
 */
export function submissionBody(input: {
  projectName: string;
  companyName: string;
  fileName: string;
  pages: number;
}): string {
  return [
    `Our bid for ${input.projectName} is attached.`,
    "",
    `${input.fileName} — ${input.pages} page${input.pages === 1 ? "" : "s"}.`,
    "",
    `Please confirm you've received it.`,
    "",
    input.companyName,
  ].join("\n");
}
