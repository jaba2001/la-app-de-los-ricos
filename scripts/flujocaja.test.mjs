// ─────────────────────────────────────────────────────────────────────────────
// LA CAPA DE CAJA
//
// Lo que fija este fichero no es que los ratios se calculen —eso es aritmética— sino las tres
// cosas que se pueden hacer mal y quedan bonitas:
//
//   1. Que un dato AUSENTE no se convierta en un cero con forma de respuesta.
//   2. Que no se lea el estado financiero de un banco con la plantilla de una industrial. La
//      prueba con datos reales cazó exactamente esto: JPMorgan salía con conversión −1,83 y
//      bandera roja, cuando en un banco el flujo operativo negativo es NORMAL porque prestar es
//      su operación.
//   3. Que el desglose de a dónde va la caja CUADRE con la variación declarada, o no se publique.
//
//   node --experimental-strip-types --no-warnings scripts/flujocaja.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { diagnosticar, banderas, puente, destino, esFinanciera, sankeyCaja, UMBRALES } from "../lib/flujoCaja.ts";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error(`  ✖ ${m}`); } };
const cerca = (a, b, tol, m) => ok(a != null && Math.abs(a - b) <= tol, `${m} — esperado ${b}, salió ${a}`);
const tiene = (bs, clave) => bs.some((x) => x.clave === clave);

// Una industrial sana, con números redondos para poder comprobar a mano.
const SANA = {
  niTTM: 100, ocfTTM: 140, capexTTM: 40, daTTM: 30, sbcTTM: 15, revTTM: 1000,
  buybacksTTM: 30, dividendsTTM: 20, cfiTTM: -50, cffTTM: -60, fxCashTTM: 0,
  deltaCashConFxTTM: 30, receivables: 100, inventory: 80, marketCap: 2000,
  prev: { revTTM: 900, receivables: 92, inventory: 74, ocfTTM: 120, niTTM: 90 },
};

// ── Diagnóstico ──────────────────────────────────────────────────────────────────────────
{
  const d = diagnosticar(SANA);
  cerca(d.cashConversion, 1.4, 1e-9, "cash conversion = CFO / beneficio = 140/100");
  cerca(d.margenCFO, 0.14, 1e-9, "margen CFO = 140/1000");
  cerca(d.fcf, 100, 1e-9, "FCF = CFO - capex = 140-40");
  cerca(d.fcfYield, 0.05, 1e-9, "FCF yield = 100/2000 = 5 % (el umbral que el material llama atractivo)");
  cerca(d.precioSobreCFO, 2000 / 140, 1e-9, "precio / CFO");
  cerca(d.capexSobreVentas, 0.04, 1e-9, "capex / ventas");
  cerca(d.crecimientoCFO, 140 / 120 - 1, 1e-9, "crecimiento del CFO");
  ok(!d.financiera, "una industrial no es financiera");
}

// ── LO QUE MÁS IMPORTA (1): ausente NO es cero ───────────────────────────────────────────
{
  const d = diagnosticar({ niTTM: 100, ocfTTM: 140 });
  ok(d.fcf === null, "sin capex NO hay FCF — no se asume capex cero");
  ok(d.margenCFO === null, "sin ventas no hay margen");
  ok(d.fcfYield === null, "sin capitalización no hay rentabilidad");
  ok(d.crecimientoCFO === null, "sin periodo anterior no hay crecimiento");
  cerca(d.cashConversion, 1.4, 1e-9, "pero lo que SÍ se puede calcular, se calcula");

  const vacio = diagnosticar({});
  ok(Object.values(vacio).every((v) => v === null || typeof v === "boolean"), "sin datos, todo null (ningún 0 disfrazado)");
  ok(banderas({}).length === 0, "sin datos no se inventan banderas");
  ok(puente({}) === null, "sin datos no hay puente");
  ok(destino({}) === null, "sin datos no hay destino");
}

// Un divisor CERO no puede dar Infinity ni NaN.
{
  const d = diagnosticar({ niTTM: 0, ocfTTM: 140, revTTM: 0, capexTTM: 40, marketCap: 0 });
  ok(d.cashConversion === null, "beneficio cero: la conversión es null, no Infinity");
  ok(d.margenCFO === null, "ventas cero: margen null");
  ok(d.fcfYield === null, "capitalización cero: rentabilidad null");
}

// ── LO QUE MÁS IMPORTA (2): un banco no se lee con la plantilla de una industrial ─────────
// ⚠️ Este bloque existe por un falso positivo REAL: JPMorgan daba conversión −1,83 y bandera de
// «el beneficio no se convierte en caja». En un banco, conceder préstamos ES la operación y sale
// como flujo operativo negativo. Leerlo como una industrial es el mismo error que calcular su FCF.
{
  const banco = { ...SANA, deposits: 5000, niTTM: 100, ocfTTM: -180, capexTTM: 10 };
  const d = diagnosticar(banco);
  ok(d.financiera, "los depósitos identifican una entidad financiera");
  ok(d.fcf === null, "un banco no tiene FCF: no se calcula");
  ok(d.capexSobreVentas === null, "ni capex sobre ventas");
  const b = banderas(banco, d);
  ok(!tiene(b, "conversion_baja"), `una conversión negativa en un banco NO es bandera roja (salieron: ${b.map((x) => x.clave).join(",") || "ninguna"})`);
  ok(!tiene(b, "cobros_disparados"), "ni el crecimiento de sus cuentas por cobrar: su circulante ES el negocio");

  ok(esFinanciera({ loans: 1 }), "los préstamos también la identifican");
  ok(esFinanciera({ premiumsTTM: 1 }), "y las primas de seguro");
  ok(!esFinanciera({ deposits: 0, loans: 0 }), "ceros explícitos no la convierten en financiera");
}

// ── Las banderas rojas, una a una ────────────────────────────────────────────────────────
{
  ok(banderas(SANA).length === 0, "una empresa sana no levanta ninguna bandera");

  const mala = { ...SANA, ocfTTM: 60 };   // conversión 0,6
  ok(tiene(banderas(mala), "conversion_baja"), "conversión por debajo del umbral levanta bandera");

  // Justo en el umbral NO salta: los cortes son estrictos y eso hay que fijarlo.
  const justo = { ...SANA, ocfTTM: 100 * UMBRALES.cashConversionMala };
  ok(!tiene(banderas(justo), "conversion_baja"), "exactamente en el umbral no salta");

  const cobros = { ...SANA, receivables: 150 };   // +63 % contra ventas +11 %
  ok(tiene(banderas(cobros), "cobros_disparados"), "cobros creciendo mucho más que las ventas");

  const inv = { ...SANA, inventory: 130 };
  ok(tiene(banderas(inv), "inventario_acumulado"), "inventario acumulándose");

  // ⚠️ LA BANDERA DEL MANUAL: se devuelve al accionista más de lo que el negocio genera.
  const retrib = { ...SANA, buybacksTTM: 90, dividendsTTM: 30 };  // 120 sobre un FCF de 100
  const br = banderas(retrib);
  ok(tiene(br, "retribucion_no_autofinanciada"), "retribuir por encima del FCF levanta bandera");
  const eb = br.find((x) => x.clave === "retribucion_no_autofinanciada").evidencia;
  cerca(eb.veces, 1.2, 0.01, "y dice cuántas veces el FCF se está repartiendo");

  const negativo = { ...SANA, capexTTM: 200, buybacksTTM: 30 };   // FCF -60 y sigue repartiendo
  ok(tiene(banderas(negativo), "retribucion_con_fcf_negativo"), "repartir con FCF negativo es el caso extremo");

  const capex = { ...SANA, capexTTM: 300, ocfTTM: 100, prev: { ...SANA.prev, ocfTTM: 120 } };
  ok(tiene(banderas(capex), "capex_sin_retorno"), "capex alto sin crecimiento del CFO");

  // Toda bandera lleva su evidencia numérica: sin ella no se puede comprobar nada.
  for (const b of banderas(mala).concat(banderas(cobros), banderas(retrib))) {
    ok(b.texto.length > 20 && Object.keys(b.evidencia).length > 0, `la bandera ${b.clave} lleva texto y evidencia`);
    ok(b.gravedad === "alerta" || b.gravedad === "aviso", `y una gravedad válida`);
  }
}

// ── El puente ────────────────────────────────────────────────────────────────────────────
{
  const p = puente(SANA);
  ok(p.pasos[0].tipo === "inicio" && p.pasos[0].importe === 100, "arranca en el beneficio neto");
  ok(p.pasos.at(-1).tipo === "fin" && p.pasos.at(-1).importe === 140, "termina en el flujo operativo");
  // 100 + 30 (D&A) + 15 (SBC) − 8 (cobros) − 6 (inventario) = 131; faltan 9 hasta 140.
  cerca(p.sinExplicar, 9, 1e-9, "lo que no explican los conceptos conocidos se calcula");
  ok(p.pasos.some((x) => /Otros ajustes/.test(x.concepto)), "y se muestra como «otros ajustes», no se reparte");
  // ⚠️ 9 sobre un salto de 40 es el 22,5 %, que PASA del umbral del 20 %. Mi primera version de
  // este test decia "menos del 20 %" y fallo: la aritmetica estaba mal en el test, no en el
  // codigo. Se deja fijado en los dos lados del corte, que es lo que habria evitado el error.
  ok(!p.suficiente, "22,5 % sin explicar pasa del 20 %: el puente NO es suficiente");
  const holgado = puente({ ...SANA, sbcTTM: 24 });   // deja 0 sin explicar
  ok(holgado.suficiente, "con los conceptos conocidos explicandolo todo, si es suficiente");
  cerca(holgado.sinExplicar, 0, 1e-9, "y no queda nada sin explicar");

  // ⚠️ Si lo no explicado domina, el puente se declara INSUFICIENTE en vez de enseñarse igual.
  const opaco = puente({ niTTM: 100, ocfTTM: 500, daTTM: 10 });
  ok(!opaco.suficiente, "cuando los ajustes desconocidos dominan, el puente NO es suficiente");
}

// ── El destino de la caja: el cuadre manda ───────────────────────────────────────────────
{
  const s = destino(SANA);
  cerca(s.variacionCalculada, 30, 1e-9, "CFO 140 − 50 inversión − 60 financiación = 30");
  cerca(s.variacionDeclarada, 30, 1e-9, "y coincide con la variación declarada");
  ok(s.cuadra, "por tanto cuadra");
  cerca(s.residuo, 0, 1e-9, "sin residuo");

  const roto = destino({ ...SANA, deltaCashConFxTTM: 200 });
  ok(!roto.cuadra, "si la variación declarada no cuadra con la suma, NO se publica");
  ok(Math.abs(roto.residuo) > 100, "y el residuo se reporta para poder investigarlo");

  // Sin variación declarada no se puede comprobar el cuadre, así que NO se da por bueno.
  const sinDeclarar = destino({ ocfTTM: 140, cfiTTM: -50, cffTTM: -60 });
  ok(!sinDeclarar.cuadra, "sin variación declarada no se puede afirmar que cuadre");
  ok(sinDeclarar.residuo === null, "y el residuo es null, no cero");

  // El efecto del tipo de cambio entra en la suma: es lo que reconcilia la caja final.
  const conFx = destino({ ocfTTM: 100, cfiTTM: -20, cffTTM: -10, fxCashTTM: 5, deltaCashConFxTTM: 75 });
  ok(conFx.cuadra, "el efecto divisa forma parte del cuadre");
  ok(conFx.bloques.some((b) => /cambio/i.test(b.concepto)), "y aparece como bloque propio");
}

// ── EL SANKEY DE CAJA: lo que hay que fijar es que CIERRE ────────────────────────────────
// ⚠️ Un Sankey que no cierra se arregla escalando barras, queda bonito y miente. Lo que este
// bloque comprueba no es que se dibuje: es que la suma de los origenes sea EXACTAMENTE la de
// los destinos, en los cuatro casos donde el signo cambia de sitio.
{
  const cierra = (s, m) => {
    const o = s.flujos.filter((x) => x.lado === "origen").reduce((a, b) => a + b.valor, 0);
    const d = s.flujos.filter((x) => x.lado === "destino").reduce((a, b) => a + b.valor, 0);
    ok(Math.abs(o - d) < 1e-9, `${m} — origenes ${o} != destinos ${d}`);
    return { o, d };
  };

  const s = sankeyCaja(SANA);
  ok(s.nivel === "completo", "con capex y retribucion, el nivel es completo");
  ok(s.cuadra, "y cuadra con la variacion declarada");
  const { o } = cierra(s, "el diagrama de una industrial sana cierra");
  cerca(o, 140, 1e-9, "y el total es el CFO: 140");
  // 140 = capex 40 + resto inversion 10 + recompras 30 + dividendos 20 + resto financiacion 10 + caja 30
  const v = (c) => s.flujos.find((x) => x.concepto === c)?.valor ?? null;
  cerca(v("Capex"), 40, 1e-9, "el capex sale con su magnitud");
  cerca(v("Resto de inversion") ?? v("Resto de inversión"), 10, 1e-9, "y el resto de inversion es CFI + capex, no un hueco");
  cerca(v("Resto de financiacion (deuda)") ?? v("Resto de financiación (deuda)"), 10, 1e-9, "igual con la financiacion");

  // ⚠️ TODO valor es positivo: el sentido lo lleva `lado`, no el signo. Mezclarlos es como se
  // dibujan las barras que apuntan al lado equivocado.
  ok(s.flujos.every((x) => x.valor > 0), "ningun flujo lleva el signo dentro del valor");

  // Caja que BAJA: es un origen (se tira de hucha), no un destino negativo.
  const baja = sankeyCaja({ ...SANA, cffTTM: -160, deltaCashConFxTTM: -70 });
  cierra(baja, "con la caja bajando tambien cierra");
  const c = baja.flujos.find((x) => x.clase === "caja");
  ok(c.lado === "origen" && /Reducci/.test(c.concepto), "y la reduccion de caja aparece como ORIGEN");

  // Deuda EMITIDA: el resto de financiacion pasa a ser un origen.
  const emite = sankeyCaja({ ...SANA, cffTTM: 100, deltaCashConFxTTM: 190 });
  cierra(emite, "emitiendo deuda tambien cierra");
  const r = emite.flujos.find((x) => /deuda/i.test(x.concepto));
  ok(r.lado === "origen", "endeudarse es un ORIGEN de caja, no un destino");

  // Un negocio que CONSUME caja: el CFO cambia de lado y la historia es de donde sale.
  const quema = sankeyCaja({ ...SANA, ocfTTM: -40, cfiTTM: -50, cffTTM: 200, deltaCashConFxTTM: 110 });
  cierra(quema, "un negocio que quema caja tambien cierra");
  const op = quema.flujos.find((x) => x.clase === "operacion");
  ok(op.lado === "destino" && /consume/i.test(op.concepto), "y el CFO negativo se dibuja como consumo, no como origen");

  // Sin desglose fino se dibuja igual, pero se DECLARA que es minimo.
  const min = sankeyCaja({ ocfTTM: 100, cfiTTM: -30, cffTTM: -20, deltaCashConFxTTM: 50 });
  ok(min.nivel === "minimo", "sin capex ni retribucion el nivel es minimo, no completo");
  ok(min.flujos.some((x) => /sin desglosar/i.test(x.concepto)), "y los agregados se marcan como no desglosados");
  cierra(min, "y aun asi cierra");

  // Sin CFO no se inventa nada.
  const nada = sankeyCaja({});
  ok(nada.nivel === "sin_datos" && nada.flujos.length === 0 && !nada.cuadra, "sin CFO: sin_datos, sin flujos y sin cuadre");

  // ⚠️ Si no cuadra con la variacion declarada, NO se publica — aunque el dibujo cierre solo.
  const roto = sankeyCaja({ ...SANA, deltaCashConFxTTM: 900 });
  ok(!roto.cuadra, "si la variacion declarada no cuadra, cuadra=false");
  ok(roto.flujos.length > 0, "el diagrama existe, pero el criterio de publicacion es `cuadra`");

  // Un banco: se construye, pero se marca para que nadie lea su CFO como el de una industrial.
  ok(sankeyCaja({ ...SANA, deposits: 5000 }).financiera, "el diagrama de un banco viene marcado como financiera");

  // ⚠️ EL CASO QUE ESTE TEST NO PEDIA Y LOS DATOS REALES SI. En los seis casos de arriba el
  // residuo es cero, asi que el dibujo cerraba solo. Sobre el S&P 500, 16 de 60 diagramas NO
  // cerraban: la variacion que la empresa DECLARA casi nunca es exactamente la suma de sus
  // tres flujos. El arreglo no es tolerar el hueco, es DIBUJARLO.
  const conResiduo = sankeyCaja({ ...SANA, deltaCashConFxTTM: 32 });   // calculada 30, declarada 32
  cerca(conResiduo.residuo, 2, 1e-9, "el residuo se calcula");
  const ne = conResiduo.flujos.find((x) => x.concepto === "No explicado");
  ok(ne != null, "y aparece como bloque propio «No explicado»");
  cerca(ne.valor, 2, 1e-9, "con su tamano REAL, sin repartirlo entre los demas");
  ok(ne.lado === "origen", "declarar mas caja de la que explican los flujos es un origen no explicado");
  cierra(conResiduo, "y con ese bloque el diagrama vuelve a cerrar exactamente");
  ok(conResiduo.cuadra, "2 sobre un CFO de 140 esta dentro de la tolerancia: sigue siendo publicable");

  // Y al reves: menos caja declarada que la que explican los flujos.
  const menos = sankeyCaja({ ...SANA, deltaCashConFxTTM: 28 });
  ok(menos.flujos.find((x) => x.concepto === "No explicado").lado === "destino", "y al reves es un destino no explicado");
  cierra(menos, "que tambien cierra");
}

console.log(pass && !fail ? `\n✓ flujoCaja: ${pass} passed, 0 failed\n` : `\n✖ flujoCaja: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
