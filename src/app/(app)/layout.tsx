import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Protects all (app) routes — redirects to login if unauthenticated.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <>{children}</>;
}
