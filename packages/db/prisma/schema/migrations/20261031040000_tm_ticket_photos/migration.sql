-- Additive and nullable. A photo can be attached to a signed T&M ticket, the
-- same shape as JobMedia.punchListItemId, and outlives the ticket.
ALTER TABLE "JobMedia" ADD COLUMN "tmTicketId" TEXT;

CREATE INDEX "JobMedia_tmTicketId_idx" ON "JobMedia"("tmTicketId");

ALTER TABLE "JobMedia" ADD CONSTRAINT "JobMedia_tmTicketId_fkey" FOREIGN KEY ("tmTicketId") REFERENCES "TmTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
