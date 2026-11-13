CREATE TABLE review_profiles (
  id TEXT PRIMARY KEY NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  profile_json TEXT,
  updated_at TEXT NOT NULL
);
