# Plan v2 · Medir Scora como se mide un fondo — corregido tras revisar el archivo

**Fecha:** 2026-09-03 · **Sustituye a** `PLAN_GESTION_ACTIVA.md` (v1, 2026-09-02)
**Origen:** revisión completa de `Downloads/Finance` (2.139 ficheros, 318 PDF extraídos, todo menos
`OLTP/`), pedida por Alejandro antes de ejecutar el plan v1.

> **La revisión no matizó el plan v1: le cambió el objetivo, la métrica principal y la referencia.**
> Tres errores de fondo, y los tres estaban documentados en material propio.

---

## 0 · Lo que la revisión rompió del plan v1

| # | el plan v1 decía | lo que dice el archivo | fuente |
|---|---|---|---|
| 1 | El objetivo es **batir al índice**; el IR es «LA métrica» | El posicionamiento de Scora **elimina** las promesas de batir al mercado. El claim es **ajustado al riesgo** | `Capital/Scora/13_blue_ocean.md`, `06_value_proposition.md`, `BP_Scora.md` |
| 2 | Information ratio como métrica principal | **El IR de la estrategia es −0,08.** Por esa métrica Scora *pierde*; por Sharpe, Sortino, Calmar y drawdown *gana con holgura* | `lib/trackRecord.ts` |
| 3 | Referencia = SPY | La estrategia tiene **beta 0,49**. Compararla sólo con un índice de beta 1,0 es el error que el propio curso advierte. **Ya existe `bench6040` en el código** | `trackRecord.ts`, `Otros varios/Alpha rO.pdf` |
| 4 | Atribución Brinson **por sector**, bloqueada porque GICS está licenciado | El Brinson canónico del curso es **por categoría de activo** (monetario / renta fija / renta variable) — que es exactamente lo que hace el allocator, y **no necesita GICS** | `Gestión de activos y carteras/Medidas del comportamiento…pdf` |
| 5 | No contemplaba la **habilidad de temporización** | Hay dos tests formales y publicados para justo eso: **Merton-Henriksson (1981)** y **Treynor-Mazuy (1966)** | mismo PDF |
| 6 | Proponía medir 3 esquemas y quedarse con el mejor IR | Eso es **cherry-picking** con nombre propio en el temario | `CAIA L1 pt1.pdf` |

---

## 1 · El objetivo real, y la contradicción que hay que resolver

### Lo que dice el material de producto

Del *value proposition canvas* y del esquema ERRC de blue ocean:

> **ELIMINAR — «Las promesas de *batir al mercado*»: generan desconfianza en nuestro perfil, no deseo.**
>
> **CREAR — «Honestidad radical: *no puedes batir al índice, aquí la verdad ajustada al riesgo*»
> como *feature*, no como disclaimer.**

Y el claim, palabra por palabra:

> *«Iguala al índice con un tercio del drawdown»* (medido, *survivorship-free*)
> — en inglés: *«The index's returns. A third of the drawdown. An AI that can't lie to you. Free.»*

### La contradicción, dicha en voz alta

La memoria `objetivo-batir-indice` (17-08-2026) recoge: *«estoy determinado en batir el índice en
algún momento, si no cómo vendo Scora»*, marcado como objetivo firme. El material de producto dice
lo contrario.

**No son incompatibles, y el propio texto de esa memoria lo resuelve** — dice también: *«Scora se
puede vender por calidad de medición, honestidad verificable y coste, sin prometer alfa»* y *«no
dejar que una promesa de rentabilidad entre en la landing, el deck ni los ToS»*.

> **La distinción que faltaba: el objetivo de INVESTIGACIÓN puede ser batir al índice. El CLAIM DE
> PRODUCTO es ajustado al riesgo.** El backtest sirve primero al segundo. El plan v1 los confundió
> y por eso puso el IR en el centro.

**Consecuencia práctica:** el backtest tiene dos trabajos con distinta urgencia.
1. **Defender el claim que ya se hace** (Sharpe, drawdown, Calmar) — esto es lo que bloquea el
   lanzamiento y lo que un abogado va a leer.
2. **Explorar si hay alfa** (IR, retorno activo) — legítimo, pero es investigación, no producto.

---

## 2 · Las cifras que ya existen, y lo que dicen

De `lib/trackRecord.ts` (fuente canónica, citada en `CONTEXTO_SESION_SCORA_2026-08-11.md`):

| | estrategia | SPY | 60/40 estático |
|---|---:|---:|---:|
| Retorno total | 636,7 % | 652,2 % | 368,0 % |
| CAGR | 10,78 % | 10,90 % | 8,24 % |
| **Sharpe** | **1,00** | 0,72 | 0,86 |
| **Sortino** | **1,74** | 1,07 | 1,33 |
| **Calmar** | **0,66** | 0,22 | 0,29 |
| **maxDD** | **−16,2 %** | −50,7 % | −28,8 % |
| VaR 95 / CVaR 95 | −4,25 / −6,36 | −8,21 / −11,18 | — |
| alfa de Jensen | +5,1 %/año | — | — |
| beta | **0,49** | 1,00 | — |
| **information ratio** | **−0,08** | — | — |

**Léase la última fila junto a las anteriores.** Es el hallazgo técnico central de la revisión:

> Por **information ratio**, Scora pierde contra el índice. Por **Sharpe, Sortino, Calmar, VaR,
> CVaR y drawdown**, gana con holgura. No es una contradicción: **el IR mide desviación en
> unidades de retorno y castiga por definición a una estrategia que se desvía a propósito
> reduciendo beta.**

Poner el IR de métrica principal —como hacía el plan v1— habría producido el titular *«Scora no
aporta»* a partir de una estrategia que triplica el ratio de Calmar del índice.

**Y contra la referencia correcta (60/40), el allocator gana en las dos dimensiones a la vez:**
636,7 % contra 368,0 % de retorno **y** 1,00 contra 0,86 de Sharpe.

---

## 3 · La jerarquía de métricas, corregida

El CFA da la regla doctrinal que decide esto:

> *«Whether risk adjustment should be based on standard deviation or beta depends on whether the
> manager's portfolio bears unsystematic risk. **If a single manager is used, then the total risk
> is the relevant measure** and risk adjustment using total risk, as with the Sharpe and M²
> measures, is appropriate.»* — CFA L1, LOS 21.i

Scora es **una estrategia única que el usuario tiene como cartera entera**. Por tanto **riesgo
total, no beta**: Sharpe y M² son correctos; Treynor y Jensen son secundarios.

### Primarias — sostienen el claim
| métrica | fórmula | por qué |
|---|---|---|
| **Sharpe** | `(Rp − Rf)/σp` | La comparación directa del claim |
| **M² (Modigliani)** | `Sharpe_p × σ_bench + Rf` · M²-alfa = `M² − R_bench` | **La pieza que faltaba.** Convierte la ventaja de Sharpe en puntos de retorno *al nivel de riesgo del índice*. Es la forma honesta de decir «iguala al índice con ⅓ del drawdown» en un solo número |
| **Sortino** | usa semidesviación | El claim es de **caídas**, no de volatilidad total |
| **Calmar** | `CAGR / |maxDD|` | 0,66 vs 0,22 — la expresión más limpia del «tercio del drawdown» |
| **maxDD y su ratio** | | El claim literal |
| **Captura alcista / bajista** | | Descompone «participa en subidas, protege en bajadas» |

### Secundarias — diagnóstico, no titular
Beta, alfa de Jensen, Treynor, VaR/CVaR, **asimetría y curtosis** (CAIA: una promesa de drawdown
obliga a enseñar la *forma* de la distribución, porque el Sharpe supone normalidad), rotación.

### Y el IR se reporta, pero **no como titular**
Se publica con su explicación: *«−0,08; es lo esperado en una estrategia que reduce beta a
propósito, y por eso la métrica principal es el Sharpe»*. Ocultarlo sería cherry-picking; ponerlo
de titular sería medir con la regla equivocada.

---

## 4 · La referencia: dos mandatos, dos referencias

El error del plan v1 fue una sola referencia. Un asignador multiactivo con beta 0,49 comparado
sólo con un índice de beta 1,0 **no se puede evaluar**.

| producto | mandato | referencia | ya existe |
|---|---|---|---|
| **Allocator por régimen** | multiactivo, beta variable | **60/40 estático** (política) + SPY como contexto | ✅ `bench6040` en `trackRecord.ts` |
| **Scora Picks** | 100 % renta variable EE. UU. | **S&P 500 ponderado por capitalización** | ⚠️ hay que construirlo (fase 1) |

**Regla que se escribe una vez y no se discute más:** toda tabla lleva la fila de su referencia, y
**las dos ventanas siempre** — GIPS señala «seleccionar los periodos que dejan mejor a la firma»
como uno de los tres sesgos que la norma existe para impedir.

---

## 5 · Lo que el plan v1 no tenía: medir la habilidad de temporización

El edge medido de Scora es la **asignación por régimen**, no la selección (`IC ~0`). O sea:
**market timing**. Y para eso hay dos tests formales que el plan v1 ignoraba por completo.

### Merton-Henriksson (1981) — beta dual
```
Rp − Rf = α + β⁻(Rm − Rf) + γ·(Rm − Rf)·D        D = 1 si Rm > Rf, 0 si no
```
`β⁻` es la **bear beta** y `β⁻ + γ` la **bull beta**. **γ > 0 y significativo = habilidad real de
temporización.** Con beta media 0,49, la pregunta es si esa beta *sube en mercados alcistas* — que
es justo lo que el allocator afirma hacer.

### Treynor-Mazuy (1966) — regresión cuadrática
```
Rp − Rf = α + β(Rm − Rf) + γ(Rm − Rf)² + u
```
La **convexidad** `γ` mide lo mismo por otra vía. Que las dos coincidan es la comprobación cruzada.

> **Éste es el test que decide si Scora tiene algo o no**, y no estaba en el plan v1. Es además el
> único que ataca la afirmación de producto en su propio terreno.

---

## 6 · Atribución: por categoría de activo, no por sector

El plan v1 daba la atribución por medio bloqueada porque **GICS está licenciado** y SIC clasifica
mal (`PG → Materiales`, `V → Tecnología`). **El bloqueo era mío, no del dato.**

El Brinson canónico del curso se hace **por categoría de activo** — su ejemplo es literalmente
monetario / renta fija / renta variable — que es lo que el allocator mueve. **No necesita GICS.**

Método práctico, con la notación del curso:
```
Aportación por ESTRATEGIA (asignación) = (R_BM,k − R_BM_total) × (w_cartera,k − w_BM,k)
Aportación por SELECCIÓN               = (R_cartera,k − R_BM,k) × w_cartera,k
```

> **Criterio de aceptación, tomado del ejemplo resuelto:** las dos contribuciones tienen que sumar
> **exactamente** el retorno activo total (en el ejemplo: −4 % + 0,3 % = −3,7 %). Si no cuadra, no
> se publica. Es el mismo listón del Sankey.

La atribución sectorial queda como fase opcional posterior, con SIC y **etiquetada como tal**.

---

## 7 · Scora Picks: dos correcciones tomadas del temario

De `Gestion de carteras.pdf` §5.2, sobre construcción de carteras activas:

> *«**Portfolios Equal Weighted:** puede implicar asumir **riesgos no compensados**, especialmente
> si el Bmk está concentrado en pocas acciones.»*
>
> *«El riesgo viene de las **diferencias de peso** entre la cartera y el Bmk, no de los pesos
> absolutos. **No tener uno de los 3 mayores valores del Bmk** porque el gestor está negativo en
> alguno de ellos **significa tomar mucho riesgo**. El gestor puede optar por tener esos valores
> simplemente **infraponderados** para evitar un riesgo excesivo.»*

**Eso describe exactamente lo que hace Scora Picks hoy**, y H4 midió su coste: 64,8 pp.

1. **No excluir las megacapitalizaciones: infraponderarlas.** Deja de ser una apuesta corta
   involuntaria del 7 % y pasa a ser una desviación dimensionada.
2. **Dimensionar por convicción y volatilidad**, no equiponderar. Las tres reglas del temario se
   resumen en una: `peso_activo ∝ alfa_esperado × confianza / volatilidad`. Es lo que sustituye al
   «peso índice × k» que proponía el plan v1, y tiene fundamento en vez de ser un parámetro suelto.

---

## 8 · El plan revisado, por fases

### Fase 0 · Persistir la serie mensual — **descubierta al verificar**

⚠️ **`growth_metrics.mjs` SÍ calcula la serie mensual de retornos y los pesos por activo dentro de
`run(step)`, pero el artefacto que escribe son 1 KB de agregados.** Los números canónicos existen;
la serie que los produjo, no. **Las seis fases dependen de esto** y el plan no lo contemplaba.

| | |
|---|---|
| **Qué** | Persistir `{fecha, ret_estrategia, ret_spy, ret_6040, pesos:{SPY,TLT,IEF,GLD,DBC,BIL,BTCUSD}, rotación}` — 234 filas |
| **Datos** | ✅ todos; ya se computan, sólo no se guardan |
| **Criterio** | Los agregados recalculados **desde la serie guardada** tienen que reproducir *exactamente* los de `trackRecord.ts`: 636,7 % · Sharpe 1,00 · maxDD −16,2. Si no cuadran, la serie no es la que produjo esas cifras |
| **Trampa** | El coste (`turn/2 × 2 × COST_BPS`) se aplica DENTRO de `run`. Guardar el retorno bruto infla todas las métricas de golpe |
| **Esfuerzo** | muy bajo |

### Fase 1 · Métricas ajustadas al riesgo, completas

`lib/metricasRiesgo.ts`, puro y comprobable: **M² = Sharpe_p × σ_bench + Rf** (y M²-alfa),
**Sortino**, **Calmar**, **captura alcista/bajista**, **asimetría y curtosis** —CAIA: una promesa de
drawdown obliga a enseñar la forma de la distribución porque el Sharpe supone normalidad— y **ρ
con cada referencia**, que es la que decide la significación de todo lo demás.

| | |
|---|---|
| **Criterio** | M² por dos caminos —desde el Sharpe y desde la serie apalancada— tiene que dar el mismo número. Si divergen, uno está mal |
| **Trampa** | **La tasa libre de riesgo.** M², Sharpe y Sortino dependen de `Rf`, y usar 0 % constante sobre 2007-2026 —que incluye la ZIRP y luego el 5 %— distorsiona en direcciones opuestas según el tramo. Serie de `BIL` o FRED, nunca una constante |
| **Desbloquea** | **El claim de producto**, que hoy está publicado en la web sin todo su respaldo |
| **Esfuerzo** | bajo |

### Fase 2 · Los tests de temporización — **la que más vale por esfuerzo**

Lo que está en juego, y por eso es decisiva:

| resultado | qué significa | consecuencia |
|---|---|---|
| **γ > 0 significativo** | El allocator **acierta el momento**: sube beta en alzas, la baja en caídas | El claim queda probado en su propio terreno |
| **γ ≈ 0, α > 0** | La reducción de drawdown viene de **beta baja siempre**, no de acertar | Sigue siendo honesto, pero es «cartera defensiva», no «asignación por régimen». **Cambia el producto** |
| **γ < 0** | Temporización con el signo cambiado | Hay que rehacer el allocator |

| | |
|---|---|
| **Criterio** | Los **dos** tests, con error estándar **Newey-West** — los retornos mensuales tienen autocorrelación y sin corregirla el *t* sale inflado. Se publican los dos aunque discrepen: que discrepen ES el resultado |
| **Trampa** | `Rm` tiene que ser la referencia del **mandato**. Contra SPY, el allocator parecerá tener *timing* sólo por llevar renta fija |
| **Coste** | Gasta **dos ensayos** del presupuesto |
| **Esfuerzo** | bajo-medio (OLS, sin dependencias nuevas) |

### Fase 3 · Brinson por categoría de activo

El allocator mueve **siete categorías** y los pesos ya se calculan cada mes:
`SPY` (renta variable) · `TLT` (RF larga) · `IEF` (RF media) · `GLD` (oro) · `DBC` (materias
primas) · `BIL` (monetario) · `BTCUSD` (cripto). Es el ejemplo canónico del curso extendido, **sin
GICS de por medio**.

| | |
|---|---|
| **Criterio** | Asignación + selección tienen que sumar **exactamente** el retorno activo (en el ejemplo del curso: −4 % + 0,3 % = −3,7 %). Si no cuadra, no se publica |
| **Trampa útil** | Al usar **un ETF por clase**, la «selección» debería salir ≈ 0 por construcción. **Si sale distinta de cero, hay un error de contabilidad** — comprobación gratis de la propia implementación |
| **Esfuerzo** | medio |

### Fase 4 · Índice ponderado por capitalización — **degradada de 1.ª a 4.ª**

Es la antigua fase 1 del plan v1. Sólo hace falta para **Picks**; el claim de producto no la
necesita. Que el v1 pusiera aquí «el 70 % del trabajo» es el error de orden que la revisión corrige.

| | |
|---|---|
| **Criterio** | Correlación diaria con SPY **> 0,99** y diferencia anual **< 0,5 pp**, o no se sigue |
| **Trampas** | `dei:EntityCommonStockSharesOutstanding` es de portada y va con hasta 90 días de retraso · en Alphabet o Berkshire hay que **sumar las clases** o se subestima la capitalización |
| **Esfuerzo** | **alto** |

### Fase 5 · Picks con pesos activos

1. **Infraponderar, no excluir** — hoy no tener Apple es una apuesta corta involuntaria del ~7 %.
2. **Dimensionar por convicción**: `peso_activo ∝ alfa × confianza / volatilidad`, que es a lo que
   se reducen las tres reglas del temario, y sustituye al «peso índice × k» que inventé sin base.

| | |
|---|---|
| **Criterio** | Se miden los tres esquemas y **se publican los tres**, incluido el que pierde |
| **Esfuerzo** | medio |

### Fase 6 · Significación y deflación

**Separar las tres preguntas que el plan v1 mezclaba:**

| pregunta | quién la contesta |
|---|---|
| ¿Es significativo? | Jobson-Korkie/Memmel con el **ρ medido** en la fase 1, no supuesto |
| ¿Está sobreajustado? | El `walkForward` que **ya existe**: 178 meses OOS, Sharpe 0,99, *gap* 0,01 |
| ¿Es robusto? | Ventanas alternativas. Y **el drawdown no necesita significación**: −50,7 % vs −16,2 % es un hecho del peor caso observado |

### El orden, y su razón

```
0 → 1 → 2 → 3      el claim de producto: barato, y bloquea el lanzamiento
        ↓
        6          significación, en cuanto haya ρ
        ↓
      4 → 5        la investigación: cara, y no bloquea nada
```

**Con 0, 1 y 2 —quizá una semana— ya se sabe si el claim publicado se sostiene y si el allocator
hace lo que dice.** Las fases 4 y 5 son meses y contestan otra pregunta.

**El cambio de orden es la consecuencia práctica de la revisión.** El plan v1 empezaba por lo más
caro (reconstruir el índice ponderado, «el 70 % del trabajo») para responder una pregunta que el
producto **no hace**. El plan v2 empieza por lo barato que sostiene el claim que **ya se está
haciendo en la web**.

---

## 9 · Higiene metodológica, con nombre y fuente

De CAIA L1 y GIPS, los sesgos que hay que impedir por construcción:

| sesgo | qué es | cómo se impide aquí |
|---|---|---|
| **Data dredging** | *«failure to take the number of tests into account»* | Deflación por 343 ensayos, ya en marcha |
| **Overfitting** | *«models with fewer parameters tend to fit future data better»* | Cero parámetros libres nuevos por ensayo |
| **Cherry-picking** | Publicar sólo la variante que salió bien | **Se publican TODAS las variantes medidas**, incluida la que pierde |
| **Selección de periodo** | GIPS lo cita como uno de los tres sesgos | **Las dos ventanas siempre, en toda tabla** |
| **Survivorship / backfill** | | Ya resuelto: universo punto en el tiempo |

Y una respuesta precisa a una pregunta que estaba abierta:

> **GIPS:** *«GIPS only apply to firms that manage assets for others… Other firms related to the
> asset management business, such as **software developers**, may state that they **endorse** GIPS
> but **may not claim compliance**.»*

Scora es software, no gestora. **Puede decir que sigue los principios GIPS; no puede decir que
cumple GIPS.** Eso va tal cual al abogado (§9) y a los ToS.

---

## 10 · El MDE, recalculado para la métrica correcta

El plan v1 calculó el MDE del **information ratio** y concluyó que hacía falta IR > 1,05. Con la
métrica corregida hay que rehacerlo — y el resultado **no es el que yo esperaba**.

El horizonte real es **Jan 2007 – Jun 2026: 234 meses, 19,5 años** (`trackRecord.ts`), no los ~25
que supuse. Y comparar dos Sharpe **de series correlacionadas** no se hace con `t ≈ ΔS × √años`
sino con Jobson-Korkie corregido por Memmel:

```
SE(S₁−S₂) = √[ (1/T)·( 2(1−ρ) + ½(S₁²+S₂²) − ρ·S₁·S₂ ) ]
```

Calculado para S₁ = 1,00, S₂ = 0,72, T = 19,5:

| correlación ρ con el índice | SE de la diferencia | t | ¿significativo? |
|---:|---:|---:|---|
| 0,60 | 0,240 | 1,16 | no |
| 0,70 | 0,209 | 1,34 | no |
| 0,80 | 0,173 | 1,62 | no |
| 0,85 | 0,151 | 1,85 | no |
| **0,88** | **0,137** | **2,04** | **sí** |
| 0,90 | 0,126 | 2,22 | sí |

> **La diferencia de Sharpe sólo es significativa si la correlación con el índice es ≥ 0,88.** Con
> beta 0,49 y un asignador que se sale del mercado, es probable que sea menor — pero **ρ es
> medible**, así que esto deja de ser una discusión y pasa a ser la primera comprobación de la
> fase 1.

**Y hay tres cosas más que separar, porque tienen epistemologías distintas:**

1. **El drawdown no es una diferencia de medias.** −50,7 % contra −16,2 % es un hecho sobre el
   peor caso *observado*. No necesita significación para ser cierto; necesita **robustez ante
   ventanas alternativas**, que es otra comprobación y más barata.
2. **El *walk-forward* ya existe y no lo había visto**: `oosMonths: 178, oosSharpe: 0.99,
   overfitGap: 0.01`. Un Sharpe fuera de muestra de 0,99 contra 1,00 dentro es **evidencia fuerte
   contra el sobreajuste** — que es una pregunta distinta de la significación, y la responde bien.
3. **Significación ≠ sobreajuste ≠ robustez.** Conviene no volver a mezclarlas: el *walk-forward*
   contesta la segunda, las ventanas alternativas la tercera, y la primera depende de ρ.

> **Corrección honesta, dos veces.** En el plan v1 dije que el backtest «sólo puede refutar, no
> demostrar» — cierto para el alfa de selección, y venía de elegir la métrica equivocada. Pero al
> rehacer el cálculo con la métrica correcta, mi primer borrador de este plan v2 decía que la
> diferencia de Sharpe «sí es detectable», y **eso también era falso**: sólo lo es con ρ ≥ 0,88.
> La conclusión buena es la intermedia y hay que medir ρ para saber de qué lado cae.

---

## 11 · Mis opiniones, revisadas

**1. El plan v1 estaba resolviendo el problema equivocado, y la culpa es mía, no tuya.** Tu
intuición sobre la gestión activa era correcta; lo que hice mal fue importar con ella el objetivo
«batir al índice», que tu propio material de producto había descartado hace meses con argumentos
mejores que los míos.

**2. Empezar por la fase 1 nueva, no por la vieja.** M², Sortino, Calmar y las dos referencias son
un par de días de trabajo sobre series que ya existen, y sostienen el claim que hoy está publicado
en la web sin todo su respaldo. Reconstruir el índice ponderado es caro y sólo sirve para Picks.

**3. El test de Merton-Henriksson es la pieza que más valor tiene por esfuerzo.** Es una regresión.
Si γ sale positivo y significativo, tienes evidencia académica publicable de que el allocator hace
lo que dice. Si sale cero, has descubierto que la reducción de drawdown viene de tener beta baja
*siempre* —no de acertar el momento—, que es una historia distinta y también honesta, pero cambia
el marketing.

**4. Publicar el IR de −0,08 en vez de esconderlo.** Es el tipo de detalle que convierte «somos
honestos» en algo verificable. Un lector técnico que lo encuentre por su cuenta después de no
verlo, deja de creerse el resto.

**5. Lo que sigo sin recomendar:** buscar el esquema de pesos que maximice ninguna métrica. Con la
palabra del temario: eso es *cherry-picking*, y la lista de estrategias ya rechazadas en
`trackRecord.ts` (apalancamiento condicional, CPPI, coberturas cortas, *long-vol*, collares de
opciones) demuestra que ese camino ya se recorrió y se cerró bien.

---

## 12 · Lo que la revisión NO cambió

- La disciplina de ensayos preespecificados y deflación.
- La obligación de la fila de referencia en toda tabla.
- Que las restricciones de fondo real (límite por posición, capacidad, rotación) siguen sin
  medirse y siguen faltando el volumen diario.
- Que §9 (el abogado) sigue siendo el único bloqueante de lanzamiento.

---

### Anexo · Alcance de la revisión

2.139 ficheros bajo `Downloads/Finance`, excluido `OLTP/`. 318 PDF extraídos a texto y buscados por
contenido, no por título. Carpetas con **cero** relevancia comprobada por contenido (no por
suposición): Geopolítica, Diplomado Derecho Mercantil, Fiscalidad, Análisis contable, Visualización,
CRE Resources, SQL, y los cuadernos de Python/pandas. Aportaron el material citado: `Capital/Scora`
(21 documentos de validación + BP + contexto), `Gestión de activos y carteras` (medición,
atribución, timing), `Gestion de carteras.pdf` (§5.2 construcción activa), `CFA L1 Portfolio
Management` (M², riesgo total vs beta), `CFA L1 ethics` (GIPS), `CAIA L1 pt1` (sesgos de backtest),
`CAIA formulas` (IR, semivarianza), `Mercados financieros` (retorno absoluto), `Otros varios/Alpha
rO.pdf` (referencia multiactivo) y `Capital/Alva Capital` (el vehículo de inversión de la fase 3).
