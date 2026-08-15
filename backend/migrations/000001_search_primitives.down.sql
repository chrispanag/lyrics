DROP TEXT SEARCH CONFIGURATION IF EXISTS app_simple;
DROP FUNCTION IF EXISTS app_norm(text);
-- Extensions are intentionally left installed: other schemas in the same
-- database may depend on them, and reinstalling is cheap.
