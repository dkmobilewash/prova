-- AlterTable: the PERIOD TO date on a G702. Additive and nullable — every
-- existing invoice keeps rendering with a blank period, and nothing reads
-- the column as required. See Invoice.periodTo in billing.prisma.
ALTER TABLE "Invoice" ADD COLUMN "periodTo" TIMESTAMP(3);
