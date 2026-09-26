// Web Push (client). Subscribes the browser to push via the PWA service worker and stores
// the subscription in Supabase (RLS: owner-only). El cron que las envia (app/api/cron/push-alerts) reads these and
// pushes regime alerts. Needs NEXT_PUBLIC_VAPID_PUBLIC_KEY (the public half of a free VAPID
// keypair); until it's set, enablePush() reports "not configured" and the UI stays hidden.
import { auth } from "./firebaseClient";
import { datos } from "./dataClient";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

export function pushConfigured(): boolean { return !!VAPID_PUBLIC; }
export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
export function pushPermission(): NotificationPermission | "unsupported" {
  return pushSupported() ? Notification.permission : "unsupported";
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export async function isSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false;
  try { const reg = await navigator.serviceWorker.ready; return !!(await reg.pushManager.getSubscription()); }
  catch { return false; }
}

export async function enablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: false, error: "Push isn't supported in this browser." };
  if (!VAPID_PUBLIC) return { ok: false, error: "Alerts aren't configured yet." };
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return { ok: false, error: "Notifications were blocked. Enable them in your browser settings." };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource });
    const json = sub.toJSON();
    const user = auth().currentUser;
    if (!user || !json.endpoint || !json.keys) return { ok: false, error: "Couldn't save the subscription." };
    const { error } = await datos.from("push_subscriptions").upsert(
      { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth, user_id: user.uid },
      { onConflict: "endpoint" }
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Subscription failed." }; }
}

export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { const ep = sub.endpoint; await sub.unsubscribe(); await datos.from("push_subscriptions").delete().eq("endpoint", ep); }
  } catch { /* best effort */ }
}
