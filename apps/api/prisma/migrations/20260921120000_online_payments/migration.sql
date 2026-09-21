-- CreateTable
CREATE TABLE "OnlinePayment" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "userId" TEXT,
    "amountXof" INTEGER NOT NULL,
    "providerTxId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnlinePayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnlinePayment_providerTxId_key" ON "OnlinePayment"("providerTxId");

-- CreateIndex
CREATE INDEX "OnlinePayment_kind_refId_idx" ON "OnlinePayment"("kind", "refId");
