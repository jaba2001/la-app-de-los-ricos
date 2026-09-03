# Plan conjunto · los cuatro vídeos — qué pasa el listón y qué no

**Fecha:** 2026-09-03 · **Fuente:** transcripciones completas aportadas por Alejandro
**Estado:** afirmaciones comprobadas contra FRED, XBRL y precios ANTES de proponer nada

> Los cuatro vídeos son de naturalezas muy distintas: una tesis única falsable, un repaso
> semanal de resultados, un análisis de restricción física, y un discurso macro. Este
> documento no los resume: separa lo medible de lo que no, dice qué salió al medirlo, y
> propone en qué orden construir.

---

## 0 · Lo primero: los cuatro dicen algo cierto y algo que no se sostiene

| vídeo | lo que aguanta la medición | lo que no |
|---|---|---|
| **1 · «El año que importó fue 2006»** | La mecánica de la desaceleración, **exacta**. Backlog de Oracle **638 B$ y +363 %, las dos cifras**. Capex 149/224/379 B$ frente a sus 150/226/410 | «Morosidad récord en 2006» (medida sobre otra población). «El capex ya supera a toda la caja»: va en **0,66**, es una previsión |
| **2 · Repaso semanal** | Casi todo: resultados de Uber, DoorDash, Airbnb y Berkshire son 10-Q auditables. Datos de empleo, en FRED | *Swing* por momentum y roturas de base: **auditado en este repo, −136 pp frente al SPY** |
| **3 · Energía y los dos relojes** | La aritmética del capex. El mecanismo de la depreciación, **y se puede derivar sin que lo declaren** | La vida útil **no está etiquetada** en XBRL salvo Oracle. Y la métrica ingenua acusa a todo el mundo (ver §2) |
| **4 · Oro y tipos reales** | Tipos reales → oro: **ρ = −0,34, y +2,46 %/mes frente a −0,72 %/mes**. Real y fuerte | «Caída media del 15 % del S&P»: medida, **−12,1 % de media y −7,6 % de mediana**. Manipulación del oro, élites, gamma de SpaceX: no falsable |

---

## 1 · La medición que más vale: la vida útil implícita

El vídeo 3 trae la afirmación de Burry —alargar la vida útil de los servidores infla el
beneficio sin tocar la caja— y resulta que **conecta con la capa de caja que ya está
construida**: si el beneficio sube y el flujo operativo no, la *conversión a caja* cae. Ya
tenemos el detector.

⚠️ **PERO LA VIDA ÚTIL NO ESTÁ EN XBRL.** Sólo Oracle etiqueta
`PropertyPlantAndEquipmentUsefulLife`. Meta y Alphabet no la etiquetan; Amazon y Microsoft
sólo la de intangibles. Está en el texto de la nota contable. **Tercera premisa de un plan
tumbada por los datos en dos sesiones.**

La salida es no pedírsela: **derivarla**. `inmovilizado bruto ÷ depreciación` = vida implícita.

⚠️ **Y AQUÍ ESTÁ LO QUE HAY QUE DECIR, porque la versión ingenua acusa a todo el mundo.** Esa
razón se infla sola cuando el activo crece: los activos nuevos aún no han depreciado. Con base
media el resultado cambia de sentido:

| | ingenua (bruto fin) | **corregida (bruto medio)** | crecim. activo |
|---|---:|---:|---:|
| ORCL 2024 | 11,1 años | 10,1 años | +21 % |
| **ORCL 2025** | **15,4 años** | **12,2 años** | **+71 %** |
| MSFT 2023 | 14,9 | 13,5 | +22 % |
| MSFT 2025 | 13,6 | **11,6** | +41 % |

**La mitad de la aparente extensión de Oracle era artefacto de crecimiento.** Sigue subiendo de
verdad (10,1 → 12,2), lo cual es coherente con que Burry señale a Oracle. Pero **Microsoft
BAJA** con la corrección — lo contrario de «todos están alargando». En pleno auge de capex, la
métrica sin corregir señalaría a las cinco.

---

## 2 · Lo que se puede construir, en orden

### 🟢 Fase A · Calidad del beneficio: la vida útil implícita *(riesgo cero, extiende lo ya hecho)*
Una función pura más en `lib/flujoCaja.ts`, con la corrección por crecimiento **dentro** y el
sesgo documentado. Encaja con las banderas que ya existen y no toca ninguna decisión.

**Criterio:** cobertura ≥ 60 % del S&P 500 y que el listón de cordura se cumpla — si marca a
más de un tercio del índice, el umbral describe el mercado y no señala nada.

### 🟢 Fase B · El precio de recompra como valor razonable revelado *(nuevo, nadie lo enseña)*
Del vídeo 2: Berkshire recompró a 487 $ con la acción a 521. No es la opinión de un analista,
es la directiva **poniendo su dinero** en una banda concreta. Se deriva de
`PaymentsForRepurchaseOfCommonStock ÷ TreasuryStockSharesAcquired`.

**Cobertura MEDIDA, y la cifra buena no fue la primera.** Sobre 45 nombres del S&P 500, el
**69 %** tiene los dos tags. Pero al construirlo resultó que lo publicable de verdad —con el
importe del MISMO ejercicio, un hecho no rancio y una serie de precios con la que comprobarlo—
es el **55 %**. (Y con 4 nombres salía 25 %: n=4 no es una medición de cobertura.)

⚠️ Corregido en la auditoría del 03-09-2026: este documento publicaba el 69 % como si fuera la
cifra utilizable. Lo era de «tiene los dos tags», no de «se puede publicar».

**Criterio:** publicable como capa explicativa desde el principio. Como SEÑAL exige tasa base
—¿compran barato de verdad?— y ahí el listón es el de siempre.

### 🟡 Fase C · Aceleración frente a nivel *(el test que los vídeos 1 y 3 comparten)*
La tesis del vídeo 1 ya está confirmada en su caso original: el crecimiento del Case-Shiller
hizo pico en **2005-09**, el nivel en **2006-07** — **10 meses de adelanto**. La pregunta
construible es si eso **generaliza**.

> **H6.** La desaceleración de un agregado predice caídas mejor que su nivel.
> **Criterio:** preespecificado, al nivel de EPISODIO independiente y no de mes solapado — el
> error que ya cazamos con el aviso de crédito, donde 393 meses eran 22 episodios y la señal
> pasó de «397 días antes de Lehman» a **p = 0,146**.

⚠️ Cuesta el ensayo 345. No se gasta sin la comprobación previa.

### 🟡 Fase D · Los tipos reales, como capa explicativa
**MEDIDO, 260 meses desde 2004:**

| | ρ(Δ tipo real, retorno) | meses con real BAJANDO | meses con real SUBIENDO |
|---|---:|---:|---:|
| **Oro (GLD)** | **−0,336** | **+2,46 %/mes** | −0,72 %/mes |
| S&P 500 (SPY) | −0,123 | +1,09 %/mes | +0,63 %/mes |

La relación es **fuerte en el oro y floja en las acciones** — una distinción que ninguno de los
dos vídeos hace.

⚠️ **Y ES CONTEMPORÁNEA, NO PREDICTIVA.** Compara el cambio del tipo real de un mes con el
retorno **de ese mismo mes**. No se puede operar salvo que se conozca el movimiento del tipo por
adelantado. Se publica como **explicación de lo que pasó**, nunca como pronóstico. `DFII10` ya
está cableado desde la fase 2, así que el coste es casi cero.

### ⚪ Fase E · Concentración del índice
El vídeo 1 dice que 10 empresas son el 40 % del S&P 500. Es medible y toca de lleno el objetivo
de batir al índice y el gate de correlación que ya está en producción. Barato.

---

## 3 · Lo que NO se construye, y por qué

| | motivo |
|---|---|
| **Taza con asa, roturas de base, media de 200** (vídeo 2) | En lo que tienen de medible son momentum, **ya auditado: −136 pp frente al SPY en 192 meses** |
| **Posicionamiento de opciones / gamma de SpaceX** (vídeo 4) | OPRA es cara y la premisa no se sostiene. Decisión ya tomada |
| **Manipulación del oro, élites dominantes** (vídeo 4) | No falsable |
| **El calendario de la ruptura** (vídeos 1 y 3) | Lo dice mejor el propio vídeo 1: *«el mecanismo se puede conocer, el calendario no»* |
| **Subasta de capacidad de PJM** (vídeo 3) | Los datos existen pero no hay API; el coste de mantenerlo no compensa para una capa explicativa |

---

## 4 · Los dos bugs míos que cazó este análisis

**1. Un tag muerto que contestaba.** Mi primera medición del capex daba 96/141/247 B$ y estuve a
punto de escribir «el vídeo exagera». Amazon publica **dos** tags de capex y mi lógica «el
primero que tenga datos gana» eligió `PaymentsToAcquirePropertyPlantAndEquipment`, que **muere
en 2016**. Con `ProductiveAssets` las cifras pasan a 149/224/379 — **las del vídeo son
esencialmente exactas**. Ahora se elige por **recencia del hecho, no por orden de la lista**.

**2. Una cobertura medida sobre cuatro nombres.** El precio de recompra parecía inviable (1 de
4). Sobre 45 del S&P 500 es el **69 %**. Cuatro nombres no son una medición.

Y un tercero que no llegó a serlo: **el RPO de Amazon responde con un dato de 2020**. Sólo 10
hechos, ninguno posterior a 2020-06-30. Los 2,1 billones del vídeo 1 **no se pueden montar sólo
con XBRL**: tres de las cuatro sí (1.842 B$), la de Amazon habría que sacarla del texto.

---

## 5 · Recomendación

**Empezar por A y B.** Las dos son medición pura sobre datos ya verificados, extienden la capa
de caja que acaba de entrar, y ninguna toca el motor. La B además es algo que **ningún
competidor minorista enseña**, que es donde este producto ha encontrado su hueco antes.

**La D es casi gratis** y da a la página de metales una explicación real en vez de un gráfico.

**La C es la única que puede mover el motor**, y con 344 ensayos gastados no se abre sin
comprobación previa. El precedente está reciente: media hora de comprobación ahorró el 345
entero.

---

# EJECUTADO Y AUDITADO · 2026-09-03

Las cuatro fases están construidas, medidas y en remoto. Esta sección la escribe la auditoría
posterior, no el plan: recoge **lo que el propio plan afirmaba y la ejecución corrigió**, que es
la parte que sirve para el siguiente.

## Lo construido

| fase | qué | dónde | asserts |
|---|---|---|---|
| A | Vida útil implícita, con corrección por crecimiento | `lib/vidaUtil.ts` | 38 → 44 |
| B | Precio de recompra como valor razonable revelado | `lib/recompras.ts` | 46 |
| C | Comprobación previa de la aceleración | `research/precheck_aceleracion.mjs` | — |
| D | Tipo real → activos, con la columna predictiva | `research/tipos_reales.mjs` | 12 |

## ⚠️ Ocho correcciones, y ninguna se veía sin ejecutar

**1. El tag muerto que contestaba.** Amazon publica dos tags de capex y el histórico murió en
2016. Con «el primero que tenga datos gana» su capex salía 5 B$ en vez de 132, y estuve a punto
de escribir que el vídeo exageraba. Se elige por **recencia del hecho**.

**2. La cobertura sobre cuatro nombres.** El precio de recompra parecía inviable (1 de 4). Sobre
45 es el 69 % con los dos tags — y **55 % publicable de verdad**. Las dos cifras estaban mal
usadas en este documento hasta la auditoría.

**3. La amortización de intangibles hunde la vida útil.** Amgen 2025: D&A total 5,17 B$, de los
que 4,30 son amortización de adquisiciones. Daba **2,92 años** para una farmacéutica con
plantas; con `Depreciation` a secas, **23,57**. Tres vías en orden de limpieza.

**4. El crecimiento del activo la infla sola.** Oracle 2025: 15,4 años ingenua contra 12,2
corregida. **Microsoft baja** con la corrección — la corrección no atenúa, puede invertir.

**5. Un hecho de recompra viejo no es un valor revelado.** 11 de 33 publicaban datos anteriores
a 2024, dos de 2013. Axon comparaba una recompra de 2016 con el precio de hoy: **+2.922 %**.

**6. Dos medidas independientes compartiendo ancla.** La recompra colgaba del ejercicio de la
depreciación: la cobertura caía del 58 % al 28 % y nada fallaba.

**7. El precio «actual» era el del final del periodo de recompra**, no el de hoy. Para AbbVie,
cuyo último hecho es de 2017, el retorno se medía hasta entonces.

**8. Y una que encontró la auditoría, no la construcción:** tres de las cifras publicadas en
estos documentos —el adelanto del Case-Shiller, el backlog de Oracle y la serie de capex—
salieron de invocaciones sueltas de `node -e` y **no dejaron script detrás**. Estaban bien
medidas y eran **irreproducibles**. En un repo cuyo criterio es «una cifra que no se reproduce
no es evidencia», eso es un defecto aunque los números estén bien. Lo cierra
`research/verificacion_videos.mjs`.

## Lo que la auditoría encontró fuera de estas fases

**Un bootstrap sin sembrar en código preexistente.** `research/portfolio_backtest.mjs` calculaba
el **intervalo de confianza al 95 % del Sharpe** con 2.000 iteraciones y `Math.random()` sin
semilla, y ese intervalo **se publica** en `portfolio_backtest.json`, que está versionado. Un
intervalo estadístico que cambiaba en cada corrida y ensuciaba el repo. Mismo defecto y mismo
arreglo que en `aviso_credito_base.mjs`.

**Tres referencias a un p-valor obsoleto.** `lib/tipos.ts`, `research/tipos.mjs` y
`PLAN_TRES_CAPAS.md` seguían citando **p = 0,149** cuando el valor reproducible con semilla fija
es **0,146**. La constante estaba bien; la prosa alrededor, no.

## Veredicto de C, y su matiz

    PUERTA 1  aceleración del precio vs momentum 12m     ρ 0,681   abierta
    PUERTA 2  aceleración de liquidez vs impulso a 6m    ρ 0,705   CERRADA

**El ensayo 345 no se gasta.** Pero el margen es de **cinco milésimas**, y presentar eso como un
veredicto limpio sería el mismo sobreajuste a un umbral que este repo evita. Lo que decide no es
de qué lado cae cada puerta sino que **las dos están cerca**: la aceleración comparte el 46 % de
su varianza con el momentum —auditado, −136 pp— y el 50 % con el impulso de liquidez del
régimen. La conclusión aguanta entre 0,60 y 0,75; con 0,80 no.

## Lo que sigue sin construirse, a propósito

Análisis técnico (taza con asa, roturas de base, media de 200), posicionamiento de opciones,
manipulación del oro y el calendario de la ruptura. **El único bloqueante de lanzamiento sigue
siendo el abogado.**
