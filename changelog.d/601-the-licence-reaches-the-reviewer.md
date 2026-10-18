### The reviewer could not see the licence collision they were about to create (Cyrus)
`cyrus/sales-signals`

`importSubListing` merges two records automatically only when an identifier matches
**and** the normalised name corroborates it — because a hand-typed licence can carry a
transposed digit, and one such digit would weld two firms together for good. That rule
is right and it is not changing.

What was wrong is what happened next. `leadCandidatesFor` — the thing that populates
*"Already a lead?"* on the review screen — matched on **names only**. So the pair the
import deliberately declined was also **invisible to the person whose job it is to
decide it**: a listed row whose licence collides with an existing lead under a different
spelling showed no candidate at all, and the reviewer created the duplicate by hand not
knowing the collision existed. Withholding it never prevented the bad merge; it hid the
evidence. CLAUDE.md's refusal trap, exactly: where a human already gates the outcome,
showing the doubtful thing and naming the doubt beats refusing to show it.

The licence now reaches the matcher. `/sales` already had it — `findMany` there has no
field `select`, so every scalar was in hand and the prop boundary was simply dropping it.

**And the opposite case was being offered, which is worse than the one that was hidden.**
An identical name over two *different* licences was returned as the strongest candidate
in the dropdown. The documents have already said those are two registrants, and no
amount of name agreement un-says it — `importSubListing` has held that since it was
written. Those now come back under `differentRegistrant` and the screen renders them as a
**note with both numbers**, never as something to click:

> Keystone Acoustical is already a lead with licence 650118; this row prints 884201.
> Different registrants, so it is not offered above — if one of the two is a typo, fix it
> on the lead first.

Dropping them silently was the other option and it is worse than either: a suppression
nobody can see is this module *deciding*, which its own title says it does not do, and
one of the two numbers may be a transposed digit somebody has to go and fix.

**One identity rule, not two.** `identifiersContradict` was private to
`lib/actions/sales.ts`; it now lives in the pure `leadMatch.ts` and both consumers read
it. Two copies of "are these the same registrant" in one app is the second-list failure
CLAUDE.md records, free to drift in whichever direction nothing tested.
`ImportedCompany` satisfies the parameter type structurally, so no call site changed.

**The screen's ternary had to go, and it is the reason the enum names evidence rather
than confidence.** It read `confidence === "SAME" ? " (same name)" : " (similar name)"`.
A two-value union invites that, and the moment a third value exists the else-branch
prints a sentence that is false — a licence match would have been labelled "(similar
name)" on a row whose name is nothing like the lead's. The four values each name the one
thing that matched, and the screen reads them from a `Record<MatchEvidence, string>` that
**fails to compile** when a value is added without a label. That record is typed against a
module that resolves, so it is one of the few things in that file a container can actually
check.

**A guard was REMOVED rather than added**, for the second time on this branch. The lead's
own stored licence was being re-canonicalised on read. Both writers already canonicalise
(`licenceNumberFrom` on import, `readTypedLicence` on the hand-typed form) and the
import's cross-import lookup is an exact equality on that column — so the re-canonicalise
could not change one outcome, which is the `spellingIsEnough` shape: a claim nobody can
check. Worse, it would have *hidden* a bad stored value from the one path that still
failed on it. A third writer canonicalises at the write.

**Seven mutations, seven killed — but only after one survivor was understood rather than
patched over.** Moving the empty-name guard back above the identifier checks left the
suite green, because the case written for it used `"Inc."` — and
`normaliseCompanyName("Inc.")` is `"inc"`, not `""`. The suffix strip requires the name to
END WITH `" inc"`, leading space and all, so a bare suffix survives as a word and the
guard was never reached. Measured rather than assumed: `""`, `"   "`, `"&"`, `"."` and
`"-"` normalise to nothing; `"Inc."`, `"LLC"` and `"Co."` do not. The case now uses the
three that do, and the mutation reds all three. CLAUDE.md's rule held — the question was
never "is my guard weak" but "what else already handles the input I chose".

The other six: the contradiction check never firing (reds 4), `||`→`&&` in the predicate
(reds 4), comparing the listed licence as printed so `C-9 884201` misses `884201` (reds
3), a name outranking a licence (reds 1), always blaming the registration when the licence
is what disagrees (reds 2), and testing registration before licence (reds 1 — the case
written for it, because no other case has two identifiers agreeing at once).

33 matcher tests, up from 13. 454 unit tests, 61 censuses including the client-boundary
one, 40 db tests, all green; every mutation run collected the full 454 first, because a
smaller green total is a load failure wearing a pass.

**The honest bound.** `components/SubListingImport.tsx` cannot be fully typechecked in an
agent container — `@/lib/actions` and `react` do not resolve, so its 144 `tsc` lines are
all `TS2307`/`TS7006`/`TS7026` cascade and a real error could hide among them. What IS
checked there is everything typed against `leadMatch.ts`, which resolves: the call shape,
every `matches.*` access, and the total label record. And the one thing neither could see
— that `SalesLead` really has both `licenceNumber` and `registrationNumber` — was read off
`packages/db/prisma/schema/sales.prisma` directly rather than inferred. CI's Typecheck and
Build are the instruments for the rest.

No schema change and no migration.
