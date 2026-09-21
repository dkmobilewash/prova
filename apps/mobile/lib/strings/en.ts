/**
 * Every sentence the field screens say, in English, and the source the
 * Spanish is checked against key for key.
 *
 * Keys are `screen.thing`, and the value is the sentence rather than a
 * word where the sentence is what matters — "Nothing outstanding on this
 * job." carries a claim, and a key called `punch.empty` translated as a
 * noun phrase would lose it. `{placeholders}` are filled at the call.
 *
 * SCOPED TO THE FIELD SCREENS on purpose. The office half of the app is
 * read by the person who bought it; these are the screens a hanger or a
 * taper is handed.
 */
export const EN = {
  // Shared across the field screens
  "common.pendingSync": "Pending sync: {count}",
  "common.syncing": "Syncing…",
  "common.tryAgain": "Try again",
  "common.dismiss": "Dismiss",
  "common.optional": "Optional",
  "common.notSaved.one": "1 change wasn't saved",
  "common.notSaved.many": "{count} changes weren't saved",
  "common.date": "Date",
  "common.note": "Note",
  "common.required": "Required.",

  // Punch list
  "punch.status.open": "Open",
  "punch.status.ready": "Ready for review",
  "punch.status.verified": "Verified",
  "punch.markReady": "Mark as ready for review",
  "punch.markOpen": "Mark as still open",
  "punch.verifiedOnWeb": "Verified items are reopened on the web, with a reason.",
  "punch.noPhoto": "No photo of the fix — add one",
  "punch.empty.title": "Nothing outstanding on this job.",
  "punch.empty.body": "Tap “Add item” to log what still needs fixing.",
  "punch.add": "Add item",
  "punch.sheet.title": "Add punch list item",
  "punch.sheet.save": "Save item",
  "punch.field.what": "What needs fixing",
  "punch.field.whatHint": "e.g. Ceiling grid out of level",
  "punch.field.where": "Where (optional)",
  "punch.field.whereHint": "e.g. Level 3 corridor",
  "punch.due": "due {date}",

  // The outbox
  "outbox.waiting": "Waiting to send",
  "outbox.needsAttention": "Needs attention",
  "outbox.needsAttention.body": "The server read these and said no. They will not go up on their own.",
  "outbox.serverSaid": "The server said: “{error}”",
  "outbox.putBack": "Put them back on",
  "outbox.letGo": "Let them go",
  "outbox.sendNow": "Send now",
  "outbox.sending": "Sending…",
  "outbox.remove": "Remove",
  "outbox.empty.title": "Everything on this phone has reached the office.",
  "outbox.empty.body":
    "Anything you save with no signal waits here until it can go up, and this screen tells you which.",
  "outbox.stillOffline": "Still no connection. Everything here is kept until there is.",
  "outbox.signInAgain": "Sign-in expired — open any screen to sign in again, then send.",
  "outbox.waitingForSignal": "Waiting for signal",
  "outbox.tried.one": "Tried once — the server said “{error}”. Trying again {when}.",
  "outbox.tried.many": "Tried {count} times — the server said “{error}”. Trying again {when}.",
  "outbox.when.seconds": "in {seconds}s",
  "outbox.when.next": "next time there's signal",
  "outbox.triesLeft.one": "One more try, then it moves to Needs attention.",
  "outbox.triesLeft.many": "{count} more tries, then it moves to Needs attention.",

  // Time
  "time.log": "Log time",
  "time.sheet.title": "Log time",
  "time.sheet.save": "Save",
  "time.signDay": "Sign the day",
  "time.sign.title": "Sign the day",
  "time.sign.primary": "Sign and lock",
  "time.field.hoursAll": "Hours for everyone",
  "time.field.hoursDifferent": "Hours (if different)",
  "time.field.hoursHint": "e.g. 8 or 8.5",
  "time.field.noteHint": "Optional — goes on every entry",
  "time.field.yourName": "Your name",
  "time.field.yourNameHint": "Printed under the signature",
  "time.who": "Who",
  "time.me": "Me",
  "time.craft": "Craft",
  "time.costCode": "Cost code",
  "time.noLine": "No specific line",
  "time.payType": "Pay type",
  "time.signature": "Signature",
  "time.clockIn": "Clock in",
  "time.clockOut": "Clock out",
  "time.notOnClock": "Not on the clock",
  "time.checkingClock": "Checking the clock…",
  "time.ratioWarning": "Apprentice ratio — over today",
  "time.empty.title": "No time logged",
  "time.empty.body": "Tap “Log time” to record the day's hours.",

  // Photos
  "photos.take": "Take photo",
  "photos.pick": "Choose from library",
  "photos.sheet.title": "Save photo",
  "photos.sheet.save": "Save photo",
  "photos.caption": "Caption",
  "photos.tags": "Tags",
  "photos.attachTo": "Attach to",
  "photos.onReport": "On the day's report",
  "photos.onPunchItem": "On a punch list item",
  "photos.stamped": "The time and place are burned into the photo when you save it.",
  "photos.empty.title": "No photos yet",
  "photos.empty.body":
    "Tap “Take photo”. Each one is stamped with the time and place it was taken, and goes up when there's signal.",

  // Safety
  "safety.talks": "Toolbox talks",
  "safety.incidents": "Incidents",
  "safety.addTalk": "Add talk",
  "safety.addIncident": "Add incident",
  "safety.talk.title": "Add toolbox talk",
  "safety.talk.save": "Save talk",
  "safety.incident.title": "Add incident",
  "safety.incident.save": "Save incident",
  "safety.field.topic": "Topic",
  "safety.field.topicHint": "e.g. Fall protection",
  "safety.field.employee": "Employee name",
  "safety.field.description": "Description",
  "safety.field.descriptionHint": "What happened",
  "safety.classification": "Classification",
  "safety.outcome": "Outcome",
  "safety.noTalks": "No talks logged",
  "safety.noIncidents": "No incidents",

  // The offline note, said on every field screen
  "offline.stale": "Showing what this phone last loaded, {age} — no connection",
  "offline.nothing":
    "Can't load this right now, and this phone hasn't loaded it before. Anything you add is kept and sent when you're back in range.",
  "offline.cantLoad": "Can't load {thing} right now.",
  "offline.cantLoad.body":
    "No connection, and this phone hasn't loaded this before. Anything you add is kept and sent when you're back in range.",

  // The empty states on the list screens that are NOT otherwise in the
  // field set (drawings, materials, reports, T&M, the schedule, the jobs
  // list). They share `emptyFor` and the offline note with the field
  // screens, so they share the language too — the alternative is a
  // Spanish note above an English empty state on the same screen.
  "materials.empty.title": "Nothing on order",
  "materials.empty.body": "Tap “Add order” to log a material delivery.",
  "reports.empty.title": "No reports yet",
  "reports.empty.body":
    "Tap “New report” to file the day's work. The crew and the weather fill in on their own.",
  "tickets.empty.title": "No T&M tickets",
  "tickets.empty.body": "Tap “New ticket” to document and sign the day's extra work.",
  "drawings.empty.title": "No drawing sets on this job.",
  "drawings.empty.body": "Sets and revisions are recorded on the web, off the transmittal.",
  "schedule.empty.title": "Nobody is scheduled on this job.",
  "schedule.empty.body": "Days are planned on the web, under Deployment.",
  "jobs.empty.title": "No jobs yet",
  "jobs.empty.body": "Jobs appear here once they're created in the office.",

  // How old a cached list is, said in words. Part of the same sentence
  // as offline.stale, so it has to speak the same language as the rest of
  // it — a Spanish note ending "2 hours ago" is the half-translated
  // screen this feature is scoped to avoid.
  "age.justNow": "just now",
  "age.minutes": "{count} min ago",
  "age.hour": "an hour ago",
  "age.hours": "{count} hours ago",
  "age.yesterday": "yesterday",
  "age.days": "{count} days ago",
  "age.earlier": "earlier",

  // What each list is called INSIDE the "can't load …" sentence, which is
  // why they carry their article: "Can't load the punch list right now."
  "thing.punchList": "the punch list",
  "thing.time": "the hours",
  "thing.photos": "the photos",
  "thing.safety.talks": "the safety talks",
  "thing.safety.incidents": "the incidents",
  "thing.materials": "the material orders",
  "thing.reports": "the field reports",
  "thing.tickets": "the T&M tickets",
  "thing.drawings": "the drawings",
  "thing.schedule": "the schedule",
  "thing.jobs": "the job list",

  // Language, in Settings
  "settings.language": "Language",
  "settings.language.auto": "Follow the phone",
  "settings.language.en": "English",
  "settings.language.es": "Español",
  "settings.language.note":
    "Changes this phone only. The office keeps everything in English either way.",
} as const;
