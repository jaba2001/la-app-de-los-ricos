import { supabase } from "./supabase";

const BASE = process.env.NEXT_PUBLIC_PROXY_URL ?? "https://ic-proxy-psi.vercel.app";

export async function authedFetch<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.headers as Record<string, string>),
  };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`[proxy ${res.status}] ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}
