import type {
  JobberAddress,
  JobberClient,
  JobberJob,
  JobberProperty,
  JobberQuote,
} from "@prova/integrations";
import {
  FULL_SSN_REFUSAL,
  MAX_IMPORT_ROWS,
  looksLikeEmail,
  mentionsWholeSsn,
  nameKey,
  parseSheetDate,
  type ExistingMatch,
  type RowProblem,
} from "./spreadsheet-import";

/**
 * Bringing a contractor's Jobber account in during onboarding — the same
 * import as /settings/import, with Jobber in place of a spreadsheet.
 *
 * ONE-WAY AND ONE-TIME, ON PURPOSE. This reads Jobber and writes C Stream,
 * once per Confirm. It never writes to Jobber, never pulls again on its own,
 * and never changes a row that is already here. A sync would need an answer
 * to "which side wins" for every field; an onboarding import needs none.
 *
 * Same rules as the spreadsheet importer (lib/spreadsheet-import.ts), and
 * the same helpers wherever they fit: names compared by `nameKey`, the
 * 500-row cap, the email check, the refusal to carry a whole Social
 * Security number, and every job landing as an ESTIMATE whatever Jobber
 * calls it — contracting is `markJobContracted`'s decision, with evidence,
 * and an import that wrote anything else would be a second door into
 * billing with none (Cyrus's decision, same as the sheet import).
 *
 * The one thing it does that a sheet cannot: every row carries its Jobber
 * id, stored on the Contact or Job it creates. A second import recognises
 * its own rows by that id FIRST, so renaming a client on either side does
 * not make it come in twice; name matching is the fallback for records that
 * were typed in by hand before Jobber was connected.
 *
 * Every Jobber record lands in exactly one bucket:
 *
 *   create    — written on Confirm;
 *   existing  — already here (same Jobber id, or same name), left alone;
 *   leftOut   — deliberately not imported, with the reason (archived work,
 *               a quote that already became a job);
 *   problems  — could not be imported, with a sentence.
 *
 * Pure: Jobber's rows and this company's existing rows in, a plan out. The
 * same function runs for the preview and again inside the confirm's
 * transaction, against a fresh pull and a fresh read.
 */

export { MAX_IMPORT_ROWS };

/** Most records of one kind read from Jobber in one import. Past this the
 * preview says plainly that the account was only partly read — a re-run
 * reads the same first N again, so it is not a way round the limit. */
export const JOBBER_PULL_LIMIT = 5000;

export type JobberPull = {
  clients: JobberClient[];
  jobs: JobberJob[];
  quotes: JobberQuote[];
  /** Null when Jobber's property list could not be read — addresses on jobs
   * and quotes still come across; the preview says so. */
  properties: (JobberProperty & { client?: { id: string } | null })[] | null;
  truncated: { clients: boolean; jobs: boolean; quotes: boolean; properties: boolean };
};

export type ExistingForJobber = {
  /** This company's contacts, OLDEST FIRST — a name matches the original. */
  contacts: { id: string; name: string; jobberId: string | null }[];
  jobs: { name: string; contactId: string; jobberId: string | null }[];
};

export type LeftOut = { label: string; reason: string };

export type JobberClientRow = {
  jobberId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** Where the address came from, said in the preview. */
  addressFrom: "billing" | "property" | null;
  notes: string[];
};

/** The C Stream client a job will hang off. */
export type JobberJobClient =
  | { kind: "existing"; contactId: string; name: string }
  | { kind: "new"; jobberClientId: string; name: string };

export type JobberJobRow = {
  jobberId: string;
  source: "job" | "quote";
  /** "Job #12" / "Quote #7", for the preview. */
  reference: string;
  name: string;
  client: JobberJobClient;
  /** What Jobber called it. Every row lands as ESTIMATE regardless. */
  jobberStatus: string | null;
  startDate: string | null;
  endDate: string | null;
  scope: string | null;
  /** The Jobber property's address, stored as the job's site. */
  site: string | null;
  notes: string[];
};

type Bucket<R> = { create: R[]; existing: ExistingMatch[]; leftOut: LeftOut[]; problems: RowProblem[] };

export type JobberPlan = {
  clients: Bucket<JobberClientRow>;
  jobs: Bucket<JobberJobRow>;
  properties: {
    total: number;
    /** Stored as a job's site address. */
    asSite: number;
    /** Became a client's address because Jobber had no billing address. */
    asClientAddress: number;
    readable: boolean;
  };
  /** Sentences for the top of the preview: partial reads and the cap. */
  notices: string[];
};

/* ------------------------------------------------------------------ */

function clean(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

export function formatJobberAddress(address: JobberAddress | null | undefined): string | null {
  if (!address) return null;
  const street = [clean(address.street1), clean(address.street2)].filter(Boolean).join(", ");
  const region = [clean(address.province), clean(address.postalCode)].filter(Boolean).join(" ");
  const line = [street, clean(address.city), region].filter(Boolean).join(", ");
  return line || null;
}

/** The name a person would recognise: Jobber's own display name, else the
 * company name, else first and last. */
export function jobberClientName(client: JobberClient): string {
  return (
    clean(client.name) ||
    clean(client.companyName) ||
    [clean(client.firstName), clean(client.lastName)].filter(Boolean).join(" ")
  );
}

function pickPrimary<T extends { primary?: boolean | null }>(items: T[] | null | undefined): T | undefined {
  if (!items || items.length === 0) return undefined;
  return items.find((item) => item.primary) ?? items[0];
}

/**
 * A Jobber timestamp to a calendar day. Jobber writes these in the
 * account's own time with an offset, so the date part is the day the
 * contractor sees in Jobber — taken as written, never shifted through UTC,
 * which would move an evening start to the next day. Anything that is not
 * a readable date is dropped with a note rather than guessed at.
 */
export function jobberDay(value: string | null | undefined): string | null | undefined {
  if (!value) return null;
  const day = parseSheetDate(value.slice(0, 10));
  return day.ok ? day.value : undefined;
}

/** Quote statuses that are not imported, with why. */
const QUOTE_LEFT_OUT: Record<string, string> = {
  converted: "already became a job in Jobber — the job is imported instead",
  archived: "archived in Jobber",
};

/** Job statuses that are not imported, with why. */
const JOB_LEFT_OUT: Record<string, string> = {
  archived: "archived in Jobber — finished work is left out so it doesn't show up as an open estimate",
};

/* ------------------------------------------------------------------ */

export function planJobberImport(pull: JobberPull, existing: ExistingForJobber): JobberPlan {
  const notices: string[] = [];
  const kinds: [keyof JobberPull["truncated"], string][] = [
    ["clients", "clients"],
    ["jobs", "jobs"],
    ["quotes", "quotes"],
  ];
  for (const [key, word] of kinds) {
    if (pull.truncated[key]) {
      notices.push(
        `Jobber has more than ${JOBBER_PULL_LIMIT} ${word}, and C Stream reads the first ${JOBBER_PULL_LIMIT} in the order Jobber lists them. Anything after that is not in this preview, and running the import again will not reach it.`,
      );
    }
  }
  if (pull.properties === null) {
    notices.push(
      "Couldn't read Jobber's property list. The addresses on your jobs and quotes still come across.",
    );
  }

  /* ------------------------------- clients ------------------------------- */

  const byJobberId = new Map<string, { id: string; name: string }>();
  const byName = new Map<string, { id: string; name: string; jobberId: string | null }>();
  for (const contact of existing.contacts) {
    if (contact.jobberId) byJobberId.set(contact.jobberId, contact);
    const key = nameKey(contact.name);
    if (!byName.has(key)) byName.set(key, contact);
  }

  // A client's first property, for a client Jobber has no billing address
  // for. From the property list when it was readable, else from the sites
  // on that client's jobs and quotes.
  const firstPropertyOf = new Map<string, string>();
  const noteProperty = (clientId: string | undefined, property: JobberProperty | null | undefined) => {
    if (!clientId || firstPropertyOf.has(clientId)) return;
    const line = formatJobberAddress(property?.address);
    if (line) firstPropertyOf.set(clientId, line);
  };
  for (const property of pull.properties ?? []) noteProperty(property.client?.id, property);
  for (const job of pull.jobs) noteProperty(job.client?.id, job.property);
  for (const quote of pull.quotes) noteProperty(quote.client?.id, quote.property);

  const clients: Bucket<JobberClientRow> = { create: [], existing: [], leftOut: [], problems: [] };
  /** Jobber client id -> the C Stream client its jobs attach to, or the
   * reason they cannot. */
  const resolved = new Map<string, JobberJobClient | { kind: "refused"; why: string }>();
  /** Name key -> the Jobber client that claimed it in this pull. */
  const newNameLine = new Map<string, string>();
  let usedPropertyAsAddress = 0;

  pull.clients.forEach((client, index) => {
    const line = index + 1;
    const name = jobberClientName(client);
    if (!name) {
      clients.problems.push({ line, message: "A Jobber client with no name — skipped, and so are its jobs." });
      resolved.set(client.id, { kind: "refused", why: "its client has no name in Jobber" });
      return;
    }

    const phone = clean(pickPrimary(client.phones)?.number) || null;
    const billing = formatJobberAddress(client.billingAddress);
    // Checked before anything about the row is kept, and the message never
    // repeats the value.
    if ([name, phone, billing].some(mentionsWholeSsn)) {
      clients.problems.push({ line, message: `${name} — ${FULL_SSN_REFUSAL}` });
      resolved.set(client.id, { kind: "refused", why: `its client ${name} was skipped` });
      return;
    }

    const linked = byJobberId.get(client.id);
    if (linked) {
      clients.existing.push({ line, label: linked.name === name ? name : `${name} (here as ${linked.name})` });
      resolved.set(client.id, { kind: "existing", contactId: linked.id, name: linked.name });
      return;
    }

    const key = nameKey(name);
    const earlier = newNameLine.get(key);
    if (earlier !== undefined) {
      clients.problems.push({
        line,
        message: `${name} — another Jobber client has the same name, so only the first is added. Rename one of them in Jobber and import again to bring this one and its jobs in.`,
      });
      resolved.set(client.id, { kind: "refused", why: `its client ${name} shares a name with another Jobber client` });
      return;
    }

    const namesake = byName.get(key);
    if (namesake) {
      if (namesake.jobberId && namesake.jobberId !== client.id) {
        // The C Stream client of that name came from a DIFFERENT Jobber
        // client. Attaching this one's jobs to it would mix two people.
        clients.problems.push({
          line,
          message: `${name} — a client with this name was already imported from a different Jobber client. Rename one of them in Jobber and import again.`,
        });
        resolved.set(client.id, { kind: "refused", why: `its client ${name} clashes with another imported client` });
        return;
      }
      // Claimed, so a second Jobber client of the same name is refused
      // below rather than merged into this one.
      newNameLine.set(key, client.id);
      clients.existing.push({ line, label: name });
      resolved.set(client.id, { kind: "existing", contactId: namesake.id, name: namesake.name });
      return;
    }

    const notes: string[] = [];
    const emailText = clean(pickPrimary(client.emails)?.address);
    let email: string | null = null;
    if (emailText) {
      if (looksLikeEmail(emailText)) email = emailText;
      else notes.push(`email "${emailText}" left out — it isn't an address`);
    }
    let address = billing;
    let addressFrom: JobberClientRow["addressFrom"] = billing ? "billing" : null;
    if (!address) {
      const property = firstPropertyOf.get(client.id) ?? null;
      if (property && !mentionsWholeSsn(property)) {
        address = property;
        addressFrom = "property";
        usedPropertyAsAddress++;
      }
    }

    newNameLine.set(key, client.id);
    clients.create.push({ jobberId: client.id, name, email, phone, address, addressFrom, notes });
    resolved.set(client.id, { kind: "new", jobberClientId: client.id, name });
  });

  // The cap applies to what would be CREATED, after matching — so a second
  // run picks up where the first stopped instead of re-reading the same 500
  // and finding them all already here.
  if (clients.create.length > MAX_IMPORT_ROWS) {
    const over = clients.create.splice(MAX_IMPORT_ROWS);
    for (const row of over) {
      resolved.set(row.jobberId, { kind: "refused", why: "its client is in the next batch — run the import again" });
    }
    notices.push(
      `Only the first ${MAX_IMPORT_ROWS} new clients are added this time — ${over.length} more are left for the next run. Confirm, then import again.`,
    );
  }

  /* --------------------------------- jobs -------------------------------- */

  const jobs: Bucket<JobberJobRow> = { create: [], existing: [], leftOut: [], problems: [] };
  const existingJobByJobberId = new Set(existing.jobs.flatMap((job) => (job.jobberId ? [job.jobberId] : [])));
  const siteIds = new Set<string>();

  type Candidate = Omit<JobberJobRow, "name"> & { title: string; line: number };
  const candidates: Candidate[] = [];

  const consider = (
    source: "job" | "quote",
    item: JobberJob | JobberQuote,
    line: number,
    number: string | null,
    statusLeftOut: Record<string, string>,
    status: string | null,
  ) => {
    const noun = source === "job" ? "Job" : "Quote";
    const reference = number ? `${noun} #${number}` : noun;
    const title = clean(item.title);
    const label = title ? `${reference} ${title}` : reference;

    if (existingJobByJobberId.has(item.id)) {
      jobs.existing.push({ line, label });
      return;
    }
    const reason = status ? statusLeftOut[status.toLowerCase()] : undefined;
    if (reason) {
      jobs.leftOut.push({ label, reason });
      return;
    }
    const clientId = item.client?.id;
    const client = clientId ? resolved.get(clientId) : undefined;
    if (!client) {
      jobs.problems.push({ line, message: `${label} — its client wasn't found in Jobber's client list, so it was skipped.` });
      return;
    }
    if (client.kind === "refused") {
      jobs.problems.push({ line, message: `${label} — skipped because ${client.why}.` });
      return;
    }
    if (!title && !number) {
      jobs.problems.push({ line, message: `A Jobber ${source} with no title and no number — skipped.` });
      return;
    }

    const site = formatJobberAddress(item.property?.address);
    const scope = source === "job" ? ((item as JobberJob).instructions ?? "").trim() || null : null;
    if ([title, site, scope].some(mentionsWholeSsn)) {
      jobs.problems.push({ line, message: `${label} — ${FULL_SSN_REFUSAL}` });
      return;
    }

    const notes: string[] = [];
    let startDate: string | null = null;
    let endDate: string | null = null;
    if (source === "job") {
      const start = jobberDay((item as JobberJob).startAt);
      const end = jobberDay((item as JobberJob).endAt);
      if (start === undefined || end === undefined) notes.push("dates left out — Jobber's weren't readable");
      else if (start && end && end < start) notes.push("dates left out — Jobber has the end before the start");
      else {
        startDate = start;
        endDate = end;
      }
    }
    if (site && item.property?.id) siteIds.add(item.property.id);

    candidates.push({
      jobberId: item.id,
      source,
      reference,
      title: title || reference,
      client,
      jobberStatus: status,
      startDate,
      endDate,
      scope,
      site,
      notes,
      line,
    });
  };

  pull.jobs.forEach((job, index) =>
    consider("job", job, index + 1, job.jobNumber != null ? String(job.jobNumber) : null, JOB_LEFT_OUT, job.jobStatus ?? null),
  );
  pull.quotes.forEach((quote, index) =>
    consider(
      "quote",
      quote,
      pull.jobs.length + index + 1,
      quote.quoteNumber != null && String(quote.quoteNumber).trim() ? String(quote.quoteNumber).trim() : null,
      QUOTE_LEFT_OUT,
      quote.quoteStatus ?? null,
    ),
  );

  // Two Jobber records with one title for one client are two pieces of
  // work — a repeat service call, say — and each keeps its own row. So
  // their names get the Jobber reference added, which keeps C Stream's
  // (name, client) pair unambiguous for the name-matching fallback.
  const clientKeyOf = (client: JobberJobClient) =>
    client.kind === "existing" ? `c:${client.contactId}` : `j:${client.jobberClientId}`;
  const titleCount = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${nameKey(candidate.title)} ${clientKeyOf(candidate.client)}`;
    titleCount.set(key, (titleCount.get(key) ?? 0) + 1);
  }
  const existingJobNames = new Set(
    existing.jobs.filter((job) => !job.jobberId).map((job) => `${nameKey(job.name)} c:${job.contactId}`),
  );

  for (const candidate of candidates) {
    const { title, line, ...rest } = candidate;
    const shared = (titleCount.get(`${nameKey(title)} ${clientKeyOf(candidate.client)}`) ?? 0) > 1;
    const name = shared && title !== candidate.reference ? `${title} — Jobber ${candidate.reference.toLowerCase()}` : title;
    // Typed in by hand before Jobber was connected: same name, same client.
    if (candidate.client.kind === "existing" && existingJobNames.has(`${nameKey(name)} c:${candidate.client.contactId}`)) {
      jobs.existing.push({ line, label: `${candidate.reference} ${name}` });
      continue;
    }
    jobs.create.push({ ...rest, name });
  }

  if (jobs.create.length > MAX_IMPORT_ROWS) {
    const over = jobs.create.splice(MAX_IMPORT_ROWS);
    notices.push(
      `Only the first ${MAX_IMPORT_ROWS} new jobs and quotes are added this time — ${over.length} more are left for the next run. Confirm, then import again.`,
    );
  }

  // A client that is ONLY in the create list because a job needs it is
  // still a client — nothing to prune. But a new client whose every job was
  // cut by the cap is still created; that is the right way round, since the
  // next run attaches its jobs to it by Jobber id.

  const propertyIds = new Set<string>();
  for (const property of pull.properties ?? []) propertyIds.add(property.id);
  for (const item of [...pull.jobs, ...pull.quotes]) if (item.property?.id) propertyIds.add(item.property.id);

  jobs.problems.sort((a, b) => a.line - b.line);
  jobs.existing.sort((a, b) => a.line - b.line);

  return {
    clients,
    jobs,
    properties: {
      total: propertyIds.size,
      asSite: siteIds.size,
      asClientAddress: usedPropertyAsAddress,
      readable: pull.properties !== null,
    },
    notices,
  };
}

/** The sentence a confirm returns. */
export function jobberSummarySentence(clientsAdded: number, jobsAdded: number, alreadyThere: number): string {
  if (clientsAdded === 0 && jobsAdded === 0) {
    return "Nothing new to add — everything from Jobber is already in C Stream.";
  }
  const parts = [
    `Added ${clientsAdded} ${clientsAdded === 1 ? "client" : "clients"} and ${jobsAdded} ${
      jobsAdded === 1 ? "job" : "jobs"
    } from Jobber, every job as an estimate.`,
  ];
  if (alreadyThere > 0) parts.push(`${alreadyThere} already here and left alone.`);
  return parts.join(" ");
}
