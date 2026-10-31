### The submittal register can start from the spec (Diego)
`diego/submittal-reader`

Nothing turned a spec book into a register, and the cost reader deliberately
skips the submittals article. **Read what must be submitted**, on a job's spec
section, is a separate reader with its own prompt, version, feature switch and
eval. The cost reader is untouched.

It writes draft rows, each with its kind, quote and page, shown on `/submittals`
when filtered to the job. A person ticks the ones they want and adds them to the
register, one submittal per requirement, or merged when they tick merge within
one section. A number is issued only then, so a dismissed draft leaves no gap.
A re-read replaces undecided drafts and does not ask again about a decided one.

Like the cost reader it records model, prompt version and pages charged, draws on
the same spec page allowance, and marks a failed read rather than refunding it.
Reading needs estimating access because it spends money; accepting needs job
access, so a PM can do it. The register only knows the sections uploaded, and the
screen says so.
