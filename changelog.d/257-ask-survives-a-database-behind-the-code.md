### The assistant survives a database that is behind the code — #257 (Diego)
`claude/prova-ai-task-completion-96pjes`

Cyrus found this by clicking the new retainage command on a dev machine:
every Ask question failed with **"Something went wrong reading your
data."** The server log had the real cause — `The table
public.AskUsage does not exist in the current database` — and the real
cause was not retainage at all. `askUsage.count()` runs on EVERY ask for
the rate-limit check, so a missing table did not break one command, it
broke the assistant.

The machine's database was simply one migration behind, which is normal
and documented: a dev database gets nothing automatically. So the defect
was never the drift. It was that **usage accounting had become a
precondition of answering**, with no degradation and no diagnosis.

**The answer was already in the file, three functions down.**
`recordAskUsage` deliberately swallows its own write failure and logs,
because the accounting must not cost the person their answer. The READ
was never extended the same courtesy. `askAllowance` now fails OPEN: the
question goes to the model, and the failure is shouted into the log with
the command that fixes it (`pnpm --filter @prova/db run migrate:deploy`),
naming P2021 as a database behind the code and anything else as a read
that failed. Failing open is the lesser fault on an internal accounting
table when the alternative is the product not working — but it is a real
cost, not a free win, and while it is happening NOTHING bounds the model
calls. That is why the log line is an error rather than a warning, and
why it is also on screen.

**The half the issue did not mention, and the more dangerous one.**
`/settings/assistant` calls `usageSummary` unguarded, so the same drift
broke the exact page an owner opens to find out why the box is behaving
oddly. Returning zeros there would have been worse than the crash:
"0 questions sent to the model" is precisely what a quiet month looks
like, so a broken table would have been reported as reassuring news. The
summary now carries `readable`, and the page prints a red sentence naming
the missing table, saying the limits are **not being enforced**, and
giving the command — or the **Migrate demo database** workflow on a
preview.

**Proved by taking the table away, not by mocking it.** A fake Prisma
rejecting with a hand-made P2021 only proves the catch block runs; it
cannot prove a real Postgres in this state raises that error at all. The
database case renames `AskUsage` out of the way, asserts the question
still goes through and the summary reports unreadable, and renames it
back in a `finally` so a failure cannot strand the table. Run against
main's version of the module it fails with the issue's own error text,
which is what makes it a reproduction rather than a description.

Two mutations run by hand, both caught: failing closed instead of open,
and a guard wide enough to swallow the refusal itself — the shape that
would pass every degradation test while silently removing the rate limit.

Verified: 13 unit cases in `usage.test.ts`, 3 database cases against a
real Postgres 16 at 80 migrations, typecheck, lint, the full unit suite
and a production build. Nobody has clicked it; the click list is in the
PR.
