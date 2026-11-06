### The e2e shell check no longer races a sign-in's redirect

`expectShellNavigation` read the window's width with `page.evaluate` before
checking the navigation, and a sign-in still redirecting to the dashboard
destroyed the page under it: "Execution context was destroyed" in
`landOnDashboard`, the only failure of two e2e runs on main (answer-key-gate
step 1). The navigation is checked first now, with a locator assertion that
waits through a navigation; the width is read only to word a failure.
