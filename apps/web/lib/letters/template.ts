/**
 * The letter, as text. Pure: no network, no database, no clock. The queue
 * renders it once and stores the result, so what the person received is
 * what the row says, not what the template says today.
 *
 * The voice is the cold-email study's (section 4): the public fact FIRST
 * with its source named, the motive stated, a gift that precedes the ask,
 * their vocabulary (certifieds, the 347, the DIR, the xml), under 200
 * words, signed by a founder. Nothing in it is a price, a percentage or a
 * product word — `FORBIDDEN` below is the study's own list and the test
 * holds the body to it.
 */

export type LetterAddress = {
  name: string;
  company?: string;
  line1: string;
  city: string;
  state: string;
  zip: string;
};

export type LetterConfig = {
  fromName: string;
  fromAddress: { line1: string; city: string; state: string; zip: string };
  mobile: string;
  replyEmail: string;
};

export type LetterFirm = {
  licence: string;
  name: string;
  mailingAddress: string | null;
  city: string | null;
  zip: string | null;
  owners: unknown;
};

export const TEMPLATE_KEY = "tier1-free-certified-v1";

/** The study's words-to-avoid, as regexes so "solutions" and "eCPRs" count. */
export const FORBIDDEN = [
  /A-1-131/i, /\beCPR\b/i, /prime approver/i, /labor compliance officer/i, /\bsolutions?\b/i, /streamlin/i,
  /minutes not hours/i, /\d+\s?%/, /avoid penalties/i, /trusted by/i, /quick question/i, /no strings/i, /\$\s?\d/,
];

export type LetterResult = { ok: true; body: string; toAddress: LetterAddress } | { ok: false; error: string };

const CONFIG_KEYS = ["fromName", "fromAddress.line1", "fromAddress.city", "fromAddress.state", "fromAddress.zip", "mobile", "replyEmail"] as const;

/** A letter with no return address is illegal and useless; refuse rather than
 * mail one. Returns the names of the missing settings so the message on the
 * page says which env var to set. */
export function missingConfig(config: Partial<LetterConfig> | null | undefined): string[] {
  if (!config) return [...CONFIG_KEYS];
  const read = (key: string) => key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), config);
  return CONFIG_KEYS.filter((k) => !String(read(k) ?? "").trim());
}

/** Reads the six OUTBOUND_* settings. The state is CA on purpose — the
 * sender is a California corporation writing to California licensees. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): LetterConfig {
  return {
    fromName: env.OUTBOUND_FROM_NAME ?? "",
    fromAddress: { line1: env.OUTBOUND_FROM_LINE1 ?? "", city: env.OUTBOUND_FROM_CITY ?? "", state: "CA", zip: env.OUTBOUND_FROM_ZIP ?? "" },
    mobile: env.OUTBOUND_MOBILE ?? "",
    replyEmail: env.OUTBOUND_REPLY_EMAIL ?? "",
  };
}

/** CSLB prints the owner surname-first ("SMITH JOHN"); turn it into a name a
 * letter can open with. Falls back to the firm when the personnel file had
 * nobody. */
export function addresseeFor(firm: Pick<LetterFirm, "name" | "owners">): string {
  const owners = Array.isArray(firm.owners) ? (firm.owners as Array<{ name?: string }>) : [];
  const raw = (owners[0]?.name ?? "").trim();
  if (!raw) return firm.name;
  const parts = raw.split(/\s+/);
  const ordered = parts.length > 1 ? [...parts.slice(1), parts[0]] : parts;
  return ordered.map((w) => w[0] + w.slice(1).toLowerCase()).join(" ");
}

const titleCase = (s: string) => s.replace(/\w\S*/g, (w) => w[0] + w.slice(1).toLowerCase());

/** CSLB's mailing address is one line with city and zip in their own
 * columns; the state is always California on a CSLB licence. Null when any
 * part is missing — a letter to half an address is a letter to nobody. */
export function toAddressFor(firm: LetterFirm): LetterAddress | null {
  const line1 = (firm.mailingAddress ?? "").trim();
  const city = (firm.city ?? "").trim();
  const zip = (firm.zip ?? "").trim().slice(0, 10);
  if (!line1 || !city || !/^\d{5}(-\d{4})?$/.test(zip)) return null;
  return { name: addresseeFor(firm).slice(0, 40), company: firm.name.slice(0, 40), line1: line1.slice(0, 64), city: titleCase(city), state: "CA", zip };
}

export function letterFor(firm: LetterFirm, fact: string, config: LetterConfig): LetterResult {
  const missing = missingConfig(config);
  if (missing.length) return { ok: false, error: `No return address on file — set ${missing.map(envNameFor).join(", ")}.` };
  if (!fact) return { ok: false, error: `${firm.name} has no public fact to open with.` };
  const toAddress = toAddressFor(firm);
  if (!toAddress) return { ok: false, error: `${firm.name} (CSLB ${firm.licence}) has no complete mailing address on its licence.` };

  const first = addresseeFor(firm).split(" ")[0];
  const greeting = first === firm.name.split(" ")[0] ? firm.name : first;
  const body = [
    `${greeting} —`,
    "",
    `${firm.name} ${factSentence(fact)}. So someone in your office is doing certifieds on it every week.`,
    "",
    `I'm building the tool that turns a week of timecards into the state xml, the 347 and the fringe sheet, and I want to run real drywall and plaster jobs through it, not my own spreadsheets.`,
    "",
    `Here is the offer. Send me one week of timecards — a phone photo is fine — and you get the finished certified payroll, the 347 and the fringe sheet back by the end of the next day. No charge, nothing to install, and you keep your payroll where it is. I build the report myself.`,
    "",
    `If you want it, text me "yes" at ${config.mobile} and I'll tell you where to send the photo. Or email ${config.replyEmail}.`,
    "",
    `${config.fromName}, founder, C Stream`,
    "",
    `C Stream, Inc. · cstream.ai · ${config.fromAddress.line1}, ${config.fromAddress.city}, ${config.fromAddress.state} ${config.fromAddress.zip}`,
  ].join("\n");
  return { ok: true, body, toAddress };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `factFor()` is written for the page — ISO date, the source in brackets,
 * DIR's own name for the list. The letter says the same thing the way a sub
 * would: a spoken date, the source as a clause, and "certified payroll"
 * where the page says eCPR, which is a word nobody in a drywall office uses. */
export function factSentence(fact: string): string {
  const spokenDate = (iso: string) => {
    const [, m, d] = iso.split("-");
    return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
  };
  const filing = fact.match(/^filed certified payroll (\d{4}-\d{2}-\d{2}) (.*) \(DIR eCPR list\)$/);
  if (filing) return `filed certified payroll ${filing[2]} on ${spokenDate(filing[1])} — that's on the DIR's certified payroll list`;
  const listing = fact.match(/^(listed as a sub on .*), awarded (\d{4}-\d{2}-\d{2}) \(DIR project list\)$/);
  if (listing) return `is ${listing[1]}, awarded ${spokenDate(listing[2])} — that's on the DIR's project list`;
  return fact.replace(/\beCPR\b/g, "certified payroll");
}

function envNameFor(key: string): string {
  return (
    {
      fromName: "OUTBOUND_FROM_NAME",
      "fromAddress.line1": "OUTBOUND_FROM_LINE1",
      "fromAddress.city": "OUTBOUND_FROM_CITY",
      "fromAddress.state": "OUTBOUND_FROM_STATE",
      "fromAddress.zip": "OUTBOUND_FROM_ZIP",
      mobile: "OUTBOUND_MOBILE",
      replyEmail: "OUTBOUND_REPLY_EMAIL",
    }[key] ?? key
  );
}

/** Lob prints HTML. The letter is plain text, so this is a paragraph per
 * blank-line-separated block and nothing else — no CSS to get wrong. */
export function letterHtml(body: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = body.split("\n\n").map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`);
  return `<html><body style="font-family: Georgia, serif; font-size: 12pt; line-height: 1.5; margin: 2.5in 1in 1in 1in;">${paragraphs.join("")}</body></html>`;
}
