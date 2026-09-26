"use client";
// Spoken macro brief (Fase 10).
//
// Renders the latest row of sl_briefings: a play button when audio exists, and the
// transcript either way. Audio is optional by design — the cron writes the transcript even
// when no TTS key is configured, so this component must be useful without it. It renders
// nothing at all when there is no brief yet, rather than showing an empty shell.
//
// Every figure in the transcript comes from a macro_state snapshot via a deterministic
// template (lib/server/brief.js); there is no model in that path, which is why this can
// be shown verbatim without passing the grounding gate.
import { useEffect, useRef, useState } from "react";
import { datos } from "@/lib/dataClient";
import { track } from "@/lib/analytics";

interface Briefing {
  brief_date: string;
  cadence: string;
  transcript: string;
  audio_url: string | null;
  duration_sec: number | null;
  macro_snapshot_date: string | null;
}

function mmss(sec: number | null): string {
  if (!sec || sec <= 0) return "";
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}:${String(s).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

export default function MacroBrief() {
  const [brief, setBrief] = useState<Briefing | null>(null);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    datos
      .from("sl_briefings")
      .select("brief_date,cadence,transcript,audio_url,duration_sec,macro_snapshot_date")
      .order("brief_date", { ascending: false })
      .limit(1)
      .then(({ data }) => { if (data?.length) setBrief(data[0] as Briefing); })
      // The table may not exist yet on an older deploy; a missing brief is not an error.
      .then(undefined, () => {});
  }, []);

  if (!brief) return null;

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) { el.play().catch(() => {}); track("brief_played", { date: brief!.brief_date }); }
    else el.pause();
  }

  return (
    <div style={{
      background: "var(--sr-surface)", border: "1px solid var(--sr-border)",
      borderRadius: "var(--sr-radius-lg, 14px)", padding: "var(--sr-sp-4)",
      margin: "var(--sr-sp-4) var(--sr-sp-6) 0",
    }}>
      <div className="sr-flex-between" style={{ gap: "var(--sr-sp-3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sr-sp-3)", minWidth: 0 }}>
          {brief.audio_url && (
            <button
              onClick={toggle} aria-label={playing ? "Pause the brief" : "Play the brief"}
              style={{
                flexShrink: 0, width: 38, height: 38, borderRadius: "50%", border: "none",
                background: "var(--sr-amber)", color: "#0a1120", cursor: "pointer",
                fontSize: 15, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              {playing ? "❚❚" : "▶"}
            </button>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--sr-t-sm)", fontWeight: 700 }}>
              {brief.cadence === "daily" ? "Daily" : "Weekly"} macro brief
            </div>
            {/* No "text only" caption when there's no audio: text IS the intended state,
                and labelling it reads as an apology for a missing feature. The play button
                simply isn't there, which says everything it needs to. */}
            <div className="sr-hint">
              {brief.brief_date}
              {brief.audio_url && brief.duration_sec ? ` · ${mmss(brief.duration_sec)}` : ""}
            </div>
          </div>
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            flexShrink: 0, background: "var(--sr-surface-2)", border: "1px solid var(--sr-border)",
            borderRadius: "var(--sr-radius)", color: "var(--sr-text-2)",
            fontSize: "var(--sr-t-xs)", padding: "5px 10px", cursor: "pointer",
          }}
        >
          {open ? "Hide transcript" : "Read it"}
        </button>
      </div>

      {brief.audio_url && (
        <audio
          ref={audioRef} src={brief.audio_url} preload="none"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        />
      )}

      {open && (
        <div style={{
          marginTop: "var(--sr-sp-3)", paddingTop: "var(--sr-sp-3)",
          borderTop: "1px solid var(--sr-border)", fontSize: "var(--sr-t-sm)",
          color: "var(--sr-text-2)", lineHeight: 1.65, whiteSpace: "pre-wrap",
        }}>
          {brief.transcript}
        </div>
      )}
    </div>
  );
}
