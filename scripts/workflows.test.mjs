// ─────────────────────────────────────────────────────────────────────────────
// LOS GUARDIANES SE VIGILAN ENTRE SÍ
//
// ⚠️ ESTE FICHERO EXISTE POR UN FALLO REAL QUE DURÓ CINCO DÍAS. El workflow de tests estuvo
// **rojo desde el 29-08 hasta el 03-09**, fallando en 0 segundos —antes de ejecutar nada— y
// nadie se enteró, porque `npm run test:all` seguía en verde en local. La causa: un carácter
// de control 0x08 en el YAML, un `\b` que el shell convirtió en un byte de retroceso al
// escribir un comentario que explicaba, precisamente, que `\b` no funciona tras una vocal
// acentuada. GitHub rechaza el fichero entero y el error no aparece en ningún log de paso.
//
// La lección no es «cuidado con los escapes». Es que **un guardián que deja de vigilar no
// falla: calla.** Si la única señal de que el CI vive es mirarlo a mano, no hay señal. Así que
// ahora el CI valida los YAML y `test:all` valida que el CI ejecuta lo que dice ejecutar.
//
// Comprueba cuatro cosas, y las cuatro han fallado de verdad alguna vez en este repo:
//   1. Ningún workflow lleva caracteres de control — el fallo silencioso de 0 segundos.
//   2. Todos parsean como YAML y tienen pasos.
//   3. Cada test de `test:all` está también en el CI. Un test que sólo corre en local no
//      vigila las ramas de nadie más.
//   4. Cada test del CI existe en disco. Un `run:` que apunta a un fichero borrado falla
//      tarde y ruidoso, que es mejor que callar, pero se caza antes aquí.
//
//   node --experimental-strip-types --no-warnings scripts/workflows.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };

const DIR = ".github/workflows";
// Construido con RegExp para que ningun escape tenga que sobrevivir a un heredoc.
const NUEVA_LINEA = new RegExp(String.fromCharCode(92) + "r?" + String.fromCharCode(92) + "n");
const ficheros = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));
ok(ficheros.length > 0, "hay workflows que vigilar");

// ── 1. Caracteres de control: el fallo que no deja rastro en ningún log ──────────────────
for (const f of ficheros) {
  const s = readFileSync(join(DIR, f), "utf8");
  const malos = [...s].map((c, i) => [c.codePointAt(0), i])
    .filter(([c]) => c < 32 && c !== 10 && c !== 13 && c !== 9);
  if (malos.length) {
    const [code, i] = malos[0];
    const linea = s.slice(0, i).split("\n").length;
    ok(false, `${f} lleva ${malos.length} caracter(es) de control — el primero 0x${code.toString(16).padStart(2, "0")} en la linea ${linea}. GitHub rechaza el fichero entero y falla en 0 s.`);
  } else pass++;
}

// ── 2. Estructura mínima, sin traerse un parser de YAML ──────────────────────────────────
// No hace falta parsear de verdad para cazar lo que rompe: basta con que cada `- name:` tenga
// su `run:` o su `uses:`, y que la indentación de los pasos sea consistente.
for (const f of ficheros) {
  const s = readFileSync(join(DIR, f), "utf8");
  ok(/^on:/m.test(s) || /^"on":/m.test(s), `${f} declara cuando se dispara`);
  ok(/^jobs:/m.test(s), `${f} declara jobs`);
  const nombres = (s.match(/^\s+- name:/gm) ?? []).length;
  const acciones = (s.match(/^\s+(run|uses):/gm) ?? []).length;
  ok(acciones >= nombres, `${f}: ${nombres} pasos con nombre y ${acciones} con accion — ninguno se queda sin hacer nada`);
  ok(!/\t/.test(s), `${f} no usa tabuladores (YAML los rechaza para indentar)`);
}

// ── 3 y 4. EL CI Y test:all SE VIGILAN ENTRE SÍ ──────────────────────────────────────────
// Este es el bloque que importa. Un test cableado sólo a `test:all` no vigila las ramas de
// nadie; uno cableado sólo al CI no se ejecuta antes de commitear. Tienen que estar en los dos.
{
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const todos = pkg.scripts["test:all"] ?? "";
  const guiones = Object.entries(pkg.scripts)
    .filter(([k]) => k.startsWith("test:") && k !== "test:all")
    .filter(([k]) => todos.includes(k));

  const ci = readFileSync(join(DIR, "scora-tests.yml"), "utf8");
  ok(guiones.length > 10, `test:all encadena ${guiones.length} tests`);

  for (const [nombre, cmd] of guiones) {
    const m = cmd.match(/scripts\/[\w.-]+\.mjs/);
    if (!m) continue;
    ok(ci.includes(m[0]), `${m[0]} (${nombre}) esta en test:all PERO NO en el CI — solo vigilaria tu maquina`);
    ok(existsSync(m[0]), `${m[0]} existe en disco`);
  }

  // Y al reves: todo lo que el CI dice ejecutar tiene que existir.
  for (const ruta of new Set(ci.match(/scripts\/[\w.-]+\.mjs/g) ?? []))
    ok(existsSync(ruta), `el CI ejecuta ${ruta}, que NO existe en disco`);
}

/**
 * CLAVES DUPLICADAS DENTRO DE UN MISMO PASO.
 *
 * ⚠️ NACE DE UN FALLO MIO DE HOY. Añadi un bloque `env:` a un paso de `scora-picks.yml` que YA
 * TENIA otro, con las credenciales dentro. YAML generico se lo traga en silencio quedandose
 * con el ultimo, asi que el fichero «parseaba»; GitHub lo rechaza y el run muere en 0 segundos,
 * que es la firma que ya nos costo cinco dias de CI en rojo. Y de haberlo aceptado seria PEOR:
 * el segundo `env` habria sustituido al primero, dejando el cron sin `SUPABASE_SERVICE_KEY`.
 * O sea, un «seguro» que rompia justo lo que venia a proteger.
 *
 * Estos 159 asertos no lo vieron. Por eso este.
 */
for (const f of ficheros) {
  const lineas = readFileSync(`${DIR}/${f}`, "utf8").split(NUEVA_LINEA);
  // Un paso empieza en `- name:` o `- uses:`; dentro de el, ninguna clave de primer nivel
  // (misma sangria) puede repetirse.
  let sangriaPaso = null, vistas = new Map(), paso = "?", dupes = [];
  const cerrar = () => { vistas = new Map(); };
  for (let n = 0; n < lineas.length; n++) {
    const l = lineas[n];
    if (!l.trim() || l.trim().startsWith("#")) continue;
    const sangria = l.length - l.trimStart().length;
    const inicio = l.trim().match(/^-\s+(name|uses):\s*(.*)$/);
    if (inicio) { cerrar(); sangriaPaso = sangria + 2; paso = inicio[2].slice(0, 40) || inicio[1]; continue; }
    if (sangriaPaso == null) continue;
    if (sangria < sangriaPaso) { cerrar(); sangriaPaso = null; continue; }
    if (sangria !== sangriaPaso) continue;
    const clave = l.trim().match(/^([A-Za-z_][\w-]*):/);
    if (!clave) continue;
    if (vistas.has(clave[1])) dupes.push(`${f}: «${paso}» repite «${clave[1]}» (lineas ${vistas.get(clave[1])} y ${n + 1})`);
    else vistas.set(clave[1], n + 1);
  }
  ok(dupes.length === 0, dupes.join(" · ") || `${f} sin claves duplicadas en ningun paso`);
}


console.log(pass && !fail ? `\n✓ workflows: ${pass} passed, 0 failed\n` : `\n✖ workflows: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
