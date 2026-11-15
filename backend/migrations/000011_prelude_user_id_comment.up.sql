-- 000002 described this column as the `user_id` claim; it holds `sub`.

COMMENT ON COLUMN users.prelude_user_id IS
  'The `sub` claim from the Prelude access token (the `usr_…` id). Prelude''s `user_id` '
  'is a different identifier, used only if a claims mapping drops `sub`. This, not '
  'the email, is the stable join key.';
