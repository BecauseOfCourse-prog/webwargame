-- Establish migration history without inventing users or game tables.
-- PostgreSQL normally creates this schema already; the statement is idempotent.
CREATE SCHEMA IF NOT EXISTS "public";
