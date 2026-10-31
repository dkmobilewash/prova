-- Additive and nullable. A PO's entered issue and close dates, and an optional
-- attribution link from a material order to an issued PO line. MaterialOrder
-- still has no quantity and no price, and nothing sums money through this.
ALTER TABLE "PurchaseOrder" ADD COLUMN "closedOn" TIMESTAMP(3),
ADD COLUMN "issuedOn" TIMESTAMP(3);

ALTER TABLE "MaterialOrder" ADD COLUMN "purchaseOrderLineId" TEXT;

CREATE INDEX "MaterialOrder_purchaseOrderLineId_idx" ON "MaterialOrder"("purchaseOrderLineId");

ALTER TABLE "MaterialOrder" ADD CONSTRAINT "MaterialOrder_purchaseOrderLineId_fkey" FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
