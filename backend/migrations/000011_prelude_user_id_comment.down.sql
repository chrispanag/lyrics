COMMENT ON COLUMN users.prelude_user_id IS
  'The `user_id` claim from the Prelude access token. This, not the email, is the '
  'stable join key: an email can be changed in Prelude, this identifier cannot.';
