// Trocea un flujo NDJSON (una línea JSON por evento) que llega a pedazos por la red.
//
// Un pedazo puede acabar a media línea, o a mitad de un carácter multibyte; lo primero lo
// resuelve el `resto` que se devuelve, lo segundo el TextDecoder en modo stream de quien llama.
// Puro y sin imports: lo prueba scripts/asistente.test.mjs.

/** Las líneas completas de `buffer` ya parseadas, y lo que queda a medias para el próximo pedazo. */
export function trocearNdjson<T = unknown>(buffer: string): { eventos: T[]; resto: string } {
  const lineas = buffer.split("\n");
  const resto = lineas.pop() ?? "";
  const eventos: T[] = [];
  for (const l of lineas) {
    if (!l.trim()) continue;
    try { eventos.push(JSON.parse(l) as T); } catch { /* línea corrupta: se ignora, no tumba el resto */ }
  }
  return { eventos, resto };
}
