/**
 * WHICH COMPANY THE DEMO SCRIPTS SCOPE THEMSELVES TO.
 *
 * `seed-demo.mjs` has always taken `SEED_COMPANY_ID` or else the oldest
 * company. That is unusable by the one person who needs it: NOTHING in the
 * app ever shows somebody their company id. It is not on any screen, it is
 * deliberately left out of the CSV export (`EXPORT_COLUMN_OMISSIONS` — every
 * file is already one company's rows), and the only place it reaches the DOM
 * is a Procore option value, which needs Procore connected. So the single
 * input the seed workflow asks for is the single value a person cannot
 * obtain, and the fallback — "the oldest company" — is the wrong one exactly
 * when it matters: signing in to a preview with an address the demo database
 * has never seen gets you a brand new empty company called "<Your Name>'s
 * Company", which is by definition the NEWEST.
 *
 * So a name can be given instead. A name is a value the person is looking
 * at while they type it.
 *
 * THE WHOLE POINT OF THIS FILE IS THAT IT REFUSES RATHER THAN GUESSES.
 * "Cyrus's Company" is an auto-generated name (`lib/auth.ts` builds
 * `${name}'s Company`), so two of them on one database is not a freak case,
 * it is what happens when the same person signs in from two email addresses.
 * A resolver that quietly took the first would seed a company nobody was
 * looking at — this repo's oldest and most expensive failure shape, and the
 * reason `SEED_EXPECT_HOST` exists twenty lines further up the seed script.
 *
 * Everything here is pure and takes the candidate rows as an argument, so it
 * is tested without a database and without secrets — same reasoning as
 * connection-target.mjs, tested from apps/web/lib/seed-company-target.test.ts
 * because that is where vitest lives.
 */

/**
 * The comparison key for a company name.
 *
 * CASE-INSENSITIVE, and the exactness is on the WHOLE name — never a
 * substring, prefix or fuzzy match. That boundary is the design:
 *
 *   - Case, surrounding whitespace, runs of whitespace and the shape of an
 *     apostrophe are differences a keyboard and a copy-paste produce on
 *     their own, between two spellings of the SAME name. Normalising them
 *     can only ever make two candidates collide — and a collision is
 *     reported with both ids rather than resolved, so the worst case of
 *     being too generous here is a refusal a person can act on.
 *   - A substring match has no such backstop. "Cyrus" matching exactly one
 *     company called "Cyrus Drywall Inc" is indistinguishable from a
 *     correct answer, and would seed the wrong company with every check
 *     green. Ambiguity is safe; silent breadth is not.
 *
 * The apostrophe class matters more than it looks. The auto-generated name
 * is written with an ASCII `'`, but it is built from a name the person typed
 * into Clerk, and macOS and iOS substitute U+2019 as you type. A name that
 * reads identically on screen and does not compare equal is the failure this
 * normalisation removes.
 */
export function companyNameKey(name) {
  return String(name ?? "")
    .replace(/[‘’ʼ՚＇]/g, "'")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * What the operator asked for, read off the environment.
 *
 * `by: "oldest"` is the untouched historical behaviour and must stay
 * byte-identical: neither variable given means the oldest company, exactly
 * as before this file existed.
 *
 * WHEN BOTH ARE GIVEN IT REFUSES. Neither one quietly wins, and that is
 * Diego's call rather than a taste: the realistic way to get here is a name
 * typed into a form that still had an id in it from the previous run, so
 * "the id wins" means a STALE id decides the target while the log reads as
 * though the name did. Two answers to one question is a question nobody has
 * actually asked yet, and this script writes ~50 models into the answer.
 */
export function companyTargetRequest(env = {}) {
  const id = String(env.SEED_COMPANY_ID ?? "").trim();
  const name = String(env.SEED_COMPANY_NAME ?? "").trim();
  if (id && name) return { by: "conflict", id, name };
  if (id) return { by: "id", id };
  if (name) return { by: "name", name };
  return { by: "oldest" };
}

const describeRow = (c) => `${c.name} (${c.id})`;

/**
 * Turn a request plus the rows it could possibly mean into one company.
 *
 * `candidates` is what the caller fetched for this request's `by`:
 *   - "id"     the `findUnique` result, as a one-or-zero element array
 *   - "name"   EVERY company, because a no-match has to be able to print
 *              the real names — a person who mistyped one needs to see what
 *              is actually there, and that list is the recovery path
 *   - "oldest" the `findFirst` result, as a one-or-zero element array
 *
 * Returns `{ company, lines }` where `lines` explain the choice and are
 * printed by the caller, or `{ error }` — a list of lines, likewise printed
 * by the caller — and never both.
 */
export function resolveCompanyTarget(request, candidates) {
  const rows = (candidates ?? []).filter(Boolean);

  if (request.by === "conflict") {
    return {
      error: [
        `BOTH company_id ("${request.id}") and company_name ("${request.name}") were given.`,
        `REFUSING — one of them is left over from a previous run and there is no way`,
        `to tell which from here. Neither is allowed to win silently: a stale id would`,
        `decide the target while this log read as though the name had.`,
        `Clear one of the two and run again. Nothing has been written.`,
      ],
    };
  }

  if (request.by === "id") {
    const company = rows.find((c) => c.id === request.id) ?? null;
    if (!company) {
      return {
        error: [
          `no company has id "${request.id}". Nothing has been written.`,
          `Leave company_id blank and give company_name instead — the app never`,
          `shows anyone their company id, so a name is the value you can actually read.`,
          `The list-companies operation prints every company on this database.`,
        ],
      };
    }
    return { company, lines: [`resolved by ID`] };
  }

  if (request.by === "name") {
    const want = companyNameKey(request.name);
    const matches = rows.filter((c) => companyNameKey(c.name) === want);

    if (matches.length === 0) {
      return {
        error: [
          `no company is named "${request.name}". Nothing has been written.`,
          rows.length
            ? `The ${rows.length} compan${rows.length === 1 ? "y" : "ies"} on this database:`
            : `This database has no companies at all. Sign in to the app once first.`,
          ...rows.map((c) => `  ${describeRow(c)}`),
          rows.length
            ? `Copy one of those names exactly, or give its id as company_id. The`
            : ``,
          rows.length
            ? `list-companies operation prints the same list with dates and demo counts.`
            : ``,
        ].filter((line) => line !== ""),
      };
    }

    if (matches.length > 1) {
      return {
        error: [
          `"${request.name}" matches ${matches.length} companies. REFUSING to pick one —`,
          `seeding the wrong company is not something you would notice afterwards.`,
          ...matches.map((c) => `  ${describeRow(c)}`),
          `Pass the id of the one you mean as company_id — the list-companies`,
          `operation prints these with their dates and demo-row counts, which is`,
          `usually enough to tell two same-named companies apart. Nothing written.`,
        ],
      };
    }

    return {
      company: matches[0],
      lines: [
        `resolved by NAME "${request.name}" — 1 of ${rows.length} compan${
          rows.length === 1 ? "y" : "ies"
        } matched, case-insensitively`,
      ],
    };
  }

  // "oldest" — the historical default, unchanged.
  const company = rows[0] ?? null;
  if (!company) {
    return {
      error: [
        `no company found. Sign in to the app once first.`,
      ],
    };
  }
  return {
    company,
    lines: [
      `resolved as the OLDEST company (no company_id or company_name given)`,
    ],
  };
}
