-- WHERE THE GC'S OWN PAPER LIVES, for the two records that come BACK from them.
--
-- FULLY ADDITIVE — four nullable columns, nothing dropped, nothing altered, no
-- index and no constraint. The deployed build selects none of them, so the
-- expand-then-contract window this repo has an outage scar for (#378) does not
-- arise in either direction: an old build cannot miss a column it never reads,
-- and a new build reading NULL gets the behaviour that exists today.
--
-- WHAT WAS MISSING. `recordSubmittalResponse` records the outcome the stamp
-- said and the reviewer's notes, and had nowhere to point at the stamp itself.
-- `answerRfi` records the answer somebody typed, and had nowhere to point at
-- the letter it was typed from. Both are the documents an argument is had
-- over when a crew is told it built the wrong thing, and both lived only in
-- somebody's inbox.
--
-- A LINK RATHER THAN A COPY, which is the same call `DrawingRevision.fileUrl`
-- already made and the reason no blob plumbing arrives with this. A reviewed
-- shop drawing and a GC's RFI response live in the GC's system; storing our
-- own copy would buy a second source of truth for a document we do not own,
-- and a 200MB plan set duplicated per revision for no one's benefit.
--
-- NULL IS THE ORDINARY CASE and stays first-class. Recording an outcome or an
-- answer with no paper attached works exactly as it does now — these columns
-- add a place to say where something is, never an obligation to have it.

ALTER TABLE "SubmittalRevision" ADD COLUMN "responseUrl" TEXT;
ALTER TABLE "SubmittalRevision" ADD COLUMN "responseFileName" TEXT;
ALTER TABLE "Rfi" ADD COLUMN "answerUrl" TEXT;
ALTER TABLE "Rfi" ADD COLUMN "answerFileName" TEXT;
