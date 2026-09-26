### The three things #524 flagged, and one of the three flags was wrong (Diego)
`diego/recap-loose-ends`

#524 listed three loose ends rather than fixing them. Closing them turned up
more than they were worth, and **the most confident of the three was false.**

### 1. The `runAction` flag was wrong, and the real bug was next door

The flag read: *"`setLineCostCategory` is not wrapped in `runAction`, so a Prisma
failure reaches production as a redacted digest."* I wrote that in a PR body, and
repeated it in a second one, and in Slack.

**It is false.** `runAction` converts an `InputError` and **rethrows everything
else** (`shared.ts:460-467`). Wrapping buys nothing against a pool timeout, and a
Prisma failure reaches production as a digest from *every* action in this
codebase, wrapped or not — deliberately, because CLAUDE.md's rule is that
`throw` is for genuine bugs and a connection timeout is one.

**Found by writing the test for the claim**, which asserted the action resolves
when Prisma throws, and watching it go red. Nobody had read `runAction`; I had
read my own PR body.

**What was actually wrong, found while checking that.** An unrecognised category
was silently coerced to `null`:

```ts
COST_CATEGORIES.includes(category) ? category : null
```

So `"MATERAIL"`, or a tampered value, was treated exactly like the deliberate
"No cost type" — it **cleared** the line's cost type and returned `{ ok: true }`.
An uncategorised line is never marked up, so that line quietly dropped out of
every markup in the bid, from a typo, with a success response.

An empty string is the real "clear it" signal (the select's own option) and still
clears. Anything else is refused now, naming the value — which needs an
`InputError`, which is what the wrapper is legitimately for.

### 2. A capability comment that drifted, in the one file that cannot check prose

`action-capability-guards.test.ts` said `saveCompanyBidDefaults` was
"MANAGE_ESTIMATING, owner". It asserts `MANAGE_COMPLIANCE` and is not
owner-gated — the owner gate was removed because it refused a
`PAYROLL_COMPLIANCE` member who legitimately holds the page's capability, and
that comment was describing the version before the fix.

Worth more than the correction: **everything else in that file is derived from
the page-import walk and executed**, so it cannot drift. This sentence was prose
beside a mechanism, and it drifted while every assertion around it stayed true.
The comment now says to read the action, not the line.

### 3. The export census had the wrong scope, and the gap was 74 columns

This was flagged as "`exportCompletenessCensus` is model-level, so an export
column list can go stale". That is true and it undersold it.

`exportCompletenessCensus` guarantees every **model** is exported, admitted
missing, or internal. It is model-level, so a new **column** on an
already-exported table was invisible: the export shipped without it and the page
went on claiming the file was complete. The `theme-contrast` shape from
CLAUDE.md — right pattern, wrong scope, and no size assertion can see it,
because the set it sizes was never the set in question.

**`exportColumnCensus.test.ts` found 74 columns across 28 datasets.** Forty-two
were real customer data simply absent from the file:

| Dataset | Missing |
| --- | --- |
| `jobs` | the whole site address, county, coordinates, `bidDueDate`, `bidAdvertisedOn`, `publicWorks`, `awardingBody`, `grossAreaSqFt` |
| `invoices` | **`status`** — the export could not tell a draft from one a GC had been sent |
| `punch-list-items` | the entire who-marked-it-ready / who-verified / who-reopened trail, and `reopenReason`. Timestamps exported, every name dropped |
| `time-entries` | the clock trail and the correction trail |
| `job-line-items` | **`costCategory`, `productionRate`**, `priceBasis`, `tradeScope` |
| `contacts` | `status`, `accountType`, MSA and prequal expiry |
| `payments` | `feeAmount`, `feeSource` — a payment net of a processor fee reconciles to the wrong number without them |
| `cost-entries` | `category`, `tradeScope` |

**Two of those are mine.** #512 made `costCategory` the thing the recap marks up
by and #514 added `productionRate`, and neither PR added its column to the job
line-item export — so the figures a bid is now built from were absent from the
file that is supposed to be the whole record.

The other 32 were deliberate and undeclared, which `EXPORT_COLUMN_OMISSIONS` now
ends: `companyId` (every file is already one company's rows) and the three
offline-sync bookkeeping columns, each with a reason.

**The census never requires a column to be exported — only that somebody has
DECIDED.** The allowlist is the security of this feature, so a test that pushed
columns into it would work against the thing it protects. Three buckets, exactly
one each: exported, `EXPORT_WITHHELD` (credentials, shown on the page), or
`EXPORT_COLUMN_OMISSIONS` (plumbing). It also refuses a credential-shaped name in
the omissions list, because withheld is *shown* to the customer and omitted is
not — filing a token as plumbing would hide it from the person it concerns.

`contacts` is the case that proves the distinction: `portalRevokedAt` is now
exported while `portalToken` stays withheld. Whether a portal link was revoked,
and when, is the customer's record. The link is a bearer credential.

### A guard that was waiting for exactly this

`crew-member-schema.test.ts` pinned the time-entry column list *without*
`crewMemberId` and said why — *"this pins that until the wiring commit adds it
deliberately"*. #525 is that commit, and it arrived from the opposite direction:
the census demanded a decision, this test demanded the decision be explicit. Both
got what they wanted. `_NoFullSsnColumn` is untouched.

### Checks

| | |
| --- | --- |
| suite | **8,024 pass** (493 files) |
| new tests | 45 (41 in the column census, 4 on the cost type) |
| mutations | 3 run, **3 caught** |
| typecheck / lint | 0 errors |
| migration | none |

| | Mutation | Result |
| --- | --- | --- |
| M1 | drop the columns #512/#514 forgot | 1 red, naming all four |
| M2 | the census's model regex matches nothing | **36 red**, including its own size and scope guards |
| M3 | restore the silent cost-type coercion | 1 red |

M2 is the one that matters: a dead parser fails loudly here instead of finding
no offenders and passing everything downstream.
