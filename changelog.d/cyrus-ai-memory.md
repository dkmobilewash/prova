### The assistant remembers a conversation after the tab closes (Cyrus)
`cyrus/ai-memory`

Until now a conversation with Ask lived in sessionStorage and died with the
tab, so a question asked on Monday could not be picked up on Wednesday. Every
question now lands in a stored thread (`AskThread` + `AskMessage`): the
person's words and the assistant's final text, with the pages it read and the
card it put up — never a tool result, so memory still carries the
conversation and never the facts. `/ask` shows a Recent list beside the
panel, `/ask?thread=<id>` reopens one, and a thread can be renamed or
deleted from its header.

A thread is one person's. Every read and write names the session's company
AND person, and someone else's thread id reads exactly like a missing one —
the route starts a new thread rather than confirming it exists. When a
thread exists the server rebuilds the model's context from it (bounded by
the same `boundTurns`), and the browser's priorTurns are ignored.

A reopened thread's answers are all marked with their age, including the
newest: with no live answer on screen, every figure was read at another
moment. The check: `lib/ask/threads.test.ts`, whose cross-user test goes red
when `userId` is dropped from `loadThread`'s where clause.
