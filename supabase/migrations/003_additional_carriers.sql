-- Migration 003 — Additional carriers
-- Brings the total to 20 carriers for a complete Canadian warehouse setup.
-- Run in Supabase SQL Editor → safe to re-run (ON CONFLICT DO NOTHING).

INSERT INTO carriers (name, code, tracking_patterns, logo_keywords, active) VALUES

-- ── User-specified carriers ──────────────────────────────────────────────────
('Fleet Optics',    'FLEETOPTICS',
  ARRAY['^FO[A-Z0-9]{6,16}$', '^FOC[0-9]{8,14}$'],
  ARRAY['Fleet Optics','FleetOptics'],
  true),

('Obibox',          'OBIBOX',
  -- Real-world formats: XPDAR + alphanumeric suffix (e.g. XPDAR81453582721601, XPDAR343195406050Q1)
  ARRAY['^XPDAR[A-Z0-9]{10,20}$', '^OB[0-9]{8,14}$', '^OBX[0-9]{6,12}$'],
  ARRAY['Obibox'],
  true),

-- ── Major Canadian carriers ──────────────────────────────────────────────────
('Intelcom Express','INTELCOM',
  ARRAY['^IC[0-9]{10,14}$', '^INC[0-9]{8,12}$', '^INT[0-9]{10,12}$'],
  ARRAY['Intelcom','Intelcom Express','Dragonfly'],
  true),

('Loomis Express',  'LOOMIS',
  ARRAY['^L[0-9]{12}$', '^LX[0-9]{10,12}$', '^LMX[0-9]{9,11}$'],
  ARRAY['Loomis','Loomis Express'],
  true),

('Day & Ross',      'DAYROSS',
  ARRAY['^DR[0-9]{8,12}$', '^DRF[0-9]{8,10}$', '^[0-9]{12}DR$'],
  ARRAY['Day & Ross','Day Ross','D&R','Sameday'],
  true),

('Nationex',        'NATIONEX',
  ARRAY['^NX[0-9]{8,12}$', '^NAT[0-9]{9,11}$'],
  ARRAY['Nationex'],
  true),

('UniUni',          'UNIUNI',
  ARRAY['^UU[A-Z0-9]{8,14}$', '^UNIUN[0-9]{6,12}$'],
  ARRAY['UniUni','Uni2','UniUni Express'],
  true),

('GoBolt',          'GOBOLT',
  ARRAY['^GB[A-Z0-9]{8,14}$', '^GBT[0-9]{8,12}$'],
  ARRAY['GoBolt','Go Bolt'],
  true),

-- ── Cross-border / US carriers ───────────────────────────────────────────────
('USPS',            'USPS',
  ARRAY['^9[0-9]{21}$',           -- Priority Mail / First-Class (22 digits)
        '^[0-9]{22}$',            -- Some Priority Mail Express formats
        '^EA[0-9]{9}US$',         -- Priority Mail Express International
        '^EE[0-9]{9}US$',
        '^EI[0-9]{9}US$',
        '^EB[0-9]{9}US$',
        '^[A-Z]{2}[0-9]{9}US$'],  -- Generic international (catches CP-style but with US suffix)
  ARRAY['USPS','United States Postal Service','US Mail'],
  true),

('OnTrac',          'ONTRAC',
  ARRAY['^C[0-9]{14}$'],          -- Standard OnTrac / LaserShip format (C + 14 digits)
  ARRAY['OnTrac','LaserShip','Lone Star Overnight','LSO'],
  true),

-- ── International / specialty ────────────────────────────────────────────────
('Landmark Global', 'LANDMARK',
  ARRAY['^LG[A-Z0-9]{8,16}$', '^LGCA[0-9]{8,12}$'],
  ARRAY['Landmark Global','Landmark','Pitney Bowes'],
  true),

('TForce Freight',  'TFORCE',
  ARRAY['^TF[A-Z0-9]{8,14}$', '^TFI[0-9]{8,12}$', '^VLY[0-9]{7,10}$'],
  ARRAY['TForce','TForce Freight','TFI International','Velocity Express'],
  true)

,

('ALS',             'ALS',
  ARRAY['^ALS[A-Z0-9]{6,16}$', '^AL[0-9]{10,14}$'],
  ARRAY['ALS','ALS Logistics','Action Logistics'],
  true),

-- Catch-all — receives any barcode whose carrier cannot be auto-detected.
-- Never needs manual selection; always active.
('Other / Unknown',  'OTHER',
  ARRAY[]::TEXT[],
  ARRAY['Other','Unknown'],
  true)

ON CONFLICT (code) DO NOTHING;
