import {
  MAX_IMPORT_ROWS,
  clean,
  mentionsWholeSsn,
  nameKey,
  type ExistingMatch,
  type RowProblem,
} from "./spreadsheet-import";

/**
 * A phone's contacts export (.vcf, vCard) into the clients importer.
 *
 * "Export contacts" on an iPhone or Android hands over a vCard file, and a
 * brand-new tester has one of those long before they have a spreadsheet.
 * This reads it with the same arrangement as every other import here: a
 * pure function over the raw text, run in the browser for the preview and
 * again on the server inside the transaction that writes
 * (`importVcfContacts`, lib/actions/spreadsheetImport.ts). Nothing is
 * written before Confirm.
 *
 * NO DEPENDENCY, on purpose. The subset of vCard a phone actually exports
 * is small — FN/N, ORG, TEL, EMAIL, ADR, folded lines, and the
 * quoted-printable encoding old Android used — and a parser for it is
 * shorter than the audit of a library would be.
 *
 * COMPANIES AND PEOPLE, the shape this app already models (crm.prisma):
 * the GC you work for is a `Contact`; the people there are `ContactPerson`
 * rows attached to it, never contacts of their own. So:
 *
 *   - a card WITH an ORG creates or matches the org's Contact and attaches
 *     the person to it (name, title, email, phone). Five cards from Acme
 *     Builders are one client and five people;
 *   - a card WITHOUT an ORG becomes a Contact named after the person —
 *     exactly the row the clients spreadsheet importer would create;
 *   - no client type is guessed. A phone export holds GCs, suppliers and
 *     in-laws alike; `Contact.accountType` stays unset and the contacts
 *     page offers it later. The spreadsheet importer's General-contractor
 *     default is for a file that is DECLARED to be a client list; this one
 *     is not.
 *
 * Matching is `nameKey` — trimmed, collapsed, case-insensitive — the same
 * "importing the same file twice adds nothing" rule as every import here.
 *
 * A card mentioning a whole Social Security number ANYWHERE — a NOTE is
 * the real case — is refused whole, without the number being repeated, the
 * same stance as the crew importer. C Stream is not where SSNs live.
 */

export const VCF_SSN_REFUSAL =
  "this card mentions a whole Social Security number (in its note or another field). C Stream never stores one — delete it from the contact on your phone, export again, and re-import. Nothing from this card was saved.";

/** Rough but deliberate: the clients box decides between the CSV and the
 * vCard parser by looking at the text, so a pasted export works too. */
export function looksLikeVcf(text: string): boolean {
  return /^﻿?\s*BEGIN:VCARD/i.test(text);
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/** RFC 6350/2426 line folding: a line starting with space or tab continues
 * the previous one, minus that one character. */
function unfold(text: string): string[] {
  const physical = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const lines: string[] = [];
  for (const raw of physical) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += raw.slice(1);
    } else {
      lines.push(raw);
    }
  }
  return lines;
}

/** Quoted-printable, as vCard 2.1 exports (old Android) wrote it: =HH byte
 * escapes decoded as UTF-8. Soft breaks (`=` at end of line) are joined
 * before this is called. */
export function decodeQuotedPrintable(value: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      // Plain ASCII inside a QP value; charCodeAt is its byte.
      bytes.push(char.charCodeAt(0));
    }
  }
  try {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  } catch {
    return value;
  }
}

/** vCard text escapes: \n is a line break, \, and \; are literal, \\ is a
 * backslash. Line breaks inside a single value become ", " — an address's
 * street lines read naturally as one line. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, ", ")
    .replace(/\\([\\,;])/g, "$1");
}

/** Split on a separator, honouring backslash escapes. */
function splitUnescaped(value: string, separator: ";" | ","): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "\\" && i + 1 < value.length) {
      current += char + value[i + 1];
      i++;
    } else if (char === separator) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

type VcfProperty = {
  /** Upper-cased, group prefix (item1.) removed. */
  name: string;
  /** Upper-cased parameters — both 3.0/4.0 `TYPE=CELL` and bare 2.1 `CELL`
   * arrive here as `TYPE=CELL` / `CELL`. */
  params: string[];
  /** Decoded (quoted-printable applied) but NOT yet unescaped — component
   * splitting has to happen before \; is resolved. */
  value: string;
};

function parseProperty(line: string): VcfProperty | null {
  // Split name+params from value at the first colon outside double quotes.
  let colon = -1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuotes = !inQuotes;
    else if (line[i] === ":" && !inQuotes) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = line.slice(0, colon);
  let value = line.slice(colon + 1);

  const headParts = head.split(";");
  let name = headParts[0].toUpperCase().trim();
  const dot = name.lastIndexOf(".");
  if (dot !== -1) name = name.slice(dot + 1); // item1.TEL -> TEL
  const params = headParts.slice(1).map((p) => p.toUpperCase().trim());

  if (params.some((p) => p === "ENCODING=QUOTED-PRINTABLE" || p === "QUOTED-PRINTABLE")) {
    value = decodeQuotedPrintable(value);
  }
  return { name, params, value };
}

export type VcfCard = {
  /** 1-based position in the file — the "Line N" of this importer. */
  index: number;
  /** The person, from FN or assembled from N. Empty when the card has
   * neither (an org-only card). */
  personName: string;
  /** ORG's first component, or null. */
  org: string | null;
  title: string | null;
  /** First TEL, with its type word when the card gave one. */
  phone: string | null;
  phoneType: string | null;
  /** First EMAIL. */
  email: string | null;
  /** First ADR, joined street → city → region zip → country. */
  address: string | null;
  /** A whole SSN appeared somewhere in the card (NOTE, misused field). */
  mentionsSsn: boolean;
};

const TEL_TYPE_WORDS: Record<string, string> = {
  CELL: "cell",
  MOBILE: "cell",
  IPHONE: "cell",
  HOME: "home",
  WORK: "work",
  MAIN: "main",
  FAX: "fax",
};

function telType(params: string[]): string | null {
  for (const param of params) {
    const bare = param.startsWith("TYPE=") ? param.slice(5) : param;
    // 4.0 writes TYPE="cell,voice"; split and strip quotes.
    for (const piece of bare.replace(/"/g, "").split(",")) {
      const word = TEL_TYPE_WORDS[piece.trim().toUpperCase()];
      if (word) return word;
    }
  }
  return null;
}

function assembleCard(index: number, lines: string[]): VcfCard {
  const card: VcfCard = {
    index,
    personName: "",
    org: null,
    title: null,
    phone: null,
    phoneType: null,
    email: null,
    address: null,
    mentionsSsn: false,
  };
  let nameFromN = "";

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // 2.1 quoted-printable soft break: a QP value ending in `=` continues
    // on the NEXT line, with no leading space. Join before parsing.
    if (/ENCODING=QUOTED-PRINTABLE|;QUOTED-PRINTABLE[;:]/i.test(line)) {
      while (line.endsWith("=") && i + 1 < lines.length) {
        line = line.slice(0, -1) + lines[i + 1];
        i++;
      }
    }
    const prop = parseProperty(line);
    if (!prop) continue;

    const plain = unescapeText(prop.value);
    if (mentionsWholeSsn(plain)) card.mentionsSsn = true;

    switch (prop.name) {
      case "FN":
        if (!card.personName) card.personName = clean(plain);
        break;
      case "N": {
        const [family = "", given = "", middle = ""] = splitUnescaped(prop.value, ";").map((part) =>
          clean(unescapeText(part)),
        );
        nameFromN = [given, middle, family].filter(Boolean).join(" ");
        break;
      }
      case "ORG": {
        const company = clean(unescapeText(splitUnescaped(prop.value, ";")[0] ?? ""));
        if (!card.org && company) card.org = company;
        break;
      }
      case "TITLE":
        if (!card.title && clean(plain)) card.title = clean(plain);
        break;
      case "TEL": {
        const number = clean(plain.replace(/^tel:/i, ""));
        if (!card.phone && number) {
          card.phone = number;
          card.phoneType = telType(prop.params);
        }
        break;
      }
      case "EMAIL": {
        const address = clean(plain);
        if (!card.email && address) card.email = address;
        break;
      }
      case "ADR": {
        if (card.address) break;
        const parts = splitUnescaped(prop.value, ";").map((part) => clean(unescapeText(part)));
        const [, , street = "", city = "", region = "", zip = "", country = ""] = parts;
        const joined = [street, city, [region, zip].filter(Boolean).join(" "), country]
          .filter(Boolean)
          .join(", ");
        if (joined) card.address = joined;
        break;
      }
      default:
        break;
    }
  }

  if (!card.personName) card.personName = nameFromN;
  return card;
}

/** Every card in the file, in order. Tolerates 2.1, 3.0 and 4.0 exports —
 * the differences that matter (folding, bare parameters, quoted-printable,
 * tel: URIs) are handled per property, not per version. */
export function parseVcards(text: string): VcfCard[] {
  const lines = unfold(text);
  const cards: VcfCard[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    const upper = line.trim().toUpperCase();
    if (upper === "BEGIN:VCARD") {
      current = [];
    } else if (upper === "END:VCARD") {
      if (current) cards.push(assembleCard(cards.length + 1, current));
      current = null;
    } else if (current) {
      current.push(line);
    }
  }
  return cards;
}

/* ------------------------------------------------------------------ */
/* Planning                                                            */
/* ------------------------------------------------------------------ */

export type VcfPerson = {
  /** Card number, for pointing at the source. */
  card: number;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
};

export type VcfNewContact = {
  card: number;
  name: string;
  /** True when the name came from an ORG line (a company), false when the
   * card had no company and the person becomes the contact. */
  fromOrg: boolean;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** People attached to this new contact (org cards only). */
  people: VcfPerson[];
};

export type VcfAttachedPerson = VcfPerson & {
  /** The contact already in C Stream this person is added to. */
  contactName: string;
};

export type ExistingPerson = { contactName: string; name: string };

export type VcfPlan = {
  createContacts: VcfNewContact[];
  /** People added to contacts that already exist. */
  attachPeople: VcfAttachedPerson[];
  existing: ExistingMatch[];
  problems: RowProblem[];
  /** How many cards the file held, before any refusals. */
  cards: number;
};

export function planVcfImport(
  text: string,
  existingContactNames: string[],
  existingPeople: ExistingPerson[],
): VcfPlan {
  const plan: VcfPlan = { createContacts: [], attachPeople: [], existing: [], problems: [], cards: 0 };
  const parsed = parseVcards(text);
  plan.cards = parsed.length;
  if (parsed.length === 0) {
    plan.problems.push({ line: 1, message: "No contacts found in that file." });
    return plan;
  }

  // The same cap as every import, counted in CARDS. Refusals below still
  // apply to the kept cards; a capped file is split, not partially trusted.
  let cards = parsed;
  if (cards.length > MAX_IMPORT_ROWS) {
    plan.problems.push({
      line: cards[MAX_IMPORT_ROWS].index,
      message: `Only the first ${MAX_IMPORT_ROWS} contacts will be imported — ${
        cards.length - MAX_IMPORT_ROWS
      } more were left out. Split the file and import again.`,
    });
    cards = cards.slice(0, MAX_IMPORT_ROWS);
  }

  const knownContacts = new Set(existingContactNames.map(nameKey));
  const knownPeople = new Set(
    existingPeople.map((person) => `${nameKey(person.contactName)} ${nameKey(person.name)}`),
  );

  /** New contacts this file creates, by name key. */
  const newByKey = new Map<string, VcfNewContact>();
  /** Person names seen per contact key in THIS file (new or existing). */
  const seenPeople = new Set<string>();
  /** Person-named contacts seen in this file, card index by key. */
  const seenCards = new Map<string, number>();

  for (const card of cards) {
    if (card.mentionsSsn) {
      const named = card.personName || card.org || "This card";
      plan.problems.push({ line: card.index, message: `${named} — ${VCF_SSN_REFUSAL}` });
      continue;
    }
    if (!card.personName && !card.org) {
      plan.problems.push({ line: card.index, message: `Card ${card.index} has no name — skipped.` });
      continue;
    }

    if (card.org) {
      const contactKey = nameKey(card.org);
      const person: VcfPerson | null = card.personName
        ? {
            card: card.index,
            name: card.personName,
            title: card.title,
            email: card.email,
            phone: card.phone,
          }
        : null;

      const contactExists = knownContacts.has(contactKey);
      let created = newByKey.get(contactKey);
      if (!contactExists && !created) {
        created = {
          card: card.index,
          name: card.org,
          fromOrg: true,
          // The person's phone and email belong to the person; the org
          // contact itself only carries them when the card names nobody.
          email: person ? null : card.email,
          phone: person ? null : card.phone,
          address: card.address,
          people: [],
        };
        newByKey.set(contactKey, created);
        plan.createContacts.push(created);
      } else if (created && !created.address && card.address) {
        created.address = card.address;
      }

      if (!person) {
        if (contactExists && !created) plan.existing.push({ line: card.index, label: card.org });
        continue;
      }

      const personKey = `${contactKey} ${nameKey(person.name)}`;
      if (knownPeople.has(personKey) || seenPeople.has(personKey)) {
        plan.existing.push({ line: card.index, label: `${person.name} at ${card.org}` });
        continue;
      }
      seenPeople.add(personKey);
      if (created) created.people.push(person);
      else plan.attachPeople.push({ ...person, contactName: card.org });
      continue;
    }

    // No ORG: the person is the contact, the spreadsheet importer's shape.
    const key = nameKey(card.personName);
    const earlier = seenCards.get(key);
    if (earlier !== undefined) {
      plan.problems.push({
        line: card.index,
        message: `${card.personName} — same name as card ${earlier}, so they're only added once.`,
      });
      continue;
    }
    seenCards.set(key, card.index);
    if (knownContacts.has(key) || newByKey.has(key)) {
      plan.existing.push({ line: card.index, label: card.personName });
      continue;
    }
    plan.createContacts.push({
      card: card.index,
      name: card.personName,
      fromOrg: false,
      email: card.email,
      phone: card.phone,
      address: card.address,
      people: [],
    });
  }

  plan.problems.sort((a, b) => a.line - b.line);
  return plan;
}

/** How many rows Confirm will write — contacts plus attached people. */
export function vcfWriteCount(plan: VcfPlan): number {
  return (
    plan.createContacts.length +
    plan.createContacts.reduce((n, contact) => n + contact.people.length, 0) +
    plan.attachPeople.length
  );
}

export type VcfDisplayRow = {
  card: number;
  name: string;
  /** Where this row lands — "new contact", "at Acme Builders", … */
  note: string;
  phone: string;
  email: string;
};

/** The preview table, flattened from the plan so the component stays
 * markup. Exactly one row per thing Confirm will write, so this list's
 * length always equals `vcfWriteCount`. */
export function vcfDisplayRows(plan: VcfPlan): VcfDisplayRow[] {
  const rows: VcfDisplayRow[] = [];
  for (const contact of plan.createContacts) {
    rows.push({
      card: contact.card,
      name: contact.name,
      note: contact.fromOrg ? "new contact — a company" : "new contact",
      phone: contact.phone ?? "—",
      email: contact.email ?? "—",
    });
    for (const person of contact.people) {
      rows.push({
        card: person.card,
        name: person.name,
        note: `at ${contact.name}`,
        phone: person.phone ?? "—",
        email: person.email ?? "—",
      });
    }
  }
  for (const person of plan.attachPeople) {
    rows.push({
      card: person.card,
      name: person.name,
      note: `at ${person.contactName} — already your contact`,
      phone: person.phone ?? "—",
      email: person.email ?? "—",
    });
  }
  return rows.sort((a, b) => a.card - b.card);
}
