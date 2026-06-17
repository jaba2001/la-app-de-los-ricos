# Despliegue — Mejoras de Research (Tiers 1–3 + A8)

Runbook para poner en producción las mejoras macro/micro. **Todo nace apagado**:
con los flags por defecto (todos `false`), IC DataLayer y StockLens se comportan
**idénticos a hoy**. Nada cambia de cara al usuario hasta que enciendes un flag
a propósito (paso 7).

> Regla de oro: **aplica las 4 migraciones SQL ANTES de desplegar ic-proxy.**
> PostgREST rechaza un upsert que referencia una columna inexistente (HTTP 400),
> y eso dejaría el refresco de `macro_state` parado. Migraciones → cron, en ese orden.

Commits locales (sin push) que entran en este despliegue:

| | ic-proxy | IC-DataLayer | StockLens |
|---|---|---|---|
| F1 (A1–A4) | `d46a445` | `6fe1df4` | — |
| F2 (B1) | — | — | `9b1d883` |
| F3 (A5–A7, B2) | `03646b9` | `125a8cd` | `0c0d7be` |
| F4 (liq. global, B3) | `548c42e` | `d0e7ee9` | `f81f232` |
| A8 (put/call + F&G) | `adca1cc` | — | `e2668d5` |

---

## Paso 0 — Pre-vuelo

- [ ] Estás en la rama correcta de cada repo y los commits de arriba están presentes
      (`git log --oneline -5` en cada repo).
- [ ] Tienes a mano: acceso SQL a Supabase, `CRON_SECRET`, y las URLs de prod.
- [ ] Confirma que los flags están **off** (lo están por defecto):
  - `ic-proxy/lib/macro.js` → `IC_FLAGS = { A2_RECESSION_GATE: false }`
  - `StockAnalyzer/StockAnalyzer.jsx` → `SL_FLAGS = { B1_REGIME_WEIGHTS: false, B2_RATE_SENSITIVITY: false }`

---

## Paso 1 — Aplicar las 4 migraciones SQL en Supabase

Todas son **aditivas** (solo `ADD COLUMN IF NOT EXISTS`, todo nullable) e
**idempotentes** (se pueden re-ejecutar). En el SQL Editor de Supabase, ejecuta
en este orden (el orden no es crítico porque son aditivas, pero así queda limpio):

1. `sql/2026-06-16_macro_state_research_fields.sql`  (Tier 1: A1/A2/A3/A4)
2. `sql/2026-06-17_macro_state_research_tier2.sql`   (Tier 2: A5/A6/A7)
3. `sql/2026-06-17_macro_state_research_tier3.sql`   (Tier 3: liquidez global)
4. `sql/2026-06-17_macro_state_sentiment_a8.sql`     (A8: put/call + Fear&Greed)

- [ ] Verifica que las columnas existen (rápido):
  ```sql
  select column_name from information_schema.columns
  where table_name = 'macro_state'
    and column_name in ('dgs30','net_liquidity_dir','fed_room','buffett_indicator',
                        'ecb_assets','global_liquidity_dir','put_call_ratio','sentiment_signal')
  order by column_name;
  ```
  Deben aparecer las 8.

---

## Paso 2 — Desplegar ic-proxy

- [ ] Push del repo `ic-proxy` (Vercel auto-despliega).
- [ ] Confirma que en Vercel están las env vars que usan las señales nuevas:
      `FRED_KEY` (A1/A2/A3/A5/A6/A7 + liq. global), `FMP_KEY` (A4 proxy privado),
      `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `CRON_SECRET`. (A8 no necesita key.)
- [ ] Dispara el cron a mano y revisa la respuesta (debe traer `ok:true` y un
      objeto `wrote` con las columnas nuevas):
  ```bash
  curl -s -H "Authorization: Bearer $CRON_SECRET" \
    https://ic-proxy-psi.vercel.app/api/cron/macro-refresh | jq '.ok, .wrote'
  ```
  - Las series FRED deben venir con valor; `credit_private_proxy` requiere `FMP_KEY`;
    `put_call_ratio`/`fear_greed` pueden venir `null` si CNN bloquea la IP del
    datacenter (degradación con gracia — no rompe nada).

---

## Paso 3 — Desplegar IC DataLayer

- [ ] Push del repo `IC-DataLayer` (Vercel auto-despliega).
- [ ] La card **«Indicadores Research»** aparece bajo el gráfico de composites tras
      pulsar **↻ Cargar Datos** (se calcula client-side; 0 fetches al abrir).

---

## Paso 4 — Desplegar StockAnalyzer (StockLens)

- [ ] Asegúrate de que `StockAnalyzer.js` está recompilado desde el `.jsx` y ambos
      commiteados (ya lo están en los commits de arriba).
- [ ] Push del repo `StockAnalyzer` (Vercel auto-despliega).
- [ ] Tras analizar un ticker, el badge **F&G / P/C** (A8) aparece junto al
      *Macro Tilt*; el tag **IPO/lockup** (B3) en la meta de la empresa.

---

## Paso 5 — Smoke contra prod (tras CADA deploy)

```bash
node StockAnalyzer/scripts/smoke.js
```
Debe decir «TODAS las apps montaron limpias».

---

## Paso 6 — Verificación automática

```bash
# Requiere: SUPABASE_URL + SUPABASE_SERVICE_KEY (o ANON) y CRON_SECRET en el entorno
#           (verify-prod toma ic-proxy/.env.local automáticamente si existe).
CRON_SECRET=... SUPABASE_SERVICE_KEY=... node ic-proxy/scripts/verify-prod.mjs
```
Comprueba: (1) que las columnas nuevas existen, (2) que el cron las está
escribiendo, (3) frescura de `macro_state`, (4) que ambas apps montan. Ver el
detalle en `scripts/verify-prod.mjs`.

---

## Paso 7 — Encender flags (uno a uno, decisión tuya, tras ver pruebas)

Cada flag está **off**. Enciéndelos de uno en uno y vuelve a verificar.

| Flag | Archivo | Efecto al encender | Re-deploy | Re-check |
|---|---|---|---|---|
| `IC_FLAGS.A2_RECESSION_GATE` | `ic-proxy/lib/macro.js` | El régimen retiene «contracción»→«transición» si claims no suben y beneficios no caen | push ic-proxy | dispara el cron y mira `regime_id`; **golden no aplica** (vive fuera del motor) |
| `SL_FLAGS.B1_REGIME_WEIGHTS` | `StockAnalyzer/StockAnalyzer.jsx` | El régimen re-pondera las 4 dimensiones del IC Score | recompila + push (ver abajo) | tabla antes/después en 8–10 tickers |
| `SL_FLAGS.B2_RATE_SENSITIVITY` | `StockAnalyzer/StockAnalyzer.jsx` | Penaliza apalancamiento/baja cobertura en regímenes de tipos altos | recompila + push | tabla antes/después |

**Recompilar StockLens tras tocar el flag** (NUNCA editar el `.js` a mano):
```bash
cd StockAnalyzer
"/c/Users/aaao0/bin/node.exe" -e "const fs=require('fs');const babel=require('C:/Users/aaao0/bin/babel-standalone.js');const src=fs.readFileSync('StockAnalyzer.jsx','utf8');const r=babel.transform(src,{presets:['react'],filename:'StockAnalyzer.jsx',sourceType:'script'});fs.writeFileSync('StockAnalyzer.js',r.code);console.log('OK',r.code.length)"
node scripts/compile-check.js && node scripts/smoke.js
git add StockAnalyzer.jsx StockAnalyzer.js && git commit -m "Enable B1/B2 flag" && git push
```

> ⚠️ Encender B1/B2 cambia el `score_total` que se persiste en `sl_analyses`. El
> histórico previo se computó con pesos planos; a partir del cambio será
> re-ponderado. Es una decisión deliberada (no afecta a nadie con el flag off).

---

## Rollback

- **Flags:** vuelve el flag a `false`, recompila (StockLens) y re-despliega. Vuelve
  al comportamiento de hoy al instante.
- **Migraciones:** son aditivas; no hace falta revertirlas. Si quisieras, las
  columnas nuevas son nullable y se pueden `DROP COLUMN` sin tocar lo existente.
- **Código:** cada fase es un commit aislado; `git revert <sha>` del commit
  correspondiente y re-deploy.
