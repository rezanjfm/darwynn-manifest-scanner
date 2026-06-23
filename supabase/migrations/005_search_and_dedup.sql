-- Migration 005 — Dedup constraint, trigram search, direct-write support
-- Safe to re-run.

-- 1. Enable trigram extension (required for fast ILIKE search index)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Trigram index on tracking_number for fast partial-match search
CREATE INDEX IF NOT EXISTS idx_parcels_tracking_trgm
  ON parcels USING gin(tracking_number gin_trgm_ops);

-- 3. Unique constraint — prevent duplicate tracking numbers per manifest
--    Remove any existing dupes (keep earliest scan) before adding constraint.
DELETE FROM parcels
WHERE id NOT IN (
  SELECT DISTINCT ON (manifest_id, tracking_number) id
  FROM parcels
  ORDER BY manifest_id, tracking_number, scanned_at ASC
);

ALTER TABLE parcels
  DROP CONSTRAINT IF EXISTS parcels_manifest_tracking_unique;
ALTER TABLE parcels
  ADD CONSTRAINT parcels_manifest_tracking_unique
  UNIQUE (manifest_id, tracking_number);

-- 4. Re-create search_parcels function (idempotent)
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
  v_is_admin BOOLEAN;
BEGIN
  SELECT (up.role IN ('admin','manager')) INTO v_is_admin
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
