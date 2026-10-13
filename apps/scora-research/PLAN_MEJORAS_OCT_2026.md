# Plan de mejoras por fases — octubre de 2026

**Fecha:** 2026-10-13 · **Estado:** propuesta para revisión de Jorge. **Nada de esto está implementado.**
**Fuentes:**
- ~26 transcripciones de vídeo aportadas por Alejandro entre el 19-09 y el 13-10;
- siete documentos de extracción que hoy solo existen en el disco de Alejandro (ver §1.3);
- `AUDIT_REPORT.md` y los planes que ya están en este directorio.

> **Cómo leer este documento.** Cada pieza dice qué es, de dónde sale, de qué depende y qué
> significa «hecho». Cada pieza es una rama y una PR. Jorge revisa, aprueba y decide cuándo se
> despliega. Nada de este plan toca `score.total` ni las reglas de Picks sin pasar por un ensayo
> preregistrado (§9).

---

## 0 · Resumen en una página

**Tres principios ordenan todo:**

1. **Primero lo que está roto, después lo nuevo.** Dos defectos ya medidos falsean lo que se
   construiría encima. El DCF cuenta la deuda dos veces. La señal viva de Picks perdió la
   cobertura de intereses en más de la mitad del universo. Los dos siguen en `main` a 13-10.
2. **Lo nuevo entra como capa explicativa, con datos públicos.** Se usan SEC, FRED y el Tesoro
   de EE. UU. Así no se agrava el bloqueante de la licencia de FMP, que prohíbe mostrar lo
   *derivado*. Y no se gasta ningún ensayo.
3. **El backtest solo se toca con hipótesis preregistradas, de una en una.** Van 344 ensayos y el
   Sharpe deflactado del asignador está en el 81,1 % (`DECISION_B_SELECCION.md`). De todo el
   material revisado, **solo una idea cumple el criterio para reabrir la selección**: las compras
   oportunistas de directivos (§9.2).

| Fase | Qué | PRs aprox. | Dueño | Bloqueada por |
|---|---|---:|---|---|
| **0** | Desbloquear: tareas sin código, DCF, datos de Picks, guardián de cobertura, higiene legal y las reglas de Picks en el repo | 5 | Jorge, Alejandro, Claude | — |
| **1** | La IA y la ficha, honestas y más baratas | 6 | Claude → Jorge | 0 (D-11) |
| **2** | Valoración por escenarios: un solo motor | 5 | Claude → Jorge | 0.1 |
| **3** | Caja y balance por empresa | 5 | Claude → Jorge | 0.2 |
| **4** | Macro: capas explicativas nuevas | 5 | Claude → Jorge | — |
| **5** | Entrada y retención del usuario | 8 | Claude → Jorge | 1; parte, abogado |
| **6** | Tesis automáticas y su enganche con Picks | 4 | Claude → Jorge | 2, 3; publicar, abogado |
| **7** | Arquitectura | 6 | Jorge (Claude ayuda) | — |
| **8** | Investigación del backtest, de ensayo en ensayo | 4 | Claude → Jorge | 0.2 y 0.3 |

Las fases 4, 7 y 8 pueden ir en paralelo con las demás. Las fases 1 → 2 → 6 son la columna
vertebral del producto.

---

## 1 · Lo que ya está hecho y NO se repite

### 1.1 Cinco de los vídeos ya se analizaron y construyeron el 03-09

`PLAN_CUATRO_VIDEOS.md` y `PLAN_TRES_CAPAS.md` ya cubren:
- Jay Martin («el año que importó fue 2006»);
- el semanal de Berkshire, Uber, DoorDash y Airbnb;
- energía y los dos relojes;
- José Luis Cava sobre el oro, los tipos reales y SpaceX;
- y Money Bureau sobre bonos.

De ahí salieron `vidaUtil.ts`, `recompras.ts`, `tipos.ts`, `flujoCaja.ts`, `research/soberano.mjs`,
`research/tipos_reales.mjs` y `research/oro_respaldo.mjs`.

### 1.2 Lo que ya existe y repiten los vídeos nuevos

| Lo que piden los vídeos | Dónde está ya |
|---|---|
| Liquidez de la Fed y cuenta del Tesoro (Cava, Felix Prehn, Opla) | `WALCL − WTREGEN − RRPONTSYD` dentro del régimen (`regimeStationary.mjs`) |
| Diferencial de crédito como aviso (Cava, «Francia, el Titanic») | `lib/tipos.ts`, con su tasa base: **p = 0,146, no es señal** |
| Deuda, intereses y defensa de EE. UU.; Japón; dólar | `research/soberano.mjs` |
| Tipos reales y oro | `research/tipos_reales.mjs`: ρ −0,34, contemporánea, no predictiva |
| Compras de directivos en mercado abierto (vídeo de Uber, Gen Z) | `lib/form4.ts`, `lib/smartMoney.ts` (código P y compra en grupo) |
| 13F y Congreso | `lib/parse13f.ts`, `mapaCusip.ts`, `/api/congress` |
| Kelly (Albert Millán) | `lib/kelly.ts` (calculadora con tope del 25 %) |
| Concentración del índice | `research/concentracion.mjs` |
| Gestión activa: serie, Rf, temporización, Brinson y significación | `growth_series.json`, `temporizacion.ts`, `informe_gestion_activa.json` |

### 1.3 Los siete documentos de extracción que entran en este plan

| Documento (local, sin versionar) | Qué aporta | Fases |
|---|---|---|
| `ESCUELA_FEF_EXTRACCION_SCORA.md` | Falsador fundamental: crecimiento que exige el precio frente al logrado (A), alerta `expectativa_rota` (B), ficha por los seis pasos (C), «crecer con deuda» (D) | 2, 3, 5 |
| `EVERYTHING_MONEY_EXTRACCION_SCORA.md` | **El fallo del DCF (X)**, TIR al precio (A), histórico junto al supuesto (B), escenario guardado (C), «enseña la cuenta» (D), alerta (E), negocio frente a precio (F), modo a ciegas (G) | 0, 1, 2, 5 |
| `GOOGLE_FINANCE_EXTRACCION_SCORA.md` | Importar CSV (A1), brief de la lista (B), calendario de resultados (C), consenso (D), momentos inusuales (E), feedback (H) | 1, 5 |
| `GOOGLE_FINANCE_ARQUITECTURA_SCORA.md` | La IA como dato compartido (AR-1), backend por ficha (AR-2), la empresa no es su ticker (AR-3), el tiempo como dato (AR-4), pestañas en la URL (AR-6), UX-1 a UX-5 | 1, 5, 7 |
| `INVESTIGACION_LEGAL_GOOGLE_FINANCE.md` | Qué cruza la línea del asesoramiento, EIPD, licencias de lo derivado y las siete preguntas afinadas para el abogado | 0, 5, 10 |
| `PLAN_TESIS_INVERSION_SCORA.md` | Cuatro defectos de la IA (F0), libro de hechos y auditor (F1), escenarios en código (F2), `sl_tesis` (F3), falsadores (F4), Picks (F5), datos nuevos (F6) | 1, 2, 3, 6 |
| `HERMES_TESIS_CAPITAL_FAKTORY*.md` (2) | Notas de estudio de un informe de terceros. Su lección ya está en `PLAN_TESIS_INVERSION_SCORA.md` | — |

⚠️ **Las dos notas de Hermès no deben versionarse aquí.** Resumen página a página un informe
protegido cuyo aviso legal prohíbe reproducirlo, y este repo lo leen más personas. El plan usa
solo lo que se extrajo de ellas en `PLAN_TESIS_INVERSION_SCORA.md`.

---

## 2 · Cómo se trabaja cada pieza

**Flujo (fijado por Alejandro y por la protección de `main`):**

1. Rama nueva desde `main` actualizado. El nombre lleva el concepto: `fix/dcf-coherente`,
   `feat/muro-vencimientos`, `research/precheck-345`…
2. Una pieza, una PR. Si una fase tiene cinco piezas, son cinco PRs pequeñas. Jorge no tiene que
   revisar 3.000 líneas de golpe.
3. Al terminar: `git pull` → commit → push → PR a `main`. La PR dice qué se probó y con qué
   resultado, incluido lo que salió mal.
4. **Jorge aprueba y decide el despliegue.** Ninguna pieza se da por cerrada hasta verla en
   producción. La verificación posterior va como comentario en la PR.

**«Hecho» significa, para cualquier pieza:**
- **Suite en verde por su código de salida real**, no por el de un `| tail` detrás.
- **Golden con casos reales y un sabotaje por test.** El test se ve fallar con el código
  anterior y con el sabotaje puesto. Si el sabotaje no lo rompe, el test no vigila nada.
- **Cada fuente, comprobada contra la API real** antes de escribir código encima. Tres premisas
  de planes anteriores cayeron así: la vida útil no estaba en XBRL, el capex de Amazon venía de
  un tag muerto y el RPO de Amazon respondía con un dato de 2020.
- **Cobertura medida sobre las 503 empresas**, nunca sobre una muestra de 4 o de 60. Para una
  bandera explicativa:
  - cobertura de al menos el 60 %;
  - la bandera salta en menos de un tercio del índice. Si salta en más, describe el mercado y no
    señala nada.
- **Textos en inglés y en español** (`lib/i18n`). Si hay IA, pasa por la compuerta de grounding
  del idioma en que sale.
- **Recorrido con sesión** (`e2e/sesion/`). Requiere arreglar antes D-11 (§3.1).

**Y para cada pieza de investigación, además:**
- preregistro escrito ANTES de ejecutar (`PREREGISTRO_ENSAYO_3NN.md`);
- artefacto en `research/out/`, versionado;
- `trialsLedger.mjs` regenerado;
- tres referencias en cada tabla: SPY, RSP y el universo equiponderado;
- el MDE declarado antes de leer el resultado;
- y el resultado se publica gane o pierda.

---

## 3 · Fase 0 — Desbloquear

Sin esta fase, lo nuevo se construiría sobre cifras falsas o no se podría probar con sesión.

### 3.1 Tareas sin código (personas, no PRs)

| # | Qué | Quién | Por qué ahora |
|---|---|---|---|
| 0.a | **Parar los 12 workflows de `scora-research` y los 8 crons del Vercel viejo** | Alejandro | Siguen escribiendo en Supabase y gastando la misma cuota de FMP. El cron de Picks corrió el 12-10 en los dos repos |
| 0.b | Volver a copiar con `infra/migrar-produccion.sh --sin-pisar` lo que Supabase recibió después del 12-10 | Jorge | Consecuencia de 0.a (C-5) |
| 0.c | **D-11:** permitir `securetoken.googleapis.com` en la clave web `scora-web` | Jorge | Hoy toda sesión se rompe a la hora («14 data sources unavailable»). Sin esto ninguna prueba con sesión es fiable |
| 0.d | **D-10:** una clave de FMP aparte para pruebas, o subir de plan | Jorge + Alejandro (presupuesto) | La cuota se agotó el 12-10 con las pruebas. Cada análisis gasta ~21 llamadas |
| 0.e | Desplegar las rondas 2 y 3 de `AUDIT_REPORT.md` | Jorge | Están en `main` sin desplegar |
| 0.f | **Los dos workflows que hacen `git push` a `main`** (auditoría de símbolos y distribuciones sectoriales) fallan con GH006 | Jorge | Opciones: que abran una PR automática, un bot exento en la protección o escribir el resultado en Cloud SQL o GCS en vez de en git |
| 0.g | D-2: claves que faltan en producción (Stripe, Resend, VAPID, Groq y Gemini) | Jorge | Sin Resend ni VAPID no salen las alertas que proponen las fases 2, 5 y 6 |
| 0.h | Llevar al abogado las siete preguntas de `INVESTIGACION_LEGAL_GOOGLE_FINANCE.md` §6 y las de §9 de `SCORA_PICKS_REGLAS.md` | Alejandro | Sigue siendo el único bloqueante de lanzamiento |

### 3.2 PR 0.1 — `fix/dcf-coherente` · el DCF deja de contar la deuda dos veces

**El fallo** (Everything Money, §6; verificado en `main` el 13-10):
- `runDCF` hace `equityValue = totalPV − netDebt` (`lib/reverseDcf.ts:91`, y lo mismo
  `StockValuation.tsx`).
- Pero el flujo que descuenta es flujo operativo más capex, que en US GAAP va **después de
  intereses**.
- Y la tasa de `computeWACC` es `rf + β·ERP`: el coste del capital propio, no un WACC.
- Resultado: en McDonald's, el crecimiento implícito sale **7,2 %** cuando el coherente es
  **2,4 %**. La diferencia se mantiene en unos 5 pp con cualquier tasa, y puede cambiar la banda
  `realityBand`.

**Arreglo propuesto: la opción 1, flujo al accionista coherente.**
- No se resta la deuda neta; solo se suma la caja sobrante.
- La interfaz dice «coste del capital propio» en vez de «WACC».
- `netDebt` deja de ignorar las inversiones a corto plazo.

Es el cambio mínimo. La opción 2 (flujo a la empresa con `waccBridge`) también es correcta;
**decide Jorge**.

**Hecho:**
- versión del método guardada en `sl_analyses.reverse_dcf`, para que el historial no mezcle
  fórmulas;
- golden con MCD (endeudada: el crecimiento implícito BAJA), AAPL (caja neta) y un banco (sigue
  excluido);
- sabotaje: volver a meter la resta rompe el caso de MCD.

**Desbloquea:** toda la fase 2 y el falsador de Escuela FEF.

### 3.3 PR 0.2 — `fix/datos-picks-taxonomia` · la señal viva vuelve a ser la medida

Medido el 22-09 sobre la decisión real del 15-09:

1. **`icov` falta en 215 de 371.** Desde la taxonomía de 2023-2024 las empresas usan
   `InterestExpenseNonoperating`, que producción no lee. El laboratorio
   (`ebit_reconstruccion.mjs`) sí lo lee. Hay que alinear la lista de etiquetas.
2. **15 empresas sin deuda quedan fuera** por la corrección del 24-08: ISRG, ANET, VEEV, CPRT,
   PLTR… Se aplica la regla estricta que ya está verificada: rechaza TXT, DASH, MNST, F, GM y
   AAPL. Con deuda cero:
   - `icov` toma el tope explícito;
   - `lev` sale solo.
3. **D&A** pasa a ser `Depreciation` + `AmortizationOfIntangibleAssets`.

Con las tres correcciones vuelven 23 de las 81 no financieras excluidas, y unas 200 recuperan
`icov`. Unas 45 se siguen quedando fuera por no tener `OperatingIncomeLoss`. Esa vía, la de antes
de impuestos, ya se rechazó y no se reabre.

**Se hace en la misma regeneración que el issue #2.** Los backtests están caducados de todos modos
y son horas de cálculo: dos regeneraciones serían el doble. **Las dos ventanas se regeneran juntas**,
porque si no las huellas de datos dejan de coincidir.

**Propuesta para la versión:** las reglas no cambian, así que no se sube `PICKS_RULES_VERSION`.
Se añade un campo `datos_version` en `sl_picks_run` y se publica la corrección de datos con las
cifras de antes y de después. Lo deciden Alejandro y Jorge.

### 3.4 PR 0.3 — `feat/guardian-cobertura-metricas` · que no vuelva a pasar en silencio

El hueco de `icov` no falló en nada porque el artefacto guarda solo el percentil agregado. El
guardián de frescura hizo lo correcto y el dato pasó a `null` sin que nadie lo viera.

**Pieza:**
- la cobertura **por métrica** en el artefacto del panel;
- un test que falla si alguna métrica cae más de N pp frente a la corrida anterior;
- y el mismo contrato para cualquier capa nueva de las fases 3 y 4.

**Hecho:** sabotear la lista de etiquetas (quitar la nueva) rompe el test.

### 3.5 PR 0.4 — `fix/higiene-legal-prebeta` · reducir exposición antes de la beta

Es reversible y no espera al abogado. Lo pide la investigación legal del 02-10:
- **`PortfolioOptimizer`:** se desliga del diario y se quita el resaltado de la columna de máximo
  Sharpe. Hoy calcula pesos sobre las posiciones abiertas del usuario, que es la zona de
  recomendación personal (§41 y §46 de la guía de ESMA).
- **Exportaciones CSV de métricas de FMP** (ficha y screener): se desactivan hasta que la licencia
  cubra ese canal. Según el texto de FMP, es redistribución.
- **Ley de IA, art. 50(1):** cada salida de chat dice que es una IA, si no lo dice ya.

**Decide:** Alejandro. Es una decisión de producto con consecuencias legales.

### 3.6 PR 0.5 — `docs/traer-reglas-picks` · las reglas de Picks no están en el repo oficial

`SCORA_PICKS_REGLAS.md` es el documento preregistrado que fija qué hace Picks. **Solo está
versionado en el repo padre viejo** (`finance-ai-workspace`), que no entró en la fusión: la fusión
trajo `scora-research` e `ic-proxy`, no el padre.

Consecuencias:
- `scripts/cifras_publicadas.test.mjs` lo busca en `../SCORA_PICKS_REGLAS.md`. Hoy deja **cuatro
  comprobaciones sin ejecutar** y lo dice en su salida, pero en verde.
- Este plan y `PLAN_TESIS_INVERSION_SCORA.md` lo citan, y quien lea solo el repo oficial no lo
  encuentra.

**Pieza:** copiarlo tal cual al sitio que espera el test (`apps/SCORA_PICKS_REGLAS.md`), o mover
el documento y ajustar la ruta del test. **Decide Jorge.**

**Hecho:** las cuatro comprobaciones pasan de «NO EJECUTADAS» a ejecutadas, y un sabotaje en una
cifra del documento las rompe.

### 3.7 Decisión D-7 — los 27 errores que se ven como vacío

**Recomendación: sí, arreglarlos.** Las capas nuevas dependen de distinguir «no hay dato» de «la
consulta falló». Es la misma familia que el caso CBE: «sin datos» no era «no hay serie». **Decide
Jorge:** son 27 cambios de interfaz.

---

## 4 · Fase 1 — La IA y la ficha, honestas y más baratas

Todo esto es necesario para una beta y no depende del abogado.

### PR 1.1 — `fix/ia-cuatro-defectos` (PLAN_TESIS, F0)

1. **Una sección que no pasa la compuerta no se publica.** Cae a su versión determinista y se
   dice por qué. Hoy `StockReport` la muestra con un aviso.
2. **Fuera el «rough value» del prompt de escenarios.** El modelo no puede inventar valores: los
   calcula el código (fase 2).
3. **La compuerta comprueba contra los hechos, no contra el prompt entero.** Hoy cualquier cifra
   del 10-K o de las instrucciones cuenta como «dato».
4. **El veredicto se pasa al modelo como hecho.** Hoy `buildStockThesis` y `buildResearchReport`
   piden su propio veredicto, que puede contradecir a `Verdict.tsx`.
5. **La compuerta va en el idioma de salida.** La de `grounding.ts` solo reconoce inglés y la de
   `narrativaLLM.ts` solo español.

**Hecho:** tres sabotajes (una cifra inventada, «deberías comprar», «cayó por los aranceles») y en
los tres el texto **no** se publica.

### PR 1.2 — `feat/ia-dato-compartido` (AR-1)

`ScoraBrief` y `MacroAI` generan un texto distinto por usuario a partir de la misma `macro_state`.
Pasan a generarse una vez por día y por hash de datos, y se leen de tabla.

**Por qué:**
- ahorra coste desde el primer día;
- da coherencia;
- y refuerza el encuadre impersonal: el mismo texto para todos.

**Hecho:**
- dos usuarios ven el mismo texto;
- cambiar un valor de la `macro_state` genera uno nuevo;
- y quitar el hash de la clave rompe el test.

### PR 1.3 — `feat/auditoria-ia-servidor` (A-4 / D-4)

`ai_audit_log` se escribe en el servidor, con la compuerta corriendo allí. Va junto con 1.2 porque
los textos compartidos ya se generan en el servidor.

⚠️ La importación de cartera desde captura (fase 5) **no** pasa por esta ruta: guardaría las
posiciones del usuario para siempre.

### PR 1.4 — `feat/feedback-beta` (Google Finance H + UX-7)

Botones 👍/👎 y «este dato está mal» en cada módulo y en cada texto de IA. Es lo que hace medible
la beta.

### PR 1.5 — `feat/ficha-url-y-tiempo` (AR-6 + AR-4)

- Las pestañas de la ficha van en la URL, para enlazarlas y que el botón de atrás funcione.
- Cada precio dice de cuándo es: hora, zona y sesión, y la fuente (FMP o Yahoo cuando FMP no tiene
  cuota).

### PR 1.6 — `feat/ensena-la-cuenta` (Everything Money D + UX-5)

Cada métrica de `StockOverview` y `StockValuation` enseña su fórmula y las variables reales con
las que salió. Además lleva un enlace «¿qué significa?» a `/evidence` o a la metodología.

**Hecho:** se comprueba contra la cifra mostrada en el mismo render.

---

## 5 · Fase 2 — Valoración por escenarios: un solo motor

**El problema que evita esta fase:** tres documentos piden escenarios por separado: Everything
Money A, Escuela FEF A y la fase F2 de la tesis. Hacerlos por separado daría tres motores que
acabarían contradiciéndose, que es justo el defecto de la tesis de Hermès (29 cifras distintas
para lo mismo). **Se construye uno.**

Depende de 0.1.

### PR 2.1 — `feat/libro-de-hechos` (Tesis, F1)

- `lib/tesis/hechos.ts`: un único libro del que sale cada cifra.
- `lib/tesis/coherencia.ts`: un auditor que bloquea lo que se contradice.

**Hecho:** golden sobre 3-5 valores y un sabotaje por comprobación.

### PR 2.2 — `feat/escenarios` (Tesis F2 + Everything Money A y E + lectura de margen de seguridad)

- **Tres escenarios**, bajista, base y alcista, calculados por código (`lib/tesis/escenarios.ts`,
  reutilizando `reverseDcf.ts`). Cada uno trae:
  - su valor por acción;
  - la **TIR implícita al precio de hoy**: «si se cumplen estos supuestos, ¿cuánto gano pagando
    esto?»;
  - y la rentabilidad exigida por el usuario como dato de entrada.
- **Lectura de margen de seguridad** (Albert Millán, «fat value»): en vez de un único valor justo,
  enseña si el precio queda por debajo incluso del escenario bajista. Es la forma honesta de decir
  «barato»: robusto a los supuestos, no apoyado en uno.
- **Rejilla de sensibilidad:** tasa × crecimiento × múltiplo de salida.
- **Alerta al precio** que hace rendir el escenario del usuario. Es un botón sobre `price_below`,
  que ya existe.

**Hecho:**
- Nike reproduce el analizador de Everything Money con un error del 1-3 %;
- la rejilla coincide con un cálculo independiente;
- y el sabotaje de la tasa rompe la TIR.

### PR 2.3 — `feat/expectativas` (Escuela FEF A1)

- `lib/expectativas.ts`: el crecimiento que exige el precio frente al que la empresa logró de
  verdad, con una serie anual de al menos 6 puntos y las etiquetas de ingresos cosidas por fecha.
- Un **falsador fundamental con número** en `verdict.ts`. Hoy los falsadores solo son técnicos y
  macro.
- Una columna «Real (N años)» en `StockValuation`.

**Hecho:** cuatro tickers revisados a ojo contra su 10-K: uno de crecimiento, uno maduro, un banco y
uno con flujo libre negativo.

### PR 2.4 — `feat/historico-junto-al-supuesto` (Everything Money B)

Junto a cada supuesto se ven sus valores de 1, 3, 5 y 10 años. Hoy los escenarios se siembran con un
solo año (`ttmGrowth`). La ventana de 10 años espera a la serie larga de EDGAR (Escuela FEF A2).

### PR 2.5 — `feat/seis-pasos-y-negocio-vs-precio` (Escuela FEF C + Everything Money F y G)

- La ficha en modo principiante, ordenada por los seis pasos.
- Negocio frente a precio: qué controla la empresa y qué pone el mercado.
- Modo a ciegas, como ejercicio educativo: analizar sin ver el nombre.

---

## 6 · Fase 3 — Caja y balance por empresa (explicativo)

Depende de 0.2 (los intereses) y del guardián 0.3. Cada pieza mide su cobertura sobre las 503
**antes** de construir y cumple el listón del §2.

| PR | Pieza | De dónde sale | Datos |
|---|---|---|---|
| 3.1 `feat/muro-vencimientos` | Deuda que vence en 1, 2 y 3 años frente a caja más flujo libre, y el salto de coste: cupón medio actual frente al rendimiento BBB de hoy | Felix Prehn, Pablo Gil y Graeme («la deuda barata vence») | XBRL: `LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths`, `…InYearTwo`, `…InYearThree` |
| 3.2 `feat/bandera-zombi` | Cobertura de intereses por debajo de 1 tres ejercicios seguidos (definición del BIS) | Felix Prehn («Danger Zone») | XBRL; **necesita 0.2** |
| 3.3 `feat/crecer-con-deuda` | Crecimiento financiado con deuda en `flujoCaja.ts` | Escuela FEF D | XBRL |
| 3.4 `feat/calidad-del-beneficio` | Peso del resultado no operativo y de las plusvalías no realizadas en el beneficio. **Caso golden: Amazon y su participación en Anthropic** (Gen Z). Primero se comprueba si la conversión a caja ya lo caza | Gen Z | XBRL |
| 3.5 `feat/tesis-datos-f6` | Tabla de crisis (2020 y 2022; 2008 dice «sin dato»), agregados de sector del propio universo, composición del capital (ROIC × reinversión) y remuneración frente a rentabilidad (*Pay vs Performance*, taxonomía ECD: **cobertura primero**) | PLAN_TESIS F6 | XBRL |

**Opcional, tras las cinco:** poder de fijación de precios, a partir del margen bruto durante el
choque de costes de 2021-2023. Viene del vídeo de inflación. Solo se hace si cumple el listón de
cobertura.

**Nada de esta fase entra en el score.** Si algún día se quisiera, va por el camino de §9.

---

## 7 · Fase 4 — Macro: capas explicativas nuevas

Mismo criterio que `soberano.mjs`: **hechos con fuente y fecha, nunca pronósticos.** Cero entradas
al asignador. Todas las series se verifican contra la API real antes de escribir código encima.

### PR 4.1 — `feat/soberano-r-menos-g`

Viene de Cava (Francia, dos vídeos), Felix Prehn, Pablo Gil y Graeme.
- **r − g por país:** EE. UU., Francia, Italia, España, Alemania, Japón y Reino Unido, con el tipo
  largo frente al crecimiento nominal.
- **Diferenciales frente al Bund.**
- **La factura de intereses que se pone al día:** tipo medio efectivo de la deuda de EE. UU.
  (FiscalData, «Average Interest Rates») frente al tipo de mercado. Cuánto subirían los intereses
  si toda la deuda se refinanciara hoy, con el vencimiento medio como calendario.
- **Licencia:** cada serie de OCDE e IMF en FRED se revisa una a una.

### PR 4.2 — `feat/quien-financia-al-tesoro`

Viene de Cava («QE del Tesoro», dos vídeos), Felix Prehn (cuenta del Tesoro) y el vídeo del oro y
China.
- Peso de las letras en la deuda negociable (Monthly Statement of the Public Debt, FiscalData).
- Tenencias extranjeras de bonos del Tesoro (TIC): China en mínimos de 18 años, según el vídeo.
- Reservas bancarias (`WRESBAL`, ya cableada).

Explica con datos lo que los vídeos cuentan como conspiración. **El matiz que hay que decir:** pagar
el gasto con letras o con bonos mueve las reservas igual. El efecto de tipo «QE» viene de que el
mercado tiene que absorber menos duración, no de que se inyecten reservas netas.

### PR 4.3 — `feat/valoracion-indice-tipo-real`

Viene de Cava («PER = 1 / bono → S&P 8.400») y de Graeme (rendimiento de beneficios del 5,20 % igual
al del bono).
- Rendimiento de beneficios del S&P 500 menos el **tipo real** a 10 años (`DFII10`), con percentil
  y, si la licencia de la serie histórica lo permite, la rentabilidad real a 10 años desde niveles
  parecidos.
- **Por qué no la versión del vídeo:** compara un rendimiento de beneficios, que es real, con un
  bono nominal. Es el «modelo de la Fed», que falla precisamente cuando cambia la inflación
  (Asness, 2003).
- **Datos:**
  - el valor actual sale del agregado XBRL propio de las 503;
  - la historia larga necesita una fuente con licencia verificada (Shiller/Yale). Si no la hay, se
    publica solo el valor y su percentil desde 2009.

### PR 4.4 — `feat/credito-no-bancario`

Viene de Cava («Francia, el Titanic»): la Fed de Nueva York inspecciona el crédito privado.
- Préstamos de la banca a instituciones financieras no bancarias, de la serie H.8 publicada en
  FRED. **Antes de construir hay que verificar el identificador, desde cuándo hay historia y si
  la definición cambió por el camino.** Una serie con la definición cambiada a mitad compara
  cosas distintas.
- **Es contexto, como el diferencial: no es señal.**

### PR 4.5 — `feat/semaforo-regimen`

Responde a una de las notas que Alejandro marcó como importantes (los semáforos de Opla).
- El régimen de Scora se presenta como semáforo, con la tasa base de cada color: distribución de la
  rentabilidad y de la caída a 3, 6 y 12 meses, y el número de episodios independientes, no de
  meses solapados.
- Es la versión honesta de un semáforo: dice cuántas veces se equivocó cada color.

**Opcional, barato:** un deflactor en horas de trabajo (`AHETPI`, desde 1964). Muestra el S&P, el
oro y la vivienda en horas de un sueldo medio. Comprueba la cifra de Felix Prehn de 75 a 21 onzas
de oro por sueldo.

---

## 8 · Fase 5 — Entrada y retención del usuario

Depende de la fase 1. Lo marcado con ⚖️ espera al abogado o a la EIPD.

| PR | Pieza | Fuente | Nota |
|---|---|---|---|
| 5.1 `feat/importar-csv` | Importar la cartera desde el CSV del bróker al diario | Google Finance A1 | La activación de la beta: hoy el diario obliga a teclear operación por operación |
| 5.2 `feat/calendario-resultados` | Calendario de resultados de la watchlist y cuánto suele moverse cada valor al publicar | Google Finance C1 y C2, UX-4 | C2 revisado a ojo: crecimiento, maduro, banco y un split reciente |
| 5.3 `feat/consenso-calibrado` | Conectar `buildConsensus`, que está construido y probado pero ningún componente usa | Google Finance D1 | La versión por ticker (D2) espera al límite real de FMP |
| 5.4 `feat/lista-por-defecto` | Un usuario nuevo ve los 11 ETF sectoriales, **no** los Picks: sería una recomendación | UX-1 | — |
| 5.5 `feat/brief-watchlist` ⚖️ | Brief determinista de la **watchlist**, sin el rating de Scora: hechos, fechas, movimientos y operaciones de directivos. En la app y por push; **el email espera a la licencia** | Google Finance B | Pregunta 2 al abogado |
| 5.6 `feat/momentos-inusuales` | Marcar en el gráfico qué coincidió con un movimiento grande, sin afirmar la causa | Google Finance E, sobre `attribution.ts` | Necesita los máximos y mínimos diarios (§9.1) para algunas marcas |
| 5.7 `feat/diario-de-decisiones` ⚖️ | En cada operación del diario:<br>• la tesis del usuario;<br>• los 3-5 indicadores que la mueven (Millán);<br>• su probabilidad (Annie Duke);<br>• su escenario guardado (Everything Money C).<br>Con el tiempo, revisión frente a lo realizado y **calibración del propio usuario**. Se fusiona con la alerta `expectativa_rota` de Escuela FEF B en **un solo camino del cron**. Kelly se alimenta de la probabilidad que el usuario escribe | Millán, Annie Duke, Everything Money C, Escuela FEF B | Lee el diario: pregunta 3 al abogado. Scora no recomienda nada; mide al usuario contra sí mismo. Caso golden: Intel 2021, que acertó el precio y falló los cuatro supuestos |
| 5.8 `feat/acciones-relacionadas` | «Se mueve con…», por correlación de 1 año y sector | UX-3 | — |

**Después, si se decide:**
- tema claro (UX-2);
- importar desde captura o PDF (Google Finance A2) ⚖️, que **exige EIPD**, no guarda la imagen y
  no pasa por `ai_audit_log`;
- y preguntas a la ficha (Google Finance G, AR-7 y AR-8) ⚖️.

---

## 9 · Fase 6 — Tesis automáticas y su enganche con Picks (PLAN_TESIS F3-F5)

Depende de las fases 2 y 3. Publicar las de Picks espera al abogado; **sellarlas no**.

| PR | Pieza | Hecho |
|---|---|---|
| 6.1 `feat/tesis-servidor` | Generación en el servidor, tabla `sl_tesis` y pestaña *Thesis* (agrupa *Report* y *Diligence*) | Leer una tesis no gasta cuota; regenerarla sí |
| 6.2 `feat/falsadores-vivos` | Falsadores con umbral, comprobación periódica y aviso | Un falsador forzado dispara un aviso real en preproducción |
| 6.3 `feat/picks-tesis-sellada` | `thesis_id` en `sl_picks_position`: sellado al comprar, revisión en cada fecha de decisión y autopsia al vender. Se genera **después** de escribir la decisión y no puede bloquearla | Test: la decisión se escribe aunque la tesis falle, y la tesis no cambia ninguna decisión |
| 6.4 `feat/calibracion-tesis` | Cuántas veces se cumplió el escenario bajista, el base y el alcista; si los falsadores precedieron a las pérdidas | Horizonte y MDE declarados antes de mirar: con ~4 compras al mes, la cifra tarda años |

**La regla que no se toca:** la tesis explica, no decide. Nada vuelve a `decide()`.

**Decisiones de Alejandro antes de 6.1:**
- idioma de las tesis;
- una pestaña *Thesis* que agrupe o una más;
- acceso: Pro o para todos;
- universo: solo los valores que han estado en Picks, que es más barato y más coherente con la
  calibración, o todos.

---

## 10 · Fase 7 — Arquitectura (dueño: Jorge)

| PR | Qué | De dónde |
|---|---|---|
| 7.1 | **Backend por ficha:** la ficha pide una respuesta resuelta en el servidor, no 33 llamadas desde el navegador. Sección a sección, con test de paridad. Es también el único punto donde aplicar la licencia | AR-2 |
| 7.2 | **La empresa no es su ticker:** el `cik` es la clave en toda tabla nueva **desde ya**; la migración de las viejas, después de la beta. Cierra de raíz los símbolos reutilizados, el CIK predecesor y el «Alphabet dos veces» | AR-3 |
| 7.3 | Rol `scora_app` con permisos mínimos; la app deja de conectar como `postgres` | A-5 / D-5 |
| 7.4 | Transacción por lote en `/api/data` (M-5), caducidad de la caché de esquema (M-6) y un solo `dataContract.ts` para cliente y servidor (M-8) | AUDIT_REPORT |
| 7.5 | Revocación inmediata de sesión en IA y Stripe (Admin SDK) | D-3 |
| 7.6 | Presupuesto de llamadas: clave de pruebas (D-10), caché de los análisis compartidos (AR-1) y un contador de llamadas a FMP por día visible en el log | AUDIT_REPORT |

**Regla para todo lo nuevo:**
- datos de fuentes públicas cuando existan (SEC, FRED, Tesoro), porque lo derivado de FMP y
  Finnhub también está bajo licencia;
- y cada fuente con su contrato de cobertura, como el de `research/tipos.mjs`.

---

## 11 · Fase 8 — Investigación del backtest: de ensayo en ensayo

Depende de 0.2 (datos) y 0.3 (guardián). **Cada pieza que evalúa una estrategia sobre la historia
suma al libro de ensayos y se preregistra.**

### 8.1 `research/panel-ohlcv` · ampliar el panel de precios

Hoy `prices.mjs` y `pricesLong.mjs` guardan solo el cierre (`raw` y `adj`). Hacen falta máximo,
mínimo y volumen ajustados para:
- probar la estrategia de Trading Latino, que ya está en la ficha y nunca se midió;
- algunas marcas de los momentos inusuales (5.6);
- y la volatilidad realizada de §8.3.

⚠️ Hay que vigilar la trampa 30 de la lista de trampas de backtest: Yahoo trata una escisión como
un split.

### 8.2 `research/precheck-345` → `research/ensayo-345` · compras oportunistas de directivos

**Es el único candidato que cumple un criterio para reabrir la selección** (`DECISION_B_SELECCION.md`,
criterio 2): una señal con **evidencia externa** y **datos nuevos**, no derivados de los mismos
fundamentales con los que se validaría.
- **Evidencia:** Lakonishok y Lee (2001); Cohen, Malloy y Pomorski (2012) separan a los directivos
  «rutinarios» de los «oportunistas», y solo los segundos predicen.
- **Datos:** la SEC publica las declaraciones de directivos (Form 3, 4 y 5) en ficheros
  trimestrales desde 2006. Son de dominio público, sin el problema de licencia de FMP. **Verificar
  la cobertura al empezar.**

**Orden:**
1. **Comprobación previa**, sin gastar el ensayo:
   - cobertura sobre los nombres del panel;
   - correlación con las señales ya auditadas: si es momentum disfrazado, no se gasta;
   - y MDE con los meses disponibles.
   ⚠️ La literatura concentra el efecto en empresas pequeñas, y en el S&P 500 podría ser
   indetectable. **Si el MDE no lo permite, se dice y no se gasta el 345.**
2. **Preregistro** (`PREREGISTRO_ENSAYO_345.md`): la definición de oportunista, la ventana, la regla
   de cartera y el criterio de éxito, escritos antes de ejecutar.
3. **Una sola corrida.** Tres referencias (SPY, RSP y universo equiponderado), Sharpe deflactado
   con el M actualizado, y se publica el resultado sea cual sea.

### 8.3 `research/tests-opciones` · las tres notas que Alejandro marcó como importantes

Opla y Cava construyen su tiempo de entrada sobre el posicionamiento en opciones. **No se reabre el
flujo de opciones**, decidido el 17-08: OPRA es cara y la premisa no se sostiene. Lo que sí se puede
es **comprobar sus afirmaciones falsables con datos gratis:**

| Afirmación | Prueba | Datos |
|---|---|---|
| «VIX en mínimos + vencimiento mensual o trimestral → caída del 8-10 %» (Opla, cuatro vídeos) | Caída máxima en los 20 días siguientes a cada vencimiento con el VIX en su quintil bajo, frente al resto de vencimientos y a fechas al azar. ~144 vencimientos trimestrales desde 1990, a nivel de episodio, permutación con semilla fija | `VIXCLS` + SPY |
| «Las manos fuertes venden volatilidad: divergencia entre el MOVE y el VIX» (Cava, «2027») | El MOVE es de ICE y está licenciado. **Sustituto público:** la volatilidad realizada del bono a 10 años (`DGS10` diario) frente al VIX. ¿La divergencia precede subidas del VIX o caídas? | FRED |
| «Manos fuertes» = exposición gamma de los creadores de mercado | **Solo si existe un histórico gratuito con licencia** (SqueezeMetrics publicaba DIX y GEX desde 2011; verificar). Y se prueba como predictor de **volatilidad**, que es el mecanismo plausible, no de dirección | — |
| «19 de 20 años de elecciones de mitad de mandato acabaron al alza tras una corrección» (Cava) | Tasa base con n = 20, publicada como lo que es: no distingue nada con veinte casos | S&P desde 1946 |

Cada resultado se publica en `/evidence`, salga lo que salga. Un «lo comprobamos y no se sostiene»
es exactamente el producto. Cada prueba suma uno al libro de ensayos.

### 8.4 `research/ensayo-346-trading-latino` (prioridad baja)

**Solo después de 8.1.** Una hipótesis preregistrada de **momento de entrada** de Picks, nunca de
salida: la regla de 180 días costó entre 63 y 74 pp. Se cuenta el coste de esperar en caja: la rampa
costó entre 32 y 96 pp.
- Antes de probarla hay que corregir los tres defectos frente a lo que enseñan los vídeos: el ADX
  girando, el valle rojo y el POC que depende del botón de periodo.
- **La probabilidad a priori es baja:** es de la familia del momentum, que ya pierde 136 pp frente
  al SPY. Solo vale la pena si se quiere cerrar la pregunta con evidencia.

### 8.5 Lo que cambiaría el cuadro y no depende del código

**Un universo menos eficiente** (`DECISION_B_SELECCION.md`, criterio 1): empresas pequeñas y
medianas, o Europa.
- Es la única vía con base teórica.
- Está bloqueada por los precios de las empresas que dejaron de cotizar: Stooq exige clave con
  CAPTCHA.
- Hace falta **decidir presupuesto** para un conjunto de datos sin sesgo de supervivencia.
- **Decide Alejandro, con Jorge.**

---

## 12 · Lo que NO se construye, y por qué

| Idea | Fuente | Motivo |
|---|---|---|
| Flujo de opciones (OPRA), barridos, gamma como producto | Opla, Cava | Cara y con la premisa sin respaldo (decidido el 17-08). Lo comprobable va en §8.3 |
| Mercados de predicción (Kalshi, Polymarket) | Google Finance F | Cuatro bloqueos legales independientes. La alternativa son las letras del Tesoro en FRED |
| Patrones técnicos como señal (doble techo con menos volumen, taza con asa, media de 200, rotura de base) | Opla, semanal | Son momentum: −136 pp frente al SPY en 192 meses |
| Diversificación internacional en el asignador | Pablo Gil | Ya medido con desarrollados ex-EE. UU., emergentes y Japón: el Sharpe cae de 0,99 a 0,73 |
| Sentimiento por portadas o por analistas | Cava | No hay datos históricos gratis y las portadas no se miden |
| Calendario electoral, Jackson Hole o «2028 año clave» como regla | Opla, Cava | n mínimo; el propio Opla concluye que el tono de Jackson Hole no predice. Solo la tasa base de §8.3 |
| Fondo soberano que provoca una caída para comprar, élites, Tether comprando oro, «manipulación» | Opla, Cava | No falsable |
| Puntuación de inflación de **tu** cartera; chat sobre **tu** diario | Felix Prehn, Google Finance G | Cruza la línea del asesoramiento personal hasta que conteste el abogado |
| Apalancamiento, también en la cartera barbell | Millán | Decisión firme del 03-09 |
| Selector de región; personalización por historial | Google Finance UX-6 | La cobertura es gran capitalización de EE. UU., y personalizar rompe el encuadre impersonal |
| Los 8 pilares y su ROIC | Everything Money | Umbrales sin medir; el ROIC cuenta el patrimonio dos veces |
| Calculadoras de vivienda (comprar ya o esperar, alquiler frente a compra) | Graeme y otros | Bien hechas, pero fuera del núcleo. Como mucho, material de escuela |
| Versionar las notas de Hermès | — | Material protegido (§1.3) |

---

## 13 · Decisiones pendientes, y de quién

| Quién | Decisión |
|---|---|
| **Jorge** | Opción 1 o 2 del DCF (§3.2) · D-7 (27 errores) · cómo salvan los bots la protección de `main` · D-2, D-3, D-5, D-9 y D-11 · calendario de despliegues |
| **Alejandro** | Parar los crons viejos (0.a) · presupuesto de FMP (D-10) y de datos sin sesgo de supervivencia (§8.5) · `datos_version` frente a nueva versión de reglas (§3.3) · higiene legal previa a la beta (§3.5) · idioma, pestañas, acceso y universo de las tesis (§9) · si Picks se mantiene y por qué (`DECISION_B_SELECCION.md`) |
| **Abogado** | Las siete preguntas de `INVESTIGACION_LEGAL_GOOGLE_FINANCE.md` §6 y las de §9 de `SCORA_PICKS_REGLAS.md` |

---

## 14 · Orden propuesto

```
Fase 0  ─┬─ 0.a-0.h (personas)        ─┐
         ├─ 0.1 DCF ───────────────────┼──► Fase 2 ──► Fase 6
         ├─ 0.2 datos Picks + issue #2 ┼──► Fase 3 ──┘
         ├─ 0.3 guardián cobertura ────┤
         ├─ 0.4 higiene legal          │
         └─ 0.5 reglas de Picks al repo│
Fase 1 (tras D-11) ────────────────────┴──► Fase 5
Fase 4 ─ en paralelo, sin dependencias
Fase 7 ─ en paralelo (Jorge)
Fase 8 ─ 8.2 y 8.3 tras 0.2; 8.1 → 8.4
```

**Primeras cinco PRs:** 0.5, 0.1, 0.2 (con la regeneración del issue #2), 0.3 y 1.1.
- 0.5 va primera porque es la más pequeña y devuelve a CI cuatro comprobaciones sobre las reglas
  que 0.2 va a tocar.
- Las otras cuatro arreglan lo que está mal publicado o mal calculado.

Ninguna depende de nadie salvo de la revisión de Jorge.
