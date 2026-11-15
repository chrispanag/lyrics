-- Email verification at sign-up.
--
-- Prelude proves the address via a step-up challenge but exposes no verified
-- flag, so the outcome is recorded here. Nothing about the challenge is stored.

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

COMMENT ON COLUMN users.email_verified_at IS
  'When the address was confirmed by completing the email:verify step-up '
  'challenge. NULL means unverified, and the API refuses everything but '
  'reading the profile and finishing verification.';

-- Existing accounts were never asked for a code, so they are verified by fiat.
UPDATE users SET email_verified_at = created_at;
