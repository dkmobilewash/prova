### Five tabs, a job the phone remembers, and sections that switch in place (Diego)
`diego/phone-navigation`

Two tabs and a list of links is a menu, not an app. Diego's words: still
very bare bones. So the phone gets the shape an iOS app is expected to
have — Home, Jobs, Create, Camera, Settings — and the thing that makes
three of those possible at all.

**The phone remembers which job it is on.** Every screen used to take a
`jobId` from the route, so the moment you left a job the app had no idea
where you were. That is why Create and Camera could not be tabs: they had
nothing to act on. The current job is chosen by opening one, shown in the
header of every tab that uses it, switched by tapping that header, and
kept on the device so it survives the app being killed in a truck and
reopened on a roof. Five decisions later that is the hinge the whole
navigation hangs on.

**Home is today, not a launcher.** Is the report filed, how many hours are
logged and by how many people, what is open on the punch list and what is
waiting on a sign-off, how many photos today — and, first and loudest,
anything this phone is still holding unsent. The rule it follows is that a
home screen is only worth opening if it can be WRONG: "today's report
isn't filed" is a claim about the day, "Field reports ›" is a menu with a
nicer name. Every line is derived in `lib/today.ts` from lists the app
already fetches — no new endpoint — and asserted in `today.test.ts`.

**Camera is a doorway, not a second camera.** The tab hands straight to the
job's photo screen with `open=camera`, where the capture, the GPS fix, the
stamping and the upload queue already live. Two implementations of that
would be two implementations of the stamp.

**Inside a job, the four daily sections switch in place** — Report, Photos,
Punch, Time as a segmented strip that `replace`s rather than pushes, so
moving between them stops costing back-read-tap and Back still means
"leave the job". Only four, and only the daily ones: a seven-segment
control is a scrolling strip of small targets, which is worse than the menu
it replaced. Safety, Materials and T&M stay as rows on the job screen.

Smaller, and it had been wrong since the second tab existed: iOS labels the
Back button with the previous screen's title, so a photo screen opened from
Home offered "Jobs". It says "Back" now, which is true from all five tabs.
