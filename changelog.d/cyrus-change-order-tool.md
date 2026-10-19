### The second free tool: a change order request a sub can hand the GC today (Cyrus)
`cyrus/change-order-tool`

Diego's plan (2026-10-17, section 3) puts the change order request (PCO) second, after the lien
waiver. It lives in the waiver's app at `/lien-waiver/change-order`: no account, phone first, one
screen at a time, and the PDF is emailed and never downloaded, like the waiver. The steps are your
company, project and GC, a number and date, the change, labor, material and equipment lines,
markup, schedule days and backup. Then you read it and get the PDF. The PDF carries everything plus
a blank GC signature block. Its shape copies the in-app `ChangeOrder` (an entered date, priced lines,
Draft -> Pending GC -> Executed), not its code. Nothing under `apps/web` or `packages/db` changed
except one browser spec.

Reuse, not a second copy. The waiver's frame (header, progress bar, Back/Next, focus, the send
screen) moved into `components/StepShell.tsx`, and both tools render in it. The send half of the
waiver's API (the per-address cap, the email that has to land, the lead note, the audience sign-up)
became `deliverPdf` in `lib/waiver-request.ts`, and both APIs call it. The waiver's 26 request tests
pass unchanged across that move.

Money is BigInt cents from the typed string to the printed total. Each line is quantity x price,
rounded half-up. The subtotal adds up the rounded lines, so the printed lines match the printed
subtotal. Markup is rounded once. The tests found one real bug: `formatMoney` refuses past twelve
digits, so a very large product printed as an empty string. `formatCents` now groups digits
itself. Changing the rounding to floor, or the decimal padding, makes the money tests fail.

Not statutory, so there is no attorney gate. Instead `content.test.ts` has a stricter guard,
scoped to an exact list of the tool's files, plus the text pdf.js reads back out of the PDF. It
blocks "guarantee", "entitled", "binding", "must pay", "owed", "claim" and the rest. A "must pay"
line added to the PDF fails both halves. An "entitled" sentence added on screen fails the source
check.

Backup files are listed by name on the PDF and say so ("sent separately; not part of this PDF").
They are not uploaded: a phone photo is 3-5 MB and the function's request body caps out near
4.5 MB.
