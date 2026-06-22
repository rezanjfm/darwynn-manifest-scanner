import { Parcel, Manifest, Carrier } from "@/types";

function esc(v: string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function manifestToCSV(
  manifest: Manifest,
  carrier: Carrier,
  parcels: Parcel[]
): string {
  const header = [
    "Tracking Number",
    "Raw Barcode",
    "Carrier",
    "Service Level",
    "Destination",
    "Postal Code",
    "Weight (kg)",
    "Entry Method",
    "Scanned At",
  ].join(",");

  const rows = parcels.map((p) =>
    [
      esc(p.tracking_number),
      esc(p.raw_barcode),
      esc(carrier.name),
      esc(p.service_level),
      esc(p.destination_address),
      esc(p.postal_code),
      esc(p.weight?.toString()),
      esc(p.entry_method),
      esc(p.scanned_at),
    ].join(",")
  );

  const meta = [
    `# Darwynn Outbound Manifest`,
    `# Carrier: ${carrier.name}`,
    `# Date: ${manifest.date}`,
    `# Status: ${manifest.status}`,
    `# Total parcels: ${manifest.parcel_count}`,
    `# Exported: ${new Date().toISOString()}`,
    "",
  ].join("\n");

  return meta + header + "\n" + rows.join("\n");
}

export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
