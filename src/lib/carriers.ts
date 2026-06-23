import { Carrier } from "@/types";

// Priority order for carriers whose patterns overlap.
// Earlier in this list = wins the match.
// Known conflicts:
//   - Purolator ^[0-9]{12}$ vs FedEx ^[0-9]{12}$ → Purolator wins (more common domestically)
//   - Nationex ^[12][0-9]{9}$ vs DHL ^[1347][0-9]{9}$ → Nationex wins (DHL 10-digit is rare in Canada)
const PRIORITY_ORDER = [
  "UPS", "CANADAPOST", "PUROLATOR", "CANPAR",
  "INTELCOM", "OBIBOX", "ICS", "ALS", "NATIONEX", "CHITCHATS", "STALLION", "FLASHBOX",
  "FEDEX", "DHL", "USPS", "ONTRAC", "LANDMARK", "TFORCE",
  "FLEETOPTICS", "LOOMIS", "DAYROSS", "UNIUNI", "GOBOLT",
  "GLS", "AMAZON", "OTHER",
];

export function detectCarrier(barcode: string, carriers: Carrier[]): Carrier | null {
  const trimmed = barcode.trim();
  const active  = carriers.filter((c) => c.active);

  // Sort by priority so conflicts resolve deterministically
  const sorted = [...active].sort((a, b) => {
    const ai = PRIORITY_ORDER.indexOf(a.code);
    const bi = PRIORITY_ORDER.indexOf(b.code);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  for (const carrier of sorted) {
    for (const pattern of carrier.tracking_patterns) {
      try {
        if (new RegExp(pattern, "i").test(trimmed)) return carrier;
      } catch {
        // Bad regex in DB — skip
      }
    }
  }
  return null;
}

// Normalise a raw barcode to the most useful tracking number segment.
// Shipping labels often encode extra fields separated by GS/RS/EOT control
// characters or spaces. We strip those and take the longest alphanumeric run.
export function extractTrackingNumber(raw: string): string {
  const cleaned = raw.replace(/[\x1C\x1D\x1E\x04\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
  const segments = cleaned.split(/\s+/).filter(Boolean);
  if (segments.length === 0) return raw.trim();
  return segments.sort((a, b) => b.length - a.length)[0];
}
