// Spoken macro brief (Fase 10).
//
// Reads the latest macro_state snapshot, builds a script from it DETERMINISTICALLY
// (lib/brief.js — no LLM, so no figure can be invented), renders it to MP3 if a TTS key is
// configured, and stores the row in sl_briefings.
//
// Runtime is nodejs, not edge, because the TTS response is a binary body that gets piped
// straight into a Storage upload.
//
// Every external dependency degrades independently:
//   · no ELEVENLABS_KEY  → transcript stored, audio_url null (readable, not listenable)
//   · TTS or upload fails → same, plus the reason is reported
//   · no macro_state row  → 503, nothing written
// The brief being text-only is a legitimate product state, so none of these is an error
// worth failing the cron over.
import { assertCron } from '../../../../lib/server/cron.js';
import { buildBriefScript, monthlyChars } from '../../../../lib/server/brief.js';
import { synthesize, uploadAudio } from '../../../../lib/server/tts.js';
import { sbFetch } from "../../../../lib/server/data/postgrest.js";

export const runtime = 'nodejs';

const CADENCE = process.env.BRIEF_CADENCE === 'daily' ? 'daily' : 'weekly';
// Rough spoken rate for an English TTS voice; only used for the UI's duration hint.
const CHARS_PER_SEC = 15;

const sb = (path, init = {}) =>
  sbFetch(`${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      ...(init.headers || {}),
    },
  });

export async function GET(request) {
  const denied = assertCron(request); if (denied) return denied;
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'Supabase env missing' }, 503);
  }

  // 1 · latest snapshot
  const r = await sb('macro_state?select=*&order=snapshot_date.desc&limit=1');
  if (!r.ok) return json({ error: 'macro_state read failed', status: r.status }, 502);
  const rows = await r.json().catch(() => []);
  const macro = Array.isArray(rows) ? rows[0] : null;
  if (!macro) return json({ error: 'no macro_state row' }, 503);

  // 2 · script (deterministic)
  let script, chars, asOf;
  try {
    ({ script, chars, asOf } = buildBriefScript(macro, { cadence: CADENCE }));
  } catch (e) {
    return json({ error: 'script build failed', reason: e?.message ?? String(e) }, 500);
  }

  const briefDate = new Date().toISOString().slice(0, 10);
  const notes = [];

  // 3 · audio (best effort)
  let audioUrl = null;
  const tts = await synthesize(script);
  if (tts.ok) {
    const up = await uploadAudio(`${CADENCE}-${briefDate}.mp3`, tts.audio);
    if (up.ok) audioUrl = up.publicUrl;
    else notes.push(`upload: ${up.reason ?? up.status}`);
  } else {
    notes.push(`tts: ${tts.reason ?? tts.status}`);
  }

  // 4 · persist. Upsert on (brief_date, cadence) so a re-run replaces rather than duplicates.
  const w = await sb('sl_briefings?on_conflict=brief_date,cadence', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      brief_date: briefDate,
      cadence: CADENCE,
      transcript: script,
      audio_url: audioUrl,
      chars,
      duration_sec: Math.round(chars / CHARS_PER_SEC),
      macro_snapshot_date: asOf,
    }),
  });
  if (!w.ok) {
    return json({ error: 'sl_briefings write failed', status: w.status, detail: (await w.text().catch(() => '')).slice(0, 300) }, 502);
  }

  return json({
    ok: true,
    cadence: CADENCE,
    brief_date: briefDate,
    macro_snapshot_date: asOf,
    chars,
    monthly_chars_estimate: monthlyChars(chars, CADENCE),
    audio: !!audioUrl,
    notes,
  });
}
