// Conecta el cliente de datos con la red.
//
// La lógica vive en lib/dataQuery.ts, que es puro y se puede probar con `node` a secas; aquí
// solo se enchufa el transporte real. Mismo reparto que lib/batchQueue.ts y lib/proxy.ts.
import { authedFetch } from "./proxy";
import { datos, setTransporte } from "./dataQuery.ts";

setTransporte((queries) =>
  authedFetch("/api/data", { method: "POST", body: JSON.stringify({ queries }) }, 30_000)
);

/** Reemplazo de `supabase` para los datos. La sesión y el login NO están aquí: eso vive en
 *  lib/auth.tsx, que pasa a hablar con Identity Platform. */
export { datos };
export type { Respuesta } from "./dataQuery.ts";
