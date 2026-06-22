# Darwynn Outbound Manifest Scanner

A mobile-first PWA for dock workers to scan outbound parcel shipping labels as they load carrier trucks.

## What it does

- Workers scan shipping labels with the device camera (Code 128, PDF417, QR, Data Matrix)
- Each scan logs the tracking number to a **manifest** tied to a carrier's daily pickup
- Detects the carrier from the tracking number pattern automatically
- Flags **duplicates** and **wrong-carrier misroutes** in real time
- Works **offline** — scans queue to IndexedDB and sync when signal returns
- Managers can view daily totals, reopen closed manifests, and export CSV

## Tech stack

| Layer | Choice |
|---|---|
| App | Next.js 15 (App Router) |
| Database / Auth | Supabase (Postgres + Row Level Security) |
| Hosting | Vercel |
| Barcode scanning | Native BarcodeDetector API, ZXing fallback |
| Offline storage | IndexedDB via `idb` |
| Styling | Tailwind CSS v3 |
| PWA | Manual service worker (sw.js) |

## Local setup

```bash
# 1. Clone
git clone https://github.com/rezanjfm/darwynn-manifest-scanner
cd darwynn-manifest-scanner

# 2. Install
npm install

# 3. Set env vars
cp .env.example .env.local
# Edit .env.local with your Supabase URL and anon key

# 4. Run the migration against your Supabase project
# Paste supabase/migrations/001_initial_schema.sql into the Supabase SQL editor

# 5. Start dev server
npm run dev
```

## Environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your project URL, e.g. `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-side only, not exposed to browser) |

## User roles

| Role | Can do |
|---|---|
| `worker` | Login, open manifest, scan parcels, close manifest, export CSV |
| `manager` | Everything above + reopen closed manifests, manager dashboard, edit carriers |

**Default role is `worker`.** To make a user a manager, run this SQL in Supabase:

```sql
UPDATE user_profiles SET role = 'manager' WHERE email = 'manager@darwynn.com';
```

## Creating your first user

Go to **Supabase → Authentication → Users → Add user**. The `handle_new_user` trigger creates their profile automatically with the `worker` role.

## Phases

| Phase | Status | Features |
|---|---|---|
| 1 | ✅ Live | Auth, manifest CRUD, barcode scan, parcel log, CSV export, offline queue |
| 2 | 🔜 | Carrier pattern matching, duplicate + misroute flagging |
| 3 | 🔜 | Camera OCR for address / service level |
| 4 | 🔜 | Manager dashboard, search, carrier editor |
| 5 | 🔜 | Background sync hardening |

## Design decisions

- **Camera-first**: full-screen viewfinder, action bar stays out of the scan area
- **Offline-first**: every scan writes to IndexedDB before Supabase; sync happens in background
- **Carrier detection runs client-side** from patterns stored in the `carriers` table — no network round trip needed
- **No double-counting**: a `Set` of tracking numbers is built at scan-session start from both the DB and the local queue
- **Audio feedback**: Web Audio API generates beeps without any audio files — green beep on success, harsh buzz on duplicate or misroute
- **Region**: Supabase project in `ca-central-1` (Canadian carriers, Canadian data residency)
