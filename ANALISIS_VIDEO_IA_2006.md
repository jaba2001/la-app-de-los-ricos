# Análisis · «El año que importó fue 2006» (Jay Martin) — qué de esto es medible

**Fecha:** 2026-09-03 · **Fuente:** transcripción aportada por Alejandro
**Estado:** afirmaciones comprobadas una a una contra FRED y XBRL. Pendiente de fundir con los
otros dos vídeos en un plan conjunto.

---

## 1 · La tesis, y por qué esta vez SÍ es falsable

> **«Los préstamos no fallaron cuando los precios cayeron. Fallaron cuando los precios dejaron
> de subir lo bastante rápido.»**

Eso no es una predicción: es una afirmación sobre la **segunda derivada**, con fechas. Se puede
comprobar, y se ha comprobado.

## 2 · La mecánica de 2006 — MEDIDA, y se sostiene

| | |
|---|---|
| pico del **crecimiento** (Case-Shiller YoY) | **2005-09** · 14,5 % |
| pico del **nivel** (índice) | **2006-07** · 184,6 |
| **adelanto** | **10 meses** |

En junio de 2006 el precio estaba en 184,5 —a un pelo de su máximo histórico— y el crecimiento
interanual ya había caído del 14,3 % al 7,3 %: **la mitad**. La morosidad empezaba a subir
(1,55 → 1,62 %) con los precios en récord. La secuencia que describe el vídeo es correcta.

⚠️ **Un matiz que el vídeo exagera.** Dice «morosidad en cifras récord» en 2006. `DRSFRMACBS`
da 1,62 % frente a un mínimo de 1,41 %: sube, pero sigue en mínimos históricos. Y esa serie
cubre **toda** la hipoteca residencial, no el *subprime* del que habla. No se puede confirmar
su cifra midiendo otra población — el mismo error que casi cometo con el JGB a 30 años.

## 3 · Los 2,1 billones de backlog — auditables, con una excepción

Del XBRL (`RevenueRemainingPerformanceObligation`), no de titulares:

| | backlog | interanual | vídeo |
|---|---:|---:|---|
| **Oracle** | **638 B$** | **+363 %** | 638 B$, +363 % — **exacto, las dos** |
| **Microsoft** | 684 B$ | +82 % | dice 625 B$ — se queda corto |
| **Alphabet** | 520 B$ | +380 % | **ni la menciona** |
| Amazon | — | — | — |

⚠️ **AMAZON DEJÓ DE ETIQUETAR EL RPO EN XBRL EN 2020.** Sólo hay 10 hechos, de 2018 a
2020-06-30, con 41 B$. El tag responde y el dato tiene seis años. **La cifra de 2,1 billones no
se puede montar sólo con XBRL**: tres de las cuatro sí (1.842 B$), la de Amazon habría que
sacarla del texto del 10-K. Es la tercera forma de serie muerta otra vez.

## 4 · El capex — el vídeo acierta, y yo me equivoqué primero

| año | capex | flujo operativo | capex/OCF | vídeo |
|---|---:|---:|---:|---|
| 2022 | 155 B$ | 287 B$ | 0,54 | — |
| 2023 | 149 B$ | 363 B$ | 0,41 | 150 B$ |
| 2024 | 224 B$ | 470 B$ | 0,48 | 226 B$ |
| 2025 | **379 B$** | 577 B$ | **0,66** | 410 B$ |

Cinco empresas (MSFT, GOOGL, AMZN, META, ORCL). Las cifras del vídeo son **esencialmente
exactas**.

⚠️ **PERO SU AFIRMACIÓN MÁS DRAMÁTICA NO SE VE EN LOS ESTADOS.** Dice que «la factura de
construcción ya es mayor que toda la caja que estas empresas ingresan» y que «cada dólar
adicional se financia con deuda». El ratio va en **0,66**, no por encima de 1. La afirmación es
sobre el **plan de 2026** (725 B$), no sobre un hecho observable: con el OCF creciendo ~20 %
anual llegaría a ~690 B$, y ahí sí cruzaría. **Es plausible y todavía no ha pasado.**

⚠️ **Y AQUÍ CACÉ UN BUG MÍO, gracias a que sus cifras salían más altas que las mías.** Mi
primera medición daba 96 / 141 / 247 B$ y estuve a punto de escribir «el vídeo exagera». La
causa: Amazon publica **dos** tags de capex y mi lógica «el primero que tenga datos gana»
eligió `PaymentsToAcquirePropertyPlantAndEquipment`, que **muere en 2016**. El bueno es
`PaymentsToAcquireProductiveAssets` (132 B$ en 2025). Un tag que contesta y está muerto. Ahora
se elige **por recencia del hecho, no por orden de la lista**.

## 5 · Lo que NO se puede comprobar con datos gratis

| afirmación | por qué no |
|---|---|
| Ronda de 122 B$ a 852 B$ de valoración; la escalera 86→157→300→500→852 | mercado privado, sin fuente auditable |
| «4 de cada 5 préstamos de 2003 refinanciados a finales de 2006» | requiere datos de originación no públicos |
| OpenRouter: modelos de EE. UU. del 70 % al 30 % del tráfico | métrica de una plataforma privada |
| Kimi K3 gana en ciegas con un 40 % menos de coste | *leaderboard* no auditable; y el vídeo dice «hace dos semanas, el 16 de julio», que a fecha de hoy son **siete** |

La **aritmética** de la escalera sí se puede comprobar aunque las cifras no: 157/86 = 1,83 ·
300/157 = 1,91 · 500/300 = 1,67 · 852/500 = 1,70. Y el salto a 1 billón sería 1,17× — el más
pequeño de la serie. Su argumento es internamente consistente.

## 6 · Lo ya verificado en la sesión anterior

La parte del Tesoro **ya está medida** en `research/soberano.mjs`: intereses 1,25 B$ frente a
defensa 1,20 B$ (**ratio 1,04x** — cierto), deuda/PIB 123 %, y el dólar perdiendo el 87,8 %
desde 1971. No hay que rehacerla.

## 7 · Dónde toca esto a Scora

El vídeo termina con **una regla operativa**, y es la parte interesante:

> *«No mires los máximos, mira la velocidad.»*

Eso es una señal, y por tanto **exige su tasa base** antes de construir nada — igual que el
aviso de ensanchamiento del crédito, que se encendió 397 días antes de Lehman y aun así
resultó indistinguible del azar (p = 0,146). Preguntas medibles:

1. ¿La **desaceleración** de un agregado (precios, backlog, capex) predice caídas mejor que su
   **nivel**? Es exactamente el test que aquí se puede hacer bien, con la vivienda de 1987-2026
   como muestra fuera del caso que inspiró la idea.
2. **Concentración del índice**: dice que 10 empresas son el 40 % del S&P 500. Es medible y
   toca directamente al objetivo de batir al índice y al gate de correlación en producción.
3. **Crecimiento del backlog (RPO) como métrica de calidad**, ya que tres de las cuatro son
   auditables y trimestrales. Encaja con la capa de caja: un backlog que crece mientras el FCF
   no lo hace es exactamente la divergencia que el módulo ya sabe marcar.

**Lo que no se construye:** el calendario de la ruptura. El propio vídeo lo dice mejor que
nadie —*«el mecanismo se puede conocer, el calendario no»*— y ésa es la única frase suya que
no hace falta comprobar.
