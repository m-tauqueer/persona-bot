-- Member-visible catalog flag. Existing rows stay published so a single
-- seeded persona remains addressable. Unpublished is an owner draft.

ALTER TABLE personas
  ADD COLUMN published boolean NOT NULL DEFAULT true;
