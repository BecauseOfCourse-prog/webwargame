CREATE TYPE "UserRole" AS ENUM ('PLAYER', 'ADMIN');

CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" VARCHAR(32) NOT NULL,
    "normalizedUsername" VARCHAR(32) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "User_username_format" CHECK ("username" ~ '^[A-Za-z0-9._-]{3,32}$'),
    CONSTRAINT "User_username_normalization" CHECK ("normalizedUsername" = lower("username" COLLATE "C"))
);

CREATE UNIQUE INDEX "User_normalizedUsername_key" ON "User"("normalizedUsername");
