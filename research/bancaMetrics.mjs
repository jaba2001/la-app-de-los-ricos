// ─────────────────────────────────────────────────────────────────────────────
// MÉTRICAS DE BANCA Y SEGUROS — el juego propio, porque el industrial no les vale
//
// §2ter de SCORA_PICKS_REGLAS.md dejó escrito que Scora Picks NO PUEDE COMPRAR BANCOS: 0 de
// 18 llegan a puntuar. La causa no es un fallo de cobertura sino una equivocación de modelo:
// la señal pide margen operativo, cobertura de intereses y deuda neta sobre EBITDA, y un
// banco no tiene nada de eso. Sus intereses no son un gasto financiero: son su materia
// prima. Su deuda no es apalancamiento: son los depósitos de sus clientes.
//
// Importa para la misión. El objetivo es batir al índice y el índice sí tiene bancos —79 de
// los 586 nombres en caché—, así que quedarse fuera de ese trozo es un sesgo sectorial
// permanente, no una postura neutral.
//
// QUÉ SE CONSTRUYE Y QUÉ NO. Medido en `research/banca_cobertura.mjs` ANTES de escribir una
// línea, sobre la caché real y contando sólo tags vivos:
//
//   · Rentabilidad y eficiencia bancaria ....... 21/25 bancos comerciales ·  84 %  → SE HACE
//   · Siniestralidad de seguros ................ 27/37 aseguradoras       ·  73 %  → SE HACE
//   · Calidad del crédito (mora, dotaciones) ....  8/20                   ·  40 %  → NO
//   · Solvencia regulatoria (Tier 1) ............  6/20                   ·  30 %  → NO
//   · CET1 ......................................  0/20                   ·   0 %  → NO
//
// Las tres últimas no se construyen. Un ranking sobre una métrica que sólo existe para el
// 40 % ordena la DISPONIBILIDAD DEL DATO, no el negocio — y encima lo hace de forma creíble.
//
// ⚠️ LAS DOS PRIMERAS CIFRAS SE VOLVIERON A MEDIR el 2026-09-01 Y BAJARON. Aquí ponía «20/20,
// 100 %», y esa cifra salía del universo con sesgo de supervivencia: la fuente de miembros
// antigua omitía a las empresas que murieron, así que había menos bancos y los que quedaban
// eran los supervivientes — los que más publican. Sobre la fuente corregida son 21 de 25.
// Un 100 % de cobertura casi nunca es una buena noticia: suele significar que el denominador
// está mal.
//
// Y «financieras» no es una sola cosa. Por subsector la cobertura no se parece en nada:
//
//   · Banca comercial ........ 21/25 ·  84 %
//   · Seguros ................ 27/37 ·  73 %
//   · Mercados de capitales ...  7/28 ·  25 %
//   · Holdings y fondos .......  0/38 ·   0 %
//
// Los dos últimos NO son un fallo que arreglar: una gestora de activos no tiene ratio de
// eficiencia bancaria ni siniestralidad, igual que un banco no tiene margen de explotación.
// Ver `PLAN_BANCOS_MEDICION.md` para qué haría falta antes de meter esto en la señal.
//
// ⚠️ ESTO NO ALIMENTA LA SEÑAL DE PRODUCCIÓN. `picksSignal.mjs` no lo importa. Meter bancos
// en el universo elegible cambia la estrategia, no arregla un fallo, así que exige abrir una
// `PICKS_RULES_VERSION` nueva y validarse antes. Aquí sólo se calcula y se mide.
// ─────────────────────────────────────────────────────────────────────────────

/** Sectores a los que se aplica este juego de métricas en lugar del industrial. */
export const SECTORES_FINANCIEROS = ["Financial Services", "Financials"];

export function esFinanciero(sector) {
  return SECTORES_FINANCIEROS.includes(sector ?? "");
}

const pos = (x) => (x != null && isFinite(x) && x > 0 ? x : null);
const num = (x) => (x != null && isFinite(x) ? x : null);

/**
 * Métricas de un banco. Signo puesto para que **mayor = mejor** en todas, igual que en
 * `picksSignal.mjs`: si media lista va al revés, el percentil medio no significa nada.
 */
export function metricasBanco(f) {
  const nii = num(f.niiTTM);
  const fees = num(f.nonIntIncTTM);
  const gastos = num(f.nonIntExpTTM);
  const ingresoTotal = nii != null && fees != null ? nii + fees : null;

  return {
    // Ratio de eficiencia: gastos de explotación sobre ingreso total. Es LA métrica con la
    // que se compara un banco con otro, y va al revés (menos es mejor), así que se niega.
    eficiencia: pos(ingresoTotal) && gastos != null ? -(gastos / ingresoTotal) : null,
    // Margen de intereses sobre activos — aproximación al NIM. El NIM de verdad se calcula
    // sobre activos RENTABLES medios, que XBRL no publica de forma fiable; sobre activo
    // total es comparable entre bancos y no pretende ser el dato regulatorio.
    margenIntereses: pos(f.assets) && nii != null ? (nii / f.assets) * 100 : null,
    // Peso de las comisiones: un banco que no depende sólo del diferencial de tipos aguanta
    // mejor un ciclo de bajadas. Ni mucho ni poco es "bueno" en abstracto, pero más ingreso
    // recurrente y no sensible a tipos sí lo es.
    pesoComisiones: pos(ingresoTotal) && fees != null ? (fees / ingresoTotal) * 100 : null,
    // Depósitos sobre activos: financiación estable y barata frente a mayorista.
    depositosSobreActivo: pos(f.assets) && num(f.deposits) != null ? (f.deposits / f.assets) * 100 : null,
    // Rentabilidad sobre activos — la comparación honesta entre bancos, sin que el
    // apalancamiento (que en un banco es enorme por definición) la infle.
    roaBanco: pos(f.assets) && num(f.niTTM) != null ? (f.niTTM / f.assets) * 100 : null,
  };
}

/**
 * Métricas de una aseguradora. El ratio combinado de verdad (siniestralidad + gastos) exige
 * el desglose de gastos de suscripción, que XBRL no da de forma homogénea; se publican sus
 * dos componentes por separado y se deja claro que no es el ratio combinado del sector.
 */
export function metricasAseguradora(f) {
  const primas = pos(f.premiumsTTM);
  const siniestros = num(f.claimsTTM);
  const adq = num(f.acqCostTTM);
  return {
    // Siniestralidad: siniestros sobre primas. Menos es mejor → negada.
    siniestralidad: primas && siniestros != null ? -(siniestros / primas) * 100 : null,
    // Coste de adquisición sobre primas. Menos es mejor → negada.
    costeAdquisicion: primas && adq != null ? -(adq / primas) * 100 : null,
    roaAsegurador: pos(f.assets) && num(f.niTTM) != null ? (f.niTTM / f.assets) * 100 : null,
  };
}

/** Las claves que produce cada juego, para que el laboratorio no las repita a mano. */
export const METRICAS_BANCO = ["eficiencia", "margenIntereses", "pesoComisiones", "depositosSobreActivo", "roaBanco"];
export const METRICAS_ASEGURADORA = ["siniestralidad", "costeAdquisicion", "roaAsegurador"];

/**
 * ¿Es este paquete el de un banco de verdad? No se mira el SIC sino LO QUE PUBLICA, porque el
 * SIC de un holding financiero puede ser cualquier cosa y porque lo que decide si el modelo
 * aplica es tener margen de intereses y comisiones, no la etiqueta.
 */
export function pareceBanco(f) {
  return f?.niiTTM != null && f?.nonIntIncTTM != null && f?.nonIntExpTTM != null;
}
export function pareceAseguradora(f) {
  return f?.premiumsTTM != null && f?.claimsTTM != null;
}
