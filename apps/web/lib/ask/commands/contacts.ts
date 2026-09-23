import { prisma, type ContactType } from "@prova/db";
import { createContact } from "@/lib/actions/company";
import { CONTACT_TYPES } from "@/lib/actions/shared";
import { formDataFrom, throughAction } from "./adapter";
import type {
  CommandContext,
  CommandInput,
  DirectCommandDefinition,
  Exclusion,
  Executed,
  Option,
  ResolvedPayload,
  Resolution,
} from "../commands";

/**
 * "Add Halvorsen Builders as a GC, 555-0142" — a new account on /contacts.
 *
 * DIRECT over `createContact` (lib/actions/company.ts), called with the
 * FormData the contacts page's own form posts, so its required-name check,
 * its PROSPECT default and its sentences are the page's. Only the fields a
 * person says in one breath are offered — name, type, phone, email,
 * address. The standing GC terms (retainage, payment terms, forms) are
 * money terms and stay on the page, where they are typed.
 *
 * THE GATE IS STRICTER THAN THE PAGE, AND THAT IS WRITTEN DOWN RATHER THAN
 * HIDDEN. /contacts is open ("names and phone numbers are not a tier") and
 * `createContact` checks no capability, but a command must name one.
 * MANAGE_ESTIMATING is the one the rest of the contacts surface already
 * uses for relationship work — the People, interactions and bid-invitation
 * sections of /contacts/[id], the follow-up alert, log_bid_invitation — so
 * the people who add GCs are the people offered this. Anyone else still
 * adds a contact on the page, which is unchanged.
 *
 * Replaces the `company.*` wildcard, which said contact creation was
 * reached through create_estimate_job's resolve-or-create instead. That is
 * still true for a GC named while starting an estimate; this is for the
 * account somebody wants on the list before there is any job at all, which
 * is what `createContact`'s own comment says it is for.
 */

const str = (payload: ResolvedPayload, key: string): string | null =>
  typeof payload[key] === "string" ? (payload[key] as string) : null;

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  GENERAL_CONTRACTOR: "General contractor",
  DEVELOPER: "Developer",
  VENDOR: "Vendor",
  SUBCONTRACTOR: "Subcontractor",
};

const TYPE_WORDS: Record<ContactType, RegExp> = {
  GENERAL_CONTRACTOR: /^(?:gc|g\.c\.|general|general contractor|contractor|builder)$/,
  DEVELOPER: /^(?:developer|owner|dev|owner developer|owner\/developer)$/,
  VENDOR: /^(?:vendor|supplier|supply house|yard|distributor)$/,
  SUBCONTRACTOR: /^(?:sub|subcontractor|sub contractor|subcontractors)$/,
};

/** The person's word for a type, or a chip's enum value. */
export function readContactType(text: string): ContactType | null {
  const words = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!words) return null;
  const asEnum = words.toUpperCase().replace(/[\s-]+/g, "_");
  if ((CONTACT_TYPES as readonly string[]).includes(asEnum)) return asEnum as ContactType;
  return CONTACT_TYPES.find((type) => TYPE_WORDS[type].test(words)) ?? null;
}

async function resolveAddContact(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const name = input.name ?? "";
  if (!name) return { kind: "need", missing: "the company's name" };

  let accountType: ContactType | null = null;
  if (input.type) {
    accountType = readContactType(input.type);
    if (!accountType) {
      const options: Option[] = CONTACT_TYPES.map((type) => ({ value: type, label: CONTACT_TYPE_LABELS[type] }));
      return { kind: "clarify", field: "type", question: `"${input.type}" isn't one of the four kinds — which is ${name}?`, options };
    }
  }

  const phone = input.phone ?? null;
  const email = input.email ?? null;
  const address = input.address ?? null;
  const warnings: string[] = [];
  if (!phone && !email) warnings.push("No phone or email given — the contact will have no way to reach them until one is added.");

  const resolved: ResolvedPayload = { name, accountType, phone, email, address };
  const preview = [
    { label: "Name", value: name },
    { label: "Kind", value: accountType ? CONTACT_TYPE_LABELS[accountType] : "not set" },
    { label: "Phone", value: phone ?? "not set" },
    { label: "Email", value: email ?? "not set" },
    { label: "Address", value: address ?? "not set" },
    { label: "Status", value: "Prospect" },
  ];

  // Same name already on the list: the card links to it and offers no
  // button. /jobs/new used to mint duplicates, and resolveContact has a rule
  // for the mess that left; this does not add to it.
  const twin = await prisma.contact.findFirst({
    where: { companyId: ctx.companyId, name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (twin) {
    return { kind: "ready", resolved, preview, warnings, existing: { label: `${twin.name} is already on your contacts`, href: `/contacts/${twin.id}` } };
  }

  return { kind: "ready", resolved, preview, warnings };
}

async function executeAddContact(ctx: CommandContext, payload: ResolvedPayload): Promise<Executed> {
  const name = str(payload, "name");
  const accountType = payload.accountType === null ? null : str(payload, "accountType");
  if (!name || (accountType !== null && !(CONTACT_TYPES as readonly string[]).includes(accountType))) {
    return { ok: false, error: "That card can't be executed. Ask again." };
  }
  const result = await throughAction("Add contact", () =>
    createContact(
      formDataFrom({
        name,
        accountType,
        phone: str(payload, "phone"),
        email: str(payload, "email"),
        address: str(payload, "address"),
      }),
    ),
  );
  if (!result.ok) return { ok: false, error: result.error };
  const row = await prisma.contact.findFirst({
    where: { companyId: ctx.companyId, name },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return {
    ok: true,
    message: `Added ${name} to your contacts as a prospect.`,
    created: row
      ? { label: name, href: `/contacts/${row.id}`, targetType: "Contact", targetId: row.id }
      : { label: name, href: "/contacts", targetType: "Contact", targetId: name },
  };
}

export const addContactCommand: DirectCommandDefinition = {
  name: "add_contact",
  description:
    "Adds a company — a GC, developer, vendor or subcontractor — to the contacts list, as a prospect, with the phone, email and address the person said. Needs the company's name; ask if missing. Pass every detail exactly as said and omit what was not said — never look up, guess or complete a phone number, email or address. Refuses (and links to it) when a contact with that name already exists. Does NOT add an individual person at a company (that is done on the contact's own page), does not set payment terms or retainage, does not create a job, and sends nothing.",
  capability: "MANAGE_ESTIMATING",
  tier: "T1_DRAFT",
  mode: "DIRECT",
  action: "createContact",
  core: "createContact",
  title: "Add the contact",
  verb: "Preparing the contact",
  button: "Add contact",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The company's name, as the person said it, e.g. 'Halvorsen Builders'. Required: ask if they did not say." },
      type: { type: "string", description: "What kind of company, in the person's word: 'GC', 'developer', 'vendor', 'sub'. Omit if not said." },
      phone: { type: "string", description: "The phone number exactly as said. Omit if not said." },
      email: { type: "string", description: "The email address exactly as said. Omit if not said." },
      address: { type: "string", description: "The address exactly as said. Omit if not said." },
    },
  },
  resolve: resolveAddContact,
  execute: executeAddContact,
};

export const contactCommands: DirectCommandDefinition[] = [addContactCommand];

const ADMIN = "Owner administration (T5): a permission or connection an assistant could widen is not a permission. Never a command.";

/** The rest of lib/actions/company.ts, per action, replacing the wildcard
 * now that one of its actions is a command. */
export const contactExclusions: Exclusion[] = [
  { action: "updateCompanyProfile", reason: ADMIN + " The company's own name, licence numbers and letterhead appear on every GC-facing document." },
  { action: "inviteTeamMember", reason: ADMIN + " An invitation grants somebody access to the company's data." },
  { action: "cancelInvite", reason: ADMIN },
  { action: "removeTeamMember", reason: ADMIN + " Removing a teammate is owner-only and done on /team." },
  { action: "deleteContact", reason: "Deletes are never commands (T5); owner-only on /contacts." },
  { action: "updateContact", reason: "Editing a contact — including its MSA, prequalification and payment terms — is done on the contact's page, where the record being changed is visible." },
  { action: "createCompanyLocation", reason: ADMIN + " Company locations are settings." },
  { action: "deleteCompanyLocation", reason: "Deletes are never commands (T5)." },
  {
    action: "saveBusinessScope",
    reason:
      ADMIN +
      " These three answers decide what the WHOLE COMPANY's nav shows, not just the caller's; an assistant narrowing every teammate's menu on one person's say-so is exactly the kind of owner-only decision this tier excludes.",
  },
  {
    action: "skipBusinessScopeQuestions",
    reason: "Dismisses a UI prompt on screen; there is nothing for a command to do here.",
  },
  {
    action: "clearBusinessScope",
    reason: ADMIN + " Same reasoning as saveBusinessScope — the reverse of the same owner-only setting.",
  },
];
