import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function service() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getRequester(): Promise<{ role: string } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await service()
    .from("user_profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!data || !["admin", "manager"].includes(data.role)) return null;
  return { role: data.role as string };
}

// GET /api/admin/warehouses — list all active warehouses
export async function GET() {
  const req = await getRequester();
  if (!req) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data, error } = await service()
    .from("warehouses")
    .select("*")
    .eq("active", true)
    .order("city");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
