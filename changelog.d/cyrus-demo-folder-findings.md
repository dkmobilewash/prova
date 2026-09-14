### An 85-file demo folder, and the three things it found (Cyrus)
`cyrus/integration`

Built the folder the demo actually needs — 85 files in six subfolders, real
GC paperwork names across all ten document kinds — and ran the real
classifier over it before filming rather than after. Three findings, none
of which reading the code would have produced.

**1. Every job hint read as a MISSING job.** `intakeTraySummary` matched a
filename's job hint against job names by exact equality. Real job names are
long ("Riverside Medical Office Building"); the hint a classifier reads out
of a filename is the leading run of capitalised words, which is short
("Riverside"), because that is what an office types. So the tray announced
*"3 files name Riverside, which is not a job here"* while that job sat in
the picker on the same screen.

Now: a hint matches when a job's name begins with it **at a word boundary**.
Prefix and nothing looser — not a substring ("Park" would match "Cedar Park
Elementary" and equally "Parkway Tower", and a suggestion that cannot tell
two jobs apart is worse than none), not a fuzzy distance. "River" still does
not match "Riverside", and a genuinely absent job is still named.

It remains safe to be this permissive because this function decides only
whether to SUGGEST that somebody look — it never chooses a job for a
document. The same latitude would not be safe in `learn.ts`, where a wrong
match writes a jobId onto an evidence record.

**2. A master service agreement and a prequalification came back "we could
not tell what this is"** — on a screen whose whole claim is that it files a
GC's paperwork, and for two records this app ALREADY keeps as compliance
documents, with expiry dates, on the dashboard's own Compliance card. Added
to the compliance detector.

`MSA` deliberately not added: three letters that are also a supplier, a
product and half a dozen other things. That is the same reasoning the
detector already applies to "bond" and "license", which are material terms
in this trade — and there is a test asserting the bare abbreviation still
comes back UNKNOWN.

**3. The rest of the UNKNOWNs are correct and should stay.** Closeout
packages, warranty letters, punch list signoffs, takeoff notes, daily
reports, backcharge responses: all real documents, none of them one of the
ten `IntakeKind` values. The classifier refusing to place them is the
feature working. 22 of 85 need a person, and on a demo that is the story
worth telling — the 22 that need you are at the top, the 63 that do not are
one click.

The folder deliberately puts `COI.pdf` and `W-9.pdf` in four different
subfolders, which is the repeated-filename case the React key fix in the
commit before this one exists for, and which a real GC transmittal folder
produces every time.
