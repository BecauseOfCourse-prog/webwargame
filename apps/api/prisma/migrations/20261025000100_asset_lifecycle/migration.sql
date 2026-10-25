ALTER TABLE "Asset" ADD COLUMN "archivedAt" TIMESTAMPTZ(3),
    ADD COLUMN "unreferencedSince" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE "Asset" SET "unreferencedSince" = "createdAt";

CREATE TYPE "AssetOwnerKind" AS ENUM ('UNIT', 'MAP', 'RULES');
CREATE TABLE "AssetReference" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assetId" UUID NOT NULL,
    "ownerKind" "AssetOwnerKind" NOT NULL,
    "ownerId" UUID NOT NULL,
    "slot" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssetReference_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AssetReference_slot_check" CHECK ("slot" ~ '^[a-z][a-z0-9._-]{0,63}$'),
    CONSTRAINT "AssetReference_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AssetReference_ownerKind_ownerId_slot_key" ON "AssetReference"("ownerKind", "ownerId", "slot");
CREATE INDEX "AssetReference_assetId_idx" ON "AssetReference"("assetId");

-- Acquire the same lock before any target row locks, including ordinary direct
-- reference writes. Application transactions explicitly use Read Committed.
CREATE FUNCTION lock_asset_lifecycle() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(14009, 1);
  RETURN NULL;
END;
$$;
CREATE TRIGGER "Asset_lock_lifecycle" BEFORE INSERT OR UPDATE OR DELETE ON "Asset"
FOR EACH STATEMENT EXECUTE FUNCTION lock_asset_lifecycle();
CREATE TRIGGER "AssetReference_lock_lifecycle" BEFORE INSERT OR UPDATE OR DELETE ON "AssetReference"
FOR EACH STATEMENT EXECUTE FUNCTION lock_asset_lifecycle();

CREATE FUNCTION check_asset_reference_target() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE target "Asset"%ROWTYPE;
BEGIN
  SELECT * INTO target FROM "Asset" WHERE "id" = NEW."assetId" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Asset reference target is unavailable.';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."assetId" = OLD."assetId" AND NEW."ownerKind" = OLD."ownerKind"
       AND NEW."ownerId" = OLD."ownerId" AND NEW."slot" = OLD."slot" THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NOT target."ready" OR target."archivedAt" IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Asset reference target is not selectable.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AssetReference_check_target" BEFORE INSERT OR UPDATE ON "AssetReference"
FOR EACH ROW EXECUTE FUNCTION check_asset_reference_target();

CREATE FUNCTION refresh_asset_reference_state(target_id UUID) RETURNS void LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  UPDATE "Asset" SET "unreferencedSince" = CASE
    WHEN EXISTS (SELECT 1 FROM "AssetReference" WHERE "assetId" = target_id) THEN NULL
    ELSE clock_timestamp() END
  WHERE "id" = target_id;
END;
$$;
CREATE FUNCTION maintain_asset_reference_state() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    PERFORM refresh_asset_reference_state(OLD."assetId");
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM refresh_asset_reference_state(NEW."assetId");
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "AssetReference_refresh_state" AFTER INSERT OR UPDATE OR DELETE ON "AssetReference"
FOR EACH ROW EXECUTE FUNCTION maintain_asset_reference_state();
