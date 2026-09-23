### Three comments stopped saying crew time entry is unwired, and the job screen's back button says "Jobs" (Diego)
`diego/labor-comment-back-label`

Cyrus flagged `TimeEntry.crewMemberId` in `labor.prisma` still opening with
"NULL on every row today and read by nothing". #292 wired it: the phone writes
it through the time-entries API and the crew schedule and Ask read it. The
same stale claim sat in two more places, `time-entry-correction.ts` and the
header of `crew.prisma` — and `crew.prisma` also said the trigger protecting
the column "is gone", when #63 put it back. All three now say what the code
does, dated, so the correction is visible rather than silent.

On the phone, every screen pushed from the tabs showed a back button labelled
"(tabs)" — iOS labels it with the previous screen's title, and the tabs stack
screen had none. It is titled "Jobs" now; the title itself is never shown.
