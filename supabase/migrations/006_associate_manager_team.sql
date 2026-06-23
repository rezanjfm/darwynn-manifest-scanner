-- Migration 006 — Rename worker → associate, add manager_id, update KPI for team visibility
-- Safe to re-run.

-- 1. Update role constraint: add 'associate', drop 'worker'
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('associate', 'manager', 'admin'));

-- 2. Rename existing worker rows
UPDATE user_profiles SET role = 'associate' WHERE role = 'worker';

-- 3. Change column default so new invites land as 'associate'
ALTER TABLE user_profiles ALTER COLUMN role SET DEFAULT 'associate';

-- 4. Add manager_id: each associate can be assigned to one manager
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_profiles_manager ON user_profiles(manager_id);

-- 5. Update get_user_kpi: admin sees all, manager sees only their assigned associates
CREATE OR REPLACE FUNCTION get_user_kpi(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
  user_id        UUID,
  full_name      TEXT,
  email          TEXT,
  role           TEXT,
  manager_id     UUID,
  outbound_scans BIGINT,
  inbound_scans  BIGINT,
  manual_scans   BIGINT,
  first_scan_at  TIMESTAMPTZ,
  last_scan_at   TIMESTAMPTZ
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_id   UUID;
BEGIN
  v_caller_id := auth.uid();
  SELECT up.role INTO v_caller_role FROM user_profiles up WHERE up.id = v_caller_id;

  IF v_caller_role NOT IN ('admin', 'manager') THEN
    RAISE EXCEPTION 'Access denied: admin or manager role required';
  END IF;

  RETURN QUERY
  SELECT
    up.id,
    up.full_name,
    up.email,
    up.role,
    up.manager_id,
    COUNT(CASE WHEN m.direction = 'outbound'    THEN p.id END)::BIGINT AS outbound_scans,
    COUNT(CASE WHEN m.direction = 'inbound'     THEN p.id END)::BIGINT AS inbound_scans,
    COUNT(CASE WHEN p.entry_method = 'manual'   THEN p.id END)::BIGINT AS manual_scans,
    MIN(p.scanned_at) AS first_scan_at,
    MAX(p.scanned_at) AS last_scan_at
  FROM user_profiles up
  LEFT JOIN parcels p
    ON  p.scanned_by = up.id
    AND p.scanned_at >= p_date::TIMESTAMPTZ
    AND p.scanned_at <  (p_date + INTERVAL '1 day')::TIMESTAMPTZ
  LEFT JOIN manifests m ON p.manifest_id = m.id
  WHERE
    CASE
      WHEN v_caller_role = 'admin'   THEN TRUE
      WHEN v_caller_role = 'manager' THEN up.manager_id = v_caller_id
      ELSE FALSE
    END
  GROUP BY up.id, up.full_name, up.email, up.role, up.manager_id
  ORDER BY COUNT(p.id) DESC, up.full_name;
END;
$$;

-- 6. Update search_parcels: managers can also see scanned_by_name (for their team)
CREATE OR REPLACE FUNCTION search_parcels(p_query TEXT, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  id                 UUID,
  tracking_number    TEXT,
  entry_method       TEXT,
  scanned_at         TIMESTAMPTZ,
  scanned_by         UUID,
  scanned_by_name    TEXT,
  manifest_id        UUID,
  manifest_date      DATE,
  manifest_status    TEXT,
  manifest_direction TEXT,
  carrier_name       TEXT,
  carrier_code       TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caller_role TEXT;
  v_caller_id   UUID;
BEGIN
  v_caller_id   := auth.uid();
  SELECT up.role INTO v_caller_role FROM user_profiles up WHERE up.id = v_caller_id;

  RETURN QUERY
  SELECT
    p.id,
    p.tracking_number,
    p.entry_method,
    p.scanned_at,
    p.scanned_by,
    CASE
      WHEN v_caller_role = 'admin'   THEN up.full_name
      WHEN v_caller_role = 'manager' AND up.manager_id = v_caller_id THEN up.full_name
      ELSE NULL
    END AS scanned_by_name,
    m.id          AS manifest_id,
    m.date        AS manifest_date,
    m.status      AS manifest_status,
    m.direction   AS manifest_direction,
    c.name        AS carrier_name,
    c.code        AS carrier_code
  FROM parcels p
  JOIN manifests m  ON p.manifest_id = m.id
  JOIN carriers  c  ON p.carrier_id  = c.id
  LEFT JOIN user_profiles up ON p.scanned_by = up.id
  WHERE p.tracking_number ILIKE '%' || p_query || '%'
  ORDER BY p.scanned_at DESC
  LIMIT p_limit;
END;
$$;

-- 7. Update RLS: managers can update manager_id assignments on associates
DROP POLICY IF EXISTS profiles_update_manager_assign ON user_profiles;
CREATE POLICY profiles_update_manager_assign ON user_profiles
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      WHERE up.id = auth.uid() AND up.role IN ('manager', 'admin')
    )
  );
