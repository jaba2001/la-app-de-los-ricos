# Scora Picks — reglas

**Estado: BORRADOR v2 — reglas RECONSTRUIDAS tras backtestearlas. Sin sellar (§9), pero YA PROGRAMADO: primera decisión el 2026-09-01.**
**Fecha:** 2026-08-21 · **Autor:** Alejandro Alvarado · **Revisión pendiente:** abogado fintech (§9)

> ⚠️ **Hay una tensión entre este documento y el estado real, y hay que resolverla antes del 1 de septiembre.** §11 dice que la Fase 1 es *sellar las reglas* y que sólo entonces esto se commitea como `rules_version = 2`; §12 deja el encuadre legal como la única decisión abierta. Pero el cron ya está programado y `/picks` ya es una página pública e indexable, así que **el sistema empezará a publicar decisiones con §9 todavía sin respuesta**. Puede ser lo correcto —publicar un registro de decisiones no es lo mismo que venderlo— pero es una decisión que aún no se ha tomado por escrito. **No la toma el código.**

> Este documento es un **pre-registro**. Su valor entero depende de escribirse **antes** de la primera compra y no tocarse después. Un conjunto de reglas que se ajusta cuando los resultados no gustan no es un sistema: es discrecionalidad con hoja de cálculo.
>
> Mismo principio que gobierna `PLAN_SEEKINGALPHA_MARKET_MOMENTUM.md` §7.9, donde los criterios de aceptación se escribieron antes de ver un solo número — y gracias a eso se pudo descartar el momentum sin discutir.

---

## 0 · Qué cambió en la v2, y por qué eso no rompe el pre-registro

La v1 declaró unas reglas **antes** de poder medirlas: sólo estaba medida la SEÑAL (rebalancear un top-40 cada trimestre), no el PRODUCTO. El 2026-08-21 se construyó `research/picks_rules_backtest.mjs`, que simula las reglas de verdad —fechas fijas, dos compras al mes, persistencia, umbrales, la regla de los 180 días, cuarentena y tope de cartera— sobre las dos ventanas. **Las reglas de la v1 fallaron su propio criterio de aceptación.** Ver §3bis.

Tres cosas cambian, cada una con un mecanismo identificado ANTES de medirla y replicado en las DOS ventanas:

| # | Cambio | Motivo medido |
|---|---|---|
| 1 | **Se elimina la regla de los 180 días** (§5.3 de la v1) | Provocaba el **95% de las ventas** y costaba **−74 pp y −64 pp**. Vendió NVDA en 2020 tras un +220% |
| 2 | **Cuatro compras al mes, no dos** (§4) | Con dos, sólo llegaba a invertirse el 76% y el **48%** del capital, y la cartera **no se llenó nunca** en ninguna de las dos ventanas |
| 3 | **Umbral de entrada al percentil 70, no 80** (§3) | El umbral no cambia la calidad de los picks (plano de p70 a p85); cambia **cuánto dinero se invierte**: 94% con la v2 frente al 48-76% de la v1 |

**Y la honestidad que hay que decir en voz alta:** la v2 es un diseño **derivado de los datos**. Por construcción está dentro de muestra, por muy replicados que estén sus tres cambios. Los números de §1 y §3bis **no son evidencia fuera de muestra de la v2** — son la razón para probarla, no la prueba. La única validación honesta es hacia adelante y en vivo, que es exactamente para lo que existe la Fase 2 (§11).

**Lo que NO cambia:** la señal (calidad), el tope de 40 posiciones, el equiponderado, la persistencia de 60 días, la cuarentena de 12 meses, las fechas fijas y todo §7 (publicarlo todo). Ninguna de ellas se movió, y las tres últimas se midieron y son inocuas o útiles.

---

## 1 · Qué es esto, y qué no es

**Es** una cartera de reglas mecánicas, idéntica para todo el mundo, publicada con todos sus resultados: los buenos y los malos.

**No es** una predicción de rentabilidad, ni asesoramiento, ni una cartera personalizada.

### La promesa, escrita para no poder inflarla después

> *"Esto es lo que hace un sistema de reglas fijas, sin emociones y sin retrospectiva, medido en vivo desde el primer día."*

**Y no esta otra:** *"estas acciones van a subir más que el mercado"*.

La medición matiza esto y hay que decirlo con precisión, porque §3 podría leerse como lo contrario. Son **dos preguntas distintas**:

- **¿La señal selecciona?** **Ya no se puede afirmar.** Con los datos corregidos del 24-08-2026 la calidad bate al universo elegible equiponderado en una ventana y no en la otra: **+30 pp y −4 pp** (§3). Antes salía +53 y +30, y esa diferencia era un defecto de datos. Lo que aguanta es más débil: bate al universo EW en 8 de 10 tamaños de cartera en la ventana reciente y en 7 de 10 en la antigua — pero **no en el tamaño 40 que usa el producto**.
- **¿El producto entero —reglas incluidas— bate a un fondo indexado?** Con las reglas de la v1, **no**. Con las de la v2, **sí en las dos ventanas** — pero medido dentro de muestra (§0).

**El producto v2 simulado día a día**, con sus fechas fijas, sus compras escalonadas y su caja parada, que es lo que de verdad vive un suscriptor:

> ### ⚠️ Estas cifras se recalcularon enteras el 2026-08-24
>
> No por cambiar ninguna regla: por **arreglar un defecto de datos que llevaba años en el
> sistema**. `flowTTM` sumaba cuatro trimestres sin comprobar que fueran consecutivos, y
> aceptaba magnitudes congeladas en el año en que la empresa dejó de etiquetarlas. **Amazon
> puntuaba con un margen bruto del 0,6 %** (real: ~52 %) y el «flujo de explotación a doce
> meses» de Apple sumaba el primer trimestre de cuatro años distintos. Afectaba a
> `grossProfitability`, `operatingMargin` y `roic` — tres de las cinco métricas de la señal.
>
> Detalle completo en `PLAN_SCORA_FORENSE.md` §8.1. Lo relevante aquí: **las cifras de abajo
> son las primeras que se calculan con la señal midiendo lo que dice medir.** Mejoran mucho
> en la ventana reciente y empeoran algo en la antigua — que no sea uniformemente favorable
> es lo que hace creíble el arreglo.

| Scora Picks v2 (con caja, 4 compras/mes) | 2019-2026 | 2011-2018 |
|---|---:|---:|
| **La cartera** | **+294%** · Sharpe 0,87 · DD −34,6% | **+143%** · Sharpe 0,83 · DD −18,4% |
| SPY (comprar y mantener) | +237% · Sharpe 0,93 · DD −33,7% | +135% · Sharpe 0,82 · DD −18,6% |
| Universo elegible EW | +172% · Sharpe 0,77 | +154% · Sharpe 0,87 |
| **vs SPY** | **+57 pp** | **+8 pp** |
| **vs universo EW** | **+122 pp** | **−11 pp** |

Frente al **SPY** gana en las dos, con **peor Sharpe** en la reciente (0,87 vs 0,93). Frente al **universo equiponderado** gana con holgura en una y **pierde** en la otra: en 2011-2018 el producto **no demuestra que seleccionar aportara nada**, sólo que estar invertido sí.

> **RECALCULADO EL 2026-09-01, tras CINCO correcciones de datos.** Ninguna se hizo para mover el
> resultado; todas lo movieron. La última fue la mayor: **la propia tabla de miembros tenía sesgo
> de supervivencia dentro** — borraba del pasado a las empresas que murieron, y tenía 446
> miembros en 2010 cuando el S&P 500 siempre ha tenido ~500. Los tickers muertos desde 2010 no
> eran 174 sino **345**.
>
> **La ventaja de la señal desnuda sobre el universo equiponderado, paso a paso:**
>
> | | base sesgada | sin sesgo | +cortadas | +sectores | **+miembros** |
> |---|---:|---:|---:|---:|---:|
> | 2019-2026 | +39 pp | +46 pp | +45 pp | +45 pp | **+40 pp** |
> | 2011-2018 | +32 pp | +12 pp | +5 pp | +5 pp | **+6 pp** |
>
> **La ventana antigua se estabilizó en ~+5 pp hace tres pasos y ya no se mueve.** La reciente
> aguantaba en +45 y baja por primera vez al arreglar el sesgo de la tabla de miembros: la
> referencia sube y la cartera baja. En la antigua las dos cosas se compensan casi exactamente.
>
> **+6 pp sobre ocho años sigue siendo indistinguible de cero**, y las dos ventanas siguen sin
> confirmarse mutuamente. Lo que ha cambiado es que ahora la base ya no esconde nada conocido.
>
> Cobertura publicada en el artefacto: 2 de 100 posiciones sin valorar en la reciente y 4 de 93
> en la antigua. Y `membresiaCongelada` baja de 22 de 182 fechas a **2 de 182**, porque la fuente
> nueva llega hasta hoy.

**El régimen manda más que la selección, y esto hay que decirlo:** en 2019-2026 el índice ponderado por capitalización batió al equiponderado por **64 pp** (la era de las megacaps); en 2011-2018 pasó lo contrario, **−40 pp**. Un producto equiponderado arrastra ese viento a favor o en contra sin que tenga nada que ver con acertar acciones. Buena parte del "+55 pp vs SPY" de la ventana reciente es selección; buena parte del "+28 pp" de la antigua es simplemente que allí equiponderar ganaba — de hecho, contra el universo equiponderado la v2 **pierde 11 pp** en esa ventana.

**Sobre el drawdown, y esto cambia de sentido con los datos corregidos:** ya **no** sale mejor que el del índice en las dos ventanas. En 2019-2026 es **peor** (−35,4% frente a −33,7% del SPY) y en 2011-2018 algo mejor (−17,7% vs −18,6%). Antes salía mejor en las dos y se apoyaba en ello con reservas; ahora ni siquiera eso. **No se puede vender como protección**, y conviene que la página del producto lo diga con este número y no con el anterior. Las dos simulaciones **arrancan con la cartera vacía**, así que en marzo de 2020 el sistema aún tenía caja sin desplegar y ese colchón es un accidente de la fecha de inicio, no una propiedad de la estrategia. **Quien se suscriba con la cartera ya montada no tendrá ese colchón.** Hasta que la Fase 2 lo mida en vivo, la frase honesta es "riesgo parecido al del índice", no "menos riesgo".

**Quien no soporte un −35% no debería comprar esto aunque acabe rindiendo más.** Y esa frase va en la página del producto, no aquí.

Lo que el propio `research/` sigue desmintiendo, y por eso no se promete: que el **score de Scora** bata al índice (§7.10-§7.11), que el momentum lo haga, o que los percentiles sectoriales ayuden.

### Entonces, ¿qué aporta?

Ataca el **coste de comportarse mal**, no la selección. Está documentado desde hace décadas —Morningstar lo publica cada año en su estudio *Mind the Gap*— que el inversor medio obtiene menos rentabilidad que los propios fondos que posee, del orden de uno a dos puntos anuales, por comprar tarde y vender en pánico. **Ese hueco es mayor que el alfa que consigue casi nadie.**

Un sistema con fechas fijas, criterios escritos y ventas por regla elimina ese hueco por construcción. No hace falta batir al mercado para que aporte: basta con dejar de perder contra uno mismo. Y eso sí se puede afirmar sin mentir.

---

## 2 · Universo elegible

Un valor sólo puede entrar si, **el día de la decisión**, cumple TODO:

| Filtro | Umbral | Por qué |
|---|---|---|
| Mercado | Acción ordinaria cotizada en EE. UU. | Datos fiables y sin fricción de divisa |
| Precio | **> $10** | Por debajo, la horquilla se come el resultado |
| Capitalización | **> $500M** (media de 3 meses) | Evita micro-caps donde el backtest miente |
| Liquidez | Volumen medio 20 días **> $5M diarios** | Que la cartera sea replicable por un particular |
| Cobertura de datos | Fundamentales completos en EDGAR | Sin datos no hay nota, y sin nota no hay pick |
| Exclusiones | Sin OPA/fusión anunciada · sin cotización suspendida | La tesis ya no depende del negocio |

> **De dónde sale la lista de miembros.** El universo point-in-time se descarga de un CSV público y gratuito (`hanshof/sp500_constituents`), que cubre 1996 → 2025-08-23 y **dejó de actualizarse ahí**. Para el backtest sigue sirviendo; para decidir hoy no, y entre el 2025-08-23 y el 2026-08-24 estuvo congelado — con el efecto que se cuenta debajo. Desde el 24-08-2026 se le añade encima la **foto de hoy** de una fuente mantenida, así que una decisión de hoy ve el índice de hoy.
>
> ### ✅ RESUELTO el 2026-08-24 — y la afirmación que había aquí era FALSA
>
> Este recuadro decía que no había sustituto usable porque los candidatos gratuitos «traen
> tickers equivocados», y citaba `FISV`, `MRSH`, `Q` y `ECHO`. **No están equivocados: son los
> tickers ACTUALES, y no se reconocieron.** Comprobado contra `data.sec.gov`, que es la
> autoridad, el 2026-08-24:
>
> | ticker | CIK | la SEC dice | y su ticker en la SEC es |
> |---|---|---|---|
> | `FISV` | 798354 | FISERV INC | `FISV` |
> | `MRSH` | 62709 | MARSH & MCLENNAN | `MRSH` |
> | `Q` | 2058873 | **Qnity Electronics** (escisión de DuPont) | `Q` |
> | `ECHO` | 1415404 | **EchoStar Corp** | `ECHO` |
>
> `Q` no es un ticker viejo: es una empresa nueva. `ECHO` no es Echo Global Logistics: es
> EchoStar. Y la que trae los tickers viejos es **la foto congelada** — de hecho §2bis ya tenía
> que mapear `BK`→BNY y `MMC`→MRSH justamente porque la SEC usa los nuevos.
>
> **Qué se ha hecho.** `datasets/s-and-p-500-companies` está mantenida (actualizada cada pocos
> días) y trae además el **CIK** de cada miembro. Se añade como una instantánea más, fechada
> hoy, **sin reescribir la historia**: el backtest point-in-time resuelve exactamente igual que
> antes y sólo cambia lo que ve una decisión de HOY.
>
> Efecto medido en el cron: de **366 días de antigüedad a 0**. Los 28 nombres que estaban mal
> (5,6 % del índice) entran, y desaparecen las exclusiones por «sin cotización vigente» —`EA` y
> `K` no estaban suspendidas: es que ya no están en el índice—.
>
> **Lo que sigue pendiente:** la fuente mantenida es una foto del PRESENTE, no una serie
> histórica. Entre el 2025-08-23 y hoy no hay instantáneas intermedias, así que las altas y
> bajas de esos once meses siguen sin verse en el backtest. Para el producto en vivo da igual;
> para el backtest es una imprecisión declarada.
>
> **La decisión es declararlo, no disimularlo.** Un universo **fijo y publicado** es defendible en un sistema de reglas preregistrado; uno que envejece en silencio, no. Cada decisión guarda `universe_asof` en `sl_picks_run`, el cron avisa en alto cuando la foto pasa de 45 días, y `/picks` lo dice en la propia página. Si algún día hay feed licenciado, se cambia la fuente **abriendo `rules_version` nueva** (§8), no en caliente.

### 2bis · Cuando una empresa cambia de ticker, el sistema deja de verla

El universo congelado nombra a las empresas con el ticker que tenían el 2025-08-23. **Tres** miembros grandes y perfectamente sanos del índice ya no se llaman así, y el resultado no era que el sistema los ignorase: en un caso era peor.

| | `BK` → `BNY` | `MMC` → `MRSH` | `BRK.B` → `BRK-B` |
|---|---|---|---|
| Empresa | Bank of New York Mellon | Marsh & McLennan | Berkshire Hathaway B |
| Qué pasó | cambio de ticker | cambio de ticker | **notación**: el CSV usa punto, la SEC y Yahoo guion |
| ¿Está el ticker viejo en `company_tickers.json` de la SEC? | ❌ **no** | ❌ **no** | ❌ **no** |
| `tickerToCik` del ticker viejo | ✅ pero **sólo por `MANUAL_CIK`**, un override a mano de este repo | ✅ ídem | ❌ **null — no había override** |
| **Percentil de calidad** | ✅ se calculaba | ✅ se calculaba | ❌ **ninguno: invisible por completo** |
| Precio bajo el ticker viejo | ❌ **14,79 $** — otro instrumento (Yahoo y Tiingo coinciden: 5 barras de junio de 2026) | ❌ no existe (Yahoo: *"symbol may be delisted"*) | ❌ no existe |
| Precio real | 158,49 $ | 192,01 $ | 495,82 $ |

Verificado contra la fuente el 2026-08-22: el mapa de la SEC tiene **10.403 entradas y sólo tickers vigentes** — están `BNY`, `MRSH` y `BRK-B`; no están `BK`, `MMC`, `BRK.B`, `K` ni `EA`.

Y por eso los dos fallos son **de distinta gravedad**:

- **`BK` y `MMC` eran ruidosos si te fijabas:** la mitad fundamental del dato seguía al CIK gracias al override, la mitad de precio seguía al **string**. **`BK` habría sido un candidato con nota buena y precio falso**: si entra en el top 40, el sistema registra una compra a 14,79 $ en un track record público y **nada falla**.
- **`BRK.B` era mudo del todo.** Sin CIK no hay fundamentales, sin fundamentales no hay señal, y **sin señal no aparece en ningún aviso** — los avisos sólo ven a los que llegan a puntuar. Berkshire Hathaway, uno de los mayores componentes del índice, llevaba fuera del universo sin dejar rastro. Con el override puesto saca **4/5 métricas y sí puntúa**. Es el único caso de los 503: el otro ticker con sufijo de clase, `BF-B`, ya viene con guion en el CSV y resuelve solo.

> **La lección de método, que es la que se lleva uno:** el aviso de "sin cotización vigente" que se añadió arriba **no habría encontrado a `BRK.B` jamás**, porque sólo mira a los que tienen señal. Un guardián que sólo inspecciona a los que llegaron nunca ve a los que no llegaron. Los ausentes hay que contarlos contra la lista de entrada, no contra la de salida.

**Tres arreglos, y son distintos:**

1. **Seguir a la empresa, no a la cadena de texto, también en los PRECIOS.** `YAHOO_ALIAS` mapea `BK→BNY`, `MMC→MRSH` y `BRK.B→BRK-B`, así que las tres recuperan sus ~2.067 barras y su precio real. **La regla para añadir un cambio de ticker ahí no es opcional:** `tickerToCik` debe devolver **el mismo CIK** para los dos tickers. Es la única prueba de que es la misma empresa y no un ticker *reasignado* a otra — el error simétrico, y mucho peor, porque empalma precios ajenos sin fallar. Verificado para `BK` y `MMC`. (`BRK.B` es un caso aparte: el ticker viejo no resuelve en ninguna forma, y lo que lo justifica es que punto y guion son la misma clase de acción, no dos empresas.)
2. **Y también en los FUNDAMENTALES.** `MANUAL_CIK` gana una entrada, `BRK.B → 0001067983`. Sin ella Berkshire no existía para el sistema.
3. **Y aun así, exigir cotización vigente.** Un valor sólo es elegible si su serie de precios **alcanza la fecha de decisión** (máximo 10 días naturales). No sirve `hasPriceAt`: usa `idxOnOrBefore`, así que una serie muerta en 2019 devuelve `true` en 2026 — con el precio de 2019. Es point-in-time: un valor deslistado en 2020 seguía siendo elegible para una decisión de 2019, y así se comporta.

**Medido en el dry-run del 2026-08-17, antes y después:** de 407 nombres con señal y 404 elegibles se pasa a **408 con señal y 406 elegibles**; los 2 excluidos son `EA` (retirada de bolsa) y `K`/Kellanova (comprada por Mars), que es exactamente lo que debe excluirse.

**De los tres, sólo volvieron al universo `MMC` y `BRK.B`. `BK` no**, y la razón es otra cosa entera — ver §2ter. Arreglar el precio de BNY Mellon no lo devuelve, porque la señal de calidad **no puntúa bancos**.

**Y un guardián por encima:** si más del **20%** del universo se queda sin precio vigente, el cron **aborta**. Que unos pocos cambien de ticker es rotación normal; que se caiga un tercio es la fuente de precios fallando, y decidir sobre el 80% que sí respondió sería sesgar la selección por quién contestó al servidor.

> Nada de esto cambia una regla: **implementa** la exclusión que §2 ya declaraba y corrige a qué empresa apunta un ticker. Por eso no abre `rules_version` nueva.

> **Lo que sí queda pendiente y no lo arregla el código:** el mapa de alias es manual. Cada cambio de ticker futuro entre miembros del índice volverá a abrir este agujero hasta que alguien lo añada. Es el precio de un universo congelado (§2) y hay que revisarlo cuando se revise la foto.

### 2ter · Scora Picks no compra bancos, y eso no era una decisión

Al arreglar el precio de `BK` se esperaba que BNY Mellon volviera al universo. **No volvió**, y al mirar por qué apareció algo que no estaba escrito en ninguna parte.

La señal son cinco métricas de calidad (`grossProfitability`, `roic`, `operatingMargin`, `interestCoverage`, `−netDebtEbitda`) y hacen falta **3 de 5** para tener nota. Medido el 2026-08-22 sobre los estados financieros reales:

| Grupo | Con señal |
|---|---:|
| **Bancos** (JPM, BAC, WFC, C, GS, MS, USB, PNC, TFC, BK, STT, NTRS, FITB, MTB, RF, KEY, CFG, HBAN) | **0 de 18** |
| Aseguradoras (PGR, TRV, ALL, AIG, MET, PRU, CB, AFL, HIG, CINF) | 4 de 10 |
| No financieras (AAPL, MSFT, JNJ, PG, KO, HD, CAT, UNH, LIN, MMM) | **10 de 10** |

Diecisiete de los dieciocho bancos dan **cero** métricas de cinco. No es un fallo del parser: es que "margen operativo", "cobertura de intereses" y "deuda neta / EBITDA" **no significan nada en el balance de un banco**, donde los intereses son el negocio y no un gasto financiero. Es el mismo argumento que ya excluye a los REIT (que necesitan FFO en vez de BPA), sólo que con los REIT estaba escrito y con los bancos no.

**Por qué esto importa para "batir al índice", que es lo que de verdad se persigue.** Scora Picks **no puede comprar un banco, nunca**. Eso es un **sesgo sectorial permanente**, no una selección. Y no es neutral, porque los bancos rindieron **por debajo del índice en las dos ventanas** (retorno total, medido el 2026-08-22):

| | 2019-2026 | 2011-2018 |
|---|---:|---:|
| SPY | +233,2% | +131,3% |
| XLF · financieras | +162,6% → **−70,6 pp** | +107,1% → **−24,2 pp** |
| KBE · bancos | +124,6% → **−108,6 pp** | +61,7% → **−69,5 pp** |

O sea que **no tener bancos fue viento a favor frente al SPY en las dos ventanas**, y parte del +55 pp y del +28 pp de §1 puede venir de ahí y no de elegir bien. Esta tabla es ponderada por capitalización, así que da la dirección y no la magnitud.

**Medido el 2026-09-01.** Quitar los financieros del universo elegible equiponderado mueve la referencia **+0,3 pp** en 2019-2026 y **−3,0 pp** en 2011-2018. Así que el margen contra el universo elegible **no es una apuesta sectorial disfrazada** — y en la ventana antigua la conclusión va al revés de lo que se temía: los financieros AYUDABAN a la referencia, o sea que no tenerlos fue un viento en contra leve, no a favor. ⚠️ Las cifras absolutas de esa medición son de antes de resolver 24 CIK más (ver §6bis): el signo y la magnitud del efecto sectorial se mantienen, pero el margen sobre el que se aplican ya no es +7,7 pp sino **+1,3 pp**.

⚠️ **Y hasta hoy esto no estaba medido.** Desde el 24-08-2026 aquí figuraba «+0 pp en las dos ventanas, ya está medido y es cero», pero `universoEW(eje, excluir)` aceptaba la lista de exclusión y **nunca filtraba**: las dos referencias eran el mismo cálculo y aquel +0 pp era comparar un número consigo mismo. La conclusión resulta ser correcta; la prueba que se daba, no. El motivo que se ofrecía —«el universo ya está casi libre de bancos, 23 de 433»— tampoco cuadraba: el artefacto contaba 55 y 51.

*(Nota de método: esta tabla NO se ha recalculado con los datos corregidos del 24-08-2026 — es de precios y no de fundamentales, así que el arreglo del extractor no la toca. Su +233,2% de SPY difiere del +237% de §1 por unos días de calendario en los extremos, igual que el +131,3% del +135%.)*

> ✅ **HECHA el 2026-09-01** — tras descubrir que la de agosto no lo estaba. La referencia vive dentro del artefacto (`universoEWSinFinancieros` en `picks_rules_backtest.json`), ahora filtra de verdad, lanza una excepción si se le pide excluir y no quita a nadie, y `datos.test.mjs` falla si las dos referencias coinciden en los cuatro campos habiendo exclusiones. El fallo no puede volver callado.

**Y hay que decirlo en la página del producto**, junto a la advertencia de concentración: quien compre esto tiene una cartera sin bancos por construcción.

---

**DECIDIDO: no se admiten ETFs ni REITs.** Los REIT necesitan otras métricas (FFO, no BPA) y meterlos obliga a duplicar el criterio. Y hay un argumento empírico además del conceptual: en las **90 operaciones** que la simulación abrió en 2019-2026 no apareció **ni un REIT**, porque su apalancamiento estructural los hunde en `netDebtEbitda` y en `interestCoverage`. Se estaría duplicando el criterio para nombres que el sistema no compraría de todas formas.

---

### 2quater · Un emisor, una posición

**La v2 tenía Alphabet dos veces.** `GOOG` y `GOOGL` en cartera **a la vez desde el 2021-10-01
hasta el cierre de la ventana**: 1.748 días con dos posiciones en la misma empresa, con retornos
de +157,2 % y +174,1 %. En una cartera que promete 40 nombres diversificados eso es un **5 % en
Alphabet donde el diseño implica 2,5 %**, y no se declaraba en ningún sitio.

No era un fallo de datos: los dos tickers existen, cotizan y puntúan. Era que **la regla contaba
POSICIONES y el diseño quería decir EMPRESAS**. Nadie eligió doblar Alphabet.

**✅ Arreglado el 2026-09-01 en la v3.** El motor (`lib/picks.ts`) ya no compra la segunda clase
de una empresa que ya tiene, y los tests lo fijan.

#### Las dos decisiones de diseño

- **Se bloquea la SEGUNDA clase, no «la peor».** Entra la que califique primero y la otra queda
  fuera mientras dure la posición. Así no hay que inventar una regla de «qué clase se queda»
  —¿la más líquida? ¿la que vota?— que habría que justificar para todos los casos futuros y que
  sería arbitraria en casi todos.
- **No se toca el universo.** El S&P 500 sí tiene las dos líneas de Alphabet, así que el pool de
  percentiles debe seguir teniéndolas: es el índice de verdad. La que no debe tenerlas es la
  **cartera**. Deduplicar arriba movería todos los percentiles; deduplicar abajo cambia sólo lo
  que estaba mal.

Y un cuidado que no es de diseño: **deduplicar nunca vende**. Un duplicado que ya se tuviera se
queda — vender la posición buena para «arreglarlo» sería peor que el duplicado. Lo que se impide
es comprar la segunda.

#### Lo que costó

| | v2 (las dos) | **v3 (una)** |
|---|---:|---:|
| Scora Picks 2019-2026 | +216,6 % | **+209,7 %** |
| ventaja sobre el universo EW | +44,3 pp | **+37,4 pp** |
| Sharpe (con caja) | 0,73 | 0,72 |
| máximo drawdown | −27,2 % | **−26,4 %** |
| posiciones | 99 | 98 |
| intercuartil de estabilidad | 5,6 pp | **4,5 pp** |

**Cambian dos entradas en 182 fechas**: sale `GOOGL|2021-10-01` y `WST` se adelanta dos semanas
al hueco. La ventana **2011-2018 tampoco cambia por deduplicar** —la ablación da el mismo +154,8 %
el control: el cambio no hace nada donde no había nada que arreglar.

**Los 6,9 puntos no son ventaja perdida: son ventaja que nunca existió.** Alphabet contaba dos
veces y sus dos clases estaban entre las ganadoras. Tres señales de que el cambio es sano y no
sólo caro: **mejora el drawdown**, **estrecha la banda de estabilidad**, y el Sharpe casi no se
mueve — el retorno que se va, se va con su riesgo.

#### Por qué abre versión de reglas

Aunque sea corrección de un defecto y no un cambio de criterio, **el track record de la v2
incluye ese doble peso**, así que no es comparable con el de la v3, y por eso **PICKS_RULES_VERSION pasa a 3**.

El coste queda publicado como una fila más de la ablación (*«sin deduplicar (como la v2)»*), para
que no haya que fiarse de este documento.

#### Lo que queda vigilado

El universo trae **tres** casos de doble clase viva —`GOOG`+`GOOGL` en las 182 fechas, `UA`+`UAA`
en 84, `DISCA`+`DISCK`+`WBD` en 79— y diecisiete parejas más que son renombres y nunca coexisten
(`FB`→`META`, `COG`→`CTRA`, `ANTM`→`ELV`…), ésas ya bien tratadas.

Dos guardianes independientes, que miran el RESULTADO y no el código que lo produjo:
`research/doble_clase.mjs` sale con código 1 si el libro tiene un solape, y `cron-picks.mjs`
avisa con anotación de GitHub Actions si la cartera del día repite emisor. Un ticker que no
resuelva a CIK se cuenta aparte, **nunca** como «no es duplicado».


## 3 · La señal de entrada

**DECIDIDO — medido el 2026-08-20 en `research/quality_lowvol_lab.mjs`, dos ventanas independientes.**

La señal es **CALIDAD SOLA**. No calidad + baja volatilidad, que era la propuesta inicial y se cayó al medirla.

### Lo medido (cartera de 40, trimestral, neto de costes, vs el universo elegible equiponderado)

*(universo COMPLETO, 499 miembros — los números anteriores estaban sesgados; ver más abajo. Y medido **a 40 posiciones**, que es el tamaño decidido en §6: publicar el backtest del top 25 y luego comprar 40 sería enseñar un backtest que no es el del producto.)*

> ### 🔴 Recalculado el 2026-08-24, y esta vez el resultado va EN CONTRA
>
> Los tres defectos de datos descritos en `PLAN_SCORA_FORENSE.md` §8 —el TTM que no eran doce
> meses, la deuda ausente escrita como cero y los REIT puntuando con una rebanada de sus
> ingresos— tocaban **cuatro de las cinco métricas** de esta señal. Al arreglarlos, **la
> afirmación central de esta sección deja de sostenerse**:
>
> | | antes (datos defectuosos) | ahora |
> |---|---:|---:|
> | Calidad sola · 2019-2026 | +53 pp | **+30 pp** |
> | Calidad sola · 2011-2018 | +30 pp | **−6 pp** |
>
> **La calidad ya NO bate al universo equiponderado en las dos ventanas.** Y no es un
> artefacto de un laboratorio: `pillar_dilution_lab`, que la mide por su cuenta, da **−5 pp**
> en esa misma ventana. Dos mediciones independientes coinciden.

| Señal | 2019-2026 | 2011-2018 | ¿Replica? |
|---|---:|---:|:---:|
| **Calidad sola** | +30 pp · Sharpe 0,77 · IC +0,0159 | **−6 pp** · Sharpe 0,87 · IC −0,0012 | ❌ **no** |
| Baja volatilidad sola | −68 pp · Sharpe 0,54 | +30 pp · Sharpe 1,61 | ❌ no |
| Calidad + baja vol (opción B) | −55 pp · Sharpe 0,57 | +6 pp · Sharpe 1,33 | ❌ no |
| Score v1 (el de producción) | +8 pp · IC −0,0063 | +27 pp · IC +0,0201 | ⚠️ positivo en las dos |
| *(referencia: universo EW)* | *+131% · Sharpe 0,69* | *+153% · Sharpe 0,96* | — |

**Lectura honesta, y es incómoda:**

- **Ninguna de las cuatro señales replica limpiamente.** La calidad gana en una y pierde en la otra; la baja volatilidad hace lo contrario; la combinación también. La única que sale positiva en las dos es **el score v1 de producción** (+8 y +27 pp) — que es justo la que este documento decidió no usar.
- **Pero eso no autoriza a cambiar de señal, y conviene ser explícito.** El barrido por número de posiciones lo desactiva: en 2011-2018 la calidad va de **−9 pp (N=50) a +28 pp (N=10)** según cuántas posiciones tenga la cartera. Un rango de 37 puntos que sale de un parámetro. **La diferencia entre estas señales es menor que la sensibilidad al tamaño de la cartera**, así que elegir la que hoy sale mejor sería exactamente el error de `TOP_N = 25` otra vez.
- **Lo que sí aguanta:** la calidad bate al universo EW en **8 de 10** tamaños en la ventana reciente y en **6 de 10** en la antigua. El −6 pp de N=40 es un punto malo de una banda mayoritariamente positiva, no un veredicto. Pero *no se puede seguir diciendo que replica*, porque el tamaño que usa el producto es 40 y ahí no lo hace.
- Los IC siguen por debajo del efecto mínimo detectable, así que lo que sostenía esta decisión era la consistencia entre ventanas — **y es justo lo que se ha caído**.

**Consecuencia para el producto, sin rodeos:** la evidencia a favor de la señal de Scora Picks es **más débil de lo que este documento afirmaba**, y parecía más fuerte por un defecto de datos. No cambia la arquitectura ni las reglas, pero sí refuerza que la validación de verdad son los seis meses en vivo (§11, Fase 2) y **no este backtest**. Cobrar por esto antes de esa medición sería vender un número que ya ha demostrado moverse.

**La baja volatilidad se cae de forma espectacular**: un giro de 98 puntos entre ventanas (−68 pp → +30 pp). Es el factor más dependiente de régimen que se ha medido aquí — brilló en 2011-2018 (tipos bajos, mercado tranquilo, drawdown máximo de −3,1%) y fue un desastre en 2019-2026 (COVID y tecnológicas). Justo lo que la literatura advierte: funciona hasta que deja de funcionar. *(Y ojo: con los datos corregidos, en 2011-2018 la combinación calidad + baja volatilidad pasa sus 3 criterios de aceptación. En 2019-2026 saca 1 de 3. Sigue sin replicar, que es lo que decidió descartarla.)*

> ### ⚠️ Corrección del 2026-08-21: el score de producción NO estaba roto, mi laboratorio sí
>
> La v1 de este documento afirmaba que el score v1 **no replicaba** (−16 pp en 2011-2018) y construía encima una hipótesis: que value, momentum y growth estaban **diluyendo** a la calidad.
>
> **Las dos cosas eran falsas.** `collectRows` usa por defecto la caché de precios que **arranca en 2018-06**; en la ventana 2011-2018 devolvía precio `null` para todos los nombres, así que `calcScores` calculaba el score **con los pilares de value y momentum a cero**. No se midió el score: se midió medio score. Con precios correctos da **+27 pp y Sharpe 1,05** — mejor que la calidad sola en esa ventana. Confirmado por dos laboratorios independientes (+27 y +26 pp). *(Cifras del 24-08-2026; antes de corregir los datos salían +40 y +41 pp.)*
>
> **Y la hipótesis de la dilución queda refutada por sus propios criterios** (`research/pillar_dilution_lab.mjs`, las dos ventanas, cada pilar solo y en pares):
>
> | | 2019-2026 | 2011-2018 |
> |---|---:|---:|
> | pilar `health` **solo** | −14 pp | +0 pp |
> | **SCORE v1 completo** | **+3 pp** | **+26 pp** |
> | Calidad §3 (5 métricas) | +48 pp | **−5 pp** |
>
> El pilar de calidad por sí solo **pierde contra el score completo en las DOS ventanas**. Ningún pilar estorba de forma consistente: value da −65 pp en una ventana y +76 pp en la otra; growth, +111 pp y −87 pp. **Combinar mejora.** El score de la app no se toca — y ahora por evidencia, no por prudencia.
>
> *(Recalculado el 24-08-2026. La conclusión no cambia; los números sí. Y aquí aparece por segunda vez, medida por un laboratorio independiente, la caída de la calidad de §3 en la ventana antigua: **−5 pp**.)*
>
> **Lo que sí replica de ahí:** la calidad de §3 bate al pilar `health` en la ventana reciente (+48 vs −14) y **pierde** en la antigua (−5 vs +0). En la v1 de este documento ganaba en las dos. El margen es mucho menor que el publicado antes, y en la ventana antigua las dos son casi cero — pero el orden entre ellas aguanta.
>
> **Y se investigó el porqué el mismo día** (`research/health_scale_lab.mjs`), con un resultado que corrige a la primera explicación que se escribió aquí:
>
> - **`health` sí satura, y muchísimo.** Da hasta 44 puntos brutos a una no-financiera y luego los recorta a 30: **el 30% del universo empata exactamente en el tope** en las dos ventanas, y **139 nombres comparten el valor del puesto 40**. Elegir "los 40 mejores por `health`" es elegir 40 de entre 139 idénticos.
> - **Pero la saturación NO es lo que le cuesta rentabilidad.** Cambiar *sólo* la escala (mismas métricas, percentil en vez de bandas) da +49 pp en una ventana y empeora en la otra. **No replica.**
> - **Lo que replica es el juego de métricas:** las 5 de §3 baten a las 6 de `health` con la misma escala en las dos ventanas. Las dos que sobran —`debtEquity` y `currentRatio`— miden conservadurismo de balance, no rentabilidad.
>
> Nada de esto toca `scoring.ts`: el cambio de escala falló su criterio preespecificado y el del juego de métricas exige su propia hipótesis antes de tocar producción.

### Qué se mide exactamente como "calidad"

Percentil transversal medio de cinco métricas, todas de los estados financieros y ninguna del precio:

`grossProfitability` (Novy-Marx: beneficio bruto / activos) · `roic` · `operatingMargin` · `interestCoverage` · `−netDebtEbitda`

### Un fallo del backtest que se encontró al revisarlo (2026-08-20)

El universo estaba **truncado alfabéticamente**: `membersAsOf` devuelve los tickers de la A a la Z y un `slice(0, 400)` borraba los 99 últimos — UnitedHealth, Visa, Walmart, Exxon, Verizon, Wells Fargo, UPS, Texas Instruments… el 20% del índice y algunos de los mayores. Afectaba a cuatro laboratorios.

Corregido y vuelto a medir con el índice completo (499 nombres). El efecto **no va en una sola dirección**, y por eso importa tanto:

*(esta tabla compara truncado vs completo **a top 25**, que es como estaba el lab entonces. Los titulares de §3 están a 40 — no son comparables con estas cifras.)*

| | Truncado | Completo |
|---|---:|---:|
| Calidad · 2019-2026 | +66 pp · Sh 0,79 | **+79 pp · Sh 0,84** ↑ |
| Calidad · 2011-2018 | +34 pp · Sh 1,02 | **+14 pp · Sh 0,90** ↓↓ |
| Score v1 · 2019-2026 | +34 pp · IC +0,0047 | **+6 pp · IC −0,0009** ↓↓ |

Arreglar el sesgo **se llevó por delante más de la mitad** del resultado de la calidad en la ventana antigua, y dejó al score de producción sin nada que distinguir. Un universo truncado por la inicial del ticker no parece un problema grave hasta que se mide cuánto movía.

**Y una segunda lección, del 2026-08-21:** al corregir el sesgo se rehicieron las **tablas** pero no se barrió la **prosa**. Tres cifras del universo truncado sobrevivieron en párrafos de este mismo documento —el IC de 2011-2018, el giro de la baja volatilidad y el resultado del score v1— diciendo lo contrario que la tabla que tenían encima. Una corrección no está terminada hasta que se busca el número viejo por todo el texto, no sólo donde uno recuerda haberlo escrito.

### Las salvedades, que no son letra pequeña

- **28 y 32 trimestres.** El efecto mínimo detectable sigue siendo mayor que los IC observados (+0,0155 y +0,0106): lo que sostiene esta decisión es la **consistencia económica entre ventanas**, no la significancia estadística. Es el criterio que gobierna este repo desde que se midió que el otro es incumplible.
- **Sólo S&P 500 large-cap** y sólo dos ventanas.
- **Este backtest mide la SEÑAL, no las REGLAS** — reconstruye el top 40 cada trimestre. Las reglas ya **sí** están backtesteadas aparte, en §6bis, y fue ahí donde se cayó la v1.
- **Sin deslistados**, y el mecanismo no era el que decía este documento: la puerta no es el precio, es `tickerToCik`. Ver el recuadro de §6bis — la dirección del sesgo **no está medida** y la frase "infla los resultados" que había aquí no se sostiene.
- **Costes estimados** en 10 pb por lado, sin impacto de mercado ni horquilla real.
- La calidad **no protege del drawdown** en la ventana reciente (−31,1% frente a −29,7% del universo). Gana por retorno, no por defensa. Si lo que se quiere vender es "dormir tranquilo", esta señal **no** es eso, y no se puede contar como si lo fuera.

### Umbral de entrada: **percentil 70** — y no es una palanca de rentabilidad

Era una decisión pendiente en la v1. Barrido en las dos ventanas (p70 → p90, 15 combinaciones con el umbral de salida):

| Entrada | Retorno de los picks | Capital realmente invertido | vs universo EW |
|---|---:|---:|---:|
| **p70** | +177% | **89%** | −28 pp |
| p75 | +185% | 79% | −41 pp |
| p80 (v1) | +172% | **48%** | −96 pp |
| p85 | +155% | 28% | −131 pp |
| p90 | +214% | **10%** | −147 pp |

> ⚠️ **Esta tabla se rehízo el 2026-08-22 y ahora dice menos de lo que decía.** La versión anterior daba dos columnas —una por ventana— con cifras que **no se pueden reproducir desde los artefactos versionados**: el barrido de 2019-2026 no está en `picks_rules_backtest.json` (`barridoUmbrales: null`, la ejecución se hizo con `--no-sweep`) y el de 2011-2018 sí está pero con otros números. No se sabe con qué parámetros se generó la tabla vieja, así que se sustituye por **lo único que hoy se puede verificar**: el barrido de 2011-2018 con salida en p50, tal cual sale del artefacto.
>
> Queda **pendiente regenerar el barrido de 2019-2026** para recuperar la comparación entre ventanas. Y la lección es la de siempre en este repo: una cifra sin artefacto que la respalde es una afirmación, no una medición.

**El hallazgo que cambia cómo se lee esto:** el retorno de los picks es prácticamente **plano** entre p70 y p85 (+177%, +185%, +172%, +155%). Lo que se mueve —del 89% al 10%— es **cuánto dinero llega a estar invertido**. El umbral de entrada no selecciona mejor: raciona el despliegue de capital. Un umbral alto no es "más exigente", es "más tiempo en liquidez", y eso en un mercado alcista se paga a precio de mercado alcista.

Se elige **p70** porque es el nivel que deja el sistema invertido: 89% del capital frente al 48% de p80 y el 10% de p90. No es el máximo por retorno de los picks —p90 da +214%— pero un +214% sobre el 10% del dinero no es una cartera, es una anécdota con mucha liquidez al lado.

**El umbral de salida se queda en p50 y es casi decorativo**: provocó 3 y 4 ventas en siete y ocho años. Quien creyera que §5 se gobierna con este umbral estaba mirando la regla equivocada (§5).

### La regla de persistencia (esta no se negocia)

Sea cual sea la señal, el valor debe cumplirla **de forma sostenida durante 60 días naturales** antes de ser elegible.

Alpha Picks usa 75 días de Strong Buy, y el motivo es bueno: sin persistencia acabas comprando un pico de un día y rotando cada mes. Con ella, la señal tiene que haber aguantado un trimestre de datos.

---

## 4 · Cadencia

- **Cuatro posiciones nuevas al mes**: dos el **primer día hábil** y dos el **día 15** (o el hábil siguiente).

> **Por qué cuatro y no dos (cambio de la v2).** Con dos compras al mes y un tope de 40, montar la cartera exige veinte meses **en el mejor de los casos** — y en el real, con el umbral de entrada filtrando candidatos, tardó **46 meses en una ventana y no llegó a llenarse nunca en la otra**. El 64% y el 74% de las fechas de compra se quedaron vacías. Resultado: sólo llegó a invertirse el 76% y el **48%** del capital, y la caja parada costó **32 pp y 96 pp** de rentabilidad.
>
> Esto no era un matiz de calibración: era el producto entero. Un sistema que deja la mitad del dinero sin invertir durante ocho años no está seleccionando mal, está **sin funcionar**.
- Las fechas son **fijas**. No se adelantan porque el mercado esté cayendo ni se retrasan porque "está caro".
- Si en una fecha **ningún valor cumple las reglas, no se compra nada**. Un hueco vacío es un resultado legítimo y se publica como tal.

> La disciplina de fecha fija es la mitad del producto. En el momento en que se decide "esta quincena mejor esperamos", esto deja de ser un sistema.

---

## 5 · Salida

Se vende cuando ocurre **cualquiera** de estas cosas, evaluadas en las mismas fechas fijas:

1. La señal cae por debajo del **percentil 50** y sigue así en dos evaluaciones consecutivas.
2. Se activa un **umbral descalificador** (un pilar en el decil inferior de su sector — ya implementado en `lib/scoring.ts`).
3. Deja de cumplir el universo elegible (OPA, exclusión, iliquidez sobrevenida).

**~~4. 180 días en la cartera sin recuperar el umbral de entrada.~~ ELIMINADA en la v2.** Es el cambio más importante del documento y merece explicarse entero:

> ### La regla que vendía a los ganadores
>
> En la simulación, esa regla provocó **52 de 55 ventas** en una ventana y **34 de 38** en la otra. No era una salvaguarda secundaria: **era la política de venta**.
>
> Y le costaba al producto **−74 pp y −64 pp**:
>
> | | con la regla | sin ella |
> |---|---:|---:|
> | 2019-2026 | +178% | **+252%** |
> | 2011-2018 | +79% | **+143%** |
>
> **El mecanismo, y por eso no es casualidad:** el percentil de calidad es **transversal**. Una empresa que crece muy rápido ve cómo sus métricas de balance se normalizan **contra un listón que sube**, así que su percentil cae mientras el negocio se dispara. La regla convertía eso en una venta obligatoria a los seis meses.
>
> En el libro de operaciones eso significó **vender NVDA en noviembre de 2020 tras un +220%**. Y también TXN, REGN e INTU, por lo mismo.
>
> Sin la regla, el sistema abre **muchas menos posiciones** (59 frente a 91 en la ventana reciente) y las mantiene: menos rotación, menos coste y mejor resultado en las dos (+235% vs +142% · +113% vs +76%).

**No hay stop-loss por precio.** Un stop es una regla sobre el precio, no sobre el negocio, y convierte el sistema en otra cosa. Si se quiere control de drawdown, va en el peso, no en la salida.

**Cuarentena:** un valor vendido no puede reentrar en **12 meses**. Se midió quitarla y es **inocua** (+3 pp vs +3 pp · −91 pp vs −92 pp): se mantiene porque protege contra el efecto sierra, no porque aporte rentabilidad.

---

## 6 · Pesos

**Equiponderado**, sin excepciones. Cada posición nueva entra con el mismo peso objetivo que las demás.

Cualquier otra cosa —"esta me convence más"— es discrecionalidad disfrazada de convicción, y hace el track record imposible de auditar.

### Número de posiciones: **40** — decidido con datos, y a propósito NO en el óptimo

Barrido de tamaño de cartera en las dos ventanas (vs universo equiponderado):

| N | 2019-2026 | 2011-2018 | |
|---:|---:|---:|---|
| 10 | −3 pp | **+28 pp** | ← mejor de 2011-2018 |
| 15 | +46 pp | +23 pp | |
| 20 | +51 pp | +0 pp | |
| 25 | +49 pp | +3 pp | |
| 30 | **+53 pp** | +9 pp | ← mejor de 2019-2026 |
| **40** | **+30 pp** · Sh 0,77 | **−6 pp** · Sh 0,87 | ← **el que usa el producto** |
| 50 | +45 pp | **−9 pp** | |
| 75 | +32 pp | −1 pp | |
| 100 | +4 pp | +10 pp | tamaño de un ETF de factor real (QUAL ≈125) |
| 150 | −8 pp | +5 pp | |

**Recalculado el 24-08-2026, y es la tabla que más cambia de todo el documento.** Antes ordenaba: N=10 malo en las dos, el rango 20-50 bueno en las dos, dilución por encima de 75. **Con los datos corregidos esa forma desaparece.** N=10 es el mejor tamaño de una ventana y casi el peor de la otra; N=50 es de los mejores en una y el peor en la otra.

**Qué replica:** que el signo sea mayoritariamente positivo — 8 de 10 tamaños en la ventana reciente, 7 de 10 en la antigua. Poco más.

**Qué NO replica:** ni el pico, ni la forma, ni el valle. Y el rango es enorme: en 2011-2018 la misma señal va de **−10 pp a +28 pp** según cuántas posiciones tenga la cartera. **38 puntos de diferencia que salen de un parámetro, no del mercado.**

**El 40 se mantiene, y ahora con un argumento distinto.** Ya no es "ni pico ni valle en ninguna" —en la ventana antigua es de los peores— sino que **cambiarlo ahora sería elegir el número mirando el resultado**, que es exactamente el error de `TOP_N = 25` que costó reescribir este documento. El tamaño se fijó antes de esta medición y se queda. Lo que cambia es lo que se puede afirmar con él.

> **La advertencia que se deriva de esto y que hay que decir en el producto:** este barrido dice que **el resultado depende tanto del tamaño de la cartera como de la señal**. A 100-150 nombres la señal aporta casi nada (+4 pp y +10 pp en 7-8 años); a 40, +30 pp y −6 pp. Concentrar significa asumir riesgo idiosincrático —unas pocas posiciones mueven el resultado— y eso no es un fallo del sistema: es lo que se compra.

---

## 6bis · El backtest de las REGLAS (aquí se cayó la v1)

`research/picks_rules_backtest.mjs` · simulación **diaria**, fechas de decisión reales del calendario del mercado, 181 y 192 decisiones. No rebalancea un top-N: abre y cierra posiciones cuando las reglas lo dicen, arrastra la caja que queda sin invertir y cobra 10 pb por lado.

### Los criterios, escritos antes de correr nada

| | Criterio | 2019-2026 | 2011-2018 |
|---|---|:---:|:---:|
| **H1** | Las reglas no destruyen la señal (≤ 15 pp por debajo del top-40 trimestral) | ✔ **+51 pp** | ✔ **+57 pp** |
| **H2** | La cartera con reglas bate al universo elegible EW | ✖ **−32 pp** | ✖ **−99 pp** |
| **H3** | Cuantificar el coste de la rampa | 71 pp | **130 pp** |

**H1 pasa en las dos y H2 falla de calle en las dos.** Con los datos corregidos H1 deja de estar en el filo: las reglas de la v1 quedan **por encima** del top-40 trimestral en las dos ventanas (+51 pp y +57 pp), no por debajo. *(En versiones anteriores de este documento H1 salía en −15,5 pp y se registró como fallado; ese número venía de la señal defectuosa.)*

**Y H2 falla, y no por poco.** Con las reglas de la v1 el suscriptor habría hecho **+76%** en 2011-2018 mientras el universo equiponderado hacía +175%. La señal seleccionaba bien —los picks solos hicieron +204%— pero **la mitad del dinero nunca llegó a invertirse**: sólo el 49% del cupo de posiciones llegó a ocuparse.

### ⚠️ La ventaja de 2011-2018 se ha ido (2026-09-01)

**Fuera de muestra ya no hay margen.** Al resolver 24 CIK más de empresas muertas —los 26 de nivel
C admitidos por la regla nueva más `AKS` y `DO` revisados a mano, §6bis— la ventana antigua pasó
de **+7,7 pp a +1,3 pp** sobre el universo elegible equiponderado.

| | Scora Picks | universo EW | ventaja |
|---|---:|---:|---:|
| 2019-2026 | +209,7 % | +179,6 % | **+30,1 pp** |
| 2011-2018 | +154,8 % | +153,5 % | **+1,3 pp** |

**Y +1,3 pp no se distingue de cero:** el intercuartil de esa ventana es 4,6 pp, o sea ±2,3.

#### Por qué bajó, y por qué era previsible

Los CIK nuevos son de **empresas que murieron**. Resolverlos las mete en el universo elegible, y
algunas se compran. El universo de la referencia pasó de 471 a 478 nombres y la cartera de 92 a 93
posiciones. Es exactamente lo que hace corregir sesgo de supervivencia: **quita del resultado la
parte que venía de no poder ver a los muertos**.

Esto no es nuevo, es el mismo patrón otra vez. La ventaja de 2011-2018, corrección tras corrección:

**+32 → +12 → +5 → +7,7 → +1,3 pp.** Cada paso fue un arreglo de datos, ninguno un cambio de
estrategia. Y **cada uno la bajó**.

#### Qué significa y qué no

- **La ventana reciente aguanta, pero ya no intacta**: +30,1 pp sobre el universo elegible. No se
  movió al resolver los CIK —en 2019-2026 casi no hay muertos que resolver— pero **el 2026-09-04
  bajó de +37,2 a +30,1 pp** por un arreglo de cobertura: la cuarta vía de reconstrucción del
  resultado de explotación (`Ingresos − CostesYGastos`) metió 21 nombres más en el universo
  —CVX, XOM, BRK.B, GE, DE, BMY, HCA, ADP— y **ninguno fue elegido**. La cartera no se movió un
  decimal (209,7 % antes y después); lo que subió fue la referencia, de 172,5 a 179,6 %.
  Es el mismo patrón de siempre: **un universo más completo es una vara de medir más dura**, y la
  ventaja baja sin que la estrategia haya cambiado. Ahora le toca a la ventana moderna.
  Ver `research/ebit_costes_gastos.mjs` y `research/out/cobertura_techo.json`.
- **La ventana antigua ya no respalda nada.** Era la única evidencia FUERA DE MUESTRA, y ahora dice
  «ni mejor ni peor que el universo elegible». No se puede seguir citando como confirmación.
- **No dice que la señal no valga.** Dice que su respaldo fuera de muestra es nulo, y que lo único
  que queda es la ventana en la que se diseñó — que por definición no es evidencia independiente.

Lo honesto es dejar de presentar 2011-2018 como validación y tratarla como lo que ha quedado:
**una ventana sin margen medible**, y el aviso más fuerte que tiene este documento sobre lo que
Scora Picks puede prometer.


### Cuánto vale el último dígito (2026-09-01)

Estas cifras se han citado siempre con un decimal. **No lo aguantan.**

Dos corridas con las mismas entradas —sólo cambió la foto de miembros, y el universo pasó de 510
a 509 nombres— dieron resultados distintos. La causa no fue un desempate mal resuelto: el motor
ordena por percentil y, a igualdad, alfabéticamente. Fue que el 2023-03-15 `ACN` puntuaba 0,8094
y `BKNG` 0,8088 — **seis diezmilésimas**, cuando la resolución de un percentil sobre 371 nombres
es 0,0027. Los separa menos de lo que vale un solo nombre del universo, así que quitar uno los
intercambia; y como la estrategia depende del camino, eso arrastró a META de venderse con +157 %
a no venderse y acabar en +451 %.

`research/filo_decision.mjs` mide cuánto de esto hay: de 182 fechas sólo **34 tienen competencia
real** por un hueco, y de ésas **7 (21 %) se deciden por un margen menor que la resolución**.

`--estabilidad` acota la consecuencia con una corrida por cada nombre comprado, quitándolo:

| | publicado (v3) | mediana | intercuartil | rango completo |
|---|---:|---:|---:|---:|
| 2019-2026 | +209,7 % | +209,7 % | 206,5 – 211,7 · **±3 pp** | 179,2 – 225,1 |
| 2011-2018 | +154,8 % | +154,8 % | 152,2 – 156,8 · **±2 pp** | 133,4 – 168,4 |

Dos lecturas, las dos necesarias:

1. **La mediana coincide con lo publicado.** La cifra no es un punto afortunado: quitar un nombre
   cualquiera la deja donde estaba.
2. **El intercuartil son 4-5 pp.** Lo honesto es citar **«unos 210 %, ±2»** y la ventaja como
   **«unos 37 pp, ±2»**, no un decimal que sugiere una precisión inexistente.

El rango completo **no** mide inestabilidad: lo domina la concentración —sin `NVDA` la ventana
reciente se queda en 182 %—, y eso es un hecho sobre la cartera, ya advertido en el producto, no
sobre la medida.

**La v3 estrechó la banda** (de 5,6 a 4,5 pp en la ventana reciente) al dejar de tener Alphabet
dos veces: menos concentración, menos dependencia de un nombre. Ver §2quater.

#### Y lo que se probó y NO se hizo: cuantizar el ranking

El ranking ordena por un percentil guardado con cuatro decimales cuando su resolución real es
1/N. Redondear al cubo de 1/N haría que `ACN` y `BKNG` empataran de verdad y entrara el desempate
alfabético, que es estable. **La pregunta no era si cambia el resultado sino si lo hace más
estable, y la respuesta es no:**

| | sin cuantizar | con cuantizar |
|---|---:|---:|
| sólo picks | +209,7 % | +207,6 % |
| **intercuartil** | **4,5 pp** | **7,0 pp** |

**Se ensancha.** Al crear empates exactos, **más** decisiones pasan a resolverse por orden
alfabético, que es arbitrario respecto al retorno. La inestabilidad no viene de exceso de
precisión sino de **dependencia del camino**: cuantizar no elimina la regla arbitraria, cambia
cuál es y la aplica más veces. Medido en las dos versiones de reglas, con el mismo signo.


### Qué regla hacía el trabajo

Quitando una regla cada vez (retorno con caja, y % del cupo de posiciones realmente ocupado):

| Variante | 2019-2026 | 2011-2018 | % invertido |
|---|---:|---:|---:|
| reglas completas (v1: 2 compras/mes, p80) | +124% | +78% | 73% / 49% |
| sin la regla de 180 días | +235% | +113% | 85% / 69% |
| sin cuarentena | +159% | +76% | 74% / 50% |
| sin persistencia de 60 días | +177% | +75% | 77% / 52% |
| 4 compras/mes (sólo la cadencia) | +154% | +79% | 76% / 50% |
| 8 compras/mes (sólo la cadencia) | +157% | +79% | 78% / 50% |
| **v2 = p70 + 4/mes + sin 180d** | **+294%** | **+143%** | **93% / 92%** |
| v2 pero a 8 compras/mes | +317% | +156% | 96% / 96% |
| *(SPY)* | *+237%* | *+135%* | — |
| *(universo elegible EW)* | *+174%* | *+175%* | — |

Las dos reglas que importan son las dos que tocan al **capital**: la de 180 días (que vendía ganadores) y la cadencia (que no llegaba a invertir). La cuarentena y la persistencia son casi inocuas — se quedan por prudencia, no por rentabilidad.

**Y con los datos corregidos la conclusión se refuerza, no se debilita:** la v1 completa se queda en +124% y +78%, muy por debajo del +294% y el +143% de la v2. El salto es de **170 pp** en la ventana reciente y de **65 pp** en la antigua. Lo que separa a las dos versiones sigue siendo **cuánto dinero llega a invertirse**, no cuánto acierta la señal.

**Por qué 4 al mes y no 8, pudiendo 8 rendir más.** Las dos cadencias despliegan prácticamente el mismo capital y abren un número parecido de posiciones (66 vs 66 · 72 vs 74). La diferencia de retorno viene del **momento** en que se llena la cartera, y no apunta en la misma dirección en las dos ventanas: 8 al mes rinde más en 2019-2026 (+335% vs +294%) y **menos** en 2011-2018 (+132% vs +143%). A cambio tiene **peor drawdown en las dos** (−35,1% vs −34,6% · −20,5% vs −18,4%) y **el doble de operaciones a mano**. Elegir la que más rinde en la ventana que más se ha mirado es exactamente el error que ya cometí con `TOP_N = 25`.

> **⚠️ Un fallo de etiquetado que estuvo a punto de colarse en este documento.** El parámetro de cadencia del simulador es **por fecha de decisión**, y hay dos fechas al mes. Las primeras variantes estaban etiquetadas "4 al mes" cuando en realidad eran 8, y la v2 que se documentó como "4 al mes" se había medido a 8. Todas las cifras de arriba están recalculadas con la cadencia que dice §4. Es la séptima vez en esta investigación que un número venía de un defecto del experimento.

### Lo que este backtest NO demuestra

- **La v2 está dentro de muestra.** Sus tres cambios se eligieron mirando estos datos. Que cada uno replique en las dos ventanas y tenga un mecanismo identificado antes de medirlo lo hace **creíble**, no **demostrado**.
- **Sigue sin haber deslistados** — y al buscar por dónde entraba el sesgo, el 2026-08-21, resultó que este documento lo tenía mal por los dos lados. Ver el recuadro de abajo.

> ### ⚠️ El sesgo de supervivencia no entra por donde decía este documento
>
> Aquí ponía que una empresa que quiebra "desaparece del panel porque su precio ya no está en la fuente" y que **eso infla los resultados, y en la dirección favorable**. Las dos mitades son incorrectas.
>
> **No es el precio.** `señalAt` llama a `collectRows` con `requirePrice = false` a propósito: la calidad sale entera de los estados financieros. Un nombre sin precio **sí** tendría señal.
>
> **Es `tickerToCik`.** El mapa ticker→CIK se descarga de `company_tickers.json` de la SEC, que contiene **sólo tickers vivos**. Comprobado el 2026-08-21: de nueve nombres que salieron del índice —FRC, ANTM, ABC, CELG, ALXN, WLTW, CBS, XLNX, ETFC— `tickerToCik` devuelve `null` para **los nueve**. Sin CIK no hay fundamentales, y sin fundamentales no hay señal **en ninguna fecha**, incluidas aquellas en que la empresa estaba perfectamente sana. Celgene no falta en 2019 porque fuera mala: falta porque Bristol-Myers la compró en 2019 y la SEC borró su ticker del mapa.
>
> **Tamaño del agujero, medido:** en 2019-2026 el índice tuvo **640 miembros distintos** y **137 salieron** durante la ventana. De ellos, **57 no tienen serie de precios** y **56 no aparecen jamás en el panel de señal** (el único que sí, `MMC`, se cae por otra puerta: tiene CIK pero le falta `revTTM`).
>
> **Y por eso la dirección deja de estar clara.** La historia habitual del sesgo de supervivencia es "los muertos desaparecen, así que el resultado se infla". Aquí muchos de los que desaparecen no murieron: los **adquirieron**. Y un adquirido no sale por abajo.
>
> Medido para tres de los ausentes, en los 12 meses hasta su última sesión cotizada:
>
> | | última barra | retorno 12m | SPY en el mismo tramo |
> |---|---|---:|---:|
> | Celgene (`CELG`) | 2019-11-22 · 108,24 $ | **+60,3%** | +19,7% |
> | Alexion (`ALXN`) | 2021-07-28 · 182,50 $ | **+73,5%** | +38,7% |
> | Xilinx (`XLNX`) | 2022-02-14 · 194,92 $ | **+34,2%** | +13,3% |
>
> Las tres terminaron muy por encima del índice y a precios altos, no a cero. Son además el perfil exacto que esta señal compra: márgenes altos y rentabilidad alta. **Es perfectamente posible que incluirlas subiera el resultado, no que lo bajara.**
>
> ⚠️ **Pero esos tres nombres los elegí yo por reconocerlos, no salieron de un muestreo.** La tabla ilustra el mecanismo; **no** establece la dirección agregada del sesgo sobre los 57. Hay muertos de verdad en la lista —First Republic quebró en 2023— y no se ha medido cuánto pesan unos frente a otros. Lo honesto sigue siendo: **la dirección no se sabe**, y ahora se sabe además que no es obvia.
>
> **Lo que sí quedó comprobado, y acota el problema:** el otro canal —una posición ya abierta cuya serie de precios se corta, que `retornosEntre` liquidaría al último precio conocido en vez de a cero— **no se activó ni una vez**. De las **84 operaciones del libro, las 84** tienen serie que llega a su fecha de cierre. Cero truncadas.
>
> Ese recuento salió primero 82 de 84, y las dos que faltaban fueron justamente las que destaparon el defecto de la caché (recuadro siguiente): eran `EA`, cuya historia se había borrado esa mañana. Recuperada de Tiingo —2.054 barras—, el libro queda completo. **Un agujero en el resultado que no era del mercado sino del almacén.**
>
> **Cómo se cierra — EN CURSO desde el 24-08-2026.** Hace falta un mapa ticker→CIK *point-in-time*. La vía limpia serían instantáneas antiguas de `company_tickers.json`, pero **el Internet Archive no tiene ninguna** (comprobado en cuatro fechas distintas). Así que se resuelven uno a uno, y **no son ~57 sino 174**: contados sobre todos los que han sido miembros desde 2010, de los que 79 caen dentro de la ventana 2019-2026 y 152 dentro de 2011-2018. La estimación anterior estaba a un tercio de la realidad. (El fichero de evidencia dice 175 porque contó `RVTY (Previously PKI)`, una celda con texto pegado de la fuente comunitaria; Revvity está viva y resuelve sola. De ahí salió `normalizaTicker`.)
>
> Dos correcciones a lo que decía este párrafo antes:
>
> · **No van a `MANUAL_CIK`.** Esa tabla tiene PRIORIDAD sobre el mapa vivo de la SEC, y meter ahí 100+ tickers muertos taparía a cualquier empresa viva que heredara uno de esos símbolos — `Q` es hoy Qnity Electronics y `ECHO` es EchoStar. Van a `research/data/cik_historicos.json`, que `tickerToCik` consulta **después** del mapa vivo: como relleno sólo actúan donde la SEC no tiene nada, que es exactamente donde hacen falta.
>
> · **El sesgo tiene una segunda mitad, por los PRECIOS**, y este documento ya la había rozado sin sacarle todas las consecuencias (ver la nota sobre Tiingo, más abajo). Cuando una empresa muere, otro instrumento hereda su símbolo: `GENZ` devuelve hoy **4.437 barras continuas de un ETF de VanEck**, con un cierre de 32,99 $ el día en que Sanofi pagó 74 $ por Genzyme. No basta con truncar —la serie entera es del instrumento nuevo—, así que se bloquea; y cuando la empresa sólo se **renombró**, se rescata por alias (`FB` no da nada de Meta, pero `META` da su serie desde 2012).
>
> El desarrollo completo está en **§10 de `PLAN_SCORA_FORENSE.md`**: nueve trampas cazadas midiendo (§10.3), cuatro más al revisar lo que el resolutor no podía decidir solo (§10.4), y seis que sólo aparecieron EJECUTANDO la auditoría muchas veces y mirando los contadores entre pasada y pasada (§10.5bis) — entre ellas que la herencia incremental no ocurría nunca, así que la auditoría no habría terminado jamás. §10.5ter documenta además la variante simétrica que nada de esto cubre: tres miembros ACTUALES (`BLK`, `APA`, `SNDK`) cuyo CIK no tiene la historia de la empresa. Rehacía la base del backtest, y **los números de este documento ya están recalculados sobre ella** (2026-08-25): ver el recuadro de §1. La auditoría de símbolos quedó cerrada —119 de 119 tickers publicados auditables con veredicto firme— y el rebuild corrió detrás de una puerta que lo impide mientras quede alguno sin comprobar.
>
> Y una nota sobre Tiingo, que parecía el atajo: no lo es. De los 57 nombres, Tiingo cubre 26 limpiamente, no tiene 16, y en **cinco devuelve el ticker RECICLADO por otra empresa** — `FB` da una serie que empieza el 2025-06-26 (Meta dejó ese ticker en 2022), `INFO` empieza en 2024-10-10, `NFX` en 2026-07-07. Poner `TIINGO_TOKEN` y dar el problema por resuelto habría inyectado los precios de compañías ajenas justo donde la original desaparecía.

> ### ⚠️ La caché de precios podía ENCOGERSE, y encogió (2026-08-21)
>
> `prices.mjs` guardaba la descarga con un `if (rows.length)`: cualquier respuesta no vacía sobrescribía el fichero. El 2026-08-21, un refresco de rutina dejó **`EA` en 6 barras** (desde 2026-07-17) y **`BK` en 5, a 14,79 $** — que no es el precio de Bank of New York sino el de otro instrumento con ese ticker. Años de historia buena, borrados, y de una fuente que ya no los tiene.
>
> **El fallo era mudo por partida doble.** `loadPanel` exige 300 barras, así que el nombre desaparece de todos los paneles sin que nada falle; y en CI, donde no hay caché, desaparece del universo directamente. Se detectó por casualidad, comprobando otra cosa: `EA` aparecía dos veces en el libro de operaciones **sin panel de precios**, y en `valorar` una posición sin panel se salta entera — capital que se compra y se esfuma de la simulación.
>
> **Y había un supuesto equivocado detrás:** a Tiingo sólo se le preguntaba cuando Yahoo devolvía **cero** barras. Pero Yahoo no devuelve cero cuando una empresa sale de bolsa o el ticker cambia de manos: devuelve una serie **truncada**. Al no estar vacía, ganaba, y la fuente que sí tiene la historia no llegaba a consultarse nunca.
>
> Arreglado con una regla que se testea sin red (`cubreLaCache`): **un refresco puede alargar una serie, nunca acortarla**. Si la descarga no abarca lo que ya había, se conserva la caché y se avisa; y se consulta a Tiingo también cuando la respuesta se queda corta, no sólo cuando viene vacía.
>
> **Reparación:** `EA` se recuperó entera de Tiingo (2.054 barras, 2018-06 → 2026-08), y el guardián nuevo se vio funcionar sobre el caso exacto que lo motivó: un refresco posterior devolvió otra vez las 6 barras y **no las escribió**.
>
> **`BK` no se pudo reparar por su propio ticker**, y la razón resultó no ser de archivo sino **de producción**: Tiingo devuelve para `BK` las mismas 5 barras a 14,79 $ que Yahoo, porque **BNY Mellon cotiza hoy como `BNY`** (2.067 barras, 158,49 $) y `BK` cambió de manos. Se resuelve por la vía correcta —seguir a la empresa, no al ticker— en §2bis.
>
> ### Y la consecuencia que obligó a recalcular la ventana 2011-2018
>
> El muñón de `EA` no se quedó en la caché: **entró en los resultados publicados**. La secuencia, por marcas de tiempo del disco, es inapelable — `px_long/EA.json` se redujo a 6 barras a las **08:10**, el panel de señal se construyó a las **08:15**, y el backtest de 2011-2018 corrió a las **08:54**. `loadPanel` exige 300 barras, devolvió `null`, y `valorar` **se saltó las dos posiciones de `EA` enteras**: aparecen en el libro con `retorno: null` y no aportaron ni retorno ni flujo de caja. Dos de 64.
>
> Reparado `EA` (4.423 barras desde 2009) y **vuelto a ejecutar todo lo de esa ventana**, los cambios son pequeños pero reales, y están ya aplicados en §1, §3 y en las tablas de aquí:
>
> | | antes | ahora |
> |---|---:|---:|
> | v2 · retorno con caja | +166,4% | **+166,2%** |
> | v2 · drawdown máximo | −14,9% | **−15,5%** |
> | v2 · vs universo EW | −4,7 pp | **−6,1 pp** |
> | Calidad sola (§3) vs EW | +30,7 pp | **+30,2 pp** |
> | Score v1 (§3) vs EW | +36,9 pp | **+39,8 pp** |
> | pilar `health` solo vs EW | +21,9 pp | **+25,3 pp** |
>
> **Y un criterio preespecificado cambia de signo:** H1 pasa de ✔ (−15 pp, «en el límite») a **✖ (−15,5 pp)**. Estaba rozando el umbral por los dos lados; con el dato bueno cae del lado que falla. No cambia ninguna decisión —H2 ya fallaba y de ahí salió la v2— pero **un criterio que se declara antes no se redondea después**, así que se registra como fallado.
>
> ⚠️ **Este recuadro es un REGISTRO HISTÓRICO y sus cifras están superadas.** El 24-08-2026 se
> encontró un defecto mucho mayor —el TTM no eran doce meses y había magnitudes de 2009 en
> uso— y **todo el documento se recalculó otra vez**. Se conserva porque documenta cómo se
> detectó aquella corrección, no porque sus números sigan vigentes. Los vigentes están en §1
> y §6bis; el defecto nuevo, en `PLAN_SCORA_FORENSE.md` §8.1.
>
> **Alcance comprobado, para no exagerarlo tampoco:** la ventana 2019-2026 **no está afectada** (su artefacto se generó a las 08:54 con la caché `px` intacta; su única operación con `retorno: null` es un `PLTR` abierto y cerrado el mismo día en el borde de la ventana, que es correcto). Y los cuatro nombres recuperados —`EA`, `BK`, `MMC`, `BRK.B`— mueven el universo medio de 315 a 319 nombres y el universo EW de +156,6% a +156,8%.

> **La lección que va más allá de este fichero:** los artefactos de evidencia están versionados, pero sus **entradas** (la caché de precios) están en `.gitignore` y pueden cambiar o desvanecerse sin dejar rastro. Un artefacto reproducible cuyo insumo no lo es sólo parece reproducible.
- **La caja no renta.** Se modela al 0%. Con letras del Tesoro, las variantes con mucha liquidez (las de la v1) saldrían algo mejor de lo que aparecen aquí — lo cual **refuerza** el argumento en su contra, no lo debilita, porque aun así pierden.
- **Los filtros de §2 no se han probado.** El universo es el S&P 500 point-in-time, donde precio > $10, capitalización > $500M y volumen > $5M **se cumplen siempre**. Este backtest valida las reglas, no los filtros.
- **El universo real son ~370 nombres**, no 503: son los miembros del índice con fundamentales suficientes en EDGAR para calcular al menos 3 de las 5 métricas de calidad. *(Medido el 24-08-2026 en el cron de producción en seco: **369 de 503** con señal Y cotización vigente. Y **quiénes** son los ausentes no es aleatorio: ver §2ter, ni un solo banco puntúa.)*

## 7 · Qué se publica (esto es el producto)

Desde el **primer día**, en abierto:

- **Cada decisión con su fecha, su precio y la razón** — incluidas las fechas en que no se compró nada.
- **La cartera completa en todo momento**, no solo las ganadoras.
- **Todas las posiciones cerradas**, con su resultado, sin excepción.
- **La rentabilidad frente a tres referencias**: SPY, RSP (equiponderado) y el universo elegible equiponderado. La tercera es la que de verdad dice si seleccionar aportó algo — lo aprendimos por las malas en §7.10.
- **La versión de las reglas** aplicada a cada decisión (`rules_version`), para que un cambio futuro no contamine el histórico.

> Publicar solo las ganadoras es lo que hace que los track records del sector no valgan nada. Aquí se publican las 30 que salieron mal con la misma tipografía que las 30 que salieron bien.

---

## 8 · Cómo se mide, y qué invalidaría el experimento

Se declara **ahora**, antes de empezar:

| Criterio | Umbral |
|---|---|
| Referencia principal | **Universo elegible equiponderado** (misma liquidez, mismo sesgo, sin seleccionar) |
| Horizonte mínimo de juicio | **24 meses**. Antes de eso, cualquier lectura es ruido |
| Éxito | Rentabilidad ≥ la referencia **con menor drawdown máximo** |
| Fracaso reconocido | Por debajo de la referencia a 24 meses → **se publica y se cierra el producto** |
| Efecto mínimo detectable | Se declara en cada informe. "No significativo con MDE 0,04" y "no significativo con MDE 0,005" son frases opuestas |

> ### ⚠️ Qué habría pasado si este criterio se hubiera aplicado al backtest (2026-08-24)
>
> Conviene saberlo **antes** de empezar, no descubrirlo a los 24 meses. Aplicando el criterio de
> arriba —retorno ≥ universo elegible EW **y** drawdown menor— a las dos ventanas históricas:
>
> | | retorno | drawdown | veredicto de §8 |
> |---|---|---|---|
> | 2019-2026 | +292 % vs +174 % ✔ | −35,4 % vs −38,2 % ✔ | **se mantiene** |
> | 2011-2018 | +163 % vs +175 % ✖ | −17,7 % vs −20,2 % ✔ | **SE CIERRA EL PRODUCTO** |
>
> **El criterio habría disparado en una de las dos ventanas.** No es un motivo para relajarlo
> —relajar un criterio después de ver el resultado es exactamente lo que lo vacía de sentido—,
> pero sí para decir en voz alta que **la probabilidad de que este experimento termine en cierre
> es alta, y era alta antes de empezar**. Cualquiera que dedique tiempo o dinero a esto debería
> partir de ahí.
>
> Y con los datos corregidos del 24-08-2026 es más alta que con los anteriores: la ventana
> antigua pasó de −6 pp a −11 pp contra la referencia.

**Y lo que invalida el experimento:** cambiar cualquier regla de §2 a §6 después de haber empezado. Si hay que cambiarla, se cierra la serie, se abre `rules_version` nueva y **las dos no se mezclan jamás** — exactamente como `score_version` en `sl_cohort`.

---

## 9 · Preguntas para el abogado (no son opinables aquí)

1. Una cartera modelo **idéntica para todos**, sin personalización y con metodología publicada, ¿se sostiene dentro del encuadre educativo/impersonal de `FASE0_INVESTIGACION_LEGAL.md`, o cruza a recomendación de inversión?
2. ¿Cambia la respuesta si se cobra por acceder a ella?
3. ¿Qué exige MAR (Reg. 2016/958) en presentación objetiva y divulgación de conflictos para publicar esto en la UE?
4. ¿Hace falta geofencing (UK financial promotions, estados de EE. UU.)?
5. ¿Qué redacción concreta debe acompañar a cada pick?

**Ninguna decisión de §9 la toma el código.**

---

## 10 · Implementación

**Construida entera el 2026-08-21.** El código está listo y programado; lo único que falta para *lanzar* es §9, que no lo cierra el código.

| Pieza | Estado |
|---|---|
| Sellado inmutable mensual | ✅ `research/paperfund_rebalance.mjs` |
| Medición automática vs referencias | ✅ `research/cron-measure.mjs` |
| Versionado que no mezcla metodologías | ✅ patrón de `score_version` |
| Descalificadores | ✅ `lib/scoring.ts` |
| Motor de reglas compartido lab↔producción | ✅ `lib/picks.ts` · 77 tests en `scripts/picks.test.mjs` |
| Señal en un solo sitio | ✅ `research/picksSignal.mjs` — la paridad de 4.632 pares con cero diferencias consta en el mensaje del commit `f5a7b59`, **no en un artefacto en `research/out/`**, así que no se puede volver a comprobar sin rehacerla |
| Tablas `sl_picks_run` + `sl_picks_position` | ✅ con `rules_version`, lectura pública y `TRUNCATE` revocado — comprobado contra la base, no sólo en el `.sql` |
| Cron quincenal que aplica §3-§5 | ✅ **activo y ya ejecutándose**: el workflow corrió el 2026-08-21 a las 21:47 UTC por `schedule`, resolvió «hoy no es fecha de decisión (las de este mes: 2026-08-03, 2026-08-17)» y salió en 12 s |
| Página pública `/picks` | ✅ **en línea**: `scora-research.vercel.app/picks` responde 200 y está en el sitemap |
| Ruta de ESCRITURA | ✅ validada con transacciones revertidas: el `INSERT` con `universe_asof`, el índice único de posición abierta y el `check` de `close_reason` se comportan como deben |

**Primera decisión real: 2026-09-01** (martes, dentro del cron de lunes a viernes). Las fechas de agosto —03 y 17— ya habían pasado cuando el workflow se creó, y por eso `sl_picks_run` está legítimamente **vacía**. La cartera además se queda **vacía a propósito las primeras ~6 semanas**: la persistencia de §3 exige tres decisiones previas dentro de 60 días, así que la primera compra no puede ocurrir antes de mediados de octubre. Un hueco vacío en septiembre es el sistema funcionando, no un fallo.

### Lo que se endureció el 2026-08-21, validando el workflow antes de que entre en vivo

Cinco defectos en la ruta de producción, encontrados al comprobar que el cron hacía lo que dice. **Los cuatro primeros salieron a la primera; el quinto sólo apareció al re-verificar los otros cuatro**, y es el que más callado estaba:

| # | Defecto | Por qué importaba |
|---|---|---|
| 1 | `loadSP500Historical` hacía **un solo `fetch`** y devolvía `null` ante cualquier error | En una fecha de decisión, el cron caía a `CURATED` y abortaba por el guardián de cobertura — **perdiendo la fecha para siempre**, porque el workflow no reintenta fechas pasadas. Ahora: 4 reintentos, caché en disco y aborto que nombra la causa. **Sobre la frecuencia:** se observó fallar **una** vez, y una medición limpia al día siguiente dio **25 de 25 correctas** — no es un endpoint poco fiable. Lo que justifica el arreglo es el coste del fallo, no su probabilidad |
| 2 | Si la tabla no cargaba, el universo caía a **`CURATED`** (43 megacaps vivas elegidas a mano) | El sistema habría publicado como "el mejor del S&P 500" el mejor de una lista que no es el S&P 500. Lo tapaba el umbral de 50 nombres **por casualidad**: 43 < 50. Una protección que depende de la longitud de una constante de laboratorio no es una protección. `cron-picks.mjs` ya no importa `CURATED` |
| 3 | La foto de miembros llevaba **congelada desde 2025-08-23** y nada lo decía | Ver §2. Ahora se guarda en `universe_asof`, el cron avisa a partir de 45 días y `/picks` lo publica |
| 4 | **La caché de precios podía encogerse** | Un refresco de rutina borró años de historia de `EA` y `BK` con respuestas de 5-6 barras. Contado entero en §6bis |
| 5 | **`BRK.B` no resolvía a CIK** — el CSV del índice escribe la clase con punto, la SEC con guion | **Berkshire Hathaway estaba fuera del universo, en silencio absoluto.** Sin CIK no hay fundamentales, sin fundamentales no hay señal, y **sin señal no aparece en ningún aviso**: los avisos del defecto 3 sólo miran a los que llegan a puntuar. Con el override puesto, saca 4/5 métricas y sí puntúa. Ver §2bis |

> **Cómo apareció el quinto, porque el método importa más que el fallo.** Al re-verificar el recuento de nombres sin precio salió que dos de ellos *seguían en el índice*: `MMC` y `BRK.B`. `MMC` ya lo tenía identificado; `BRK.B` no lo había mirado. **Un guardián que sólo inspecciona a los que llegaron nunca ve a los que no llegaron** — a los ausentes hay que contarlos contra la lista de entrada, no contra la de salida. De los 503 miembros sólo hay dos tickers con sufijo de clase (`BF-B` y `BRK.B`) y sólo uno fallaba, así que el agujero está acotado y cerrado.

---

## 11 · El plan que recomiendo

**~~Fase 0 — medir la señal.~~ ✅ HECHA (2026-08-20).** La opción B (calidad + baja volatilidad) se cayó; la calidad sola bate al universo equiponderado en las dos ventanas (§3).

**~~Fase 0bis — medir las REGLAS.~~ ✅ HECHA (2026-08-21), y no estaba en el plan original.** Fue el paso que faltaba, y el que tumbó la v1: las reglas fallaron su propio criterio de aceptación en una de las dos ventanas (§6bis). De ahí sale la v2.

**~~Fase 0ter — validar el workflow antes de que decida en público.~~ ✅ HECHA (2026-08-21/22), y tampoco estaba en el plan.** Cinco defectos en la ruta de producción y dos correcciones a lo que este documento afirmaba (§10, §2bis, §2ter, §6bis). Ninguno habría fallado ruidosamente: los cinco habrían producido un track record plausible y equivocado.

> **Y una lección sobre la propia validación:** el quinto defecto (`BRK.B`) no salió en la primera pasada — salió al **re-verificar** los otros cuatro, junto con dos afirmaciones mías que eran falsas (una tasa de fallo inventada a partir de n=3, y "la SEC mantiene el ticker antiguo", que no lo hace). Revisar los hallazgos encontró tanto como buscarlos.

**~~Fase 0quater — la señal medía mal.~~ ✅ HECHA (2026-08-23/24), y tampoco estaba en el plan.** Salió tirando del hilo de una falsa alarma mientras se construía otra cosa. **Tres de las cinco métricas de §3 se calculaban con magnitudes de ejercicios distintos**: `flowTTM` sumaba cuatro trimestres sin comprobar que fueran consecutivos y aceptaba cifras congeladas en el año en que la empresa dejó de etiquetarlas. Amazon puntuaba con un margen bruto del **0,6 %** (real ~52 %), Oracle restaba un coste de 2011 de unos ingresos de 2026, y el «flujo de explotación a doce meses» de Apple sumaba el primer trimestre de cuatro años distintos. **Todas las cifras de este documento están recalculadas** con la señal arreglada; el detalle está en `PLAN_SCORA_FORENSE.md` §8.

> **Lo que esto cambia de fondo, y conviene no maquillarlo:** el backtest mejora en la ventana reciente (+293% frente a +249%) y **empeora** en la antigua contra el universo equiponderado (de −6 pp a −11 pp). Que no sea uniformemente favorable es lo que hace creíble el arreglo — pero también significa que **la ventana antigua sigue sin demostrar que seleccionar aporte nada**, y ahora con un margen mayor en contra.

**~~Fase 0quinquies — la contabilidad forense como veto.~~ ✅ MEDIDA Y DESCARTADA (2026-08-24).** Se preespecificaron tres hipótesis y **ninguna la sostiene**. **HF1** no encuentra efecto: el spread entre quintiles de devengos es de **−0,23 pp y −0,15 pp** a doce meses, contra unos efectos mínimos detectables de 8,1 y 6,2 pp — o sea, cero, y el poco que hay apunta al revés de lo predicho. **HF3**, el falsador, apunta en la dirección temida en las dos ventanas: el veto marca a los ganadores **1,29× y 1,76×** más que al resto, con NVDA señalada por devengos en 2017 y en 2022, justo antes de sus dos mejores años. Pasa el listón sólo por falta de potencia. **`PicksInput.disqualified` sigue vacío en producción**, que es lo que §5.2 dice desde el principio. Los modelos quedan como capa explicativa. Artefacto: `research/out/forense_veredicto.json`.

**Fase 1 — sellar las reglas.** Queda **una** decisión abierta: el encuadre legal (§9). Cerrada esa, este documento se commitea como `rules_version = 2` y **no se toca más**.

> **Las dos mediciones que faltaban están hechas (2026-09-01).** Y la segunda cambió lo que este documento puede afirmar — ver «La ventaja de 2011-2018 se ha ido», en §6bis.
>
> 1. ~~**El sesgo sectorial (§2ter).**~~ ✅ **MEDIDO el 2026-09-01.** Estuvo marcado como hecho desde el 24-08-2026 con el resultado «sale CERO», y ese día se descubrió que la referencia sin financieros era, bit a bit, la referencia CON financieros: `universoEW(eje, excluir)` ignoraba `excluir`. Arreglado y vuelto a medir sobre el universo corregido:
>
>    | | universo elegible EW | …sin financieros | diferencia |
>    |---|---:|---:|---:|
>    | 2019-2026 | +172,3 % | +172,6 % | **+0,3 pp** |
>    | 2011-2018 | +153,6 % | +150,6 % | **−3,0 pp** |
>
>    **Lo que dicen los números.** En 2019-2026 quitar los 55 financieros no mueve la referencia (+0,3 pp): el universo elegible apenas los tiene, porque la señal no los puntúa. En 2011-2018 sí la mueve, y **hacia abajo** (−3,0 pp con 51 excluidos): allí los financieros rendían MEJOR que el resto del universo elegible, así que no tenerlos restaba. El margen de esa ventana pasa de +7,7 pp a **+10,7 pp** contra la referencia comparable.
>
>    **Y el matiz que hay que conservar:** contra el **SPY** el sesgo sectorial existe y esta medición no lo toca —el índice tiene financieros y Scora Picks no puede comprarlos—, así que parte de la comparación contra el SPY sigue siendo eso. Pero contra el **universo elegible equiponderado**, que es la referencia que responde a *«¿aporta algo seleccionar?»*, el sesgo es despreciable en la ventana reciente y va en contra en la antigua. El efecto de selección queda **sin confundir**, para bien y para mal.
>
>    *Sobre las métricas de banca (`research/bancaMetrics.mjs`), corregido el 2026-09-01:* aquí se decía «al **100 %** para los 20 bancos comerciales del índice». Vuelto a medir sobre el universo sin sesgo de supervivencia son **21 de 25 (84 %)**, y **27 de 37 (73 %)** en seguros; por subsector, mercados de capitales 25 % y holdings 0 %. Aquel 100 % salía del universo truncado. Lo que **no** sostienen los datos sigue igual: calidad crediticia (40 %) y solvencia regulatoria (30 %). Meter bancos en el universo elegible sería una estrategia distinta, no un arreglo, así que exigiría abrir `rules_version` nueva — medido y razonado en `PLAN_BANCOS_MEDICION.md`.
> 2. ~~**El sesgo de supervivencia (§6bis).**~~ ✅ **CERRADO el 2026-09-01, y salió caro.** El mapa ticker→CIK point-in-time está completo en lo resoluble: **168 CIK publicados, cero pendientes de revisión manual**. Se cerró en dos pasos — la regla automática del nivel C (`research/nivel_c.mjs`: el emisor nombra su propio documento con el ticker de prefijo, y el documento cae dentro del periodo; 26/26 pasan y ninguno de los 16 de nivel B se cuela) y la revisión a mano de `AKS` y `DO` contra el historial de EDGAR. **Y al resolver esos 24 CIK, la ventaja de 2011-2018 pasó de +7,7 pp a +1,3 pp — indistinguible de cero.** Era previsible: los CIK nuevos son de empresas que murieron, y meterlas en el universo elegible es exactamente lo que hace corregir sesgo de supervivencia. Quedan 69 tickers sin candidato, que probablemente no tengan solución desde EDGAR.
>
>    *Probadas y descartadas TRES vías automáticas el 2026-08-24.* Las tres devuelven CIK **plausibles y equivocados**, que es peor que no devolver nada:
>
>    | vía | resultado |
>    |---|---|
>    | `browse-edgar?company=TICKER` | Busca por **nombre**, no por ticker. De nueve, resolvió dos y **las dos mal**: `ABC` → **Joshua Gold Resources** (una minera cuyo nombre anterior era «ABC Acquisition Corp 1501»); `CBS` → una filial en vez de la matriz. |
>    | Instantáneas del Internet Archive | **No existen.** `company_tickers.json` no está archivado en ninguna fecha. |
>    | Búsqueda de texto completo (`efts.sec.gov`) | La mejor de las tres: 6 de 8 correctas. Pero falla en los tickers cortos, que se cuelan como subcadena en presentaciones ajenas — y al refinar con votación empeoró: `ABC` pasó a devolver **Walt Disney**, que es dueña de la cadena ABC. |
>
>    **La lección, que vale más que la medición:** un CIK equivocado no falla — ingiere los estados financieros de otra empresa. Ninguna de las tres es aceptable. Queda la vía lenta, y son **174 tickers, no ~57** (contados el 24-08-2026: 79 afectan a la ventana reciente y 152 a la antigua). Cada CIK verificado contra `data.sec.gov/submissions` exigiendo que la empresa presentara informes DENTRO del periodo en que el ticker estuvo en el índice — que es la prueba que Joshua Gold y Walt Disney no habrían pasado.
>
> Hasta que **la segunda** esté hecha, el "+55 pp vs SPY" de §1 sigue siendo lo que dice §0 —una razón para probarlo, no una prueba— y ahora además con dos vías concretas por las que podría moverse en cualquiera de los dos sentidos.

**Fase 2 — seis meses en abierto y gratis.** El sistema corre a la vista, publicando cada decisión. Sin cobrar, sin prometer nada.

> **En la v2 esta fase deja de ser una cortesía y pasa a ser la validación.** La v2 se diseñó mirando los datos (§0), así que su backtest **no es evidencia fuera de muestra**. Los seis meses en vivo son la primera medición limpia que va a existir de este sistema. Cobrar antes sería vender un backtest.

**Fase 3 — decidir con datos.** A los seis meses hay un track record real y corto. Si funciona, hay producto. Si no, se publica el resultado y se cierra — habiendo perdido seis meses en lugar de la credibilidad.

> Es más lento que lanzarlo ya. También es lo único que permite mirar a un inversor a la cara cuando pregunte de dónde salen los números.

---

## 12 · Decisiones (resumen)

| # | Decisión | Estado |
|---|---|---|
| 1 | ~~¿ETFs y REITs dentro?~~ | ✅ **DECIDIDO: no.** Y resulta que la señal ya los excluye sola: en 90 operaciones simuladas no apareció **ni un solo REIT**. Su apalancamiento estructural los hunde en `netDebtEbitda` y `interestCoverage`. Meterlos obligaría a duplicar el criterio para nombres que el sistema no compraría igualmente |
| 2 | ~~Señal de entrada (A/B/C)~~ | ✅ **DECIDIDO: calidad sola.** B (calidad + baja volatilidad) se cayó al medirla (§3) |
| 3 | ~~Umbral de entrada y de salida~~ | ✅ **DECIDIDO: entrada p70, salida p50.** Y con el hallazgo de que el umbral de entrada no es una palanca de rentabilidad sino de despliegue de capital (§3) |
| 4 | ~~Tope de posiciones~~ | ✅ **DECIDIDO: 40**, elegido fuera del óptimo de ambas ventanas (§6) |
| 5 | ~~¿Se cobra desde el principio?~~ | ✅ **DECIDIDO: no.** Seis meses en abierto y gratis (§11). Con la v2 dentro de muestra (§0), cobrar antes de tener track record en vivo sería vender un backtest |
| 6 | Encuadre legal | ⏳ **ABIERTA — abogado (§9).** Es la única que queda, y no la cierra el código |

**Quedan cerradas cinco de seis.** La sexta bloquea el lanzamiento, no el trabajo.
