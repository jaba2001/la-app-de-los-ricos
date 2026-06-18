# Despliegue — Research (Tiers 1–3 + A8) + Reverse DCF · runbook unificado

Runbook único para poner en producción **dos batches** que viven en StockLens a
la vez: (a) las mejoras macro/micro de *Research*, y (b) el *Reverse DCF* ("qué
descuenta el precio"). **Todo nace apagado**: con los flags por defecto (todos
`false` y el peso del reverse DCF en `0`), IC DataLayer y StockLens se comportan
**idénticos a hoy**. Nada cambia de cara al usuario hasta que enciendes un flag a
propósito (paso 7).

> StockAnalyzer ahora lleva **los dos batches**: un solo push de StockLens
> despliega ambos (siguen apagados). ic-proxy e IC DataLayer solo intervienen
> para el batch de Research; **el Reverse DCF no toca ic-proxy**.

> Regla de oro: **aplica las migraciones SQL ANTES de desplegar ic-proxy.**
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
| **Reverse DCF F1** (núcleo) | — | — | `19b5223` |
| **Reverse DCF F2** (datos+WACC / caché) | — | — | `9d7f8ac` · `878a1a0` |
| **Reverse DCF F3** (UI "Descuento") | — | — | `17108cc` |
| **Reverse DCF F4** (IC Score, peso 0) | — | — | `a2fe932` |

---

## Paso 0 — Pre-vuelo

- [ ] Estás en la rama correcta de cada repo y los commits de arriba están presentes
      (`git log --oneline -5` en cada repo).
- [ ] Tienes a mano: acceso SQL a Supabase, `CRON_SECRET`, y las URLs de prod.
- [ ] Confirma que los flags están **off** (lo están por defecto):
  - `ic-proxy/lib/macro.js` → `IC_FLAGS = { A2_RECESSION_GATE: false }`
  - `StockAnalyzer/StockAnalyzer.jsx` → `SL_FLAGS = { B1_REGIME_WEIGHTS: false, B2_RATE_SENSITIVITY: false, REVERSE_DCF_ENABLED: false }`
  - `StockAnalyzer/StockAnalyzer.jsx` → `const RDCF_VALUATION_WEIGHT = 0;` (peso del reverse DCF en el IC Score)

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

### Reverse DCF — columna `sl_analyses.reverse_dcf` (YA aplicada)

- La migración `add_reverse_dcf_to_sl_analyses` (columna `reverse_dcf jsonb`
  nullable) **ya está aplicada** en producción. **No** forma parte de las 4 de
  arriba y **no** hay que volver a ejecutarla. Verificación opcional:
  ```sql
  select column_name, data_type from information_schema.columns
  where table_name = 'sl_analyses' and column_name = 'reverse_dcf';
  ```
- **Dependencia cruzada (rf del WACC):** el Reverse DCF lee `macro_state.dgs10`
  (solo lectura) para el risk-free. Ese campo lo provee el **batch de Research**
  (Tier 1 migración + cron). Por tanto:
  - Si despliegas Research → el reverse DCF usa el 10Y real (alta confianza).
  - Si NO has desplegado Research aún → el reverse DCF funciona igual con un rf
    por defecto (4,3%) y marca el resultado `lowConfidence:true` (banner ámbar en
    la card). Se afina solo en cuanto `dgs10` empiece a escribirse. No rompe nada.

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
- [ ] Push del repo `StockAnalyzer` (Vercel auto-despliega). **Este push lleva los
      dos batches** (Research + Reverse DCF); ambos siguen apagados por sus flags.
- [ ] Tras analizar un ticker, el badge **F&G / P/C** (A8) aparece junto al
      *Macro Tilt*; el tag **IPO/lockup** (B3) en la meta de la empresa.
- [ ] El Reverse DCF **no** debe verse aún: con `REVERSE_DCF_ENABLED:false` no hay
      pestaña «Descuento» ni cambios en el IC Score (se enciende en el paso 7).

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
| `SL_FLAGS.REVERSE_DCF_ENABLED` | `StockAnalyzer/StockAnalyzer.jsx` | Aparece la pestaña **«Descuento»** + se cachea `reverse_dcf` al analizar. **NO mueve el IC Score** todavía (peso 0) | recompila + push | pestaña visible; tras analizar, `select reverse_dcf from sl_analyses` trae filas |
| `RDCF_VALUATION_WEIGHT` (subir de `0`) | `StockAnalyzer/StockAnalyzer.jsx` | La señal reverse-DCF entra en la dimensión Valuation del IC Score | recompila + push | **tabla antes/después obligatoria** (ver abajo) + tu OK |

**Recompilar StockLens tras tocar un flag/peso** (NUNCA editar el `.js` a mano):
```bash
cd StockAnalyzer
"/c/Users/aaao0/bin/node.exe" -e "const fs=require('fs');const babel=require('C:/Users/aaao0/bin/babel-standalone.js');const src=fs.readFileSync('StockAnalyzer.jsx','utf8');const r=babel.transform(src,{presets:['react'],filename:'StockAnalyzer.jsx',sourceType:'script'});fs.writeFileSync('StockAnalyzer.js',r.code);console.log('OK',r.code.length)"
node scripts/compile-check.js && node scripts/rdcf-golden.js && node scripts/validate-js.js && node scripts/smoke.js
git add StockAnalyzer.jsx StockAnalyzer.js && git commit -m "Enable flag" && git push
```

> ⚠️ Encender B1/B2 — o subir `RDCF_VALUATION_WEIGHT` por encima de 0 — cambia el
> `score_total` que se persiste en `sl_analyses`. El histórico previo se computó
> sin ese ajuste; a partir del cambio será distinto. Es una decisión deliberada
> (no afecta a nadie con el flag off / peso 0).

### Secuencia recomendada para el Reverse DCF (orden importa)

1. Enciende **solo** `REVERSE_DCF_ENABLED` (deja `RDCF_VALUATION_WEIGHT = 0`).
   Recompila, push. Esto muestra la pestaña y empieza a **cachear** `reverse_dcf`,
   pero **el IC Score no se mueve** (doble gate: peso 0).
2. Analiza ~8–10 tickers en la app (esto persiste su `reverse_dcf`; 0 fetches extra
   al abrir — es fetch-on-demand por ticker).
3. Exporta esas filas y revisa el **antes/después** del IC Score a un peso candidato:
   ```bash
   # Exporta de Supabase: ticker, score_total, macro_tilt, reverse_dcf (JSON array)
   # → StockAnalyzer/scripts/_rows.json   (o pasa otra ruta como 1er argumento)
   cd StockAnalyzer
   node scripts/rdcf-score-table.js scripts/_rows.json 0      # weight 0 → Δ=0 en todos (control)
   node scripts/rdcf-score-table.js scripts/_rows.json 0.5    # weight candidato
   ```
4. **Solo tras revisar esa tabla y dar el OK**, sube `RDCF_VALUATION_WEIGHT` (p. ej.
   0.25→0.5), recompila, push. Vuelve a verificar con la tabla.

---

## Rollback

- **Flags:** vuelve el flag a `false`, recompila (StockLens) y re-despliega. Vuelve
  al comportamiento de hoy al instante.
- **Reverse DCF — dos niveles:**
  - Para quitar **solo el efecto en el IC Score** sin esconder la pestaña: pon
    `RDCF_VALUATION_WEIGHT = 0`, recompila, push. La card sigue visible; el score
    vuelve al de hoy.
  - Para esconderlo del todo: `REVERSE_DCF_ENABLED = false`, recompila, push.
- **Migraciones:** son aditivas; no hace falta revertirlas. Si quisieras, las
  columnas nuevas (incl. `sl_analyses.reverse_dcf`) son nullable y se pueden
  `DROP COLUMN` sin tocar lo existente.
- **Código:** cada fase es un commit aislado; `git revert <sha>` del commit
  correspondiente y re-deploy. Reverse DCF: `19b5223` (F1), `9d7f8ac`/`878a1a0`
  (F2), `17108cc` (F3), `a2fe932` (F4).
