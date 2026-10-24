-- This singleton serializes account writes before they take User row locks.
-- Updating the guard (rather than only taking an advisory lock) also rejects
-- stale concurrent role changes in REPEATABLE READ / SERIALIZABLE transactions.
CREATE TABLE "AdministratorGuard" (
  "id" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "AdministratorGuard_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdministratorGuard_singleton" CHECK ("id" = 1)
);

INSERT INTO "AdministratorGuard" ("id") VALUES (1);

CREATE FUNCTION lock_administrator_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  UPDATE "AdministratorGuard" SET "id" = "id" WHERE "id" = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Administrator guard is unavailable.';
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "User_lock_administrator_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "User"
FOR EACH STATEMENT EXECUTE FUNCTION lock_administrator_guard();

CREATE FUNCTION protect_last_administrator() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  removing_administrator boolean := false;
BEGIN
  IF OLD."role" = 'ADMIN' THEN
    IF TG_OP = 'DELETE' THEN
      removing_administrator := true;
    ELSE
      removing_administrator := NEW."role" <> 'ADMIN';
    END IF;
  END IF;

  -- VOLATILE obtains a fresh query snapshot after any guard-lock wait at
  -- READ COMMITTED and sees previous changes from a multi-row statement.
  IF removing_administrator AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE "role" = 'ADMIN' AND "id" <> OLD."id"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The last administrator cannot be removed.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_protect_last_administrator"
BEFORE DELETE OR UPDATE OF "role" ON "User"
FOR EACH ROW EXECUTE FUNCTION protect_last_administrator();
