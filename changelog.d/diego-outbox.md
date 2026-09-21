### What actually changed, in plain English (Diego)
`diego/outbox`

Gap 6: the queue could be blocked by one write, and there was no way to
see it, let alone do anything about it.

**The head-of-line bug, which was half-fixed and I want to be exact about
which half.** A 4xx the server will give again — a signed day, an archived
crew member — has been set aside in "needs attention" since #382, and the
drain carries on past it. What was still live is the write the server
answers with a **500**: that hit `break`, so it stayed at the head of the
queue and everything behind it waited. A day of time could sit behind a
photo the server would not take, with no attempt count, no backoff, no
way to see it and no way to remove it. That is OFF-32 exactly: never drop
time, and never let it be blocked behind something else.

Now each write carries its own state — attempts, the server's own words,
when to try next — and the drain SKIPS anything not due instead of
stopping. Backoff is 15s, 30s, 1m, 2m. After five server-side refusals a
write moves to "needs attention" with what the server said, rather than
retrying forever.

**A network failure is deliberately not an attempt.** Nothing reached the
server, so counting it would set aside perfectly good writes for the crime
of being carried around a jobsite. A phone that spends all day in a
basement arrives with everything still queued and nothing "failed".

**The outbox.** "Pending sync: 3" was the whole of it before: a number, on
whichever screen you were standing on, with no way to ask which three, how
old, or why one is not moving. `app/outbox.tsx` lists every held write by
what it IS — "8 hours · ZZQB-TEST · Fri 19 Sep" — with its status, a
countdown before anything is set aside, Remove, and Send now (which clears
the backoff, because somebody pressing it has just walked outside). It is
in Settings, and Home's "3 changes still to send" now goes there. Every op
type must have wording: the switch is exhaustive at compile time and
`outbox.test.ts` re-derives the list from the type union, so a new kind of
write cannot appear as a blank line. `RefusedBanner` used to have a second
copy of that switch with a `default` that rendered half the op types as
"A saved item"; it shares this one now.

**It retries by itself while the app is open** (`use-queue-drain.ts`, one
timer for the app, 20s). Before, the queue drained only on screen focus or
on returning from the background, so a phone sitting on the time screen
as the crew walked out of a basement held everything until somebody
navigated. A timer rather than NetInfo on purpose: a connectivity listener
is a native module, so it would need a new EAS build to reach the phone,
and it would buy seconds. It is a drop-in for the interval if that ever
matters.

**And the end-of-day reminder**, which is the part that is actually about
money. Eight hours logged in a basement, phone in a pocket, drive home,
nothing ever asks again. At 5pm (adjustable, or off) the phone itself says
"3 changes from this phone haven't been sent". LOCAL, not push, and that
is the design rather than a shortcut: the server cannot know what this
phone is holding — that is what unsent means — so a push would have to be
told, over the network that is missing. Scheduled only while something is
waiting and cancelled the moment the last write goes up, because a
reminder that fires on an empty queue is one people learn to ignore.
Permission is asked for when somebody picks a time, not silently at
sign-in, and Settings says so if it was refused. No new native module —
`expo-notifications` is already in the build for #294 — so this needs no
new EAS build.

**Two of the audit's four points were already fixed, and I would rather
say so than bill for them.** The flush has run on focus and on foreground
since #354; `apps/mobile` has had tests since #382 and now has 133 of
them, including the screen suite added in #401. The audit was written
before both.

Checks: 11 queue cases including one write 500ing while the one behind it
goes up, backoff, set-aside after five, and a basement not counting — each
mutation-tested by restoring `break`, which turns three of them red. 9
reminder cases; 6 outbox-wording cases, mutation-tested by deleting one op
type's wording. 4 rendered outbox cases. A census rule that anything
flushing the queue goes through `syncOnce`, with two reasoned exceptions
that lapse automatically if either file grows a cached list.
