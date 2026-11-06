### The new-customer walk ends at Send, reading the GC's proposal at the signing link

`e2e/local/new-customer-walk.local.spec.ts` (local, `--real-plans`) now walks the guided
flow's last step: it adds the inclusions, exclusions and GC terms Send asks for, makes the
signing link, checks the job shows it, and opens it signed out as the GC. Every scope row
must carry its height, LF and SF (walls with no type yet LF only), the terms must be on the
page, the price must not be $0.00, and Sign contract must be there; it stops at the link
and does not sign. It also follows what changed under it: Confirm scales says the floor
plans need their own (#1000), so that is no longer written down as stuck; the floor plans
take one "Use the printed scale on all N" press; and a group with no height gets one
through the row's own key (T since #1005).
