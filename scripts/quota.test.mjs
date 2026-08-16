// Tests de la cuota diaria de IA.
// Run: node scripts/quota.test.mjs
//
// Las comprobaciones de dailyLimit son puras. Las del contador usan el Upstash REAL cuando
// hay credenciales (.env.local), con un id de usuario de usar y tirar que se borra al
// final: un simulacro de Redis probaría mi simulacro, no que INCR sea atómico ni que la
// expiración se ponga donde debe, que es justo lo que puede fallar aquí.
import { readFileSync, existsSync } from "fs";
import { dailyLimit, checkDailyQuota, peekDailyQuota } from "../lib/quota.js";

let passed = 0, failed = 0;
const fails = [];
const ok = (c, m) => { if (c) passed++; else { failed++; fails.push(m); } };

// ── dailyLimit: puro, gobernado por entorno ─────────────────────────────────────
{
  const save = { free: process.env.AI_DAILY_FREE, pro: process.env.AI_DAILY_PRO };
  delete process.env.AI_DAILY_FREE; delete process.env.AI_DAILY_PRO;

  ok(dailyLimit(false) === 5, `sin configurar, free = 5 (fue ${dailyLimit(false)})`);
  ok(dailyLimit(true) === 100, `sin configurar, pro = 100 (fue ${dailyLimit(true)})`);
  ok(dailyLimit(true) > dailyLimit(false), "pro siempre por encima de free");

  process.env.AI_DAILY_FREE = "3"; process.env.AI_DAILY_PRO = "250";
  ok(dailyLimit(false) === 3 && dailyLimit(true) === 250, "el entorno manda sobre el defecto");

  // Valores rotos: un '0' dejaría el producto inservible y un 'abc' se leería como NaN.
  // En ambos casos vale más el defecto conocido que un límite absurdo aplicado en silencio.
  for (const malo of ["0", "-5", "abc", "", "2.5", "Infinity"]) {
    process.env.AI_DAILY_FREE = malo;
    ok(dailyLimit(false) === 5, `AI_DAILY_FREE="${malo}" cae al defecto (fue ${dailyLimit(false)})`);
  }

  if (save.free === undefined) delete process.env.AI_DAILY_FREE; else process.env.AI_DAILY_FREE = save.free;
  if (save.pro === undefined) delete process.env.AI_DAILY_PRO; else process.env.AI_DAILY_PRO = save.pro;
}

// ── Sin Redis: FAIL-OPEN ────────────────────────────────────────────────────────
{
  const save = { u: process.env.UPSTASH_REDIS_REST_URL, t: process.env.UPSTASH_REDIS_REST_TOKEN };
  delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;

  const r = await checkDailyQuota("u-sin-redis", false, null);
  ok(r.limited === null, "sin Upstash se deja pasar (fail-open), no se bloquea el producto");
  ok(r.limit === 5, "aun degradado informa del límite que tocaría");

  const p = await peekDailyQuota("u-sin-redis", false);
  ok(p.used === 0 && p.remaining === 5, "peek degradado no inventa consumo");

  if (save.u) process.env.UPSTASH_REDIS_REST_URL = save.u;
  if (save.t) process.env.UPSTASH_REDIS_REST_TOKEN = save.t;
}

// ── Contador real contra Upstash ────────────────────────────────────────────────
// Se cargan las credenciales de .env.local si no vienen ya en el entorno.
if (!process.env.UPSTASH_REDIS_REST_URL && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^(UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

const tieneRedis = !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
if (!tieneRedis) {
  console.log("  (sin credenciales de Upstash — se omiten las comprobaciones del contador)");
} else {
  const saveFree = process.env.AI_DAILY_FREE;
  process.env.AI_DAILY_FREE = "3";
  // Id irrepetible: si el test se corta a medias, no deja basura que afecte a la siguiente
  // ejecución ni, mucho menos, a un usuario real.
  const uid = `test-quota-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const r1 = await checkDailyQuota(uid, false, null);
  ok(r1.limited === null && r1.used === 1, `1ª llamada pasa y cuenta 1 (used=${r1.used})`);

  const r2 = await checkDailyQuota(uid, false, null);
  ok(r2.limited === null && r2.used === 2, `2ª llamada pasa y cuenta 2 (used=${r2.used})`);

  const peek = await peekDailyQuota(uid, false);
  ok(peek.used === 2 && peek.remaining === 1, `peek ve 2 usadas y 1 restante (${JSON.stringify(peek)})`);

  const r3 = await checkDailyQuota(uid, false, null);
  ok(r3.limited === null, "3ª llamada, la última permitida, pasa");

  const peekTrasConsumir = await peekDailyQuota(uid, false);
  ok(peekTrasConsumir.remaining === 0, "peek NO consume: sigue en 0 restantes tras mirarlo dos veces");

  const r4 = await checkDailyQuota(uid, false, null);
  ok(r4.limited !== null, "4ª llamada se rechaza");
  ok(r4.limited?.status === 429, `el rechazo es 429 (fue ${r4.limited?.status})`);

  const body = await r4.limited.json();
  ok(body.limit === 3, "el cuerpo dice cuál es el límite");
  ok(body.used === 3, `el cuerpo dice cuántas se han usado, sin contar la rechazada (fue ${body.used})`);
  ok(body.plan === "free", "el cuerpo dice el plan");
  ok(body.upgrade_url === "/pricing", "a un usuario gratuito se le ofrece la salida");
  ok(typeof body.resets_at === "string" && !Number.isNaN(Date.parse(body.resets_at)),
    "el cuerpo trae una fecha de reinicio válida");
  ok(/UTC/.test(body.error), "el mensaje dice en qué huso se reinicia, para que no parezca un fallo");

  const retry = Number(r4.limited.headers.get("Retry-After"));
  ok(retry > 0 && retry <= 86400, `Retry-After es un resto de día razonable (${retry}s)`);
  ok(r4.limited.headers.get("X-Scora-Quota-Remaining") === "0", "la cabecera de restantes va a 0");

  // Un usuario Pro con el mismo contador NO se ve afectado por el tope gratuito: el límite
  // se resuelve por plan en cada llamada, no se congela en la clave.
  const rPro = await checkDailyQuota(uid, true, null);
  ok(rPro.limited === null, "el mismo usuario como Pro sigue pasando pese al contador alto");
  ok(rPro.limit === 100, `y su límite es el de Pro (${rPro.limit})`);

  // Cada usuario cuenta por separado.
  const otro = await checkDailyQuota(`${uid}-otro`, false, null);
  ok(otro.used === 1, "el contador es por usuario, no global");

  // Limpieza: se borran las claves de prueba para no dejar residuo en una instancia que
  // está en noeviction y comparte espacio con el limitador de peticiones.
  try {
    const { Redis } = await import("@upstash/redis");
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    const day = new Date().toISOString().slice(0, 10);
    const borradas = await redis.del(`q:ai:${day}:${uid}`, `q:ai:${day}:${uid}-otro`);
    ok(borradas === 2, `limpieza: ${borradas}/2 claves de prueba borradas`);
  } catch (e) {
    ok(false, `limpieza falló: ${e?.message ?? e}`);
  }

  if (saveFree === undefined) delete process.env.AI_DAILY_FREE; else process.env.AI_DAILY_FREE = saveFree;
}

console.log(failed === 0
  ? `\n✓ quota: ${passed} passed, 0 failed${tieneRedis ? " (contador probado contra Upstash real)" : ""}\n`
  : `\n✗ quota: ${passed} passed, ${failed} failed\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n`);
process.exit(failed ? 1 : 0);
