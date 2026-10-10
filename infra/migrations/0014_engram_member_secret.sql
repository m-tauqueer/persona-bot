-- AES-GCM ciphertext of this member's Engram login password, stored so we can
-- mint a session token and talk as them (docs/ENGRAM.md §2.3). Encrypted
-- because the password can be set exactly once and cannot be reset by an org
-- admin; losing it strands the member. Nullable is load-bearing: NULL means
-- we hold no credential, which is the degrade-to-shared-only signal. Never
-- derive this value from a master secret — encryption can be re-keyed, an
-- Engram password cannot. ADD COLUMN IF NOT EXISTS so a re-run is a no-op
-- and does not rewrite existing ciphertext.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS engram_member_secret text;
