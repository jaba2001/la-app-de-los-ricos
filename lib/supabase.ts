import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    _client = createClient(
      url || "https://placeholder.supabase.co",
      key || "placeholder",
      { auth: { persistSession: true, autoRefreshToken: true } }
    );
  }
  return _client;
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop: string) {
    return (getClient() as unknown as Record<string, unknown>)[prop];
  },
});
