### The app is organised around the job, not the department (Cyrus)
`cyrus/ui-navigation`

Contractors said the app was too hard to use. The main reason is that the rail was 34 entries filed by department, while contractors think about one job at a time. The jobs list was filed under "Pre-construction", and that heading means work you have not won yet. This change fixes the structure and leaves the look alone:

- **The rail keeps its place on a job page.** A `/jobs/*` URL matched no nav item, so every group collapsed and nothing was highlighted on the page where most of the work happens. `activeItemHref` now treats `/jobs` as the jobs list. The job header also has a "← Jobs" link.
- **The rail has a new group at the top, "Daily work", that is always open:** Jobs & Estimates, Schedule, Deployment, Field reports, Bid pipeline, Cash flow, Contacts. The other groups sit below a "More" label, each collapsed until opened. Entries only moved between groups. No route, capability or label changed.
- **The job page is the hub.** The Overview now starts with links to this job's RFIs, submittals, punch list, drawings and material orders. Each link is filtered with `?job=`, which all five lists already supported. Each shows the count you will see when you land on the list. After contract, the Estimate tab is called "Change orders". On an estimate, the line items come first and "Job costing & WIP" is folded away at the bottom.
- **The dashboard puts New job and the job search at the top.** All four Needs-attention tiles now link to the lists they count. A brand-new account sees only the getting-started checklist. "Further down this page" now links to Mark contracted on the Estimate tab, which is where the button actually is.

How to check it: `navItems.test.ts` and `Sidebar.test.ts` cover the job-page highlight, the single primary group and the "More" label. `new-account.test.ts` covers the tile links and the checklist-only new account. `job-paperwork.test.ts` covers the hub links. `JobStatusControl.test.tsx` covers the contract link. If the `/jobs` alias is removed, three tests fail. If an `href` is removed from a tile, one test fails.
