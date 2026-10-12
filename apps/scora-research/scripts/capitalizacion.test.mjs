// Capitalización cuando la cotización no la trae (lib/capitalizacion.ts).
//   node --experimental-strip-types --no-warnings scripts/capitalizacion.test.mjs
import { capitalizacion } from "../lib/capitalizacion.ts";

let bad = 0, total = 0;
const check = (l, got, want) => {
  total++;
  if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.log(`FAIL  ${l}\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`); }
};

check("la de la cotización manda", capitalizacion({ price: 10, marketCap: 500 }, { profile: { marketCap: 999 } }), { valor: 500, fuente: "quote" });
// El caso real: cotización de Yahoo (sin capitalización) con FMP sin cuota.
const yahoo = { price: 341.77, marketCap: null };
check("si no, la del perfil", capitalizacion(yahoo, { profile: { marketCap: 5.1e12 } }), { valor: 5.1e12, fuente: "profile" });
check("el perfil viejo la llama mktCap", capitalizacion(yahoo, { profile: { mktCap: 5e12 } })?.fuente, "profile");
check("sin perfil: precio × acciones en circulación", capitalizacion({ price: 10 }, { sharesFloat: [{ outstandingShares: 3 }] }), { valor: 30, fuente: "shares-float" });
check("sin float: precio × diluidas del último trimestre", capitalizacion({ price: 10 }, { income: [{ weightedAverageShsOutDil: 4 }, { weightedAverageShsOutDil: 9 }] }), { valor: 40, fuente: "income" });
check("sin precio no se inventa", capitalizacion({ price: null }, { income: [{ weightedAverageShsOutDil: 4 }] }), null);
check("ceros y basura no cuentan", capitalizacion({ price: 10, marketCap: 0 }, { profile: { marketCap: "n/a" }, sharesFloat: [{ outstandingShares: -1 }] }), null);
check("sin nada → null", capitalizacion(null, {}), null);

console.log(bad ? `\n✗ capitalizacion: ${bad} fallo(s) de ${total}` : `\n✓ capitalizacion: ${total} comprobaciones OK`);
process.exit(bad ? 1 : 0);
