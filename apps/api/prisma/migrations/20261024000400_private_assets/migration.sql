CREATE TABLE "Asset" (
    "id" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "mimeType" VARCHAR(16) NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Asset_mimeType_check" CHECK ("mimeType" IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT "Asset_byteSize_check" CHECK ("byteSize" > 0 AND "byteSize" <= 52428800),
    CONSTRAINT "Asset_dimensions_check" CHECK ("width" > 0 AND "height" > 0 AND "width" <= 16384 AND "height" <= 16384 AND "width"::bigint * "height" <= 64000000),
    CONSTRAINT "Asset_sha256_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "Asset_uploadedById_idx" ON "Asset"("uploadedById");
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
