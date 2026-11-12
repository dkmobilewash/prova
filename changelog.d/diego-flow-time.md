### A new job's proposal starts with the company's standard inclusions and exclusions (Diego)
`diego/flow-time`

The Baker flow, measured as a new customer (sign-up → upload → takeoff → review → estimate → a
signing link, no AI): **106 presses, 1.16 min of app time**. The five biggest steps by time were
reading the set and confirming scales (21.4 s, the app reading 65 sheets), sign-up (11.2 s, Clerk),
"Set markup" (10.1 s, 0 presses: the walk waiting out a banner that correctly never shows), Send
(8.3 s, 13 presses) and Run takeoff (5.7 s). By presses, the review queue (60) and Send (13).

The biggest one C-Stream could do itself, without changing a quantity or a price: on Send, the
new user typed an inclusion and an exclusion before the proposal could go (6 presses). Now the trade
pick puts the trade's usual inclusions and exclusions in the company's clause library (as it already
puts the trade's wall types), and a new job starts with the library's inclusions and exclusions on
its proposal, as the same snapshot copies the proposal page's add makes. **After: 100 presses**
(Send 13 → 7), the same scope by wall type, the same nine lines, the same $30,836.08.

A company that already keeps a clause library gets it pre-applied to new jobs; the library page has
always described those as the clauses "repeated on every bid". Each is edited or removed per job.

Checks: `lib/estimating/startingClauses.dbtest.ts` (red without the change: the job starts with no
clauses and Send asks); the walk now sets the GC's terms whether or not Send stopped for clauses, so
the two runs measure the same proposal.
