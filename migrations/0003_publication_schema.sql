-- Preserve existing publications while distinguishing strictly validated agent content.
-- Source text is not part of the publishing contract or stored document.
ALTER TABLE notes ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 0 CHECK (schema_version IN (0, 1));
