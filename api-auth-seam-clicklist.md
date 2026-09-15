# Click-list: the field-reports HTTP API (PR 1 auth seam)

Every step below is run against the **signed-in app** on the same origin
(a Vercel preview, or `localhost:3000`). The route reads your Clerk session
the same way the web pages do, so a signed-in browser is already
authenticated — no tokens to copy.

**Open the browser's DevTools → Console** and paste the snippet for each
step. Each step says the EXACT thing you must see. If anything differs,
that step failed and the PR is not ready.

---

### 1. No session → 401

Open a **private / incognito window** (so there is no Clerk session) at the
same origin, then in its Console:

```js
fetch('/api/v1/field-reports?jobId=anything').then(r => r.json().then(b => console.log(r.status, b)))
```

**Must print exactly:** `401 {error: 'Not authenticated'}`

A 401 means "not signed in". If you see a redirect to `/sign-in` or a
different status, that step failed.

---

### 2. Signed in, but no MANAGE_FIELD → 403

Sign in as a user whose job function does **not** include Field Reports
(ask the owner to check the Team page if unsure). In the Console:

```js
fetch('/api/v1/field-reports?jobId=<REAL_JOB_ID>').then(r => r.json().then(b => console.log(r.status, b)))
```

(Use a job id you can see in the app.)

**Must print:** `403` with this sentence, word for word:

> Field records aren't part of your job function. The account owner sets who sees what, on the Team page.

---

### 3. Duplicate date → 400 with the exact sentence

Signed in as someone **with** MANAGE_FIELD. Pick a job and a date that
**already has a report** (or file one first, then run this again). In the
Console:

```js
fetch('/api/v1/field-reports', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jobId: '<REAL_JOB_ID>',
    reportDate: '<DATE_THAT_ALREADY_HAS_A_REPORT>',
    workPerformed: 'duplicate test'
  })
}).then(r => r.json().then(b => console.log(r.status, b)))
```

(Use `YYYY-MM-DD`, e.g. `2026-09-14`.)

**Must print:** `400` with this sentence, word for word:

> A report already exists for that date — edit it instead of adding a second one

---

### 4. Successful create, then read it back

Signed in with MANAGE_FIELD. Pick a **fresh** date (one with no report yet)
on a job you can see. In the Console:

```js
fetch('/api/v1/field-reports', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jobId: '<REAL_JOB_ID>',
    reportDate: '<FRESH_DATE>',
    workPerformed: 'Click-list smoke test',
    crewPresent: '2',
    weather: 'dry',
    delays: ''
  })
}).then(r => r.json().then(b => console.log(r.status, b)))
```

**Must print:** `201 {ok: true}`

Then read the list back:

```js
fetch('/api/v1/field-reports?jobId=<REAL_JOB_ID>').then(r => r.json().then(b => console.log(JSON.stringify(b, null, 2))))
```

**Must show** the report you just created, with `reportDate` equal to
`<FRESH_DATE>` and `workPerformed` equal to `"Click-list smoke test"`.

---

**Clean up:** delete the smoke-test report through the web app (open the
job → Field Reports) so the demo/preview data stays tidy.
