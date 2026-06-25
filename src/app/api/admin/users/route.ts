import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const STAFF_DOMAIN = "@staff.darwynn.local";

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type Requester = { role: "admin" | "manager"; warehouse_id: string | null };

async function getRequester(): Promise<Requester | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await service()
    .from("user_profiles")
    .select("role, warehouse_id")
    .eq("id", user.id)
    .single();
  if (!data || !["admin", "manager"].includes(data.role)) return null;
  return { role: data.role as "admin" | "manager", warehouse_id: data.warehouse_id ?? null };
}

// GET /api/admin/users
// Admin: all users.  Manager: only users in their warehouse.
export async function GET() {
  const req = await getRequester();
  if (!req) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let query = service().from("user_profiles").select("*").order("created_at");
  if (req.role === "manager") {
    if (!req.warehouse_id) return NextResponse.json([]);
    query = query.eq("warehouse_id", req.warehouse_id);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/admin/users
// Body A — create associate:  { type: "associate", full_name, username, pin, warehouse_id? }
// Body B — invite manager/admin (admin only): { full_name, email, role }
export async function POST(httpReq: NextRequest) {
  const req = await getRequester();
  if (!req) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await httpReq.json() as Record<string, string>;
  const svc = service();

  if (body.type === "associate") {
    const { full_name, username, pin, warehouse_id } = body;
    if (!full_name?.trim()) return NextResponse.json({ error: "Full name is required" }, { status: 400 });
    if (!username?.trim())  return NextResponse.json({ error: "Username is required" }, { status: 400 });
    if (!pin || pin.length < 4) return NextResponse.json({ error: "PIN must be at least 4 characters" }, { status: 400 });

    const slug = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    if (!slug) return NextResponse.json({ error: "Username must contain letters or numbers" }, { status: 400 });

    // Admin can specify any warehouse; manager is locked to their own
    const assignedWarehouse = req.role === "admin"
      ? (warehouse_id || null)
      : req.warehouse_id;

    const email = `${slug}${STAFF_DOMAIN}`;

    const { data: created, error: createError } = await svc.auth.admin.createUser({
      email,
      password: pin,
      email_confirm: true,
      user_metadata: { full_name: full_name.trim() },
    });
    if (createError) return NextResponse.json({ error: createError.message }, { status: 400 });

    await svc.from("user_profiles").upsert({
      id:           created.user.id,
      email,
      full_name:    full_name.trim(),
      username:     slug,
      role:         "associate",
      warehouse_id: assignedWarehouse,
      created_at:   new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    }, { onConflict: "id" });

    return NextResponse.json({ ok: true, userId: created.user.id });
  }

  // Invite manager / admin — admin only
  if (req.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email, full_name, role = "manager" } = body;
  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  if (!["manager", "admin"].includes(role)) {
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

// PATCH /api/admin/users — admin only
// Body: { userId, role?, manager_id?, warehouse_id? }
export async function PATCH(httpReq: NextRequest) {
  const req = await getRequester();
  if (!req || req.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await httpReq.json() as {
    userId?: string;
    role?: string;
    manager_id?: string | null;
    warehouse_id?: string | null;
  };
  const { userId, role, manager_id, warehouse_id } = body;
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  if (role && !["associate", "manager", "admin"].includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (role)                     update.role         = role;
  if (manager_id  !== undefined) update.manager_id  = manager_id;
  if (warehouse_id !== undefined) update.warehouse_id = warehouse_id || null;

  const { error } = await service().from("user_profiles").update(update).eq("id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
