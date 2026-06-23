export type Role = "worker" | "manager" | "admin";

export interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  created_at: string;
  updated_at: string;
}

export interface Carrier {
  id: string;
  name: string;
  code: string;
  tracking_patterns: string[];
  logo_keywords: string[];
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Manifest {
  id: string;
  carrier_id: string;
  date: string;
  status: "open" | "closed";
  opened_by: string | null;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
  parcel_count: number;
  direction: "outbound" | "inbound";
  notes: string | null;
  created_at: string;
  updated_at: string;
  carrier?: Carrier;
}

export interface Parcel {
  id: string;
  manifest_id: string;
  carrier_id: string;
  tracking_number: string;
  raw_barcode: string;
  destination_address: string | null;
  postal_code: string | null;
  service_level: string | null;
  weight: number | null;
  entry_method: "scan" | "manual";
  scanned_by: string | null;
  scanned_at: string;
  created_at: string;
  carrier?: Carrier;
}

// Used in the offline queue stored in IndexedDB
export interface QueuedScan {
  id: string; // local UUID
  manifest_id: string;
  carrier_id: string;
  tracking_number: string;
  raw_barcode: string;
  entry_method: "scan" | "manual";
  scanned_by: string | null;
  scanned_at: string;
  synced: boolean;
}
