import { Carrier } from "@/types";

// Resolve carrier from a raw barcode value against the carriers list.
// Runs entirely client-side — no network required — so it works offline.
export function detectCarrier(
  barcode: string,
  carriers: Carrier[]
): Carrier | null {
  const active = carriers.filter((c) => c.active);

  for (const carrier of active) {
    for (const pattern of carrier.tracking_patterns) {
      try {
        if (new RegExp(pattern, "i").test(barcode.trim())) {
          return carrier;
        }
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
  // Strip common GDI/EDI control characters
  const cleaned = raw.replace(/[\x1C\x1D\x1E\x04\x00-\x08\x0B\x0C\x0E-\x1F]/g, " ");
  // Take the segment that looks most like a tracking number (longest alphanum run)
  const segments = cleaned.split(/\s+/).filter(Boolean);
  if (segments.length === 0) return raw.trim();
  return segments.sort((a, b) => b.length - a.length)[0];
}
