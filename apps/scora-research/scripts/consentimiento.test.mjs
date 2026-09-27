// La analítica NO arranca sin consentimiento (AUDIT_REPORT A-6).
//   NEXT_PUBLIC_POSTHOG_KEY=x node --experimental-strip-types --no-warnings scripts/consentimiento.test.mjs
//
// PostHog guarda cookie e identificador y liga eventos a una persona: exige consentimiento
// previo. Hasta el 27-09 arrancaba al cargar la página. Aquí se sustituye posthog-js por un
// doble que cuenta las llamadas, y se comprueba que sin "sí" no hay ni init ni capture.
process.env.NEXT_PUBLIC_POSTHOG_KEY = "phc_prueba";

// Un navegador mínimo: lo único que analytics.ts toca es window.localStorage.
const almacen = new Map();
globalThis.window = { localStorage: {
  getItem: (k) => (almacen.has(k) ? almacen.get(k) : null),
  setItem: (k, v) => almacen.set(k, String(v)),
} };

// Doble de posthog-js, registrado antes de importar el módulo.
const llamadas = [];
const doble = { init: () => llamadas.push("init"), capture: (e) => llamadas.push(`capture:${e}`),
  identify: () => llamadas.push("identify"), reset: () => llamadas.push("reset"),
  opt_out_capturing: () => llamadas.push("opt_out") };
const { register } = await import("node:module");
register("data:text/javascript," + encodeURIComponent(`
  export async function resolve(s, c, n) { return s === "posthog-js" ? { url: "doble:posthog", shortCircuit: true } : n(s, c); }
  export async function load(u, c, n) { return u === "doble:posthog" ? { format: "module", source: "export default globalThis.__posthog;", shortCircuit: true } : n(u, c); }
`));
globalThis.__posthog = doble;
const a = await import("../lib/analytics.ts");

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
  }
};

// Sin elección: lo que hace AnalyticsProvider al montar, y un evento cualquiera.
a.initAnalytics(); a.track("tab_opened"); a.identify("uid");
check("sin elegir: ni init, ni capture, ni identify", llamadas, []);
check("sin elegir: el consentimiento es null", a.leerConsentimiento(), null);

// Rechaza: sigue sin nada, y se recuerda.
a.guardarConsentimiento("no"); a.initAnalytics(); a.track("tab_opened");
check("rechaza: nada sale", llamadas, []);
check("rechaza: se recuerda", a.leerConsentimiento(), "no");

// Acepta: arranca y los eventos salen.
a.guardarConsentimiento("si"); a.track("tab_opened");
check("acepta: init y el evento", llamadas, ["init", "capture:tab_opened"]);

// Cambia de opinión: se apaga, se borra lo guardado, y deja de enviar.
llamadas.length = 0;
a.guardarConsentimiento("no"); a.track("tab_opened");
check("retira el consentimiento: opt-out + reset, y nada más", llamadas, ["opt_out", "reset"]);

console.log(bad ? `\n✗ consentimiento: ${bad} fallo(s) de ${total}` : `\n✓ consentimiento: ${total} comprobaciones OK`);
process.exit(bad ? 1 : 0);
