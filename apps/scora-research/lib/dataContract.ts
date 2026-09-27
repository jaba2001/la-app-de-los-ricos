// EL CONTRATO de /api/data: la forma de una consulta, UNA sola vez (AUDIT_REPORT M-8).
//
// Estaba escrito dos veces —lib/dataQuery.ts (lo que el navegador manda) y
// lib/server/data/query.ts (lo que el servidor entiende)— y ya se habían separado:
//   · el cliente mandaba `.not(col,"is",null)` como `neq null` → cero filas siempre (M-1)
//   · mandaba `count` y `head`; el servidor no los declaraba y devolvía un recuento falso (M-2)
//   · mandaba `ignoreDuplicates`; el servidor lo ignoraba y hacía ON CONFLICT DO UPDATE, así
//     que el registro "inmutable" sl_score_log se podía sobrescribir el mismo día
// Ahora los dos importan de aquí: un campo nuevo que uno mande y el otro no conozca es un
// error de compilación, no una diferencia silenciosa. Solo tipos: no arrastra nada al bundle.

export type Op = "select" | "insert" | "upsert" | "update" | "delete";

/** `not_null` es `.not(col, "is", null)`. `is` solo admite null. */
export type OpFiltro = "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte" | "is" | "not_null";

export interface Filtro { col: string; op: OpFiltro; val: unknown }

export interface Peticion {
  /** Llamada a función: `rpc` lleva el nombre y `args` los parámetros. */
  rpc?: string;
  args?: Record<string, unknown>;
  table: string;
  op: Op;
  /** Lo que iría en .select("a,b,c"). */
  columns?: string;
  filters?: Filtro[];
  order?: { col: string; asc: boolean }[];
  limit?: number;
  /** `{ count: "exact" }`: además de las filas, cuántas cumplen el filtro sin el LIMIT. */
  count?: boolean;
  /** `{ head: true }`: solo el recuento, sin filas. */
  head?: boolean;
  /** insert / upsert */
  rows?: Record<string, unknown>[];
  /** update */
  patch?: Record<string, unknown>;
  /** upsert */
  onConflict?: string[];
  /** upsert: no pisar la fila existente (ON CONFLICT DO NOTHING). */
  ignoreDuplicates?: boolean;
}
