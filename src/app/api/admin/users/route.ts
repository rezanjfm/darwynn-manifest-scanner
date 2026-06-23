import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const STAFF_DOMAIN = "@staff.darwynn.local";

// Service-role client — bypasses RLS entirely, server-only
function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function requireAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await service()
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  return data?.role === "admin";
}

// GET /api/admin/users  → all user profiles
export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { data, error } = await service()
    .from("user_profiles")
    .select("*")
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/admin/users
// Body A — create associate (no real email):  { type: "associate", full_name, username, pin }
// Body B — invite manager/admin (email):      { type: "invite",    full_name, email, role }
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json() as Record<string, string>;
  const svc = service();

  // ── Create associate with username + PIN ────────────────────────────────
  if (body.type === "associate") {
    const { full_name, username, pin } = body;
    if (!full_name?.trim()) return NextResponse.json({ error: "Full name is required" }, { status: 400 });
    if (!username?.trim())  return NextResponse.json({ error: "Username is required" }, { status: 400 });
    if (!pin || pin.length < 4) return NextResponse.json({ error: "PIN must be at least 4 characters" }, { status: 400 });

    const slug  = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (!slug)  return NextResponse.json({ error: "Username must contain letters or numbers" }, { status: 400 });

    const email = `${slug}${STAFF_DOMAIN}`;

    const { data: created, error: createError } = await svc.auth.admin.createUser({
      email,
      password: pin,
      email_confirm: true,
      user_metadata: { full_name: full_name.trim() },
    });
    if (createError) return NextResponse.json({ error: createError.message }, { status: 400 });

    await svc.from("user_profiles").upsert({
      id:         created.user.id,
      email,
      full_name:  full_name.trim(),
      username:   slug,
      role:       "associate",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });

    return NextResponse.json({ ok: true, userId: created.user.id });
  }

  // ── Invite manager / admin by real email ────────────────────────────────
  const { email, full_name, role = "associate" } = body;
  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  if (!["associate", "manager", "admin"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const { data: inviteData, error: inviteError } = await svc.auth.admin.inviteUserByEmail(email, {
    data: { full_name: full_name ?? "" },
  });
  if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 400 });

  await svc.from("user_profiles").upsert({
    id:         inviteData.user.id,
    email,
    full_name:  full_name ?? "",
    role,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });

  return NextResponse.json({ ok: true, userId: inviteData.user.id });
}

// PATCH /api/admin/users  { userId, role?, manager_id? }
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json() as { userId?: string; role?: string; manager_id?: string | null };
  const { userId, role, manager_id } = body;
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  if (role && !["associate", "manager", "admin"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (role) update.role = role;
  if (manager_id !== undefined) update.manager_id = manager_id;

  const { error } = await service().from("user_profiles").update(update).eq("id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
