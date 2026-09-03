# Plan definitivo — qué hacer con Scora, con la evidencia sobre la mesa

**Fecha:** 2026-09-03 · **Estado:** todo lo que sigue está medido y verificado
**Sustituye a** `PLAN_GESTION_ACTIVA_V2.md` en lo estratégico; ese documento sigue valiendo como
descripción técnica de las fases.

> **Verificación previa:** 2.183 asserts en 24 ficheros, `test:all` en verde, y **29 de 30
> afirmaciones hechas al usuario comprobadas una a una contra los artefactos**. La 30 era un valor
> esperado mal escrito en el propio script de verificación, no una afirmación falsa.

---

## 1 · Lo que ha quedado establecido

### ✅ El claim es cierto como DESCRIPCIÓN

| | growth | SPY |
|---|---:|---:|
| Captura alcista | **64,7 %** | 100 % |
| Captura bajista | **45,8 %** | 100 % |
| Máximo drawdown | **−16,2 %** | −50,7 % |
| M² (al riesgo del índice) | **14,13 %** | — |
| M²-alfa | **+3,92 pp/año** | — |

Participa en dos tercios de las subidas y sufre menos de la mitad de las caídas. **Eso es
exactamente «iguala al índice con un tercio del drawdown», y se sostiene.**

### ❌ Pero NO es superioridad estadística

| contraste | t | veredicto |
|---|---:|---|
| Sharpe vs SPY | 1,47 | no significativo |
| Sharpe vs 60/40 | 0,97 | no significativo |
| Timing (Merton-Henriksson) vs SPY | 1,38 | no |
| Timing (Treynor-Mazuy) vs SPY | 2,08 | sí, pero contra la referencia equivocada |
| Timing vs 60/40 (los dos tests) | 1,29 · 1,54 | no |

**1 de 8 contrastes.** Y el que sale es contra el S&P 500, donde una estrategia que lleva renta
fija parece temporizar sólo por no ser 100 % bolsa.

⚠️ Lo que destruyó la significación aparente **no fue la autocorrelación sino la
heterocedasticidad**: clásico t = 2,58 → White **1,42** → Newey-West 1,39.

### ✅ Y se sabe DE DÓNDE viene el resultado

Atribución de Brinson por categoría de activo contra el 60/40, encadenada por Carino (residuo
−1,25e−12, los 236 periodos cuadran individualmente):

```
asignación (CUÁNTO en cada clase)   +319,6 pp     96,1 %
selección  (CUÁL dentro de la clase) +13,1 pp      3,9 %
                                    ────────
retorno activo compuesto             +332,7 pp
```

Y no es un artefacto del método: **la selección sale 0,0000 EXACTO en todas las clases de un solo
activo**, y los 13,1 pp vienen enteros de elegir TLT o IEF dentro de duración. Cambiar el método
de encadenado no lo mueve.

### ❌ La selección no aporta, y ya son TRES medidas independientes

1. **A nivel de valor**: `IC ~0` en la selección N-stock (medido antes de esta sesión).
2. **A nivel de clase de activo**: ampliar el universo de 7 a 21 activos empeora el Sharpe de
   0,99 a 0,73 — y las tres variantes (k=1, k=2, todos) fallan con t = −2,12 / −2,93 / −2,90.
3. **En la atribución**: el 96 % del retorno activo es asignación.

### ⚠️ Y hay una cifra publicada por encima de lo que se sostiene

`riskMetrics.ts` tenía `rfAnnual = 0` y **nadie le pasaba otra cosa**. Con la tasa real (FRED
TB3MS, validada contra BIL: 1,45 % vs 1,35 %, ρ 0,942):

| | publicado | honesto |
|---|---:|---:|
| Sharpe growth | 1,01 | **0,87** |
| Sharpe SPY | 0,72 | 0,63 |
| Sharpe 60/40 | 0,86 | 0,70 |

El **orden se conserva**; el nivel absoluto no. Es un número que está en la landing.

---

## 2 · La cuenta que decide la estrategia

El estadístico crece con la raíz del tiempo. Partiendo de lo que hay:

```
t = 1,47 con 236 meses
para t = 2 hacen falta 437 meses = 36,4 años
                    → 16,7 AÑOS MÁS de espera

contra el 60/40 (t = 0,97):  64 años más
```

> **El backtest no va a demostrar la ventaja en ningún plazo relevante.** No es una limitación de
> este backtest: es la potencia estadística de comparar dos Sharpe con series correlacionadas.

Eso no se arregla con más investigación, ni con más activos, ni con más historia — ya se midió que
alargar la ventana da t = 1,84 como mucho. Se arregla **esperando**, o **no dependiendo de ello**.

---

## 3 · El plan

### 🔴 A · Corregir lo que está mal publicado — *esta semana*

1. **El Sharpe de la landing: 1,00 → 0,87.** Decisión de producto, requiere OK explícito. La
   ventaja relativa no cambia (1,39× antes, 1,38× ahora), sólo el nivel.
2. **Declarar la curtosis.** El exceso es **+2,52**: las colas son más gruesas que la normal, y el
   Sharpe supone normalidad. Un evaluador lo va a mirar; mejor que esté escrito.
3. **Publicar el «no significativo» como característica, no como letra pequeña.** Es literalmente
   el posicionamiento de *blue ocean*: «no puedes batir al índice, aquí está la verdad ajustada al
   riesgo». Decir *«captura el 65 % de las subidas y el 46 % de las bajadas; la diferencia de
   Sharpe no alcanza significación estadística con 20 años de datos»* es más creíble que un
   Sharpe redondo.

**Coste: días. Bloquea el lanzamiento** — es lo que un abogado y un evaluador van a leer.

### 🟡 B · Dejar de invertir en selección — *decisión, no tarea*

Tres medidas independientes dicen lo mismo. Concretamente **no hacer**:

- La fase 4 del plan v2 (reconstruir el índice ponderado por capitalización): meses de trabajo
  para responder una pregunta sobre selección.
- La fase 5 (Picks con pesos activos): la probabilidad a priori acaba de bajar mucho.
- Más variantes del universo ampliado.

**Lo que sí queda abierto y es barato**: si Scora Picks debe existir como producto. Hoy consume
mantenimiento y no tiene evidencia a favor; el allocator sí.

### 🟡 C · Cerrar lo que falta del informe — *1-2 semanas*

1. **Rotación y capacidad.** Nunca medidas. La rotación ya se persiste en la serie; falta el
   volumen diario para saber qué patrimonio cabe. Un fondo real lo reporta.
2. **Deflación formal** por los 344 ensayos, aplicada a las cifras que se publiquen.
3. **Robustez del drawdown ante ventanas alternativas.** El −16,2 % es un hecho del peor caso
   observado y **no necesita significación**, pero sí necesita saber si aguanta empezando en otro
   año. Es barato y refuerza lo único que sí se puede afirmar.

### ⚪ D · Lo que cambiaría el cuadro, y no depende de nosotros

- **Tiempo.** 16,7 años para significación contra el índice.
- **Datos de más resolución.** Si la estrategia reequilibrara semanalmente habría 4× observaciones
  — pero eso cambia la estrategia, no sólo su medición, y hay que medirlo como tal.
- **Un universo menos eficiente.** La memoria ya lo apuntaba: small/mid caps, Europa. Es la única
  vía con base teórica para buscar alfa de selección, y sigue sin explorarse.

---

## 4 · Mi recomendación, en una frase

> **Dejar de intentar demostrar que Scora bate al índice —no se puede con estos datos y no se
> podrá en 16 años— y vender lo que sí es verificable: una asignación que captura el 65 % de las
> subidas y el 46 % de las caídas, con la atribución que lo explica y la honestidad de decir que
> no alcanza significación.**

Es exactamente el posicionamiento que el material de producto ya tenía escrito hace meses. La
diferencia es que ahora está medido, atribuido y verificado, con 2.183 asserts detrás.

---

## 5 · Lo que sigue bloqueando el lanzamiento

**§9, el abogado.** No ha cambiado, y ahora hay dos cosas más para llevarle:

- **GIPS**: un desarrollador de software puede decir que *endosa* los principios, **no que
  cumple** GIPS (sólo aplica a quien gestiona activos de terceros).
- **Las cifras corregidas**: Sharpe 0,87 con tasa real, curtosis +2,52, y la frase sobre
  significación. Es mejor que lo revise con los números buenos que tener que corregirlos después.
