import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const claimsResult = await supabase.auth.getClaims();
  if (!claimsResult.data?.claims?.sub) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });
  const { error } = await supabase.rpc("complete_password_change");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
