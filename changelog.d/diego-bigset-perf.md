### On a big set, the title blocks no longer wait for the legend, and Accept all writes its lines once

Timed on Topeka Senior Villas (137 sheets, 109 MB, a training set) from upload
to the first Accept all. Two of the steps a pilot waits on were slow for
reasons that were not the work itself:

- **The title blocks waited 82 s for the wall legend.** The free pass queues the
  legend read behind itself, and the panel offered "Read the title blocks" only
  once nothing was running. It is offered as soon as the free pass is done now,
  and pressed, the title blocks take the reading loop; the legend picks up again
  when they finish. The sheet list, the floor plans and their scales all wait on
  the title blocks; the legend is wanted at the review queue, minutes later.
- **Accept all took 10.8 s.** Each group rewrote its type's estimate lines, and
  that reads every item and measurement on the job. The lines are written once
  for all the groups now.
