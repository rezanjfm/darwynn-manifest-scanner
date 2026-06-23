import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
  // Use service client so RLS can't block us from reading the role
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

// POST /api/admin/users  { email, full_name, role }  → invite a new user
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json() as { email?: string; full_name?: string; role?: string };
  const { email, full_name, role = "associate" } = body;
  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  if (!["associate", "manager", "admin"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const svc = service();

  // Send invite email — creates the auth.users row immediately
  const { data: inviteData, error: inviteError } = await svc.auth.admin.inviteUserByEmail(email, {
    data: { full_name: full_name ?? "" },
  });
  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }

  const userId = inviteData.user.id;

  // Upsert user_profiles (handles both: trigger already ran, or trigger didn't run)
  await svc.from("user_profiles").upsert({
    id:         userId,
    email,
    full_name:  full_name ?? "",
    role,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });

  return NextResponse.json({ ok: true, userId });
}

// PATCH /api/admin/users  { userId, role }
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
