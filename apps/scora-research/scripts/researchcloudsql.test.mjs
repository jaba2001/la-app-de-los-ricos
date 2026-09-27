// Los workflows de research escriben en Cloud SQL, no en Supabase (AUDIT_REPORT C-5).
//   node --experimental-strip-types --no-warnings scripts/researchcloudsql.test.mjs
//
// Estático, sin base ni red: vigila las tres piezas que tienen que casar para que un workflow
// escriba, y que por separado no fallan hasta el día en que corre el cron.
//   1. Ningún script de research vuelve a hablar con la API de Supabase.
//   2. Cada workflow que pasa credenciales de Postgres también instala `pg`, pide el token de
//      OIDC y abre el proxy. Si falta uno, el cron falla — el lunes a las 6, sin nadie mirando.
//   3. sql/gcp/006_rol_jobs.sql da permiso a toda tabla que los scripts tocan. Una tabla nueva
//      sin su GRANT daba «permission denied» solo en producción (en local se usa postgres).
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = join(AQUI, "..");
const WF = join(APP, "..", "..", ".github", "workflows");

let bad = 0, total = 0;
const ok = (c, m) => { total++; if (!c) { bad++; console.log(`FAIL  ${m}`); } };

// Los scripts que lanzan los workflows, sacados de los propios workflows (no de una lista a mano).
const workflows = readdirSync(WF).filter((f) => f.endsWith(".yml"))
  .map((f) => ({ f, s: readFileSync(join(WF, f), "utf8") }));
const scripts = new Set();
for (const { s } of workflows) for (const m of s.matchAll(/research\/([\w-]+\.mjs)/g)) scripts.add(m[1]);
ok(scripts.size >= 9, `los workflows lanzan ${scripts.size} scripts de research (se esperaban al menos 9)`);

// ── 1 ─────────────────────────────────────────────────────────────────────────────────
const tablasTocadas = new Map();
for (const f of scripts) {
  const s = readFileSync(join(APP, "research", f), "utf8");
  ok(!/rest\/v1|SUPABASE_SERVICE_KEY|supabase\.co/.test(s), `research/${f} ya no habla con Supabase`);
  for (const m of s.matchAll(/sbFetch\(`([a-z_]+)[?`]/g)) tablasTocadas.set(m[1], f);
  // cron-picks e ingest_filings construyen la ruta con una variable: sus tablas se leen aparte.
  for (const m of s.matchAll(/sb\(`([a-z_]+)[?`]/g)) tablasTocadas.set(m[1], f);
  for (const m of s.matchAll(/upsert\("([a-z_]+)"/g)) tablasTocadas.set(m[1], f);
}
ok(tablasTocadas.size >= 10, `se reconocen ${tablasTocadas.size} tablas tocadas por los scripts`);

// ── 2 ─────────────────────────────────────────────────────────────────────────────────
for (const { f, s } of workflows) {
  if (!/secrets\.PGPASSWORD/.test(s)) continue;
  ok(!/SUPABASE/.test(s), `${f} no pasa claves de Supabase`);
  ok(/npm ci/.test(s), `${f} instala dependencias (pg)`);
  ok(/id-token:\s*write/.test(s), `${f} pide el token de OIDC (id-token: write)`);
  ok(/uses:\s*\.\/\.github\/actions\/cloud-sql/.test(s), `${f} abre el proxy de Cloud SQL`);
  ok(/PGHOST:\s*127\.0\.0\.1/.test(s), `${f} apunta al proxy local`);
}

// ── 3 ─────────────────────────────────────────────────────────────────────────────────
const rol = readFileSync(join(APP, "sql", "gcp", "006_rol_jobs.sql"), "utf8").replace(/--.*$/gm, "");
const concedidas = new Set([...rol.matchAll(/public\.([a-z_]+)/g)].map((m) => m[1]));
for (const [t, f] of tablasTocadas) ok(concedidas.has(t), `006_rol_jobs.sql concede ${t} (lo usa research/${f})`);
// Y lo que no debe: ninguna tabla con datos de usuarios.
for (const t of ["sl_journal", "sl_watchlist", "sl_alerts", "sl_alert_prefs", "sl_analyses", "push_subscriptions", "sl_waitlist", "ai_audit_log", "sl_subscriptions"]) {
  ok(!concedidas.has(t), `006_rol_jobs.sql NO concede ${t} (datos de usuarios)`);
}

console.log(bad ? `\n✗ researchcloudsql: ${bad} fallo(s) de ${total}` : `\n✓ researchcloudsql: ${total} comprobaciones OK`);
process.exit(bad ? 1 : 0);
