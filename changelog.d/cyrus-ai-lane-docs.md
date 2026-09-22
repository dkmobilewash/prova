### AI is Cyrus's lane now, and the docs stop saying otherwise (Cyrus)
`cyrus/ai-lane-docs`

AUDIT, docs-only. `CLAUDE.md` and `WORK-SPLIT.md` both listed AI under Diego.
As of 2026-09-21 it is Cyrus's: the Ask assistant, the model integration
(`anthropic.ts`, `ask.ts`), AI extraction and AI usage metering. It was announced
in `#prova-build` the same night.

The cost of leaving it was concrete and immediate. Agents read these two files
and route work by them, so every AI task that night got described as "Diego's
lane", including to the founder who had just taken it over. A lane that exists
only in Slack is broken by whichever agent read the repo instead.

The boundary is spelled out where the two lanes meet: an AI feature sitting on
Diego's numbers (`draft_invoice`, the WIP narrative) keeps Diego's logic
underneath, with Cyrus's AI layer on top.
