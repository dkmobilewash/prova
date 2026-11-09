### "New job" on Home and in the top bar, landing on the job's plan upload

A renovation walk found no clear way to start a job from Home. A brand-new company saw only the checklist; a busy one saw a "+ New job" chip on desktop only; the top bar had none.

**Changes:**
- **Home:** one primary **"+ New job — upload plans"** button at every width and for every company, beside the checklist on a brand-new one.
- **Top bar:** **"+ New job"** beside search on every page, a "+" on a phone.
- **Landing:** both open the wizard with `then=plans`. Creating the job lands on its Takeoff tab: the stepper at Plans, the uploader on screen. That applies only for someone the Takeoff tab lets in; anyone else still gets the scope-items step (`lib/new-job-entry.ts`, `createJob`).

`new-account.test.ts` changed on purpose: a brand-new company's Home is the checklist **and** the New job button, and still no search box or empty-state panel.
