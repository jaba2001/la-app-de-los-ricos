// ─────────────────────────────────────────────────────────────────────────────
// Cola de micro-agrupación. Módulo PURO (sin imports), como lib/grounding.ts, para que la
// prueba pueda ejecutarlo headless con un transporte falso: la lógica que importa aquí
// —qué se agrupa, cómo se reparten las respuestas, qué pasa cuando el lote falla— no
// necesita ni red ni navegador para comprobarse, y probarla contra el transporte real
// significaría no probarla nunca.
//
// QUÉ RESUELVE: la página de un ticker hace 33 llamadas en el mismo tick. Encolarlas y
// mandarlas juntas convierte 33 peticiones HTTP (con 33 autenticaciones y 33 comprobaciones
// de rate-limit en el servidor) en una.
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchResult { id: string; status: number; body: string }

export interface BatchTransport {
  /** Manda el lote. Puede lanzar: el llamante degrada a peticiones sueltas. */
  send(requests: { id: string; path: string }[]): Promise<{ results: BatchResult[] }>;
  /** Una petición suelta, para el camino de respaldo. */
  single(path: string): Promise<unknown>;
}

export interface BatcherOptions {
  /** El servidor rechaza lotes más grandes; se parte antes de llegar ahí. */
  maxBatch?: number;
  /** Cuándo vaciar la cola. Por defecto, el siguiente turno del bucle de eventos. */
  schedule?: (fn: () => void) => void;
  /** Aviso de degradación (para logs en desarrollo). */
  onFallback?: (err: unknown, paths: string[]) => void;
}

interface Pending {
  path: string;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export function createBatcher(transport: BatchTransport, opts: BatcherOptions = {}) {
  const maxBatch = opts.maxBatch ?? 40;
  const schedule = opts.schedule ?? ((fn: () => void) => setTimeout(fn, 0));

  let queue: Pending[] = [];
  let scheduled = false;

  async function sendChunk(chunk: Pending[]) {
    // El id es la POSICIÓN dentro del lote, no la ruta. Dos llamadas a la misma ruta en el
    // mismo tick son legítimas —la página pide el histórico de precios del ticker y el de
    // SPY— y usar la ruta como id haría que una pisara a la otra; el servidor además
    // rechaza ids duplicados, así que el lote entero fallaría.
    const requests = chunk.map((p, idx) => ({ id: String(idx), path: p.path }));
    try {
      const res = await transport.send(requests);
      const byId = new Map((res?.results ?? []).map((r) => [r.id, r]));
      chunk.forEach((p, idx) => {
        const r = byId.get(String(idx));
        if (!r) { p.reject(new Error(`[batch] sin respuesta para ${p.path}`)); return; }
        if (r.status < 200 || r.status >= 300) {
          // Mismo formato de error que la vía individual: las pantallas hacen
          // setError(e.message) y no deben distinguir por dónde vino la petición.
          p.reject(new Error(`[proxy ${r.status}] ${p.path}: ${r.body}`));
          return;
        }
        try { p.resolve(JSON.parse(r.body)); } catch (e) { p.reject(e); }
      });
    } catch (e) {
      // El lote entero falló: proxy sin /api/batch (404), 429, caída de red. Cada petición
      // se reintenta sola — más lenta, pero igual de correcta que antes de existir esta
      // capa. Es lo que permite desplegar este cliente ANTES que el proxy.
      opts.onFallback?.(e, chunk.map((p) => p.path));
      chunk.forEach((p) => { transport.single(p.path).then(p.resolve, p.reject); });
    }
  }

  function flush() {
    scheduled = false;
    const batch = queue;
    queue = [];
    for (let i = 0; i < batch.length; i += maxBatch) {
      void sendChunk(batch.slice(i, i + maxBatch));
    }
  }

  return {
    enqueue<T = unknown>(path: string): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push({ path, resolve: resolve as (v: unknown) => void, reject });
        if (!scheduled) { scheduled = true; schedule(flush); }
      });
    },
    /** Solo para pruebas: cuántas peticiones esperan turno. */
    _pending: () => queue.length,
  };
}
