# Scora — monorepo

**Este es el repositorio oficial.** Integra los dos repos que formaban el producto
(`scora-research` + `ic-proxy`) en uno solo, con el historial completo de ambos.

Los repos originales de Alejandro Alvarado quedan como referencia de solo lectura
(remotos `upstream-*`, con el push deshabilitado a propósito). El trabajo va aquí.

Para traer algo de ellos si hiciera falta:

```bash
git fetch upstream-scora-research   # o upstream-ic-proxy
```

## Estructura

```
apps/
  scora-research/   Frontend. Next.js + TypeScript. 13 páginas de UI.
  ic-proxy/         Backend. Next.js + JavaScript. 19 rutas API, 7 crons, 0 UI.
```

`ic-proxy` guarda las API keys (FMP, FRED, Finnhub, EDGAR, Anthropic) para que
nunca lleguen al navegador. `scora-research` lo consume por HTTP.

## Cómo dependen entre sí

1. **HTTP** — el frontend llama a `NEXT_PUBLIC_PROXY_URL`
   (default `https://ic-proxy-psi.vercel.app`). Está en `lib/proxy.ts`,
   `next.config.ts` (CSP `connect-src`) y `app/pricing/page.tsx`.
2. **CORS** — `apps/ic-proxy/lib/cors.js` incluye a `scora-research.vercel.app`
   por nombre. El proxy sirve además a `ic-suite`, `ic-datalayer-app` y
   `stock-lens-app`, que **no** están en este monorepo.
3. **Import de fichero** — `apps/scora-research/research/regimeReal.mjs`
   importa `../../ic-proxy/lib/macro.js`. El layout `apps/` mantiene la relación
   de hermandad, así que la ruta sigue resolviendo sin cambios.
4. **Supabase compartido** — el cron del proxy escribe `macro_state`, la app lo lee.
   Igual con la waitlist y las suscripciones push.
5. **Lógica duplicada a mano** — hay fórmulas espejadas entre ambos lados
   (`ic-proxy/lib/macro.js` ↔ `scora-research/research/regimeStationary.mjs`,
   `MacroIndicators.tsx`, `lib/technicals.js`). Los propios comentarios lo dicen.
   Si tocas una, toca la otra.

`apps/scora-research/scripts/smoke-proxy.mjs` comprueba que cada ruta que llama
el frontend existe en el proxy desplegado. Pásalo tras cambiar el contrato.

## Historial

Se preservó completo: 393 commits, el más antiguo del 19-05-2026.

Los commits antiguos referencian las rutas **originales** (`lib/proxy.ts`), no
las nuevas (`apps/scora-research/lib/proxy.ts`). Para ver el historial de un
fichero hay que usar la ruta antigua y `--full-history`:

```bash
git log --full-history -- lib/proxy.ts
```

Las 7 ramas de ambos repos quedaron guardadas como tags `legacy/<repo>/<rama>`.
Incluye `legacy/ic-proxy/security/hardening-2026-08`, que ya fue borrada de
GitHub y solo sobrevivía en un clon local.
