-- AlterTable: a T&M ticket remembers the change order drafted from it, the
-- way DelayEvent.changeOrderId does. Additive and nullable; SetNull on the
-- change order's deletion so a thrown-away draft frees the ticket.
ALTER TABLE "TmTicket" ADD COLUMN "changeOrderId" TEXT;

CREATE INDEX "TmTicket_changeOrderId_idx" ON "TmTicket"("changeOrderId");

ALTER TABLE "TmTicket" ADD CONSTRAINT "TmTicket_changeOrderId_fkey" FOREIGN KEY ("changeOrderId") REFERENCES "ChangeOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
