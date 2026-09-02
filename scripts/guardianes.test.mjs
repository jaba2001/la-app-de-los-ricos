// ─────────────────────────────────────────────────────────────────────────────
// LOS GUARDIANES, VIGILADOS
//
// Un guardián es código que casi siempre pasa. Cuando deja de vigilar no falla: contesta que
// todo va bien. Es exactamente el patrón que este repo ya ha pagado tres veces —el no-op de
// §11, la huella que caducaba a medianoche, `sin datos` heredado como seguro—, y un guardián
// sin tests es la versión de ese patrón aplicada a la propia red de seguridad.
//
// Aquí se fija:
//   1. Que `variantes_identicas` distingue REGISTROS de VARIANTES. Se relajó el 2026-09-02
//      porque PCG y EIX —las dos eléctricas de California— cayeron −24,6022 % y −24,5984 % en
//      la misma semana y el guardián lo daba por no-op. Relajar un guardián es peligroso, así
//      que estos tests fijan las TRES direcciones, no sólo la que se arregló.
//   2. Que lo que corre CI y lo que corre `npm run test:all` son la misma lista. El 2026-09-02
//      no lo eran: `datos.test.mjs` sólo corría en CI (verde en local, rojo tras empujar) y
//      `smoke-proxy.mjs` sólo en local — o sea que el contrato de 39 rutas del proxy NO se
//      comprobaba antes de llegar a main.
//
//   node --experimental-strip-types --no-warnings scripts/guardianes.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(RAIZ, "research", "out");

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`  ✖ ${msg}`); } };

// ── 1 · variantes_identicas: registros ≠ variantes ───────────────────────────────────────
// Se corre el guardián de verdad contra un artefacto de prueba. Probar la función suelta no
// valdría: lo que falló era el recorrido completo sobre un JSON real.
const corre = (nombre, contenido) => {
  const f = join(OUT, `_test_${nombre}.json`);
  writeFileSync(f, JSON.stringify(contenido), "utf8");
  try {
    execFileSync(process.execPath,
      ["--experimental-strip-types", "--no-warnings", "research/variantes_identicas.mjs"],
      { cwd: RAIZ, stdio: "pipe" });
    return { code: 0, salida: "" };
  } catch (e) {
    return { code: e.status ?? 1, salida: String(e.stdout ?? "") + String(e.stderr ?? "") };
  } finally {
    if (existsSync(f)) unlinkSync(f);
  }
};

const fila = (ticker) => ({ ticker, pct: -24.6, sesiones: 6, huecos: 0 });

// Dos entidades DISTINTAS con los mismos números: coincidencia del mundo, no un no-op.
// Es el caso PCG/EIX, y el que hacía rojo el CI sin que hubiera ningún fallo.
{
  const r = corre("coincidencia", { ventanas: { "1s": { perdedores: [fila("PCG"), fila("EIX")] } } });
  ok(r.code === 0, `dos entidades distintas con los mismos números no son un hallazgo (salió ${r.code})`);
}

// La MISMA entidad dos veces: eso sí es un fallo, y antes no lo veía en absoluto.
{
  const r = corre("duplicado", { ventanas: { "1s": { perdedores: [fila("PCG"), fila("PCG")] } } });
  ok(r.code === 1, "la misma entidad dos veces tiene que fallar");
  ok(/MISMA ENTIDAD/.test(r.salida), "y decir que es una entidad duplicada, no una variante");
}

// Y el caso original de §11, que no lleva identidad: tiene que seguir cazándose.
// Si esto se rompe, la relajación de arriba habrá dejado ciego al guardián.
{
  const r = corre("s11", {
    benchmarks: {
      universoEW: { retorno: 174.3, sharpe: 0.77, maxDD: -30.1 },
      universoEWSinFinancieros: { retorno: 174.3, sharpe: 0.77, maxDD: -30.1 },
    },
  });
  ok(r.code === 1, "el no-op de §11 (dos ramas sin identidad, idénticas) sigue fallando");
  ok(/universoEWSinFinancieros/.test(r.salida), "y nombra la rama que coincide");
}

// Una identidad presente en un lado y ausente en el otro NO desactiva la comparación: si
// bastara con que a una fila le falte el ticker para saltarse el guardián, el hueco sería justo
// el sitio donde se esconde un no-op.
{
  const r = corre("media", {
    grupo: {
      a: { ticker: "PCG", retorno: 174.3, sharpe: 0.77, maxDD: -30.1 },
      b: { retorno: 174.3, sharpe: 0.77, maxDD: -30.1 },
    },
  });
  ok(r.code === 1, "con identidad en un solo lado se sigue comparando");
}

// ── 2 · CI y test:all corren lo mismo ────────────────────────────────────────────────────
const scripts = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")).scripts ?? {};

/** Expande `test:all` siguiendo los `npm run` anidados hasta los ficheros que ejecuta. */
const deTestAll = () => {
  const vistos = new Set(), yaVisto = new Set();
  const exp = (n) => {
    if (yaVisto.has(n)) return;
    yaVisto.add(n);
    for (const parte of (scripts[n] ?? "").split("&&").map((x) => x.trim())) {
      if (parte.startsWith("npm run ")) exp(parte.slice(8).trim());
      else { const m = parte.match(/(?:scripts|research)\/[\w-]+\.(?:test\.)?mjs/); if (m) vistos.add(m[0]); }
    }
  };
  exp("test:all");
  return vistos;
};

const wf = readFileSync(join(RAIZ, ".github", "workflows", "scora-tests.yml"), "utf8");
const deCI = new Set((wf.match(/(?:scripts|research)\/[\w-]+\.(?:test\.)?mjs/g) ?? []));

// Lo que legítimamente corre en un solo sitio, con su motivo escrito. Sin motivo no entra: una
// lista muda de excepciones es donde se esconde justo lo que esto busca.
const SOLO_CI = new Map([]);
const SOLO_LOCAL = new Map([]);

const enCInoLocal = [...deCI].filter((f) => !deTestAll().has(f) && !SOLO_CI.has(f));
const enLocalNoCI = [...deTestAll()].filter((f) => !deCI.has(f) && !SOLO_LOCAL.has(f));

ok(enCInoLocal.length === 0,
   `corre en CI pero no en test:all (verde en local, rojo tras empujar): ${enCInoLocal.join(", ")}`);
ok(enLocalNoCI.length === 0,
   `corre en test:all pero no en CI (un fallo llega a main sin que nadie lo vea): ${enLocalNoCI.join(", ")}`);
ok(deCI.size >= 15, `CI tiene que correr al menos 15 comprobaciones, tiene ${deCI.size}`);

// El typecheck no es un .mjs y se escapaba del contraste de arriba: estaba en CI y no en
// test:all, o sea la misma asimetría con otra cara. Se comprueba aparte.
const ciTypecheck = /tscs+--noEmit/.test(wf);
const localTypecheck = /typecheck/.test(scripts["test:all"] ?? "") && /tscs+--noEmit/.test(scripts.typecheck ?? "");
ok(!ciTypecheck || localTypecheck, "si CI hace typecheck, test:all también tiene que hacerlo");

console.log(`\n${fail ? "✖" : "✓"} guardianes: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
