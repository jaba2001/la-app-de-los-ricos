# Mega plan · Las tres capas — de la macro a la caja de una empresa

**Fecha:** 2026-09-03 · **Fuente:** transcripciones completas de los tres vídeos aportadas por
Alejandro · **Estado:** analizado, con la disponibilidad de datos VERIFICADA serie a serie

> Petición: *«quisiera que Scora pueda dar estos análisis en todas sus capas»*.
> Los tres vídeos cubren exactamente tres capas encadenadas: **divisa/soberano → tipos y crédito →
> caja de la empresa**. Este documento separa lo construible de lo que no, y propone un orden.

---

## 0 · Lo primero: separar la mecánica de la narrativa

Los dos vídeos de Felix Breen (*Bonds* y *Japan*) son **la misma pieza en dos entregas**, y las dos
terminan en el mismo seminario de pago (`survivethebubble.com`). Eso no los invalida —la mecánica
que explican es correcta y está bien contada— pero obliga a separar tres cosas:

| | qué es | qué hacemos |
|---|---|---|
| ✅ **Mecánica** | El precio y el cupón se mueven al revés · el tipo sin riesgo es el suelo que todo lo demás tiene que batir · el diferencial de crédito se abre antes de las crisis | **Se construye.** Es correcta y comprobable |
| ✅ **Hechos verificables** | Deuda de EE. UU., intereses > gasto militar, poder adquisitivo del dólar, deuda/PIB de Japón | **Se construye.** Todo está en FRED |
| ❌ **Narrativa** | «La factura está por llegar» · «Japón va diez años por delante» · «el oro no está listo» · el momento de la burbuja de la IA | **NO se construye.** Son afirmaciones sin falsar y con calendario implícito |
| ❌ **Venta** | El seminario, la app, los enlaces de afiliado | — |

⚠️ **Y esto no es una objeción de estilo, es de posicionamiento.** El esquema ERRC de Scora
**elimina** las promesas de mercado y **crea** la honestidad radical. Un producto que dice «la
diferencia de Sharpe no alcanza significación, t = 1,47» no puede a la vez decir «la factura está
por llegar». Nos quedamos con los indicadores; el miedo se lo dejamos a ellos.

---

## 1 · Qué enseña cada vídeo, quirúrgicamente

### Vídeo 2 · *If You Don't Understand Bonds, You Don't Understand Money*

1. **Un bono es un préstamo.** Precio y rendimiento se mueven en direcciones opuestas — el «balancín».
2. **El mercado de bonos (~160 B$) es mayor que el de acciones.** Ahí vive el dinero serio.
3. **El tipo sin riesgo es el suelo de todo.** Si un bono seguro paga el 5 %, cualquier activo con
   riesgo tiene que batirlo. Cuando sube, **todo lo demás se reprecia a la baja**.
   → *«¿Nunca has visto tu cartera caer un día sin ninguna noticia mala? Eso son los bonos.»*
4. **El diferencial (*spread*)** = lo extra que paga un emisor dudoso sobre el Tesoro. **Se abre
   antes de las crisis.** *«El mercado de bonos huele el problema mucho antes que el de acciones.»*
5. Espiral de deuda: se pide prestado para pagar intereses. Tres salidas — crecer (imposible),
   impagar (impensable), **inflar** (la que siempre se elige).
6. El dólar ha perdido el **87 % de su poder adquisitivo desde 1971**.

### Vídeo 1 · *The UNTHINKABLE… Japan & the Dollar*

7. El bono japonés a 30 años en máximos históricos; el *widowmaker* despertó.
8. Rendimientos globales en máximos desde 2000-2008. El 30 años de EE. UU. tocó el 5,3 %.
9. **El oro «no está listo»**, por dos razones: hay muchas más reclamaciones en papel que metal en
   cámaras, y **mucha gente que cree tener oro tiene papel** — fondos que replican el precio con
   futuros o permutas, sin metal reclamable.

### Vídeo 3 · *Tardé años en entender el flujo de caja*
Ya analizado en detalle en `ANALISIS_VIDEO_FLUJO_CAJA.md`. Resumen: **«lo que no es caja, no vale»**,
el puente del método indirecto, y siete reglas comprobables (*cash conversion*, margen CFO, P/CFO,
FCF yield, y cuatro banderas rojas).

---

## 2 · Disponibilidad de datos — VERIFICADA serie a serie

### ✅ Lo que existe con historia suficiente

| serie | qué es | historia |
|---|---|---|
| `DGS3MO` · `DGS2` · `DGS10` · `DGS30` | La curva completa | 1962-1981 |
| **`BAA10Y`** | **El diferencial de crédito** (Baa − Tesoro 10a) | **1986 · 41 años** |
| `AAA10Y` | Diferencial de máxima calidad | 1983 |
| `T10Y2Y` | Pendiente 10a-2a | 1976 |
| `DFII10` | Tipo **real** a 10 años (TIPS) | 2003 |
| `T5YIFR` | Expectativa de inflación 5a5a | 2003 |
| `VIXCLS` | VIX | 1990 |
| `DTWEXBGS` | Índice del dólar | 2006 |
| `IRLTLT01JPM156N` | Tipo largo de Japón | 1989 |
| `GFDEBTN` · `A091RC1Q027SBEA` | Deuda federal · intereses pagados | 1966 · 1947 |
| `M2SL` · `CPIAUCSL` | Masa monetaria · IPC | 1959 · 1947 |

### ⚠️ Lo que NO existe, y es justo la serie que el vídeo señala

> **`BAMLH0A0HYM2` (diferencial *high yield* de ICE BofA) sólo tiene 786 observaciones, desde
> 2023-09-04.** Tres años. Las series de ICE BofA están licenciadas y FRED ya no sirve su historia.

Eso **impide validar la señal estrella del vídeo tal cual** sobre los 236 meses del backtest.
`BAA10Y` es el sustituto correcto: mide lo mismo —el precio del riesgo de crédito— con 41 años.
Es una degradación honesta, y hay que decirla al publicar.

### ✅ Capa micro
Ya medido: **CFO 100 % · cash conversion 100 % · FCF 78 %**, con `buybacksTTM`, `dividendsTTM`,
`debt`, `cffTTM` y `fxCashTTM` ya expuestos.

---

## 3 · Los huecos de Scora, verificados en el código

| capa | qué hay | qué falta |
|---|---|---|
| **Divisa / soberano** | nada | **Cero dimensión de divisa.** El régimen usa `WALCL`, `WTREGEN`, `RRPONTSYD`, `T10Y3M`, `SAHMREALTIME`, `STLFSI4` |
| **Tipos / crédito** | un solo diferencial (`T10Y3M`) | **Sin curva, sin tipos reales, sin diferencial de crédito** |
| **Caja** | el Sankey hace la cuenta de resultados | **No toca el estado de flujos** |

---

## 4 · El plan, y por qué en este orden

El orden **no** es por interés sino por **riesgo de sobreajuste**. Ampliar el universo de activos
ya nos costó un `t = −2,12`: tocar el motor es donde se inventan parámetros.

### 🟢 Fase 1 · La capa de caja *(riesgo cero, cobertura 100 %)*
Es **pura medición**: no toca ninguna decisión de inversión, así que no puede sobreajustar nada.

1. **Diagnóstico de calidad del beneficio** — *cash conversion*, margen CFO, capex/ventas, FCF yield.
2. **Las cuatro banderas rojas** — cobros disparados, inventario acumulándose, y sobre todo
   **recompras y dividendos financiados con deuda**, que es lo que ningún competidor retail enseña.
3. **El Sankey de caja**, con el mismo listón que su hermano: si no cuadra con la variación de
   caja, no se publica.

### 🟢 Fase 2 · La capa explicativa de tipos *(riesgo cero, valor alto)*
Lo que los vídeos hacen bien —**explicar**— sin tocar la estrategia:

4. **Panel de la curva**: 3m / 2a / 10a / 30a, su pendiente, el tipo **real** y las expectativas de
   inflación. Con la lectura en una frase: *«el tipo sin riesgo a 10 años está en X; cualquier
   activo con riesgo tiene que batir eso»*.
5. **El diferencial de crédito (`BAA10Y`) en vivo**, con su percentil histórico a 41 años.
   *«Ensanchándose» es la única señal de alerta temprana que los tres vídeos comparten.*

### 🟡 Fase 3 · El diferencial DENTRO del régimen *(experimento, no obra)*
Aquí sí se toca el motor, así que va con hipótesis preespecificada y criterio escrito antes:

> **H5.** Añadir el diferencial de crédito (`BAA10Y`, percentil) como cuarto componente del régimen
> mejora el perfil ajustado al riesgo.
> **Criterio:** Sharpe **y** Calmar mejores que el régimen actual **en las dos mitades**. Una sola
> serie nueva, cero parámetros libres. Si falla, se escribe que falló y se cierra.

⚠️ Ojo: `STLFSI4` —que el régimen **ya usa**— incorpora diferenciales de crédito entre sus
componentes. Es muy posible que la señal ya esté dentro y `BAA10Y` no añada nada. **Hay que medir
la correlación entre los dos antes de gastar el ensayo.**

### 🟡 Fase 4 · Divisa y soberano *(el más caro y el más flojo)*
6. Índice del dólar y tipo largo japonés como **contexto explicativo**, no como señal.
7. Sólo si la fase 3 sale bien: probar la divisa como quinta dimensión del régimen.

**No se construye** la narrativa de la espiral de deuda como señal. Los datos (deuda, intereses)
sí se pueden enseñar como contexto verificable; el pronóstico, no.

### ⚪ Fase 5 · La comprobación del oro *(pequeña, verificable, nadie la hace)*
La única idea del vídeo de Japón que es **comprobable y no alarmista**: verificar si un ETF de oro
tiene **metal asignado** o es un pagaré. Se resuelve con los N-PORT y folletos, que es exactamente
la maquinaria que ya construimos para el mapa CUSIP. Encaja con la honestidad radical: no «el oro
no está listo», sino «este fondo concreto tiene barras y este otro no».

---

## 5 · Mi recomendación

**Empezar por la fase 1 y la 2.** Las dos son medición y explicación, cobertura verificada, riesgo
de sobreajuste **cero**, y dan a Scora algo que hoy no tiene en ninguna capa: el «por qué» detrás
del número.

**La fase 3 es la única que puede mover el motor**, y antes de gastar el ensayo 345 hay que medir
si `BAA10Y` aporta algo sobre el `STLFSI4` que ya está dentro. Es media hora de trabajo y puede
ahorrar el ensayo entero.

**La fase 4 la dejaría para el final** o para nunca: es donde más narrativa hay y menos evidencia.

---

# EJECUTADO · 2026-09-03 — y las siete cosas que el propio plan daba por buenas y no lo eran

Las cinco fases están construidas, medidas y en remoto. Lo que sigue no es el resumen de lo
que se hizo —eso está en los commits— sino **la lista de lo que este documento afirmaba y la
medición corrigió**, que es la parte que sirve para el siguiente plan.

## Lo que se construyó

| fase | qué | dónde | estado |
|---|---|---|---|
| 1 | Capa de caja: diagnóstico, banderas, puente, destino y **Sankey de caja** | `lib/flujoCaja.ts` · 92 asserts | ✅ |
| 2 | Capa de tipos: curva, forma, nominal/real, diferencial de crédito | `lib/tipos.ts` · 44 asserts | ✅ |
| 3 | Comprobación previa del ensayo 345 | `research/precheck_credito.mjs` | ✅ **no se gasta** |
| 4 | Capa soberana: las cifras de los vídeos, una a una | `research/soberano.mjs` | ✅ |
| 5 | Chequeo del respaldo del oro | `research/oro_respaldo.mjs` | ✅ |

## ⚠️ Las siete correcciones

**1. `research/macro.mjs` llevaba un clasificador muerto que contestaba.** Corría sobre
`BAMLH0A0HYM2`. Medido sobre 83 trimestres: 86 % con el dato en null, `credit_stress` clavado
en 50,0 exacto, y octubre de 2008 y abril de 2020 saliendo los dos como «reflation». No lo
importaba nadie, así que no contaminó ninguna cifra publicada. Retirado.

**2. `highCSC > 55` no se activa ni una vez en 210 meses.** Sin las cuatro series de ICE BofA
el CSC no sólo baja 5,8 puntos: **se aplana** (31,3-35,2 frente a 21,3-39,4). El régimen
`neutral`/Transición es inalcanzable en todo el backtest histórico. La ruta viva ya lo
resolvía en `regimeStationary.mjs`; lo que no existía era el **contrato de cobertura** que
ahora vigila STLFSI4, que es el único sostén que queda.

**3. El plan decía «media hora puede ahorrar el ensayo entero». Acertó.** ρ Spearman 0,769
sobre un criterio de 0,70 escrito antes de mirar. Van 344 ensayos, no 345.

**4. La afirmación central de los vídeos no sobrevive.** «El mercado de bonos huele el
problema antes que el de acciones»: el aviso se encendió 397 días antes de Lehman —precioso—
pero medido sobre 22 episodios independientes en 33 años, **p = 0,146** y **8 de 22 fueron
seguidos de un año de más del +20 %**. Marzo de 2020 se enciende EN el suelo. El mecanismo es
cierto; como señal, no. Por eso `avisoConTasaBase` obliga a publicar el booleano con su tasa
base y el test falla si alguien le añade una recomendación.

**5. El test sintético del Sankey pasaba y los datos reales no.** 84 asserts en verde porque
en laboratorio el residuo es cero. Sobre el S&P 500, **16 de 60 diagramas no cerraban**: la
variación que la empresa DECLARA casi nunca es la suma exacta de sus tres flujos. El arreglo
no es tolerar el hueco ni escalar barras, sino **dibujarlo**. Ahora cierran 60/60.

**6. Las dos premisas de la fase 5 eran falsas.** Los ETF de oro **no presentan N-PORT** —son
fideicomisos de materias primas, 10-K— y en el XBRL de GLD **no hay un solo tag de onzas**. Y
el control positivo que proponía el plan, DGL, **estaba liquidado desde marzo de 2023**: 1.254
timestamps y 385 cierres. En la primera pasada el script se negó a publicar por eso.

**7. Marqué como FALSA una afirmación midiendo otro instrumento.** `IRLTLT01JPM156N` es el
tipo japonés a 10 años; el vídeo habla del JGB a 30, que no cotiza hasta 1999. Corregido a
matiz. No se refuta una cifra midiendo otra serie.

## Lo que sí quedó medido, y es publicable

- El diferencial de crédito está hoy en **1,58 pp, percentil 11 de 41 años**: el crédito está
  tranquilo, no ensanchándose. Contradice el tono de los vídeos con su propio indicador.
- **DGP es una nota no garantizada del emisor cotizando junto a los ETF de oro** y desviándose
  +13,79 pp/año. El vídeo acierta en que el papel sin metal existe y se equivoca en cuál es:
  los ocho vehículos físicos se comportan como metal asignado dentro de 0,05 pp.
- El dólar ha perdido el **87,8 %** desde 1971 y los intereses de la deuda superan al gasto en
  defensa (**1,04x**). Las dos, ciertas.

## Lo que sigue sin construirse, a propósito

La espiral de deuda como señal, el calendario de la crisis, «Japón va diez años por delante»
y «el oro no está listo». Está escrito dentro del propio artefacto para que no se cuele luego.

**El único bloqueante de lanzamiento sigue siendo el abogado (§9).** Ninguna de estas cinco
fases lo toca.
