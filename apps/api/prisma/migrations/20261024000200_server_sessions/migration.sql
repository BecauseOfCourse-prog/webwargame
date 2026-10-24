CREATE TABLE "Session" (
    "tokenHash" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "idleExpiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("tokenHash"),
    CONSTRAINT "Session_tokenHash_format" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "Session_deadlines" CHECK ("expiresAt" > "createdAt" AND "idleExpiresAt" > "createdAt" AND "idleExpiresAt" <= "expiresAt"),
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "Session_idleExpiresAt_idx" ON "Session"("idleExpiresAt");
