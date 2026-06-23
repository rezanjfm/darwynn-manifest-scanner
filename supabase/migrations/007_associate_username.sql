-- Migration 007 — Add username column for passwordless-email associates
-- Associates log in with username + PIN; email is generated internally.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_user_profiles_username ON user_profiles(username);
