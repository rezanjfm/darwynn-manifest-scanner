-- Migration 008 — Warehouses + warehouse assignment for users

CREATE TABLE IF NOT EXISTS warehouses (
  id         TEXT PRIMARY KEY,
  code       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  city       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO warehouses (id, code, name, city) VALUES
  ('WHCANON001', 'WH02001', 'Toronto',   'Toronto'),
  ('WHCANAB001', 'WH02002', 'Calgary',   'Calgary'),
  ('WHCANQC001', 'WH02003', 'Montreal',  'Montreal'),
  ('WHCANBC001', 'WH02004', 'Vancouver', 'Vancouver')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS warehouse_id TEXT REFERENCES warehouses(id);

CREATE INDEX IF NOT EXISTS idx_user_profiles_warehouse ON user_profiles(warehouse_id);

-- RLS: authenticated users can read warehouses (needed for scanner UI)
ALTER TABLE warehouses ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "warehouses_select_auth" ON warehouses
  FOR SELECT TO authenticated USING (true);
