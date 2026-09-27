// Postgres devuelve numeric, decimal e int8 como CADENA, no como número.
//
// node-pg lo hace a propósito: un numeric puede no caber en un double de JavaScript sin
// perder precisión, así que prefiere darte el texto exacto y que tú decidas. PostgREST,
// que es lo que había con Supabase, los serializaba como número JSON — así que al
// sustituirlo, cada `v.toFixed(1)` de la interfaz empezó a recibir una cadena y a
// reventar la vista entera con "toFixed is not a function". Lo veía cualquier usuario
// con sesión en /macro, /discovery y /momentum.
//
// La conversión va por OID del tipo de columna, que viene en los metadatos de la
// respuesta, y NO adivinando por el aspecto del valor: un ticker "123" o una fecha en
// texto no deben convertirse nunca.
//
//   1700 numeric/decimal    20 int8/bigint    700 float4    701 float8
//
// Se pierde precisión en numeric enormes, igual que la perdía PostgREST. Es el
// comportamiento que la interfaz ya esperaba.
const OID_NUMERICOS = new Set([1700, 20, 700, 701]);

/** Convierte a número las columnas numéricas de un resultado de node-pg. */
export function filasConNumeros(res) {
  const rows = res?.rows ?? [];
  if (!rows.length) return rows;

  const cols = (res.fields ?? [])
    .filter((f) => OID_NUMERICOS.has(f.dataTypeID))
    .map((f) => f.name);
  if (!cols.length) return rows;

  return rows.map((fila) => {
    const out = { ...fila };
    for (const c of cols) {
      const v = out[c];
      if (typeof v === "string" && v !== "") out[c] = Number(v);
    }
    return out;
  });
}
