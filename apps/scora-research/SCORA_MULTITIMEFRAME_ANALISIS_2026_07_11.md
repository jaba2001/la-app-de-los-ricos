# Scora — Análisis del proposal "Multi-Timeframe Top-Down" · 2026-07-11

> Investigación profunda del mensaje que propone fragmentar el Scora Score en 3 capas temporales (mensual/semanal/diario) con "alfa por confluencia". Analizado contra la arquitectura REAL de Scora y **medido** (`research/multitimeframe_lab.mjs`), no aceptado por plausibilidad.

---

## TL;DR

El proposal es **~70% ya implementado en Scora** (con otro nombre), **~15% valioso pero como capa de CONTEXTO/DISCIPLINA, no de alfa**, y **~15% empíricamente peligroso si se toma literal**. Su afirmación central — que la confluencia multi-timeframe genera alfa y reduce drawdown — **la medí y NO se sostiene**. Lo bueno que aporta ya lo hace Scora (jerarquía top-down); lo nuevo y útil es de explicabilidad, no de rendimiento.

---

## 1. La medición (lo primero, porque decide todo) — survivorship-free, 100 nombres, 2010-2026

**IC de momentum por horizonte (Spearman cross-sectional ↔ retorno futuro):**

| Señal → fwd | IC total | baja-corr | media | alta-corr |
|---|---|---|---|---|
| **LONG 12-1m → 3m** | −0.014 | **+0.093** | −0.025 | −0.111 |
| MED 3-1m → 3m | −0.001 | −0.002 | +0.063 | −0.060 |
| **SHORT 1m → 3m** | −0.022 | **−0.041** | +0.012 | −0.031 |

**Confluencia multi-timeframe (LONG entre nombres con MED+SHORT alineados) vs LONG solo:**
- fwd 1m: confluencia **+0.002** vs long-solo −0.009 (marginal)
- fwd 3m: confluencia **−0.040** vs long-solo −0.014 (**PEOR**)

**Tres conclusiones medidas:**
1. **Solo el momentum 12-1m tiene poder predictivo real, y solo en baja correlación** (IC +0.093 a 3m). En alta correlación se invierte (momentum crash, −0.111). → Es EXACTAMENTE lo que Scora ya usa (meta-switch por correlación, `stockPickingRegime` + `trajectoryScore`).
2. **El momentum de corto plazo (1m, el "trigger diario") REVIERTE, no continúa** (IC −0.022/−0.041). Un trigger diario de momentum compraría techos. Es el efecto de reversión a 1 mes de Jegadeesh (1990), confirmado en nuestros datos.
3. **La confluencia multi-timeframe NO añade alfa** (marginal a 1m, negativa a 3m). Exigir los 3 horizontes alineados encoge la muestra a nombres sobre-extendidos justo cuando están más caros, y el componente de corto plazo mete el drag de reversión.

> Igual que apalancamiento, CPPI y collar: idea plausible, **medida y descartada** como fuente de alfa.

---

## 2. Mapeo: el proposal vs lo que Scora YA tiene

| Capa del proposal | Estado en Scora | Veredicto |
|---|---|---|
| **Mensual — Macro/Bias** | `getMacroTilt(risk_on)` ±20 + Secular Clock (L1) + risk-on allocation (L2) + regime switch del allocator. **La capa más validada.** | ✅ Ya es el core. |
| **Semanal — Trend/Sector** | 12-1m momentum (`trajectoryScore`), rotación sectorial top-3 (`rankSectors`, Sharpe 0.76 vs 0.71), `stockPickingRegime`. Falta: fuerza relativa del STOCK vs sector/SPY *dentro del score* (existe en UI: StockSmartMoney, InstrumentPanel). | ✅ Mayormente sí; RS a nivel stock es la única pieza aditiva. |
| **Diario — Timing trigger** | Indicadores técnicos (RSI/ADX/divergencias) existen pero **fuera del score** (solo display en el chart). Scora es allocator de **rebalanceo mensual** por diseño validado. | ⚠️ El proposal lo usa mal (momentum diario = reversión). |
| **Jerarquía (macro gatea todo)** | `topDownContext` L1→L4 + el loop de breadth + el gate de correlación. | ✅ Es la filosofía de diseño validada. |
| **"Macro predice qué stocks liderarán" = alfa** | Medido toda la sesión: a nivel **asset-class** sí (allocator Sharpe 0.99 vs 0.72); a nivel **sector** modesto (0.76 vs 0.71); a nivel **stock individual** débil (value/quality IC 0.007; momentum solo condicional). | ⚠️ Cierto en allocation/sector, sobre-vendido a nivel stock. |

---

## 3. Lo que está bien, lo que choca, lo que aporta

**✅ Correcto (y ya en Scora):** la jerarquía top-down (el macro gatea; un rebote diario alcista contra un macro bajista es solo un rebote). Es literalmente el diseño de Scora.

**❌ Choca con la evidencia:**
- "Trigger diario de momentum" → el corto plazo revierte; comprarías fuerza reciente = techos.
- "Confluencia genera alfa / reduce drawdown" → medido marginal/negativo. El drawdown lo reduce el **switch de régimen** (medido: −17% vs −51% del índice), no la confluencia de stock.
- "Macro predice qué stocks suben" a nivel single-name → débil; el alfa está en la ASIGNACIÓN, no en el timing de acciones.

**✅ Aporta de verdad (pero como CONTEXTO/DISCIPLINA, no alfa):**
- Hacer **explícita y visible** la jerarquía temporal en el objeto del score, para que el usuario no actúe sobre un rebote contra el macro. Valor de UX y disciplina, no de rendimiento.
- Usar el horizonte corto correctamente: como filtro de **reversión / sobrecompra** ("¿estás persiguiendo o esperando un pullback?"), no como score de continuación.
- Meter la **fuerza relativa vs sector/SPY** en el score (única pieza stock-level aditiva; ojo: las señales stock-level son débiles de por sí).

---

## 4. Diseño CORRECTO para Scora (si se implementa) — capa de conviccíon, no motor de alfa

Extender `topDownContext` (ya hace L1→L4) para exponer un objeto multi-horizonte HONESTO:

```ts
timeframes: {
  macro:  { bias: number,  label: "risk-on"|"neutral"|"risk-off" },   // GATE (getMacroTilt/risk_on) — validado
  trend:  { mom12_1: number, rsVsSector: number, rsVsSpy: number },     // 12-1m (condicional a corr) + RS
  timing: { rsi14: number, distFrom200dma: number,
            state: "oversold/entry" | "neutral" | "overbought/chasing" }, // corto = REVERSIÓN, no momentum
  confluence: "aligned-up" | "aligned-down" | "mixed",
  convictionMult: 0.6–1.0  // alto solo si macro-gate y trend coinciden; el timing modula la ENTRADA, no el bias
}
```

Reglas honestas: el **macro gatea** (si es bajista, un trend/timing alcista es un rebote, se etiqueta así); el **trend** solo cuenta con correlación baja (meta-switch ya existente); el **timing corto** avisa de sobrecompra/entrada, NUNCA suma momentum de continuación; la **confluencia** sube conviccíon pero **no promete alfa** (medido). Se vende como *claridad de ejecución y disciplina top-down*, no como "batir al mercado con confluencia".

---

## 5. Recomendación

- **NO** construir un "motor de alfa multi-timeframe": lo medí y la confluencia no genera exceso de retorno; el corto plazo revierte. Hacerlo sería el tipo de over-claim que el gate anti-alucinación de Scora existe para evitar.
- **SÍ** (opcional, si quieres) implementar la capa multi-timeframe como **explicabilidad/disciplina**: extender `topDownContext` con el objeto de arriba, mostrando bias macro / trend condicional / timing de reversión / confluencia — para que el usuario vea si un stock es una compra estructural o un rebote, y cuándo NO perseguir. Aditivo, honesto, sin tocar el edge validado (la asignación por régimen).
- El "alfa" real y medido sigue siendo el mismo de toda la sesión: **asignación multi-activo por régimen, ajustada al riesgo** (Sharpe 0.99 vs 0.72, un tercio del drawdown). La capa temporal mejora la NARRATIVA y la DISCIPLINA, no el número.

Artefacto de medición: `research/multitimeframe_lab.mjs` → `research/out/multitimeframe_lab_full.json`.

---

## 6. AMPLIACIÓN (2026-07-11) — el diferenciador macro→stock, medido y precisado

El usuario insistió (con razón) en que **el macro predice qué stocks lideran** es la identidad de Scora, y que fui demasiado tajante. Lo medí propiamente (`research/regime_sector_lab.mjs`, 1999-2026, 244 meses):

- **Régimen → SECTOR**: un tilt concentrado a los 2 sectores que lideran el régimen actual (leave-one-out) hizo **14.6%/año, Sharpe 0.85, +1501%** vs SPY 11.2%/0.74/+758% → **bate a SPY en retorno Y Sharpe** (top-3/4 revierte a ~SPY: depende de concentración; parte es el efecto secular tech).
- **Régimen → FACTOR (la señal más limpia)**: **Growth** lidera en expansion/reflation/stagflation, **pierde en contraction/neutral**; **Value** al revés. Es la rotación growth↔value documentada, confirmada en los datos.

**Conclusión precisada — tu tesis es correcta, opera a nivel FACTOR y SECTOR (cestas), no single-name:**
- Macro → asset-class: fuerte (el allocator, Sharpe 0.99 vs 0.72).
- Macro → factor/sector: **real y explotable** (esto es "qué stocks lideran", bien hecho).
- Macro → acción individual: ruido idiosincrático (débil).

**Hueco encontrado y aprovechado**: `getMacroTilt` solo inclinaba por SECTOR (risk-on/off), NO por FACTOR. La nueva capa `lib/timeframes.ts` codifica la **rotación regime→factor MEDIDA** en su read mensual: un nombre growth tiene tailwind en reflation, un nombre value lo tiene en contraction, etc. — "el macro dice qué stocks tienen viento de cola", a nivel de estilo, con evidencia.

## 7. IMPLEMENTADO — capa multi-timeframe honesta (`lib/timeframes.ts`)

**Aclaración de temporalidades (la duda del usuario)**: NO son 3 scores compitiendo. Es UN Scora Score envuelto en 3 LECTURAS de contexto, cada una responde una pregunta a una velocidad distinta:
- **MENSUAL (estructural)** — "¿Debo tenerlo?" → tailwind macro/régimen del SECTOR + FACTOR del nombre (con la rotación medida). Es el PORTERO.
- **SEMANAL (tendencia)** — "¿Está en tendencia real y liderando?" → momentum 12-1m + fuerza relativa vs sector/SPY.
- **DIARIO (timing)** — "¿Buena entrada o persigo?" → filtro de REVERSIÓN (RSI + distancia 200d). Alto = sobreventa/pullback (buena entrada); bajo = sobrecompra (persiguiendo). NO es momentum de continuación.

**Confluencia** → veredicto: `structural-buy` / `leader-extended` (líder pero sobrecomprado, espera pullback) / `bounce-vs-macro` (fuerza contra el macro = rebote) / `improving` / `avoid` / `mixed`, con `convictionMult` 0.6-1.0. El mensual GATEA: fuerza contra un headwind macro es rebote, no compra. Surface en StockOverview (tarjeta "Timeframes · top-down"). Honesto: es contexto y disciplina de ejecución, no un motor de alfa nuevo (medido: la confluencia no da alfa; el edge sigue en la asignación por régimen).

## 8. PLEGADO EN EL SCORE + PRODUCTIZADO (2026-07-11, decisión del usuario)

El usuario pidió aplicar ambas decisiones abiertas. Hechas E2E con validación:

**Validación previa (regla Scora: medir antes de plegar)** — `research/regime_factor_validate.mjs`, 2000-2026, 312 meses (incluye dot-com y GFC): una rotación regime→growth/value (IWF/IWD) dio **Sharpe 1.24** vs SPY 0.74, static-50/50 0.83, siempre-growth 0.93. **VALIDADO** → plegar en el score.

**(A) Regime→factor plegado en `getMacroTilt`**: el score ahora inclina ±4 según si el estilo dominante del nombre (de calcFactorTilts) coincide con lo que el régimen premia (growth en expansion/reflation, value en contraction/neutral). `factorTilts` opcional (backward-compatible); callers actualizados (stock page comparte scoreInputs entre calcScores/calcFactorTilts; screener igual). Cap ±20 intacto. Tests de comportamiento en golden (growth +tilt en reflation, −tilt en contraction; value invierte).

**(B) Productizado "Macro-favored (this regime)"** en SectorRotation: muestra el estilo favorecido + los 3 sectores con tailwind medido para el régimen actual, con la validación (Sharpe 1.24). El diferenciador visible: "el régimen elige el viento de cola, no el nombre".

**Arquitectura**: `lib/regimeSectors.ts` = fuente canónica (tablas medidas, pura, UI la importa); scoring.ts y timeframes.ts llevan copia inline (deben ser node-cargables por el golden — sin imports de valor); anti-drift en golden pincha ambas al mismo signo + los claims vs regime_factor_validate.json. **475 tests golden.** Nivel correcto: opera vía factor/sector (cestas), no single-name.

## 9. FASE 1 — Sector-tilt como ESTRATEGIA: MEDIDO Y RECHAZADO (2026-07-11)

Antes de productizar el "top-2 sector-tilt" como estrategia (no panel), lo re-validé con **ventana expansiva OOS estricta** (sin la fuga del leave-one-out del +1501% original): `research/sector_tilt_validate.mjs`, 312 meses 2000-2026.

- **Sector-tilt OOS**: top-2 Sharpe 0.54, top-3 0.61 — **por debajo de SPY (0.74)** y de equal-weight-9 (0.71). Sin Tech: 0.51/0.53 (peor → era un proxy de Tech + concentración).
- **Como sleeve de equity del Growth allocator (decisivo)**: Growth con SPY plano Sharpe **1.01** / Sortino 1.83 / maxDD −17.3%; con sector-tilt top-3 **0.93** / 1.65 / −19.8%; top-2 **0.90** / 1.60 / −18.7%. El tilt **EMPEORA** el allocator validado en todo.
- La **rotación de sectores por momentum** (top-3 12-1m, que YA existe en lib/sectors.ts) sí iguala a SPY (Sharpe 0.74, −41% DD) — es la única versión sectorial que se sostiene, y ya está en el producto como panel Layer-3.

**VEREDICTO: NO VALIDADO.** El sector-tilt por régimen es leakage; OOS destruye valor. Se queda como PANEL informativo (contexto histórico), no como estrategia. Contraste importante: el tilt **por FACTOR** (growth/value) sí se plegó al score porque es una regla de BAJO parámetro (5 decisiones binarias) fundamentada en teoría documentada y validada con regla fija (Sharpe 1.24); el tilt **por SECTOR** es un data-mine de alto parámetro (9 sectores × 5 regímenes) que sobreajusta. Medir antes de construir, otra vez, evitó meter concentración disfrazada de alfa.

## 10. Cierre de la brecha de validación del fold (2026-07-12)

Re-corrí el backtest de stock-selection A/B (con/sin el fold regime→factor), survivorship-free `--full 120 --macro`, para confirmar que plegar el tilt no daña el IC forward del score:
- **CON fold (= producción)**: IC 0.015; BUY α reflation **+1.3%**, contraction −14.2%.
- **SIN fold**: IC 0.017; BUY α reflation +0.7%, contraction −14.5%.

**Veredicto**: el fold NO daña el IC (0.015 vs 0.017 = ruido, n=78) y **donde se activa** (reflation/contraction) mejora el α direccionalmente (+0.6pp / +0.3pp). La ventana 2020-26 es casi toda expansion (73/78 meses) donde el fold apenas dispara → IC global casi idéntico, esperado. Con la señal ya validada 2000-2026 (Sharpe 1.24), brecha cerrada.

**Bug de paso arreglado**: `research/score.mjs` llamaba `getMacroTilt(macro, sector)` SIN `factorTilts` → el backtest había divergido del camino de producción (que sí pasa el perfil de factor). Corregido: score.mjs ahora computa `calcFactorTilts` y lo pasa (paridad backtest↔producción restaurada), con `FACTOR_FOLD=0` para el A/B. cron-score pasa `null` macro → no afectado.

## 9b. Completado — momentum-rotation como sleeve (la única señal sectorial que se sostiene standalone): como sleeve de equity del Growth allocator da Sharpe **1.00** / Sortino 1.77 / maxDD −19.6% / α 6.72 vs SPY plano **1.01** / 1.83 / −17.3% / 5.92. Es un **empate ajustado-al-riesgo con peor drawdown** (más retorno bruto +617% vs +558% y más alfa, pero peor Sortino/DD por la concentración). **Ninguna estrategia sectorial mejora el sleeve de equity del allocator** — el SPY plano gana en riesgo-ajustado. Fases 2-4 NO se construyen (Fase 2 no tiene nada validado que poner; Fase 3 requiere un fondo nuevo para una estrategia que solo empata; Fase 4 ya está hecha — el panel SectorRotation muestra en vivo los sectores favorecidos por momentum + por régimen + los stats backtesteados).
