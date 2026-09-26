// Reemplazo de `datos.from(...)` para los datos — la parte PURA.
//
// POR QUÉ IMITA LA FORMA DE SUPABASE. Hay 56 llamadas repartidas por 23 tablas y 40 ficheros.
// Reescribirlas todas a mano habría sido la parte más larga de la migración y, peor, la más
// fácil de equivocar: cada una es una oportunidad de olvidar un filtro. Manteniendo el mismo
// constructor de consultas —`.from("x").select("a").eq("b", 1)`— los ficheros que llaman
// cambian una línea de import y nada más.
//
// La diferencia de fondo está debajo: esto no habla con la base de datos, sino con
// /api/data, que aplica la política por tabla y añade el filtro de usuario. Lo que antes
// garantizaba Postgres ahora lo garantiza el servidor, y el cliente no puede saltárselo
// porque no tiene forma de llegar a la base.
//
// Solo se implementa el subconjunto que la app usa de verdad (13 métodos, contados sobre el
// código). Un método que no esté aquí falla al compilar, que es cuando conviene enterarse.


export type { Peticion };
export interface Respuesta<T> {
  data: T | null;
  error: { message: string } | null;
  /** Solo cuando se pide `{ count: "exact" }`. */
  count?: number | null;
}

/** Fila que se ENVIA al servidor (insert/upsert/update). Lo que se RECIBE se tipa como
 *  `unknown`: los que llaman escriben `data as MiTipo`, igual que hacian con Supabase, y
 *  `Record<string, unknown>` no se puede convertir a una interfaz sin indice. */
export type Fila = Record<string, unknown>;

interface Filtro { col: string; op: "eq" | "neq" | "in" | "gt" | "gte" | "lt" | "lte" | "is"; val: unknown }
type Op = "select" | "insert" | "upsert" | "update" | "delete";

interface Peticion {
  rpc?: string;
  args?: Fila;
  table: string; op: Op;
  columns?: string; filters?: Filtro[];
  /** `{ count: "exact" }`: devuelve cuantas filas cumplen, no solo la pagina. */
  count?: boolean;
  /** `{ head: true }`: solo interesa el numero, no las filas. */
  head?: boolean;
  order?: { col: string; asc: boolean }[];
  limit?: number;
  rows?: Record<string, unknown>[];
  patch?: Record<string, unknown>;
  onConflict?: string[];
  ignoreDuplicates?: boolean;
}

// ── Transporte inyectable ────────────────────────────────────────────────────────────
// Igual que lib/batchQueue.ts: la parte que habla con la red se inyecta para que este
// modulo se pueda cargar y probar con `node` a secas. Sin esto, importarlo arrastraria
// lib/proxy.ts -> lib/supabase.ts y la prueba no podria ejecutarse sin un bundler.
export type Transporte = (queries: Peticion[]) => Promise<{ results: (Resultado | { error: string })[] }>;
let transporte: Transporte = async () => { throw new Error("transporte no configurado"); };
export function setTransporte(t: Transporte) { transporte = t; }

// ── Agrupación, igual que en lib/proxy.ts ────────────────────────────────────────────
// Una pantalla pide tres o cuatro tablas en el mismo tick. Se mandan juntas para no pagar
// tres viajes y tres comprobaciones de token.
type Resultado = { rows: unknown[]; count?: number };
type Pendiente = { pet: Peticion; resolve: (v: Resultado) => void; reject: (e: unknown) => void };
let cola: Pendiente[] = [];
let programado = false;
const MAX_LOTE = 20;

async function enviar(trozo: Pendiente[]) {
  try {
    const res = await transporte(trozo.map((p) => p.pet));
    trozo.forEach((p, i) => {
      const r = res.results?.[i];
      if (!r) { p.reject(new Error("sin respuesta para la consulta")); return; }
      if ("error" in r) { p.reject(new Error(r.error)); return; }
      p.resolve(r);
    });
  } catch (e) {
    trozo.forEach((p) => p.reject(e));
  }
}

function encolar(pet: Peticion): Promise<Resultado> {
  return new Promise((resolve, reject) => {
    cola.push({ pet, resolve, reject });
    if (!programado) {
      programado = true;
      setTimeout(() => {
        programado = false;
        const lote = cola; cola = [];
        for (let i = 0; i < lote.length; i += MAX_LOTE) void enviar(lote.slice(i, i + MAX_LOTE));
      }, 0);
    }
  });
}

// ── El constructor ───────────────────────────────────────────────────────────────────
class Consulta<T = unknown> implements PromiseLike<Respuesta<T>> {
  private pet: Peticion;
  private modo: "many" | "single" | "maybe" = "many";

  constructor(table: string, op: Op) { this.pet = { table, op, filters: [], order: [] }; }

  select(columns = "*", opts?: { count?: "exact"; head?: boolean }) {
    if (this.pet.op === "select") this.pet.columns = columns;
    if (opts?.count) this.pet.count = true;
    if (opts?.head) this.pet.head = true;
    return this as unknown as Consulta<unknown[]>;
  }
  eq(col: string, val: unknown)  { this.pet.filters!.push({ col, op: "eq",  val }); return this; }
  neq(col: string, val: unknown) { this.pet.filters!.push({ col, op: "neq", val }); return this; }
  gt(col: string, val: unknown)  { this.pet.filters!.push({ col, op: "gt",  val }); return this; }
  gte(col: string, val: unknown) { this.pet.filters!.push({ col, op: "gte", val }); return this; }
  lt(col: string, val: unknown)  { this.pet.filters!.push({ col, op: "lt",  val }); return this; }
  lte(col: string, val: unknown) { this.pet.filters!.push({ col, op: "lte", val }); return this; }
  in(col: string, val: unknown[]) { this.pet.filters!.push({ col, op: "in", val }); return this; }
  /** Solo `is(col, null)`: es lo único que la app usa y lo único que el servidor admite. */
  is(col: string, val: null)     { this.pet.filters!.push({ col, op: "is", val }); return this; }
  not(col: string, _op: string, val: unknown) {
    // La app solo escribe `.not("sector", "is", null)`. Se traduce a "distinto de null".
    this.pet.filters!.push({ col, op: val === null ? "neq" : "neq", val });
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.pet.order!.push({ col, asc: opts?.ascending !== false }); return this;
  }
  limit(n: number) { this.pet.limit = n; return this; }
  single()      { this.modo = "single"; return this as unknown as Consulta<unknown>; }
  maybeSingle() { this.modo = "maybe";  return this as unknown as Consulta<unknown>; }

  then<R1 = Respuesta<T>, R2 = never>(
    onOk?: ((v: Respuesta<T>) => R1 | PromiseLike<R1>) | null,
    onErr?: ((r: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return encolar(this.pet).then(
      ({ rows, count }) => {
        if (this.modo === "many") return { data: rows as T, error: null, count: count ?? null };
        if (rows.length === 0) {
          // `single()` sin filas es un error en Supabase; `maybeSingle()` devuelve null.
          return this.modo === "single"
            ? { data: null, error: { message: "No se encontró ninguna fila" } }
            : { data: null, error: null };
        }
        return { data: rows[0] as T, error: null };
      },
      (e) => ({ data: null, error: { message: (e as Error)?.message ?? String(e) } })
    ).then(onOk as never, onErr as never) as Promise<R1 | R2>;
  }
}

class Tabla {
  private table: string;
  constructor(table: string) { this.table = table; }
  select(columns = "*", opts?: { count?: "exact"; head?: boolean }) {
    return new Consulta(this.table, "select").select(columns, opts);
  }
  insert(rows: Fila | Fila[]) {
    const q = new Consulta(this.table, "insert");
    (q as unknown as { pet: Peticion }).pet.rows = Array.isArray(rows) ? rows : [rows];
    return q;
  }
  upsert(rows: Fila | Fila[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    const q = new Consulta(this.table, "upsert");
    const pet = (q as unknown as { pet: Peticion }).pet;
    pet.rows = Array.isArray(rows) ? rows : [rows];
    pet.onConflict = (opts?.onConflict ?? "id").split(",").map((s) => s.trim());
    // `ignoreDuplicates` = no pisar lo que ya hay (ON CONFLICT DO NOTHING). Lo usa el
    // registro inmutable del track record: una nota por ticker y dia, la primera que entra.
    if (opts?.ignoreDuplicates) pet.ignoreDuplicates = true;
    return q;
  }
  update(patch: Fila) {
    const q = new Consulta(this.table, "update");
    (q as unknown as { pet: Peticion }).pet.patch = patch;
    return q;
  }
  delete() { return new Consulta(this.table, "delete"); }
}

export const datos = {
  from(table: string) { return new Tabla(table); },
  /** Llama a una funcion de Postgres. Solo las de la lista blanca del servidor. */
  rpc(nombre: string, args?: Fila) {
    const q = new Consulta<unknown[]>("", "select");
    const pet = (q as unknown as { pet: Peticion }).pet;
    pet.rpc = nombre; pet.args = args ?? {};
    return q;
  },
};

/** Solo para pruebas: cuántas consultas esperan turno. */
export function _pendientes() { return cola.length; }
