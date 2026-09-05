# Decisión B — dejar de invertir en selección

**Fecha:** 2026-09-03 · **Estado:** decisión tomada sobre evidencia, no sobre intuición
**Contexto:** `PLAN_DEFINITIVO.md` §3.B

Este documento existe para que la decisión no se vuelva a discutir sin evidencia nueva, y para
que quede escrito **qué haría falta para revertirla**.

---

## La evidencia: tres medidas independientes

| # | medida | resultado | cuándo |
|---|---|---|---|
| 1 | **Selección de valores** (N-stock) | `IC ~0` · +127,6 % contra +154,2 % del índice | antes de esta sesión |
| 2 | **Selección de clase de activo** — ampliar el universo de 7 a 21 activos | Sharpe **0,99 → 0,73**, y las tres variantes fallan con **t = −2,12 / −2,93 / −2,90** | 2026-09-03 |
| 3 | **Atribución de Brinson** por categoría de activo | **96,1 % asignación · 3,9 % selección** (Carino, residuo −1,25e−12) | 2026-09-03 |

Las tres apuntan a lo mismo desde ángulos distintos, y la tercera lo hace de forma **estructural**:
la selección sale **0,0000 exacto** en todas las clases de un solo activo, y los 13,1 pp que quedan
vienen enteros de elegir TLT o IEF dentro de duración.

⚠️ Y la segunda medida trae un detalle que conviene recordar: no es sólo que la selección no
aporte, es que **ampliar el universo hace daño medible**. Elegir el ganador reciente dentro de una
clase sustituye una cesta diversificada de 500 valores por uno concentrado; «tenerlos todos»
diluye en internacional y small caps. Los activos de producción **ya son carteras diversificadas
elegidas como representantes de clase**.

---

## Qué se deja de hacer

- **Fase 4 del plan v2** — reconstruir el índice ponderado por capitalización, punto en el tiempo.
  Era «el 70 % del trabajo» y sólo sirve para responder una pregunta sobre selección.
- **Fase 5** — Scora Picks con pesos activos (infraponderar en vez de excluir, dimensionar por
  convicción). Sigue siendo la forma *correcta* de construir una cartera activa; lo que ha caído
  es la probabilidad a priori de que la selección subyacente aporte algo.
- **Más variantes del universo ampliado.** Ya se midieron tres y las tres fallan. Una cuarta
  sería un barrido, no una hipótesis.

---

## La pregunta que queda abierta: ¿debe existir Scora Picks?

Medido hoy, su huella de mantenimiento:

```
research/picks_rules_backtest.mjs   1.024 líneas
scripts/picks.test.mjs                671 líneas   (172 asserts)
research/cron-picks.mjs               414 líneas
lib/picks.ts                          290 líneas
                                    ─────
                                    2.399 líneas + 4 pasos de CI + un cron
```

Frente a eso, la evidencia a favor es **ninguna**: `IC ~0`. El allocator sí tiene evidencia
descriptiva (captura 65/46, drawdown estable en ocho ventanas, atribución que lo explica).

**No propongo retirarlo hoy** — es una decisión de producto y hay razones para mantenerlo que no
son de rentabilidad: sirve de demostración del motor de research con IA fundamentada, que es el
foso técnico declarado. Pero **conviene decidirlo a la vista y no por inercia**, y si se mantiene,
que sea por esa razón y no por una expectativa de alfa que tres medidas ya han descartado.

---

## Qué haría falta para revertir esta decisión

No «una idea nueva». Cualquiera de estas tres, medida:

1. **Un universo menos eficiente.** Small/mid caps o Europa. Es la única vía con base teórica: la
   eficiencia del mercado de grandes valores estadounidenses es precisamente lo que hace inútil la
   selección ahí. Sigue **sin explorarse** y sería un ensayo preespecificado legítimo.
2. **Una señal con evidencia externa**, no derivada de los mismos datos con los que se validaría.
3. **Un horizonte mucho más largo con reglas selladas por delante.** El problema no es sólo el
   tamaño del efecto: es que ya se han gastado **344 ensayos** sobre estas dos décadas, y el
   Sharpe deflactado del propio allocator sólo llega al **81,1 %** por eso mismo.

---

## Lo que esta decisión NO dice

- **No dice que la selección de valores sea imposible.** Dice que no la hemos encontrado en el
  S&P 500 con estos datos, y que seguir buscando ahí tiene un coste de oportunidad alto.
- **No dice que Picks esté mal construido.** Las reglas v3, la deduplicación por emisor, el gate
  de correlación y los guardianes anti-deriva son correctos. Lo que falta es que la señal de
  partida ordene el universo, y eso ya se midió que no ocurre.
- **No toca el allocator**, que es donde está la evidencia.
