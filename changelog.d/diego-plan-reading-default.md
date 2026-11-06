### AI plan reading is on for new companies, with its cost and an off switch

Diego, 2026-11-06. A company created from now on starts with **"Wall types from the drawings"** (`PLAN_TEXT_READ`) switched on. That means its plan sets' wall legend gets read, and the review queue suggests each wall's type and height from the first set. Companies that already exist are unchanged.

- **Where the default lives.** It's set in code when the company is created: `requireCompanyContext` creates the company together with a `CompanyAiSettings` row that has `PLAN_TEXT_READ` in `optedInFeatures`. It is **not a column default and there is no migration**. A default on the column would opt an existing company in the first time anybody saved its AI settings, because saving creates the row. `PLAN_TEXT_READ` stays in `OPT_IN_FEATURES`, which is what keeps every older company off.
- **Shown with what it costs.** The sentence is "Reads your plans' title blocks and wall legends with AI; about $0.50 per plan set." It appears in three places:
  - on `/welcome`, with an on/off switch (the same `setWallTypesFromDrawings` action Settings uses);
  - in Settings' takeoff list;
  - in Settings → Assistant's description, where the tag now reads "on for new companies".
- **The figure is measured.** It comes from Baker EOC (65 sheets) at the repo's own rates:
  - title blocks: Haiku 4.5, 65 calls, $0.26;
  - wall legend: Opus 5, 4 calls, $0.19.
  That's $0.46 in total. Title blocks scale with the number of sheets, so a 300-sheet set comes nearer $1.40. The working is beside `PLAN_READING_SENTENCE` in `lib/ai/features.ts`.

Proof: a db test signs a brand-new person in through the real `requireCompanyContext` and checks that the gate passes. An existing company stays off, including after an AI settings row is created later. Removing the opt-in from `auth.ts` makes the first test fail. A render test covers the welcome switch, and the new-customer walk now checks the switch is on, with the cost sentence, at signup.
