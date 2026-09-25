// Traduce una consulta que llega del navegador a SQL parametrizado.
//
// Es el límite de seguridad de la aplicación. Dos cosas que NUNCA pueden fallar aquí:
//
//   1. El nombre de tabla y los de columna vienen del cliente, así que jamás se interpolan:
//      se comprueban contra listas blancas (POLICY y el esquema real) y solo entonces se
//      escriben. Los VALORES van siempre como parámetros $1, $2…
//
//   2. En una tabla privada, el filtro por usuario se añade SIEMPRE y no se puede quitar:
//      ni mandando otro `user_id` en los datos, ni filtrando por él a mano, ni pidiendo
//      columnas raras. El identificador sale del token verificado en el servidor, nunca
//      del cuerpo de la petición.

import { policyFor, funcionPermitida, type Op, type TablePolicy } from "./policy.ts";

export interface Filtro { col: string; op: "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte" | "is"; val: unknown }
export interface Peticion {
  /** Llamada a funcion: `rpc` lleva el nombre y `args` los parametros. */
  rpc?: string;
  args?: Record<string, unknown>;
  table: string;
  op: Op;
  columns?: string;                 // lo que iría en .select("a,b,c")
  filters?: Filtro[];
  order?: { col: string; asc: boolean }[];
  limit?: number;
  rows?: Record<string, unknown>[]; // insert / upsert
  patch?: Record<string, unknown>;  // update
  onConflict?: string[];            // upsert
  single?: boolean;
}

export interface SqlListo { text: string; values: unknown[] }

export class RechazoPolitica extends Error {
  constructor(msg: string) { super(msg); this.name = "RechazoPolitica"; }
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** Llamada a una funcion de la lista blanca. Los parametros van por NOMBRE (`p_ticker => $1`)
 *  y solo los declarados: uno que no este se rechaza en vez de ignorarse, porque ignorarlo
 *  significaria ejecutar la funcion con menos argumentos de los que el llamante cree. */
function construirRpc(p: Peticion, userId: string | null): SqlListo {
  const nombre = p.rpc!;
  if (!IDENT.test(nombre)) throw new RechazoPolitica(`Funcion invalida: ${nombre}`);
  const def = funcionPermitida(nombre);
  if (!def) throw new RechazoPolitica(`Funcion no accesible: ${nombre}`);
  if (def.scoped && !userId) throw new RechazoPolitica(`${nombre} requiere sesion`);

  const vals: unknown[] = [];
  const partes: string[] = [];
  for (const [k, v] of Object.entries(p.args ?? {})) {
    if (!def.params.includes(k)) throw new RechazoPolitica(`Parametro no permitido en ${nombre}: ${k}`);
    partes.push(`${k} => $${vals.push(v)}`);
  }
  return { text: `SELECT * FROM "${nombre}"(${partes.join(", ")})`, values: vals };
}

/** Las columnas reales de cada tabla, leídas del esquema. Sin esto habría que confiar en que
 *  el cliente manda nombres válidos, y un nombre es lo único que no se puede parametrizar. */
export type Esquema = Record<string, Set<string>>;

function ident(nombre: string, permitidas: Set<string>, tabla: string): string {
  if (!IDENT.test(nombre) || !permitidas.has(nombre)) {
    throw new RechazoPolitica(`Columna no permitida en ${tabla}: ${nombre}`);
  }
  return `"${nombre}"`;
}

/** Comprueba la política y devuelve la tabla junto con el usuario a inyectar (o null). */
function comprobar(p: Peticion, userId: string | null): { pol: TablePolicy; scoped: boolean } {
  if (!IDENT.test(p.table)) throw new RechazoPolitica(`Tabla inválida: ${p.table}`);
  const pol = policyFor(p.table);
  // Denegar por defecto: una tabla sin política no existe para el navegador.
  if (!pol) throw new RechazoPolitica(`Tabla no accesible: ${p.table}`);
  if (!pol.ops.includes(p.op)) throw new RechazoPolitica(`Operación ${p.op} no permitida en ${p.table}`);
  const scoped = pol.scope === "user";
  // Una tabla privada SIN usuario no devuelve "todo": no devuelve nada. Es la diferencia
  // entre un fallo de sesión y una fuga de datos.
  if (scoped && !userId) throw new RechazoPolitica(`${p.table} requiere sesión`);
  return { pol, scoped };
}

export function construir(p: Peticion, userId: string | null, esquema: Esquema): SqlListo {
  if (p.rpc) return construirRpc(p, userId);
  const { pol, scoped } = comprobar(p, userId);
  const cols = esquema[p.table];
  if (!cols) throw new RechazoPolitica(`Tabla desconocida en el esquema: ${p.table}`);
  const T = `"${p.table}"`;
  const vals: unknown[] = [];
  const P = (v: unknown) => `$${vals.push(v)}`;

  // ── WHERE ──────────────────────────────────────────────────────────────────────────
  // Solo para las operaciones que lo llevan. Construirlo tambien en INSERT reservaba un
  // parametro $1 que luego nadie referenciaba, y Postgres rechazaba la sentencia entera con
  // "could not determine data type of parameter $1". No lo vio la prueba de construccion
  // —el texto parecia correcto— sino la de ejecutar contra una base real.
  const llevaWhere = p.op === "select" || p.op === "update" || p.op === "delete";
  const where: string[] = [];
  if (scoped && llevaWhere) {
    // Va el PRIMERO y sale del token, no de la petición. Aunque el cliente mande su propio
    // filtro sobre user_id, este se suma con AND: acotar más es inofensivo, ampliar imposible.
    where.push(`${ident(pol.userColumn!, cols, p.table)} = ${P(userId)}`);
  }
  for (const f of (llevaWhere ? p.filters ?? [] : [])) {
    const c = ident(f.col, cols, p.table);
    switch (f.op) {
      case "eq":  where.push(`${c} = ${P(f.val)}`); break;
      case "neq": where.push(`${c} <> ${P(f.val)}`); break;
      case "gt":  where.push(`${c} > ${P(f.val)}`); break;
      case "gte": where.push(`${c} >= ${P(f.val)}`); break;
      case "lt":  where.push(`${c} < ${P(f.val)}`); break;
      case "lte": where.push(`${c} <= ${P(f.val)}`); break;
      case "is":  // solo null / not null: cualquier otra cosa sería SQL interpolado
        if (f.val !== null) throw new RechazoPolitica("`is` solo admite null");
        where.push(`${c} IS NULL`); break;
      case "in": {
        const arr = Array.isArray(f.val) ? f.val : [];
        // Un IN vacío en SQL es un error de sintaxis; semánticamente es "ninguna fila".
        if (arr.length === 0) { where.push("FALSE"); break; }
        where.push(`${c} = ANY(${P(arr)})`); break;
      }
      default: throw new RechazoPolitica(`Operador no soportado: ${(f as Filtro).op}`);
    }
  }
  const W = where.length ? ` WHERE ${where.join(" AND ")}` : "";

  // ── SELECT ─────────────────────────────────────────────────────────────────────────
  if (p.op === "select") {
    const sel = !p.columns || p.columns.trim() === "*"
      ? "*"
      : p.columns.split(",").map((c) => ident(c.trim(), cols, p.table)).join(", ");
    const ord = (p.order ?? []).map((o) => `${ident(o.col, cols, p.table)} ${o.asc ? "ASC" : "DESC"}`);
    const O = ord.length ? ` ORDER BY ${ord.join(", ")}` : "";
    // Tope duro aunque el cliente no pida límite: sin él, un select sobre kb_chunks (50.000
    // filas) se traería la tabla entera a un navegador.
    const lim = Math.min(Math.max(1, p.limit ?? 1000), 5000);
    return { text: `SELECT ${sel} FROM ${T}${W}${O} LIMIT ${lim}`, values: vals };
  }

  // ── INSERT / UPSERT ────────────────────────────────────────────────────────────────
  if (p.op === "insert" || p.op === "upsert") {
    const filas = p.rows ?? [];
    if (!filas.length) throw new RechazoPolitica("Sin filas que insertar");
    if (filas.length > 500) throw new RechazoPolitica("Demasiadas filas (máx. 500)");

    const nombres = new Set<string>();
    for (const f of filas) for (const k of Object.keys(f)) nombres.add(k);
    // El dueño lo pone el servidor. Se descarta lo que venga del cliente en esa columna:
    // aceptarlo permitiría escribir filas a nombre de otra persona.
    if (scoped) nombres.delete(pol.userColumn!);
    const lista = [...nombres].map((c) => ident(c, cols, p.table));
    if (scoped) lista.unshift(ident(pol.userColumn!, cols, p.table));

    const tuplas = filas.map((fila) => {
      const v = [...nombres].map((c) => P(fila[c] ?? null));
      if (scoped) v.unshift(P(userId));
      return `(${v.join(", ")})`;
    });

    let sql = `INSERT INTO ${T} (${lista.join(", ")}) VALUES ${tuplas.join(", ")}`;
    if (p.op === "upsert") {
      const conf = (p.onConflict ?? []).map((c) => ident(c.trim(), cols, p.table));
      if (!conf.length) throw new RechazoPolitica("upsert necesita onConflict");
      const set = [...nombres].map((c) => `${ident(c, cols, p.table)} = EXCLUDED.${ident(c, cols, p.table)}`);
      sql += set.length
        ? ` ON CONFLICT (${conf.join(", ")}) DO UPDATE SET ${set.join(", ")}`
        : ` ON CONFLICT (${conf.join(", ")}) DO NOTHING`;
    }
    return { text: `${sql} RETURNING *`, values: vals };
  }

  // ── UPDATE ─────────────────────────────────────────────────────────────────────────
  if (p.op === "update") {
    const patch = { ...(p.patch ?? {}) };
    if (scoped) delete patch[pol.userColumn!];   // nadie cambia el dueño de una fila
    const set = Object.keys(patch).map((c) => `${ident(c, cols, p.table)} = ${P(patch[c])}`);
    if (!set.length) throw new RechazoPolitica("Nada que actualizar");
    // Sin WHERE, un UPDATE toca la tabla entera. En una tabla privada el filtro de usuario
    // ya está puesto; en una compartida esto no debería llegar nunca (ninguna admite update).
    if (!W) throw new RechazoPolitica("UPDATE sin condiciones");
    return { text: `UPDATE ${T} SET ${set.join(", ")}${W} RETURNING *`, values: vals };
  }

  // ── DELETE ─────────────────────────────────────────────────────────────────────────
  if (p.op === "delete") {
    if (!W) throw new RechazoPolitica("DELETE sin condiciones");
    return { text: `DELETE FROM ${T}${W} RETURNING *`, values: vals };
  }

  throw new RechazoPolitica(`Operación desconocida: ${p.op}`);
}
