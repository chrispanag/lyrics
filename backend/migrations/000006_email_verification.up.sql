-- Email verification at sign-up.
--
-- Prelude Auth proves the address, through a step-up challenge whose completion
-- it signs into the access token. What Prelude does not expose is a "this
-- identifier was verified" flag on the account, so the outcome is recorded here.
-- That is the same split already made for roles: Prelude owns credentials, this
-- database owns authorization.
--
-- Nothing about the challenge itself is stored. The one-time code and the
-- challenge it belongs to live entirely between the browser and Prelude; this
-- side only ever sees the granted scope on a signed token.

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

COMMENT ON COLUMN users.email_verified_at IS
  'When the address was confirmed by completing the email:verify step-up '
  'challenge. NULL means unverified, and the API refuses everything but '
  'reading the profile and finishing verification.';

-- Everyone registered before this migration is verified by fiat. They were
-- never asked for a code and never received one, so gating them would lock
-- working accounts out of an app that cannot tell them why.
UPDATE users SET email_verified_at = created_at;
