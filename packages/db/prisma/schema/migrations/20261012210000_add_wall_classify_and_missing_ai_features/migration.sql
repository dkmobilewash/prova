-- AlterEnum
--
-- THREE VALUES, ADDITIVE, NO DROPS. One is a new feature; two have been live in
-- the app with no member behind them since they shipped.
--
-- `aiSettings.ts` builds `disabledFeatures` as `AI_FEATURE_KEYS.filter(...) as
-- AiFeature[]`, and that cast is what let the app's list grow past this type.
-- Unchecking "Reading schedules off a drawing" or "Drafting a proposal" on
-- Settings → Assistant therefore wrote a value Postgres does not have, and the
-- upsert failed — taking every other setting on the form with it. These two
-- lines are the fix, and `aiFeatureEnumParity.test.ts` is what stops the lists
-- diverging again.
--
-- SAFE ON A LIVE DATABASE: `ADD VALUE` only widens the type. Nothing reads or
-- writes a row here during the change, no existing value moves, and the
-- previous three `AiFeature` migrations did exactly this.
ALTER TYPE "AiFeature" ADD VALUE 'SCHEDULE_READ';
ALTER TYPE "AiFeature" ADD VALUE 'PROPOSAL_DRAFT';
ALTER TYPE "AiFeature" ADD VALUE 'WALL_CLASSIFY';
