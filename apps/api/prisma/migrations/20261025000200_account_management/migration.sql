ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMPTZ(3),
  ADD COLUMN "passwordResetRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "User_version_check" CHECK ("version" >= 0);

CREATE TYPE "AccountAuditAction" AS ENUM ('ROLE_CHANGED', 'SUSPENDED', 'RESUMED', 'PASSWORD_RESET_ISSUED', 'PASSWORD_RESET_COMPLETED');
CREATE TABLE "PasswordReset" (
  "tokenHash" CHAR(64) NOT NULL PRIMARY KEY,
  "userId" UUID NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
  "userVersion" INTEGER NOT NULL CHECK ("userVersion" >= 0),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PasswordReset_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "PasswordReset_expiry_check" CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '30 minutes')
);
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");
CREATE TABLE "AccountAudit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "actorId" UUID REFERENCES "User"("id") ON DELETE RESTRICT,
  "targetId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "action" "AccountAuditAction" NOT NULL,
  "fromRole" "UserRole" NOT NULL,
  "toRole" "UserRole" NOT NULL,
  "fromSuspended" BOOLEAN NOT NULL,
  "toSuspended" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AccountAudit_targetId_createdAt_id_idx" ON "AccountAudit"("targetId", "createdAt", "id");

CREATE OR REPLACE FUNCTION protect_last_administrator() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
DECLARE removing_administrator boolean := false;
BEGIN
  IF OLD."role" = 'ADMIN' AND OLD."suspendedAt" IS NULL AND NOT OLD."passwordResetRequired" THEN
    IF TG_OP = 'DELETE' THEN removing_administrator := true;
    ELSE removing_administrator := NEW."role" <> 'ADMIN' OR NEW."suspendedAt" IS NOT NULL OR NEW."passwordResetRequired";
    END IF;
  END IF;
  IF removing_administrator AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE "role" = 'ADMIN' AND "suspendedAt" IS NULL
      AND NOT "passwordResetRequired" AND "id" <> OLD."id"
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The last administrator with working access cannot be removed.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER "User_protect_last_administrator" ON "User";
CREATE TRIGGER "User_protect_last_administrator" BEFORE DELETE OR UPDATE OF "role", "suspendedAt", "passwordResetRequired" ON "User"
FOR EACH ROW EXECUTE FUNCTION protect_last_administrator();

CREATE FUNCTION maintain_account_version() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF ROW(NEW."role", NEW."suspendedAt", NEW."passwordHash", NEW."passwordResetRequired") IS DISTINCT FROM
     ROW(OLD."role", OLD."suspendedAt", OLD."passwordHash", OLD."passwordResetRequired") THEN
    NEW."version" := OLD."version" + 1;
  ELSIF NEW."version" <> OLD."version" AND NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid account version transition.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "User_security_version" BEFORE UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION maintain_account_version();
CREATE FUNCTION revoke_changed_account_access() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF NEW."version" <> OLD."version" THEN
    DELETE FROM "Session" WHERE "userId" = NEW."id";
    DELETE FROM "PasswordReset" WHERE "userId" = NEW."id";
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER "User_revoke_security_changes" AFTER UPDATE ON "User"
FOR EACH ROW EXECUTE FUNCTION revoke_changed_account_access();

CREATE TRIGGER "Session_lock_account_guard" BEFORE INSERT ON "Session"
FOR EACH STATEMENT EXECUTE FUNCTION lock_administrator_guard();
CREATE FUNCTION check_account_session() RETURNS trigger LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE "id" = NEW."userId" AND "suspendedAt" IS NULL AND NOT "passwordResetRequired") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Account does not allow sessions.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Session_check_account" BEFORE INSERT ON "Session"
FOR EACH ROW EXECUTE FUNCTION check_account_session();

CREATE FUNCTION immutable_account_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Account audit is immutable.'; END;
$$;
CREATE TRIGGER "AccountAudit_immutable" BEFORE UPDATE OR DELETE ON "AccountAudit"
FOR EACH ROW EXECUTE FUNCTION immutable_account_audit();
