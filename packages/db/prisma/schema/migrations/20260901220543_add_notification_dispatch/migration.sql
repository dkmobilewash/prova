-- CreateTable
CREATE TABLE "NotificationDispatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dispatchKey" TEXT NOT NULL,
    "alertKey" TEXT NOT NULL,
    "rung" TEXT NOT NULL,
    "messageId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationDispatch_companyId_idx" ON "NotificationDispatch"("companyId");

-- CreateIndex
CREATE INDEX "NotificationDispatch_userId_idx" ON "NotificationDispatch"("userId");

-- CreateIndex
CREATE INDEX "NotificationDispatch_alertKey_idx" ON "NotificationDispatch"("alertKey");

-- CreateIndex
CREATE INDEX "NotificationDispatch_messageId_idx" ON "NotificationDispatch"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDispatch_userId_dispatchKey_key" ON "NotificationDispatch"("userId", "dispatchKey");

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDispatch" ADD CONSTRAINT "NotificationDispatch_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutboundMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

