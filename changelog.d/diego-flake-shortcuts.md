### Workspace step 16's flake: a sign-in bounce, retried once and named

"16. THE KEYBOARD SHORTCUTS ACTUALLY DO SOMETHING" failed three times, each time
the only failure (main ae6bffce, #1062, #1078). In every run the goto to
`/takeoff/<job>` landed on the dashboard, seconds after Clerk's test client
logged "FAPI request failed after 4 attempts". Step 15 had just opened the same
job, and nothing in the workspace redirects. The session check bounced through
sign-in, which drops the target.

`onWorkspace` now opens the workspace again, once, only when the browser has
been taken off `/takeoff/`. A slow or broken workspace still fails. A second
bounce fails naming the page the browser is on.
