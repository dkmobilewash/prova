### Two fixes for the same red merged and left a duplicate `describe` prop (Diego)
`diego/fix-duplicate-describe`

#266 (`diego/fix-main-red-census`) and #267 (`cyrus/main-is-red`) both fixed
the same red on `main` — the three breaks #261/#262 introduced — and both
merged, one after the other. Because the two `describe` lines landed on
*different* lines of the same component, git saw no text conflict and merged
both, leaving a duplicate `describe` prop on `ConfirmDeleteButton`
(JobDetailsForm) and on `ConfirmDelete` (TimeEntryRow). Typecheck failed
`TS17001` on both the moment the second PR merged, so `main` was red again.

Fix removes #266's duplicate line and keeps #267's wording, which is the more
complete of the two — it says there is no history to lose, and on the
time-entry row it points at Edit as the correction path. Two lines deleted,
nothing else.
