// Traductor de la sintaxis de PostgREST a SQL, para el código de servidor.
//
// POR QUÉ UN TRADUCTOR Y NO REESCRIBIR A MANO. Los crons y el webhook de Stripe hacen 34
// llamadas HTTP con la forma de Supabase:
//
//   sbFetch(`sl_alerts?active=eq.true&kind=in.(a,b)&select=id,user_id`)
//
// Reescribir cada una como SQL es mecánico, largo y justo el tipo de trabajo donde se cuela
// un filtro mal traducido que nadie ve hasta que un cron manda alertas de más. Un traductor
// es UNA pieza que se prueba una vez, y las 34 llamadas cambian solo el nombre de la función.
//
// IMPORTANTE — esto NO es la capa del navegador. Aquí no hay política por tabla ni filtro de
// usuario: es código de servidor que ya corre con privilegios (los crons tocan las filas de
// todos a propósito, para eso mandan las alertas). La puerta del navegador es
// app/api/data/route.ts, que sí aplica policy.ts. No mezclar las dos.
import { pool } from "./pool.ts";

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(n) {
  if (!IDENT.test(n)) throw new Error(`Identificador inválido: ${n}`);
  return `"${n}"`;
}

/** `eq.true` → ["=", true] · `in.(a,b)` → ["= ANY", [a,b]] · `is.null` → ["IS NULL"] */
function condicion(col, expr, push) {
  const i = expr.indexOf(".");
  const op = i === -1 ? "eq" : expr.slice(0, i);
  const crudo = i === -1 ? "" : expr.slice(i + 1);
  const C = ident(col);
  switch (op) {
    case "eq":  return `${C} = ${push(valor(crudo))}`;
    case "neq": return `${C} <> ${push(valor(crudo))}`;
    case "gt":  return `${C} > ${push(valor(crudo))}`;
    case "gte": return `${C} >= ${push(valor(crudo))}`;
    case "lt":  return `${C} < ${push(valor(crudo))}`;
    case "lte": return `${C} <= ${push(valor(crudo))}`;
    case "is":
      // PostgREST admite is.null y is.not.null; la app solo usa el primero.
      if (crudo === "null") return `${C} IS NULL`;
      if (crudo === "not.null") return `${C} IS NOT NULL`;
      throw new Error(`is.${crudo} no soportado`);
    case "in": {
      const lista = crudo.replace(/^\(|\)$/g, "");
      // Un IN vacío en SQL es error de sintaxis; aquí significa "ninguna fila".
      if (!lista) return "FALSE";
      return `${C} = ANY(${push(lista.split(",").map((v) => valor(v.replace(/^"|"$/g, ""))))})`;
    }
    default: throw new Error(`Operador PostgREST no soportado: ${op}`);
  }
}

/** PostgREST manda todo como texto; `true`, `false` y `null` son valores, no cadenas. */
function valor(s) {
  const d = decodeURIComponent(s);
  if (d === "true") return true;
  if (d === "false") return false;
  if (d === "null") return null;
  return d;
}

/**
 * Misma firma que el `fetch` que sustituye, y devuelve algo con la misma forma que una
 * Response, para que los 34 sitios cambien solo el nombre.
 *
 * @param {string} url  ruta completa o solo `tabla?filtros`
 * @param {{method?: string, body?: string, headers?: Record<string,string>}} [init]
 */
export async function sbFetch(url, init = {}) {
  try {
    const sinBase = String(url).replace(/^.*\/rest\/v1\//, "");
    const [tabla, qs = ""] = sinBase.split("?");
    const T = ident(tabla);
    const q = new URLSearchParams(qs);
    const metodo = (init.method || "GET").toUpperCase();

    const vals = [];
    const push = (v) => `$${vals.push(v)}`;

    const where = [];
    for (const [k, v] of q) {
      if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
      where.push(condicion(k, v, push));
    }
    const W = where.length ? ` WHERE ${where.join(" AND ")}` : "";

    let text;
    if (metodo === "GET") {
      const sel = q.get("select");
      const cols = !sel || sel === "*" ? "*" : sel.split(",").map((c) => ident(c.trim())).join(", ");
      let O = "";
      const ord = q.get("order");
      if (ord) {
        O = " ORDER BY " + ord.split(",").map((o) => {
          const [c, dir] = o.split(".");
          return `${ident(c)} ${dir === "desc" ? "DESC" : "ASC"}`;
        }).join(", ");
      }
      const lim = q.get("limit");
      text = `SELECT ${cols} FROM ${T}${W}${O}${lim ? ` LIMIT ${Number(lim) || 1000}` : ""}`;

    } else if (metodo === "POST") {
      const cuerpo = JSON.parse(init.body || "[]");
      const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
      if (!filas.length) return respuesta(200, []);
      const nombres = [...new Set(filas.flatMap((f) => Object.keys(f)))];
      const tuplas = filas.map((f) => `(${nombres.map((c) => push(f[c] ?? null)).join(", ")})`);
      text = `INSERT INTO ${T} (${nombres.map(ident).join(", ")}) VALUES ${tuplas.join(", ")}`;
      const conf = q.get("on_conflict");
      // `Prefer: resolution=merge-duplicates` es como Supabase pide un upsert; sin esa
      // cabecera, un conflicto se ignora en vez de pisar.
      const prefer = String(init.headers?.Prefer || init.headers?.prefer || "");
      if (conf) {
        const cols = conf.split(",").map((c) => ident(c.trim())).join(", ");
        text += prefer.includes("merge-duplicates")
          ? ` ON CONFLICT (${cols}) DO UPDATE SET ${nombres.map((c) => `${ident(c)} = EXCLUDED.${ident(c)}`).join(", ")}`
          : ` ON CONFLICT (${cols}) DO NOTHING`;
      }
      text += " RETURNING *";

    } else if (metodo === "PATCH") {
      const patch = JSON.parse(init.body || "{}");
      const set = Object.keys(patch).map((c) => `${ident(c)} = ${push(patch[c])}`);
      if (!set.length) return respuesta(200, []);
      // Sin WHERE, un PATCH de PostgREST actualiza la tabla entera. Aquí se rechaza: ninguna
      // de las 34 llamadas lo hace, y permitirlo es como dejar un UPDATE sin condiciones.
      if (!W) throw new Error("PATCH sin filtros");
      text = `UPDATE ${T} SET ${set.join(", ")}${W} RETURNING *`;

    } else if (metodo === "DELETE") {
      if (!W) throw new Error("DELETE sin filtros");
      text = `DELETE FROM ${T}${W} RETURNING *`;

    } else {
      throw new Error(`Método no soportado: ${metodo}`);
    }

    const r = await pool().query(text, vals);
    return respuesta(200, r.rows);
  } catch (e) {
    // Misma forma que una Response fallida: los llamantes hacen `r.ok ? await r.json() : []`
    // y así no hay que tocar su manejo de errores.
    console.error("sbFetch:", e?.message || e);
    return respuesta(500, { error: String(e?.message || e) });
  }
}

function respuesta(status, cuerpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  };
}

/** Los crons escapaban los valores para meterlos en la URL. Aquí van parametrizados, así que
 *  esto pasa a ser la identidad — se conserva para no tocar las 34 llamadas. */
export const pgv = (v) => String(v);
