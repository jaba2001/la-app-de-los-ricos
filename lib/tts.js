// Text-to-speech via ElevenLabs, plus upload to Supabase Storage.
//
// No-ops gracefully when ELEVENLABS_KEY is unset, exactly like lib/email.js: the cron must
// never fail just because voice isn't configured yet. The caller still gets the transcript
// row, just without audio — which is a useful product state on its own (the brief is
// readable before it is listenable).
//
// COST NOTE: ElevenLabs bills by CHARACTER, and its free tier is small. A ~880-char brief
// is ~3.8k chars/month weekly but ~26k/month daily. lib/brief.js exports monthlyChars() so
// the cron can log this; check the current free-tier limit before switching to daily.

const API = "https://api.elevenlabs.io/v1/text-to-speech";
// Rachel — a stock voice available on every plan. Override with ELEVENLABS_VOICE_ID.
const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";
const BUCKET = "briefings";

/**
 * Render text to MP3.
 * @returns {Promise<{ok:boolean, audio?:ArrayBuffer, skipped?:boolean, reason?:string, status?:number}>}
 */
export async function synthesize(text) {
  const key = process.env.ELEVENLABS_KEY;
  if (!key) return { ok: false, skipped: true, reason: "ELEVENLABS_KEY unset" };
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  try {
    const r = await fetch(`${API}/${voice}`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!r.ok) return { ok: false, status: r.status, reason: (await r.text().catch(() => "")).slice(0, 300) };
    return { ok: true, audio: await r.arrayBuffer() };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}

/**
 * Upload an MP3 to the public `briefings` bucket and return its public URL.
 *
 * The bucket must exist and be public — create it once in the Supabase dashboard
 * (Storage → New bucket → name "briefings", Public). Uses upsert so a re-run of the same
 * day's cron replaces the file instead of erroring.
 */
export async function uploadAudio(path, audio) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { ok: false, skipped: true, reason: "Supabase env unset" };
  try {
    const r = await fetch(`${url}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "audio/mpeg",
        "x-upsert": "true",
      },
      body: audio,
    });
    if (!r.ok) return { ok: false, status: r.status, reason: (await r.text().catch(() => "")).slice(0, 300) };
    return { ok: true, publicUrl: `${url}/storage/v1/object/public/${BUCKET}/${path}` };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}
