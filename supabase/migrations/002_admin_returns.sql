-- Phase 2: admin role, inbound/returns direction, RLS updates, KPI + search RPC

-- 1. Add admin to role constraint
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_role_check CHECK (role IN ('worker', 'manager', 'admin'));

-- 2. Add direction to manifests (outbound = normal sortation, inbound = carrier return)
ALTER TABLE manifests
  ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'outbound'
  CHECK (direction IN ('outbound', 'inbound'));

-- 3. Update RLS policies --------------------------------------------------

-- profiles: manager OR admin can see all
DROP POLICY IF EXISTS profiles_select ON user_profiles;
CREATE POLICY profiles_select ON user_profiles FOR SELECT USING (
  id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM user_profiles up
    WHERE up.id = auth.uid() AND up.role IN ('manager', 'admin')
  )
);

-- profiles: users update own profile; admin can update any profile (for role assignment)
CREATE POLICY IF NOT EXISTS profiles_update_admin ON user_profiles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'admin')
  );

-- carriers: manager or admin can insert/update
DROP POLICY IF EXISTS carriers_insert ON carriers;
DROP POLICY IF EXISTS carriers_update ON carriers;
CREATE POLICY carriers_insert ON carriers FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
);
CREATE POLICY carriers_update ON carriers FOR UPDATE USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
);

-- parcels: manager or admin can delete (void scan)
DROP POLICY IF EXISTS parcels_delete ON parcels;
CREATE POLICY parcels_delete ON parcels FOR DELETE USING (
  EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role IN ('manager', 'admin'))
);

-- 4. Indexes for KPI and search
CREATE INDEX IF NOT EXISTS idx_parcels_scanned_by   ON parcels(scanned_by);
CREATE INDEX IF NOT EXISTS idx_parcels_scanned_at   ON parcels(scanned_at);
CREATE INDEX IF NOT EXISTS idx_manifests_direction  ON manifests(direction);
-- Efficient prefix/contains search on tracking_number
CREATE INDEX IF NOT EXISTS idx_parcels_tracking_trgm ON parcels USING gin(tracking_number gin_trgm_ops);

-- 5. KPI function — admin only; returns per-user scan stats for a given date
CREATE OR REPLACE FUNCTION get_user_kpi(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  user_id        UUID,
  full_name      TEXT,
  email          TEXT,
  role           TEXT,
  outbound_scans BIGINT,
  inbound_scans  BIGINT,
  manual_scans   BIGINT,
  first_scan_at  TIMESTAMPTZ,
  last_scan_at   TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Access denied: admin role required';
  END IF;

  RETURN QUERY
  SELECT
    up.id,
    up.full_name,
    up.email,
    up.role,
    COUNT(CASE WHEN m.direction = 'outbound' THEN p.id END)::BIGINT  AS outbound_scans,
    COUNT(CASE WHEN m.direction = 'inbound'  THEN p.id END)::BIGINT  AS inbound_scans,
    COUNT(CASE WHEN p.entry_method = 'manual' THEN p.id END)::BIGINT AS manual_scans,
    MIN(p.scanned_at) AS first_scan_at,
    MAX(p.scanned_at) AS last_scan_at
  FROM user_profiles up
  LEFT JOIN parcels p
    ON  p.scanned_by = up.id
    AND p.scanned_at >= p_date::TIMESTAMPTZ
    AND p.scanned_at <  (p_date + INTERVAL '1 day')::TIMESTAMPTZ
  LEFT JOIN manifests m ON p.manifest_id = m.id
  GROUP BY up.id, up.full_name, up.email, up.role
  ORDER BY COUNT(p.id) DESC, up.full_name;
END;
$$;

-- 6. Parcel search function — anonymises scanned_by_name for non-admins
CREATE OR REPLACE FUNCTION search_parcels(p_query TEXT, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  id                 UUID,
  tracking_number    TEXT,
  entry_method       TEXT,
  scanned_at         TIMESTAMPTZ,
  scanned_by         UUID,
  scanned_by_name    TEXT,   -- NULL for non-admin callers
  manifest_id        UUID,
  manifest_date      DATE,
  manifest_status    TEXT,
  manifest_direction TEXT,
  carrier_name       TEXT,
  carrier_code       TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  SELECT (up.role = 'admin') INTO v_is_admin
  FROM user_profiles up WHERE up.id = auth.uid();

  RETURN QUERY
  SELECT
    p.id,
    p.tracking_number,
    p.entry_method,
    p.scanned_at,
    p.scanned_by,
    CASE WHEN v_is_admin THEN up.full_name ELSE NULL END AS scanned_by_name,
    m.id          AS manifest_id,
    m.date        AS manifest_date,
    m.status      AS manifest_status,
    m.direction   AS manifest_direction,
    c.name        AS carrier_name,
    c.code        AS carrier_code
  FROM parcels p
  JOIN manifests m ON p.manifest_id = m.id
  JOIN carriers  c ON p.carrier_id  = c.id
  LEFT JOIN user_profiles up ON p.scanned_by = up.id
  WHERE p.tracking_number ILIKE '%' || p_query || '%'
  ORDER BY p.scanned_at DESC
  LIMIT p_limit;
END;
$$;
