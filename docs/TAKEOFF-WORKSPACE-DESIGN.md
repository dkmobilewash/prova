# Takeoff & Estimating Workspace — design

Phase 0 of the standalone workspace. **No UI code; this document is the
deliverable.** Written 2026-10-16 against the schema and code on
`diego/takeoff-audit`, by reading the models rather than remembering them.

---

## The headline, before the detail

**Most of this product already exists in the database under different names.**
The brief describes assemblies, parts, quantity formulas, a price book, cost
codes, labour hours, and a two-way link between items and estimate lines. Eight
of those nine things are built, shipped and under test today. They are called
`WallType`, `WallTypeComponent`, `WallComponentBasis`, `LineItemCatalogEntry`
and `JobLineItem`, and the expander that keeps them in step is
`apps/web/lib/estimating/wall-schedule.ts`.

**Exactly one concept is genuinely missing: the takeoff ITEM** — the named,
coloured "condition" that owns measurements across sheets and points at an
assembly. Everything else in Phases 2 and 3 is a user interface over models
that are already there, plus a widening of one enum.

That changes what this project is. It is not "build an estimating engine"; it
is "build the workspace, and give the engine a front door". The risk is no
longer whether the maths works — it is whether we accidentally build a SECOND
engine beside the working one, which is the failure this repo has a named scar
for (`CostCategory` and the bid recap's rates: one canonical list, four
hand-rolled copies, and Ask reporting a bid $1,732.50 under the estimate).

---

## 1. Audit of the current models

Every field below was read out of `packages/db/prisma/schema/` on 2026-10-16.
Doc comments are stripped; nullability and types are as declared.

### 1.1 The capture layer — `takeoff.prisma`

`TakeoffPlan` — one uploaded PDF per revision.

| field | type | note |
| --- | --- | --- |
| `id` `companyId` `jobId` | String | |
| `fileUrl` `fileName` | String / String? | blob store |
| `revisionLabel` | String? | |
| `sheetIssuedOn` | DateTime? | ENTERED, not stamped |
| `uploadedByUserId` | String? | |
| `createdAt` | DateTime | |

**There is no `updatedAt`.** Already recorded as a known shortcut in
`lib/takeoff/AUDIT.md`; the multi-tab notice derives a signature from three
aggregates because of it. **This project should carry that migration** — see
§5.4.

`TakeoffPlanPage` — `planId`, `pageNumber`, `label?`, `pageWidthPt?`,
unique on `(planId, pageNumber)`.

`TakeoffScaleCalibration` — `pageId`, `x1 y1 x2 y2` (Float),
`declaredDistanceFeet` (Decimal 12,4), `note?`, `createdByUserId?`.
Measurements hang off a calibration, not just a page, so a re-scaled sheet
cannot silently restate old numbers.

`TakeoffMeasurement` — **the geometry we have today**:

| field | type | note |
| --- | --- | --- |
| `pageId` `calibrationId` | String | |
| `kind` | `LINEAR \| AREA \| COUNT` | the enum the brief wants to widen |
| `packageLabel` | String? | **the proto-item** — a loose grouping string |
| `xs` `ys` | Float[] | page-width-box coordinates, see the file header |
| `label` | String? | |
| `postedAt` | DateTime? | guards double-posting to the estimate |
| `wallRunId` | String? | the link to the priced side |
| `createdByUserId` `createdAt` | | |

`TakeoffWallProposal` — what detection produces: `thicknessInches` (Float),
`source` (`TAG \| REMAINDER \| GENERAL_NOTE`), `sourceLabel?`, `namedCode?`,
`runs` (Json), keyed to `(pageId, calibrationId)`.

**Nothing derived is stored anywhere in this file**, deliberately and at
length — feet and square feet are computed from coordinates plus a calibration
on every read. Any new model here inherits that rule.

### 1.2 The sheet-metadata layer — `plan-ingest.prisma`

`PlanSheetText` (`hasTextLayer`, `titleBlockText?`, `widthPt`, `heightPt`,
`rotation`), `PlanSheetScaleReading` (per-page read scale, with
`declineReason?`), `PlanSheetProposal` (`proposedSheetNumber`,
`proposedTitle`, `proposedDiscipline`, `proposedPageType`, `proposedScale`,
`proposedConfidence`, `status`, `acceptedSheetNumber`, `acceptedTitle`),
`PlanScheduleProposal` (`kind`, `rows` Json, `status`).

**`proposedDiscipline` already exists**, which is most of Phase 1's sheet tree:
the grouping the brief asks for (A/S/M/E/P/C) does not need deriving from sheet
numbers, it needs reading off a column that ingest already fills.

### 1.3 The pricing layer — `wall-types.prisma` ← **this is the assembly model**

`WallType` — *an assembly*:

| field | type | the brief's name for it |
| --- | --- | --- |
| `companyId` | String | **company-level library** ✅ |
| `code` `name` | String | assembly code + name |
| `defaultHeightFt` | Decimal(8,2)? | item property |
| `thicknessIn` | Decimal(6,2)? | item property |
| `sides` | Int @default(2) | item property |
| `studSpacingIn` | Decimal(6,2) @default(16) | item property |
| `sortOrder` `notes` | | |

`WallTypeComponent` — *a part, with its quantity formula*:

| field | type | the brief's name for it |
| --- | --- | --- |
| `description` `unit` | String / String? | part + unit ✅ |
| `basis` | `WallComponentBasis` | **the formula's driver** ✅ |
| `factor` | Decimal(12,4) @default(1) | **the formula's multiplier** ✅ |
| `wastePercent` | Decimal(5,2) @default(0) | **waste %** ✅ |
| `roundUp` | Boolean | |
| `costCategory` | `CostCategory?` | **cost code** ✅ |
| `catalogEntryId` | String? | **price book link** ✅ |
| `productionRate` | Decimal(10,4)? | **labour hours per unit** ✅ |
| `craftClassificationId` | String? | **which craft** ✅ |
| `sortOrder` | Int | |

`WallComponentBasis` = `LINEAR_FT | FACE_SQFT | BOARDED_SQFT | STUDS | PER_RUN`.

`WallRun` — a named, priced quantity: `jobId`, `wallTypeId`, `label`,
`lengthFt` (Decimal 10,2), `heightFt?`, `openings` (Json), `sortOrder`, and
`measurements TakeoffMeasurement[]`.

### 1.4 The estimate layer — `estimating.prisma`, `jobs.prisma`

`LineItemCatalogEntry` — **the price book**: `companyId`, `description`,
`unit?`, `tradeScope?`, `defaultUnitPrice`, `defaultBudgetedUnitCost`,
`defaultLaborHours`, `productionRate`, `costCategory`, `indirectKind`,
`craftClassificationId`.

`JobLineItem` — **the estimate line**: `description`, `quantity`, `unit?`,
`laborHours?`, `craftClassificationId?`, `costCategory?`, `indirectKind?`,
`productionRate?`, `phaseCodeId?`, `unitPrice?`, `budgetedUnitCost?`,
`currentEstimatedUnitCost?`, `isDeleted`, `priceBasis?`,
`sourceCatalogEntryId?`, and — decisively —

```
wallTypeComponentId String?
wallTypeComponent   WallTypeComponent? @relation(...)
```

**The estimate line already knows which assembly part produced it.** That one
column is the whole "one source of truth, derived not re-typed" requirement,
and it has been in production for weeks.

`EstimateTemplate` / `EstimateTemplateItem` — a second, flatter library
(description, unit, defaultQuantity, catalogEntry). Useful for non-measured
lines; not an assembly.

`EstimateVersion` holds a `snapshot Json` per version, with
`EstimateVersionCounter` — the existing answer to "don't let price changes
rewrite a submitted bid".

### 1.5 The expander — `lib/estimating/wall-schedule.ts`

Its header states three rules, and they are exactly the two-way flow the brief
asks for:

1. **Update in place** — a generated line is found by `wallTypeComponentId`;
   only QUANTITY and LABOUR HOURS move. The id survives, so cost entries and
   change-order history keep pointing at it, **and a price the estimator typed
   over the catalog's is not overwritten** — "pricing is theirs and measuring
   is this function's".
2. **Create from the catalog** — a new line takes price, cost, craft and trade
   from the part's catalog entry, marked `priceBasis: COMPANY_CATALOG`.
3. **Soft-delete what is gone** — `isDeleted`, so history keeps it and totals
   drop it.

Every write to a run calls this **inside the same transaction**, so the two
cannot be observed disagreeing.

### 1.6 Audit summary

| the brief asks for | exists today | gap |
| --- | --- | --- |
| TakeoffItem / condition | `packageLabel` string; `WallRun` | **the one real gap** |
| geometry per sheet | `TakeoffMeasurement` | + `source`, `confidence`, cutouts |
| assembly of parts | `WallType` + `WallTypeComponent` | names are wall-shaped |
| quantity formula | `basis × factor × (1+waste)`, `roundUp` | 5 bases, all wall-ish |
| price book | `LineItemCatalogEntry` | no project-level snapshot |
| cost codes | `costCategory`, `phaseCodeId`, `indirectKind` | — |
| labour hours | `productionRate` + `craftClassificationId` | — |
| item → estimate lines | `wall-schedule.ts`, 3 rules, transactional | only from `WallRun` |
| detection → items | `TakeoffWallProposal` | posts direct; no item match |
| sheet discipline tree | `proposedDiscipline` | — |

---

## 2. The proposed data model

### 2.1 `TakeoffItem` — the one new model

```prisma
enum TakeoffItemType {
  LINEAR
  AREA
  COUNT
  SEGMENT
  AREA_WITH_PERIMETER
}

enum TakeoffLineStyle {
  SOLID
  DASHED
  DOTTED
}

model TakeoffItem {
  id        String  @id @default(cuid())
  companyId String
  company   Company @relation(fields: [companyId], references: [id])
  jobId     String
  job       Job     @relation(fields: [jobId], references: [id])

  name      String
  type      TakeoffItemType
  colorHex  String            // "#RRGGBB", validated; see §2.6
  lineStyle TakeoffLineStyle @default(SOLID)

  // PROPERTIES — nullable because which ones apply depends on `type`.
  // They mirror WallType's defaults so an item can override its assembly
  // per job without editing the company library.
  heightFt     Decimal? @db.Decimal(8, 2)
  sides        Int?
  thicknessIn  Decimal? @db.Decimal(6, 2)
  wastePercent Decimal? @db.Decimal(5, 2)
  spacingIn    Decimal? @db.Decimal(6, 2)
  depthIn      Decimal? @db.Decimal(6, 2)

  // The assembly. Nullable: an item may be measured before it is priced,
  // which is how every estimator actually works.
  wallTypeId String?
  wallType   WallType? @relation(fields: [wallTypeId], references: [id], onDelete: SetNull)

  sortOrder Int @default(0)

  measurements TakeoffMeasurement[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([jobId, sortOrder])
  @@index([companyId])
  @@index([wallTypeId])
}
```

**Three decisions worth arguing with:**

- **No `isVisible` column.** The brief lists a visible toggle, and it belongs
  in `localStorage`, not the database: it is a per-viewer convenience, it must
  not travel to another user, and CLAUDE.md's storage rule says exactly that.
  A stored one would also be the fourth kind of state two tabs can disagree
  about.
- **No stored totals.** `totalQuantity` is derived from the measurements and a
  calibration on every read, like every other number in `takeoff.prisma`. A
  stored total is a number that was true against a scale somebody has since
  corrected.
- **`companyId` as well as `jobId`**, matching `WallRun`, so scratch-scoping
  and company filters work the same way they already do.

### 2.2 `TakeoffMeasurement` — three added columns

```prisma
enum TakeoffMeasurementSource {
  MANUAL
  DETECTED
  IMPORTED
}

// added to the existing model:
itemId String?
item   TakeoffItem? @relation(fields: [itemId], references: [id], onDelete: SetNull)

source     TakeoffMeasurementSource @default(MANUAL)
confidence Float?                   // null unless DETECTED
cutouts    Json @default("[]")      // [{xs:[…], ys:[…]}] — AREA only
```

`onDelete: SetNull` deliberately: deleting an item must not destroy traced
geometry. The measurement falls back into "Unassigned".

`kind` stays as it is and `type` lives on the item. A `SEGMENT` or
`AREA_WITH_PERIMETER` item stores `LINEAR`/`AREA` geometry; the item's type
says how to read it. Widening the geometry enum would invalidate the existing
`kind`-based maths for no gain.

### 2.3 Assemblies — widen, do not duplicate

**Recommendation: keep `WallType`/`WallTypeComponent` as the assembly tables
and add bases to the enum.** Do not create `Assembly`/`AssemblyPart` beside
them.

New bases needed for non-wall trades:

| basis | reads | for |
| --- | --- | --- |
| `AREA_SQFT` | the item's measured area | ceilings, flooring, paint |
| `PERIMETER_FT` | an area's perimeter | wall angle, base, edge trim |
| `COUNT_EACH` | the item's count | fixtures, doors, openings |
| `VOLUME_CY` | area × depth ÷ 27 | slabs, footings |

Each is a named, tested function of the item's geometry, exactly as the five
existing ones are.

**On the naming.** `WallType` in the database and "Assembly" in the UI is the
two-names-for-one-thing problem this repo has scars about. Prisma can rename
the MODEL while keeping the TABLE — `model Assembly { … @@map("WallType") }` —
so this costs **no data migration**, only a mechanical rename of
`prisma.wallType` → `prisma.assembly` across the codebase. **Recommended, but
not in Phase 1 or 2** — neither phase touches assemblies, and a wide
mechanical diff landing underneath new UI work is how a merge conflict eats an
afternoon. Do it as the first commit of Phase 3.

### 2.4 Library and the "don't rewrite a submitted bid" rule

The brief asks for company assemblies copied into a project on use. **That
protection already exists at a different layer and is stronger**: a
`JobLineItem`'s price is written ONCE from the catalog at creation and never
updated afterwards (rule 1 of the expander — only quantity and labour hours
move). `EstimateVersion.snapshot` then freezes the whole estimate per version.

So a later catalog price change cannot alter an existing line, and a submitted
bid is a snapshot. **A project-level copy of the assembly would add a third
place for a price to live** and a new way for the three to disagree.

What is genuinely missing is narrower: a part ADDED to a company assembly
after a job used it will appear on that job's estimate the next time the
expander runs. That is one question — "apply library changes to this job?" —
and it should be answered by a flag on the job, not by duplicating the
library. **Proposed:** `Job.assemblyLibraryPinnedAt DateTime?`; when set, the
expander ignores parts created after it. One nullable column, no copy.

### 2.5 Item → assembly → parts → estimate lines

Unchanged from what ships today, with one widening:

```
TakeoffItem ──< TakeoffMeasurement        (geometry, per sheet)
     │
     └─ wallType ──< WallTypeComponent     (parts + formulas)
                            │
                            └─ JobLineItem.wallTypeComponentId   (the estimate)
```

`loadWallSchedule` currently reads `WallRun`. It gains a second source: items
with an assembly, their quantities computed from measurements. The three rules
and the transaction boundary do not change.

**Both directions already work**: quantities flow down (re-measure → the line's
quantity moves), prices flow nowhere (an estimator's typed price survives), and
removal is a soft delete.

`WallRun` stays. It is the manual, typed path for somebody with dimensions and
no drawing, and the brief's "never re-typed" applies to measured quantities,
not to the typed-entry feature.

### 2.6 Colour

`colorHex` is a raw hex string, not a design token, and this is a deliberate
exception to the `DESIGN.md` rule: the colours mark USER DATA on a drawing,
the user picks them, and they must stay stable against a PDF that is not our
palette. The palette OFFERED is tokens; what is stored is what they chose.
Validated `^#[0-9a-fA-F]{6}$` on write. Contrast against white paper is
checked when offering, not enforced on storage — an estimator may legitimately
want a faint colour.

---

## 3. How auto-detection plugs in

Today `TakeoffWallProposal` groups runs by thickness and the UI offers "Add
these", which posts straight to the estimate.

**Proposed:** detection proposes INTO items.

```prisma
// added to TakeoffWallProposal:
itemId String?
item   TakeoffItem? @relation(fields: [itemId], references: [id], onDelete: SetNull)
```

Matching, in order, first hit wins:

1. **`namedCode` equals an item's assembly `code`** — the drawing's own wall
   tag, the strongest signal we have.
2. **`namedCode` equals an item's `name`** (case-insensitive, trimmed).
3. **`thicknessInches` within 1/8" of an item's `thicknessIn`** — a direct
   comparison, so tighter than the half-inch band `duplicateCoverage.ts`
   uses for its schedule-coverage test.

**Unmatched groups are `itemId IS NULL`** and render as "Unassigned walls" —
not a special model, not a magic item, just the absence of a link. The user
assigns them to an item or creates an item from the group in one click, which
pre-fills `thicknessIn` and `name` from the proposal.

**Detection confidence travels.** A measurement created from a proposal gets
`source: DETECTED` and the proposal's confidence, so the workspace can flag
"review these" without re-deriving anything. This is what makes the brief's
"next review flag" keyboard shortcut implementable.

**No detection logic changes in this project**, per the brief. The wall finder
keeps emitting the same proposals; only their destination changes.

---

## 4. The formula language

**Recommendation: do not build one.**

The brief asks for a simple, safe, validated, non-eval formula language and
gives two examples:

- `studs = LF × 0.75 + corners` → the `STUDS` basis, which computes from the
  item's spacing via `studsRequired()` and is already tested.
- `drywall SF = LF × height × sides × (1 + waste)` → the `BOARDED_SQFT` basis,
  which is `boardedArea()` with sides and opening deductions, times
  `(1 + wastePercent/100)`.

**Both examples are already expressible.** `basis × factor × (1+waste)` with
`roundUp` is a formula language: it has a typed variable set, no parser, no
evaluator, no injection surface, and errors that are impossible rather than
validated — an enum cannot be misspelt.

A string formula would mean inventing a lexer, a parser, a validator, an error
reporter, a security review, and a UI for all of it, to express what four more
enum values express. It would also break the thing that makes the current
model safe: **every basis is a function we have tested against real geometry**,
so a part cannot ask for a quantity nobody has defined.

**When this recommendation expires.** The enum stops being enough when a part
needs to multiply two drivers the enum does not already pair — say
`perimeter × height × 2`. Three options then, cheapest first:

1. add the pairing as a basis (what `BOARDED_SQFT` is);
2. allow a SECOND factor field keyed to a property (`factorProperty:
   HEIGHT_FT`), which covers most of the remaining cases with one column;
3. only then a parser — shunting-yard over a whitelisted variable set, no
   identifiers but the known quantities, no function calls, no property
   access, validated at save time with the offending token named.

Do not start at 3.

---

## 5. Migration plan

### 5.1 Existing measurements

`TakeoffMeasurement` rows today have `packageLabel` and no item. Backfill, per
job, in the migration:

1. For each distinct `(jobId, kind, packageLabel)` on UNPOSTED measurements,
   create a `TakeoffItem` with `type` from `kind`, `name` from `packageLabel`
   or `"Linear takeoff"` / `"Area takeoff"` / `"Count"`, and a colour from a
   fixed 12-colour rotation keyed by `sortOrder` (deterministic, so a re-run
   is idempotent).
2. Set `itemId` on those measurements.
3. `source: MANUAL` for all of them — true by construction, since detection
   has never written a measurement.

**Posted measurements (`postedAt IS NOT NULL`) are left alone.** They already
became `WallRun`s and priced `JobLineItem`s; giving them an item retroactively
would make the expander see the same quantity twice. They keep `itemId NULL`
and read as historical.

`packageLabel` is NOT dropped in this migration. Expand, then contract — the
running build still reads it, and a drop plus the deploy that stops reading it
do not land together. It goes in a later three-line PR, per the scar in
CLAUDE.md.

### 5.2 Assemblies

No data migration. New enum values are additive. The `@@map` rename, if taken,
moves no rows.

### 5.3 The cleanup scripts — **do not skip this**

`TakeoffItem` is a child of `Job` keyed on `jobId`, which is exactly the shape
that broke both cleanup scripts when `InvoiceCounter` shipped. Adding it is
**three edits, not one**:

1. the model;
2. `HANDLED_MODELS` in `packages/db/scripts/scratch-scope.mjs`;
3. the `del(...)` order in BOTH `clean-scratch-data.mjs` and `seed-demo.mjs`.

`scratch-cleanup-order.test.ts` derives blocking foreign keys from the
migration SQL and asserts the parsed count against an independent count of
`FOREIGN KEY` — so a hand-written migration that wraps a line will fail loudly
rather than shrink the set. Write the migration, then run that test.

### 5.4 `TakeoffPlan.updatedAt`

Add it. `AUDIT.md` records the three-aggregate signature as a known shortcut
and says the proper fix is this column, "worth doing with the next takeoff
migration rather than on its own". **This is that migration.** The multi-tab
notice then becomes one indexed read, and the brief's "refetch on focus"
requirement gets a cheap answer.

### 5.5 Announcing it

Every migration here touches the shared schema, so per the working agreement it
is announced in `#prova-build` BEFORE the push, not on merge.

---

## 6. What this does not decide

Listed so the next phase does not read silence as agreement:

- **Panel layout mechanics** (resize handles, persistence keys) — Phase 1.
- **Undo/redo**: the brief wants it for every takeoff action. The model above
  makes it possible (measurements are rows, not a blob) but the mechanism —
  a client-side command stack versus a server-side journal — is a Phase 1
  decision with real cost either way.
- **Whether `WallRun` is eventually absorbed into `TakeoffItem`.** They
  overlap. Today they do not conflict, because one is typed and one is traced.
  Revisit after Phase 3, with evidence.
- **Seed assembly library content** — Phase 3, and it needs a tradesperson's
  eye rather than a schema decision.

---

## 7. Performance note carried forward

`AUDIT.md` records, measured, that `Find the walls` takes **102 seconds** on a
real Camp Bow Wow sheet and 15 s on an Eleven03 sheet, while rendering and
panning stay under a quarter-second. Detection is not changing in this project,
but the workspace is where that minute and a half will be VISIBLE — the brief's
"detected walls are proposed into items" happens after it.

Whatever Phase 2 does, it must not block the canvas on detection, and the
progress it shows should be honest about the scale of the wait.
