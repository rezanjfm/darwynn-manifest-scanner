-- Migration 004 — Fix all carrier tracking patterns with verified industry regexes.
-- Safe to run multiple times (UPDATEs are idempotent, INSERTs use ON CONFLICT).

-- ── Existing carriers — pattern corrections ──────────────────────────────────

UPDATE carriers SET tracking_patterns = ARRAY[
  '^1Z[A-Z0-9]{6}[0-9]{10}$'          -- 1Z + 6 alphanum + 10 digits = 18 chars
] WHERE code = 'UPS';

UPDATE carriers SET tracking_patterns = ARRAY[
  '^[0-9]{12}$',
  '^[0-9]{15,20}$'
] WHERE code = 'FEDEX';

UPDATE carriers SET tracking_patterns = ARRAY[
  '^[0-9]{16}$',
  '^[A-Z]{2}[0-9]{9}CA$'              -- covers LT/RM/CX/CC/JD… prefixes
] WHERE code = 'CANADAPOST';

UPDATE carriers SET tracking_patterns = ARRAY[
  '^[0-9]{12}$',                       -- NOTE: overlaps with FedEx 12-digit
  '^[A-Z]{3}[0-9]{9}$'
] WHERE code = 'PUROLATOR';

UPDATE carriers SET tracking_patterns = ARRAY[
  '^[WDH][A-Z0-9]{20}$'               -- W / D / H prefix + 20 alphanum
] WHERE code = 'CANPAR';

-- DHL Express + eCommerce combined
UPDATE carriers SET tracking_patterns = ARRAY[
  '^[1347][0-9]{9}$',                  -- Express 10-digit (NOTE: 1-prefix overlaps Nationex)
  '^(GM|LW|RX)[0-9]{16,20}$'          -- eCommerce
] WHERE code = 'DHL';

UPDATE carriers SET tracking_patterns = ARRAY[
  '^94[0-9]{20}$',                     -- Priority Mail / First-Class 22-digit
  '^92[0-9]{20}$'                      -- USPS Returns / commercial 22-digit
] WHERE code = 'USPS';

UPDATE carriers SET tracking_patterns = ARRAY[
  '^(INTLCMA|INTLCMB|INTLCMD|LPKEN)[0-9]+$'
] WHERE code = 'INTELCOM';

-- Obibox: OBI/OBX standard + XPDAR confirmed from real-world scans
UPDATE carriers SET tracking_patterns = ARRAY[
  '^(OBI|OBX)[0-9]{9,12}$',
  '^XPDAR[A-Z0-9]{10,20}$'
] WHERE code = 'OBIBOX';

UPDATE carriers SET tracking_patterns = ARRAY[
  '^(ALS|ALC)[0-9]{10,14}$'
] WHERE code = 'ALS';

-- Nationex: starts with 1 or 2, 10 digits total (NOTE: 1-prefix overlaps DHL Express)
UPDATE carriers SET tracking_patterns = ARRAY[
  '^[12][0-9]{9}$'
] WHERE code = 'NATIONEX';

UPDATE carriers SET tracking_patterns = ARRAY[
  '^(ND|GR|DK)[A-Z0-9]{18}$'          -- 2-letter prefix + 18 alphanum = 20 chars
] WHERE code = 'ICS';

UPDATE carriers SET tracking_patterns = ARRAY[
  '^1LS[A-Z0-9]{15}$',                 -- New LaserShip/OnTrac unified format
  '^C[0-9]{14}$'                       -- Legacy OnTrac
] WHERE code = 'ONTRAC';

-- ── New carriers ──────────────────────────────────────────────────────────────

INSERT INTO carriers (name, code, tracking_patterns, logo_keywords, active) VALUES
('Flashbox',         'FLASHBOX',  ARRAY['^(FBX|CP)[0-9]{10}$'],  ARRAY['Flashbox'],                    true),
('Chit Chats',       'CHITCHATS', ARRAY['^CC[A-Z0-9]{1,12}$'],   ARRAY['Chit Chats','ChitChats'],      true),
('Stallion Express', 'STALLION',  ARRAY['^(STN|SE)[0-9]{10}$'],  ARRAY['Stallion','Stallion Express'], true)
ON CONFLICT (code) DO NOTHING;
