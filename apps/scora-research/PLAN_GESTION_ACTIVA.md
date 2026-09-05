# Plan · Medir Scora como se mide un fondo de gestión activa

**Fecha:** 2026-09-02 · **Estado:** plan, nada implementado
**Origen:** la pregunta de Alejandro tras H4 — «los fondos de gestión activa tienen el índice como
referencia; hazlo así». Tiene razón, y este documento explica por qué, qué implica, y qué se puede
construir de verdad con los datos que hay.

---

## 0 · El diagnóstico: qué mide hoy el backtest, y por qué no es gestión activa

El modelo actual es **«caja + N valores equiponderados»**. Un fondo de gestión activa es
**«el índice, más unas desviaciones deliberadas»**. No son variaciones del mismo objeto: miden
cosas distintas.

Ocho diferencias concretas, todas verificadas en `research/picks_rules_backtest.mjs`:

| # | hoy | un fondo de gestión activa |
|---|---|---|
| 1 | La caja llega al **23 % (reciente) y 42 % (antigua)** del patrimonio, durante años | El folleto obliga a ≥ 90-95 % invertido. Una caja del 23 % ocho años **es un incumplimiento de mandato**, no una estrategia |
| 2 | Las posiciones se equiponderan; el índice pondera por capitalización | La diferencia entre las dos ES una apuesta de tamaño. Hoy es **involuntaria**, y H4 midió que costó **64,8 pp** |
| 3 | Se publica **retorno total** | Se publica **retorno activo, tracking error e information ratio**. El retorno total mezcla beta con alfa |
| 4 | No hay atribución | **Brinson-Fachler**: cuánto viene de apostar por sectores y cuánto de elegir valores dentro de cada sector |
| 5 | Cada compra se dimensiona a 1/40 del patrimonio **y nunca se reequilibra** | Los pesos son una decisión continua, con reequilibrio y límites |
| 6 | **Una compra por fecha de decisión** | Restricción artificial. Es la que crea la rampa que H4 cuantificó en 84 pp |
| 7 | No hay rotación ni capacidad | Rotación anual y capacidad (¿cabe el dinero en el volumen diario?) son parte del informe |
| 8 | `soloPicks` reequilibra **a diario** al equiponderado | Nadie hace eso. Esa cifra —209,7 %— **no es una cartera que exista** |

**La consecuencia**: hoy no sabemos si Scora elige bien. Sabemos que una cartera con mucha caja y
sesgo de tamaño rindió menos que el índice. Son preguntas distintas.

---

## 1 · Cómo se mide de verdad un fondo de gestión activa

### 1.1 El mandato define la referencia, y obliga a estar invertido

Un fondo de renta variable estadounidense de gran capitalización se compara contra el S&P 500
**Total Return** (con dividendos reinvertidos) o el Russell 1000. Dos cosas que se suelen pasar
por alto:

- **Total return, no precio.** La diferencia es ~1,5-2 pp anuales. Comparar una cartera con
  dividendos contra un índice de precios regala esos puntos. *(Nosotros ya usamos `adj`, que es
  total-return. Esto ya está bien.)*
- **La caja no es una herramienta de temporización.** Es un residuo del 2-5 % para reembolsos.
  Un gestor que se pone al 40 % en efectivo está haciendo *market timing*, y eso se mide aparte y
  se penaliza.

### 1.2 La cartera se expresa en PESOS ACTIVOS

Ésta es la reformulación central, y la que responde a tu intuición:

```
peso_activo(i) = peso_cartera(i) − peso_índice(i)
```

No se eligen 40 valores en el vacío: **se decide en qué desviarse del índice**. Sobreponderar
Apple significa tener más de su peso índice, no «tener Apple». Y no tener Apple **es una apuesta
activa en contra**, del tamaño de su peso índice — que en 2026 es ~7 %.

Esto tiene una consecuencia inmediata para nosotros: la cartera actual, al no tener las
megacapitalizaciones, lleva una **enorme apuesta corta implícita** contra ellas. Nunca la hemos
declarado ni medido. H4 la vio de refilón (los 64,8 pp) sin nombrarla.

### 1.3 El juego de métricas

| métrica | qué es | por qué importa |
|---|---|---|
| **Retorno activo** | `r_cartera − r_índice`, anualizado | Lo que el gestor aporta o destruye |
| **Tracking error (TE)** | desviación típica anualizada del retorno activo | Cuánto se separa del índice. 2-4 % = poco activo · 4-8 % = convicción · >8 % = concentrado |
| **Information Ratio (IR)** | retorno activo ÷ TE | **LA métrica.** IR > 0,5 bueno · > 0,75 muy bueno · > 1,0 excepcional y raro |
| **Active share** | ½·Σ\|peso_cartera − peso_índice\| | < 60 % = *closet indexer* (cobra por replicar) · > 80 % = activo de verdad |
| **Beta** | sensibilidad al índice | Un IR alto con beta 1,3 en un mercado alcista es beta disfrazada |
| **Alfa de Jensen** | `r_p − [rf + β(r_b − rf)]` | Retorno que no explica la exposición al mercado |
| **Captura alcista / bajista** | rendimiento relativo en meses buenos y malos | Un fondo que captura el 110 % de las subidas y el 90 % de las bajadas es otra cosa que uno con 130/130 |
| **Batting average** | % de meses con retorno activo positivo | Distingue «acertó mucho» de «acertó una vez y grande» |
| **Rotación** | min(compras, ventas) ÷ patrimonio medio | Manda en costes y en capacidad |

### 1.4 Atribución de Brinson-Fachler

Descompone el retorno activo en dos causas, por sector:

```
Asignación  = Σ (w_cartera,s − w_índice,s) × (r_índice,s − r_índice)     ← apostar por sectores
Selección   = Σ  w_índice,s × (r_cartera,s − r_índice,s)                  ← elegir dentro del sector
Interacción = Σ (w_cartera,s − w_índice,s) × (r_cartera,s − r_índice,s)
```

Es la pregunta que Scora nunca se ha hecho: **¿el score elige valores, o sólo acaba apostando por
sectores?** El repo ya midió que los percentiles sectoriales no mejoran los retornos
([[score-sector-relativo-v2]]); esto lo comprobaría desde el otro lado.

### 1.5 La significación estadística — y aquí está el problema serio

El estadístico del IR es aproximadamente:

```
t ≈ IR × √años
```

Para afirmar algo con t = 2 hacen falta:

| horizonte | IR mínimo detectable (t=2) | …deflactado por 343 ensayos |
|---|---:|---:|
| 7 años (2019-2026) | **0,76** | **≈ 1,05** |
| 15 años (las dos ventanas) | **0,52** | **≈ 0,72** |

La deflación sale del máximo esperado de N pruebas bajo la hipótesis nula,
`√(2·ln N) − corrección` ≈ **2,79 errores típicos** para N = 343.

**Léelo despacio, porque cambia para qué sirve todo esto:** con 7 años y 343 ensayos gastados,
sólo podríamos *demostrar* una ventaja si el IR pasara de **1,05** — territorio de gestor
excepcional, top decil mundial, que casi nadie sostiene *long-only*.

**Conclusión incómoda pero honesta: el backtest no puede demostrar que Scora tiene ventaja. Sólo
puede refutarla.** Eso no lo invalida —refutar es valiosísimo y ya nos ha ahorrado el Momentum
Suite, la regla de 180 días y el veto forense— pero hay que dejar de esperar de él una prueba que
no puede dar. Ver [[disciplina-ensayos-sharpe-deflactado]] y [[validacion-señales-mde]].

---

## 2 · Qué se puede construir HOY, comprobado (no supuesto)

| pieza | ¿la tenemos? | evidencia |
|---|---|---|
| Precios **total return** | ✅ sí | `research/prices.mjs`: `adj` = ajustado por *split* y dividendo; `returnsSeries` lo usa |
| Pertenencia **punto en el tiempo** | ✅ sí | `loadSP500Historical` + `membersAsOf`, 2.719 fechas desde 1996 |
| **Capitalización** punto en el tiempo | ⚠️ construible, **no construida** | `sharesAsOf` (EDGAR `dei:EntityCommonStockSharesOutstanding`) × precio `raw`. Ya se usa en `score.mjs`, nunca para pesar un índice |
| **Sector** | ⚠️ sí, pero **SIC y no GICS** | `sicSector` resolvió 10/10 en la prueba. Pero clasifica **`PG` → Materials** (es Consumo Básico) y **`V` → Technology** (es Financiero) |
| Costes de transacción | ✅ sí | `COST_BPS = 10` |
| Volumen diario (capacidad) | ❌ no | No se descarga volumen. Habría que añadirlo |

### La advertencia del sector, que es seria

GICS —el que usan S&P, MSCI y todos los proveedores de atribución— **está licenciado y no es
público**. Con SIC obtenemos una aproximación utilizable pero **no comparable** con la atribución
que publicaría cualquier otro. `PG` en Materiales no es un detalle: Procter & Gamble pesa ~1,2 %
del índice y ponerlo en el sector equivocado contamina dos efectos de asignación a la vez.

**Mi opinión:** hacer la atribución con SIC, y **etiquetarla siempre como «sectores SIC, no GICS»**,
midiendo antes cuántos nombres del universo caen en cada sector y cuántos quedan sin clasificar.
Si la discrepancia con la composición sectorial conocida del S&P 500 es grande, la atribución vale
para uso interno y **no para publicar**.

---

## 3 · El plan, por fases, con criterio de aceptación escrito antes

### Fase 1 · El índice de verdad, reconstruido por nosotros

Construir el S&P 500 ponderado por capitalización, punto en el tiempo, con reequilibrio mensual, a
partir de nuestro propio universo: `peso(i) = cap(i) / Σ cap`, con `cap = acciones × precio raw`.

**Por qué reconstruirlo si ya tenemos SPY:** porque comparar una cartera extraída del universo `U`
contra un ETF externo mezcla dos preguntas —«¿elegimos bien?» y «¿está bien reconstruido nuestro
universo?»—. Con las dos series podemos separarlas.

> **Criterio de aceptación:** correlación diaria con SPY **> 0,99** y diferencia de retorno anual
> **< 0,5 pp**. Si no se cumple, **todo lo demás queda invalidado** y hay que arreglar esto antes.
> Es la misma disciplina que el cuadre del Sankey: si no cuadra, no se publica.

⚠️ **La trampa que espero aquí:** `dei:EntityCommonStockSharesOutstanding` es de la **portada** de
la presentación y se actualiza trimestralmente, con retraso. Usarlo sin más introduce un desfase
de hasta 90 días en los pesos. Y en empresas con varias clases (Alphabet, Berkshire) hay que sumar
las clases o se subestima la capitalización. Las dos cosas hay que medirlas, no suponerlas.

### Fase 2 · La cartera como pesos, siempre invertida

Expresar la cartera como un vector de pesos que **suma 1 todos los días**. Tres decisiones, y las
tres se miden juntas como UN ensayo preespecificado (no un barrido):

| esquema | qué hace | apuesta implícita |
|---|---|---|
| **A · equiponderado** | los N elegidos a 1/N | fuerte sesgo a tamaño pequeño (el actual) |
| **B · peso índice escalado** | `w = w_índice × k`, normalizado | neutral en tamaño: aísla la selección |
| **C · núcleo + satélite** | índice + sobreponderación fija en los elegidos | *tracking error* bajo, es lo que hace un fondo real |

**El resto —cuando no hay suficientes elegidos— va al índice, nunca a caja.** Es el modelo C de
H4 generalizado, y es lo que exige el mandato.

> **Criterio:** se publica el **IR** de los tres, con su TE y su *active share*. Gana el que tenga
> IR más alto **en las dos ventanas**. Si ninguno supera el MDE, la conclusión es «no se puede
> distinguir de cero» y se escribe así.

### Fase 3 · Las métricas de gestión activa

Retorno activo, TE, IR, *active share*, beta, alfa de Jensen, captura alcista/bajista, *batting
average* y rotación. Mensual y anualizado.

> **Criterio:** el **MDE se calcula y se escribe ANTES** de mirar ningún resultado, en el propio
> artefacto. Un IR por debajo del MDE se reporta como **«no concluyente»**, nunca como un número
> a secas.

### Fase 4 · Atribución Brinson-Fachler

Asignación, selección e interacción, por sector SIC, mensual.

> **Criterio previo:** medir primero la cobertura sectorial del universo y la discrepancia contra
> la composición conocida del S&P 500. Sin eso, la atribución no se construye.

### Fase 5 · Las restricciones de un fondo real

Límite por posición (regla UCITS 5/10/40 o un tope propio), presupuesto de rotación, y capacidad
—qué patrimonio cabe sin mover el precio, con volumen diario, que **hay que añadir**—.

> **Criterio:** que las restricciones **no cambien el IR más de lo que da el ruido**. Si al meter
> un tope del 5 % por posición el IR se desploma, la ventaja vivía en concentraciones que un fondo
> real no puede tener.

### Fase 6 · Significación, con deflación

t del IR, deflactado por los 343 ensayos ya gastados.

> **Criterio:** escribir el resultado como **banda**, no como punto ([[cifras-son-banda-no-punto]]).

---

## 4 · Mis opiniones, explícitas

**1. Tienes razón en el planteamiento, y es el cambio más importante desde el gate de correlación.**
Medirse contra el índice en pesos activos no es una presentación distinta de los mismos números:
es otra pregunta, y es la correcta. La actual mezcla tres cosas —selección, sesgo de tamaño y
temporización con caja— y no permite atribuir el resultado a ninguna.

**2. El esquema B (peso índice escalado) es el que de verdad responde a «¿elegimos bien?».**
Es el único que neutraliza el sesgo de tamaño. El equiponderado actual mete una apuesta contra las
megacapitalizaciones que nadie decidió y que costó 64,8 pp. **Si Scora aporta, tiene que aportar
también sin esa apuesta.** Recomiendo que B sea el principal y A y C las referencias.

**3. Pero el esquema C es el producto vendible.** «Índice más un sesgo» tiene *tracking error* bajo,
es lo que un suscriptor puede sostener sin abandonar en el primer año malo, y es honesto sobre lo
que Scora es. Un producto que se separa 8 puntos del índice se vende una vez y se cancela al
segundo trimestre malo.

**4. La caja tiene que desaparecer del modelo, y eso cambia la estrategia de verdad.** Hoy las
reglas producen ~31 posiciones de 40 huecos. Con obligación de estar invertido, o se concentra más
o se relaja el umbral de entrada. **No es un cambio de contabilidad, es un cambio de estrategia**, y
por eso va con su ensayo preespecificado.

**5. Y la más importante: hay que decidir para qué sirve el backtest antes de rehacerlo.**
Con 7 años y 343 ensayos, el MDE del IR está en ~1,05. La probabilidad de demostrar una ventaja es
esencialmente nula. Así que propongo cambiar el objetivo declarado:

> El backtest **no** existe para demostrar que Scora bate al índice. Existe para **descartar** que
> lo empeore, para **atribuir** de dónde viene lo que hace, y para **acotar** lo que puede
> prometerse sin mentir.

Con ese objetivo, el plan es valiosísimo. Con el otro, es una fábrica de decepciones caras.

**6. Lo que NO recomiendo.** Buscar el esquema de pesos que maximice el IR. Sería un barrido con
los mismos datos, ensayos 344 a 3xx, y el resultado no significaría nada
([[disciplina-ensayos-sharpe-deflactado]]). Tres esquemas preespecificados, medidos una vez.

---

## 5 · Orden y coste

| fase | esfuerzo | bloquea a | riesgo principal |
|---|---|---|---|
| 1 · índice ponderado | **alto** — hay que descargar acciones de 500 nombres × ~15 años | todas | el desfase trimestral de las acciones en circulación |
| 2 · pesos y mandato | medio | 3, 4 | ninguno técnico; es decisión de producto |
| 3 · métricas activas | bajo | 6 | ninguno: es aritmética sobre dos series |
| 4 · atribución | medio | — | **SIC no es GICS**; medir cobertura primero |
| 5 · restricciones | medio | — | falta el volumen diario |
| 6 · significación | bajo | — | ninguno |

**La fase 1 es el 70 % del trabajo y bloquea todo lo demás.** Y tiene un criterio de aceptación
duro: si el índice reconstruido no replica a SPY dentro de tolerancia, no se sigue.

Mi recomendación de secuencia: **1 → 3 → 2 → 6**, dejando 4 y 5 para después. La razón es que con
1 y 3 ya se pueden calcular retorno activo, TE e IR **de la cartera actual tal cual es**, sin
cambiar ninguna regla. Eso da la línea base contra la que comparar cualquier cambio posterior —y
si la línea base ya dice «no concluyente», nos ahorra las fases 2, 4 y 5 enteras.
