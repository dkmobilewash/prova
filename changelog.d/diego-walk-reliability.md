### The review queue keeps the question on screen when the server's refresh lands (Diego)
`diego/walk-reliability`

After a bulk answer (a printed tag, "the rest of the sheet", Accept all) the queue marked its groups done
and left its cursor on one of them, so the question shown was "the next after the cursor". The server's
refresh then dropped those groups, the cursor's key was nowhere, and the queue fell back to its first item:
the existing-walls question the person had just skipped (Baker A101), or a height item that had just
arrived (Falafel A2.00). That happened under the pointer, mid-click. The new-customer walk on main failed
this way in 7 of 10 runs (Falafel 2/5, Baker 1/5), and so did the three intermittent failures reported on
#1157+, including issue #1159. The cursor now follows the item on screen. Check:
`components/queueAfterAnswer.test.tsx` (Baker's tag and Falafel's doors, each with the refresh) fails
without it. The walk also prints, when a step fails, each change of the queue's item, an uncaught error's
stack and any plan byte range that failed or came back short.
