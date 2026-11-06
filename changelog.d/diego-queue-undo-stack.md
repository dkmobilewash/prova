### The queue's Undo is a stack that holds; Run takeoff shows the groups the queue reads

Chrome on Baker accepted C8B on two groups in the review queue, pressed Undo
twice, and after a reload both were still saved: the runs on "C8B walls", the
type's two lines on the estimate. The queue saves behind (the next item is on
screen before the server answers) and pushed its Undo entry when the save came
back, and the workspace wrote back the stack as it was when an Undo began. An
accept saved while an Undo waited was dropped from the stack and could never be
undone. Now the entry joins the stack at the press, in press order, and its
Undo waits for the save; Undo and Redo move their one entry on the stack as it
is now; and a Redo keeps the new token, so a redone accept is undone in full.

The workspace's Run takeoff found the sheet again in the browser and grouped
the lines its own way (one 7-3/8" 114 ft group, where the queue had C8B 117 ft),
and that grouping was gone on a reload. It shows and posts the groups stored
with the sheet's scale now, and where it had to find them in the browser first,
the stored groups take over once they are stored and posted.
