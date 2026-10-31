### A T&M ticket can carry photos, and they show on its change order (Diego)
`diego/tm-ticket-photos`

Photos are the usual backup for a change order request, and a ticket had none:
the draft could only count the job's photos from that day. Each ticket on the
phone now offers "No photo of the work — add one", which opens the camera with
the photo tied to that ticket at the shutter, the punch list's pattern, queued
offline like any other photo.

`JobMedia.tmTicketId` (additive, nullable, SetNull) holds the link. The change
order shows the photos through the ticket rather than a copy, so one added after
drafting still appears. The crew tab shows the count, and a change order's
description now keeps its line breaks, which it was collapsing.

The photos are not part of the signature: the frozen snapshot covers the hours
and materials, and a photo can be added after signing. The DocuSign document
carries the count in its text, not the images.
