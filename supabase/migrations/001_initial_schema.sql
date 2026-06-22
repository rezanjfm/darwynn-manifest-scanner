-- Darwynn Outbound Manifest Scanner — Initial Schema
-- Run this to rebuild the database from scratch.
-- Applied automatically by the project setup script.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS carriers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  code              TEXT UNIQUE NOT NULL,
  tracking_patterns TEXT[] NOT NULL DEFAULT '{}',
  logo_keywords     TEXT[] NOT NULL DEFAULT '{}',
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manifests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  carrier_id   UUID NOT NULL REFERENCES carriers(id),
  date         DATE NOT NULL DEFAULT CURRENT_DATE,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_by    UUID REFERENCES auth.users(id),
  closed_by    UUID REFERENCES auth.users(id),
  opened_at    TIMESTAMPTZ DEFAULT NOW(),
  closed_at    TIMESTAMPTZ,
  parcel_count INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parcels (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  manifest_id         UUID NOT NULL REFERENCES manifests(id),
  carrier_id          UUID NOT NULL REFERENCES carriers(id),
  tracking_number     TEXT NOT NULL,
  raw_barcode         TEXT NOT NULL,
  destination_address TEXT,
  postal_code         TEXT,
  service_level       TEXT,
  weight              NUMERIC(10,3),
  entry_method        TEXT NOT NULL DEFAULT 'scan' CHECK (entry_method IN ('scan','manual')),
  scanned_by          UUID REFERENCES auth.users(id),
  scanned_at          TIMESTAMPTZ DEFAULT NOW(),
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  full_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'worker' CHECK (role IN ('worker','manager')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Triggers
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS
$$
BEGIN
  INSERT INTO user_profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE OR REPLACE FUNCTION update_manifest_parcel_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS
$$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE manifests SET parcel_count = parcel_count + 1, updated_at = NOW() WHERE id = NEW.manifest_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE manifests SET parcel_count = GREATEST(parcel_count - 1, 0), updated_at = NOW() WHERE id = OLD.manifest_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS on_parcel_inserted ON parcels;
CREATE TRIGGER on_parcel_inserted AFTER INSERT ON parcels FOR EACH ROW EXECUTE FUNCTION update_manifest_parcel_count();
DROP TRIGGER IF EXISTS on_parcel_deleted ON parcels;
CREATE TRIGGER on_parcel_deleted AFTER DELETE ON parcels FOR EACH ROW EXECUTE FUNCTION update_manifest_parcel_count();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_manifests_carrier_date ON manifests(carrier_id, date);
CREATE INDEX IF NOT EXISTS idx_manifests_status ON manifests(status);
CREATE INDEX IF NOT EXISTS idx_parcels_manifest ON parcels(manifest_id);
CREATE INDEX IF NOT EXISTS idx_parcels_tracking ON parcels(tracking_number);

-- RLS
ALTER TABLE carriers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE manifests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE parcels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY carriers_select ON carriers FOR SELECT USING (true);
CREATE POLICY carriers_insert ON carriers FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'manager'));
CREATE POLICY carriers_update ON carriers FOR UPDATE USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'manager'));
CREATE POLICY manifests_select ON manifests FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY manifests_insert ON manifests FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY manifests_update ON manifests FOR UPDATE USING (auth.uid() IS NOT NULL AND (status = 'open' OR EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'manager')));
CREATE POLICY parcels_select ON parcels FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY parcels_insert ON parcels FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY parcels_delete ON parcels FOR DELETE USING (EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'manager'));
CREATE POLICY profiles_select ON user_profiles FOR SELECT USING (id = auth.uid() OR EXISTS (SELECT 1 FROM user_profiles up WHERE up.id = auth.uid() AND up.role = 'manager'));
CREATE POLICY profiles_update ON user_profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY profiles_insert ON user_profiles FOR INSERT WITH CHECK (id = auth.uid());

-- Seed carriers
INSERT INTO carriers (name, code, tracking_patterns, logo_keywords, active) VALUES
('UPS','UPS',ARRAY['^1Z[A-Z0-9]{16}$','^[0-9]{9}$','^T[0-9]{10}$'],ARRAY['UPS','United Parcel Service'],true),
('FedEx','FEDEX',ARRAY['^[0-9]{12}$','^[0-9]{15}$','^[0-9]{20}$','^96[0-9]{20}$','^74[0-9]{18}$'],ARRAY['FedEx','Federal Express','FDXG','FDXE'],true),
('Canada Post','CANADAPOST',ARRAY['^[A-Z]{2}[0-9]{9}CA$','^JD[0-9]{18}$','^CC[0-9]{9}CA$','^RM[0-9]{9}CA$','^CX[0-9]{9}CA$','^LT[0-9]{9}CA$'],ARRAY['Canada Post','Postes Canada','CPC'],true),
('Purolator','PUROLATOR',ARRAY['^[A-Z]{3}[0-9]{9,10}$','^PPN[0-9]{9}$','^PWL[0-9]{9}$','^329[0-9]{9}$'],ARRAY['Purolator','PRL'],true),
('Canpar','CANPAR',ARRAY['^D[0-9]{15}$','^1[0-9]{15}$'],ARRAY['Canpar','Canpar Express','Day & Ross'],true),
('DHL','DHL',ARRAY['^[0-9]{10}$','^[0-9]{11}$','^JD[0-9]{18}$','^GM[0-9]{16}$'],ARRAY['DHL','Deutsche Post'],true),
('GLS','GLS',ARRAY['^[0-9]{8}$','^[0-9]{10}$'],ARRAY['GLS','General Logistics Systems'],true),
('Amazon Logistics','AMAZON',ARRAY['^TBA[0-9]{9,15}$'],ARRAY['Amazon','AMZL','Amazon Logistics'],true)
ON CONFLICT (code) DO NOTHING;
