# Plan único de Scora — octubre de 2026

**Fecha:** 13-10-2026 · **Para:** Jorge, que revisa y despliega, y Alejandro, que decide.
**Estado:** propuesta. Nada de lo que propone está implementado; lo que ya existe en `main` se marca como tal.
**Sustituye a** `PLAN_MEJORAS_OCT_2026.md` (PR #3) y a los tres anexos que se escribieron sobre él
(sesiones `64dd764b`, `a83d1ada` y `7a6dfd82`). Un solo documento y una sola numeración; la
correspondencia con los identificadores anteriores está en el apéndice A.
**Base:** `main` en `6e3b7fb`. Cada afirmación sobre el código lleva su fichero y su línea, y se
volvió a comprobar el 13-10 al escribir este documento (§3).

> **Cómo leer este documento.**
> - §1 lo resume en una página; §2 dice cómo se trabaja y qué significa «hecho»; §3 es el estado
>   de partida verificado.
> - Las **fases 0 a 9** van en orden de ejecución. Cada pieza tiene un identificador `fase.n`, una
>   rama, de qué depende, quién decide y cuándo está hecha.
> - §4 lo que no se construye, §5 las decisiones pendientes, §6 el orden con sus dependencias y
>   §7 qué cambia respecto al PR #3.

---

## 1 · Resumen en una página

**Los cuatro frentes:**

| Frente | Qué se busca | Piezas |
|---|---|---|
| **Arquitectura** | Una sola fuente por dato y por fórmula, barras de precio con historia larga, IA servida como dato y un presupuesto de llamadas medido | 0.7, 2.1-2.8 |
| **Stock picking (Scora Picks)** | Que la señal viva vuelva a ser la medida, que cada decisión quede sellada y que la página diga solo lo que se puede sostener | 0.2, 1.1, 1.3, 1.4, 3.1, 3.3, 7.3 |
| **Backtest e investigación** | La CI en verde con datos frescos, un panel OHLCV y un ensayo preregistrado cada vez (345, directivos; 346, Trading Latino) | 1.3, 3.2, 3.4-3.8 |
| **La app: funciones y datos** | Valoración por escenarios con un solo motor, gráfico multitemporal, calendario, consenso, Congreso, 13F, laboratorios y capas explicativas con datos públicos | Fases 4, 5, 6 y 7 |

**Los principios** (los mismos en los cinco documentos de origen):
1. **Primero lo roto y el riesgo vivo; después lo nuevo.** El DCF cuenta la deuda dos veces, la
   señal viva de Picks perdió la cobertura de intereses en más de la mitad del universo y el
   asistente lee el diario de posiciones en producción.
2. **Lo nuevo es información, no recomendación.** Ni «compra» ni «vende», nada sobre las posiciones
   del usuario, y las alertas, sobre la watchlist.
3. **Cada fórmula y cada indicador, en un solo sitio**, importado por la ficha, el cron y el
   backtest.
4. **Datos públicos o con licencia.** Nada nuevo que dependa de más cuota de FMP (D-10) ni de lo
   derivado de FMP o Finnhub.
5. **El backtest solo se toca con hipótesis preregistradas, de una en una.** Van 344 ensayos y el
   Sharpe deflactado del asignador está en el 81,1 %. Lo que se puede medir hacia delante se sella
   y no gasta ensayo.
6. **Una sesión, una rama, una PR con pocas piezas.** Jorge aprueba y despliega; lo nuevo va detrás
   de un interruptor.

**Las fases:**

| Fase | Qué | Piezas | Empieza |
|---|---|---:|---|
| **0** | Desbloqueo: personas, configuración y decisiones (sin código) | 12 tareas | Ya |
| **1** | Lo roto y el riesgo vivo | 6 | Ya |
| **2** | Arquitectura y cimientos | 8 | Ya; la 2.1 tras decidir el proveedor de barras |
| **3** | Stock picking y backtest: sellar, medir y un ensayo cada vez | 8 | Tras la 1.3, la 1.4 y la 2.2 |
| **4** | Valoración por escenarios: un solo motor | 8 | Tras la 1.5 (DCF) |
| **5** | La ficha, el gráfico y la watchlist | 16 | Tras la 1.2; la 5.1, la 5.2, la 5.5 y la 5.14 tras la 2.1 |
| **6** | Capas explicativas: caja, balance y macro | 17 | Tras la 1.4, en paralelo |
| **7** | Tesis automáticas y su enganche con Picks | 5 | Tras las fases 4 y 6 |
| **8** | Beta cerrada | — | Con las fases 1 y 2 desplegadas y lo esencial de las 4 y 5 |
| **9** | Lo que espera a la licencia o al abogado | 10 | Con la licencia o el abogado |

**Las seis primeras PRs, en este orden:** 1.1 (las reglas de Picks al repo) → 1.2 (higiene legal) →
1.3 (los datos de Picks y la regeneración, que devuelve la CI a verde) → 1.4 (guardián de
cobertura) → 1.5 (DCF) → 1.6 (IA honesta). Ninguna espera a nada salvo a la revisión de Jorge y a
las decisiones de §5 que les tocan.

**Lo que hace falta de las personas ya** (fase 0): parar los crons de los repos viejos (el de Picks
corre cada día laborable en los dos repos), D-11, D-10, los bots que chocan con la protección de
`main`, y empezar con el abogado y con la licencia de FMP.

---

## 2 · Cómo se trabaja

### 2.1 El flujo

1. **Una sesión de trabajo, una rama** desde `main` actualizado, con el concepto o la fecha en el
   nombre (`fix/dcf-coherente`, `research/precheck-345`…). Lleva una pieza o unas pocas de la misma
   fase, **cada una en su commit**, para que Jorge pueda revisarlas por separado.
2. **Cada sesión trabaja en su propio `git worktree`.** Al empezar: `git fetch`, `git status` y
   `git worktree list`. Si otra sesión está escribiendo en el mismo directorio, se para y se avisa.
   Para leer `main` con otra sesión activa: `git show origin/main:<ruta>`.
3. **Al terminar:** `git pull` → commit → push → PR a `main`. Nunca se commitea en `main` (está
   protegida: un push directo falla con GH006) ni se reutiliza la rama de otra sesión.
4. **Jorge** revisa, aprueba, aplica migraciones y secretos, despliega y activa el interruptor. Una
   pieza se cierra cuando se ve en producción: la verificación va como comentario en la PR, y
   `AUDIT_REPORT.md` se actualiza si cambia algo de lo que figura ahí.

### 2.2 Qué significa «hecho»

- **La suite en verde por su código de salida real**, no por el de un `| tail` detrás.
- **Golden con casos reales y un sabotaje por test:** cada test nuevo se ve fallar con el código
  anterior y con el sabotaje puesto. Si el sabotaje no lo rompe, el test no vigila nada.
- **Cada fuente, comprobada contra la API real** antes de escribir código encima.
- **Cobertura medida sobre las 503**, nunca sobre una muestra. Una bandera explicativa necesita al
  menos un 60 % de cobertura y saltar en menos de un tercio del índice; si salta en más, describe
  el mercado y no señala nada.
- **Los textos en `lib/i18n`** (inglés y español), con `scripts/i18n.test.mjs`. Si hay IA, pasa por
  la compuerta del idioma en que sale.
- **Toda tabla nueva:** migración aditiva en `sql/gcp/`, entrada en `lib/server/data/policy.ts`,
  permisos en el rol `scora_app` (sin `TRUNCATE`), sitio en la lista de borrado de cuenta y columna
  `cik` si es por empresa (2.5).
- **Recorrido con sesión** (`e2e/sesion/`) de lo que se toca, en cuanto esté D-11.
- **Un paso nuevo va en CI y en `test:all` a la vez:** el guardián exige que corran lo mismo.

### 2.3 Investigación (la fase 3 y todo lo que mida una estrategia)

- **El preregistro se fusiona antes de correr nada** (`PREREGISTRO_ENSAYO_3NN.md`, como el 343 y
  el 344): hipótesis, métrica, MDE, ventanas, regla de decisión y contador de ensayos. La fecha de
  la PR la pone GitHub, y es la prueba de que se escribió antes.
- **Una hipótesis por ensayo.** «A o B» son dos ensayos.
- **Una comprobación previa que no gasta ensayo:** cobertura, correlación con lo ya auditado y MDE,
  sin mirar retornos. Si el MDE no lo permite, se dice y no se gasta.
- **Las dos ventanas, siempre juntas; tres referencias** (SPY, RSP y el universo equiponderado), y
  la **banda intercuartil** (4-5 pp), no un punto.
- Artefacto en `research/out/` (versionado) y `research/trialsLedger.mjs` regenerado.
- **El resultado se publica gane o pierda** (`/evidence`), con el diff entre corridas.
- **Nada entra en el score ni en las reglas de Picks** sin pasar el Sharpe deflactado y el MDE. Las
  reglas v3 siguen congeladas: un cambio es una versión nueva con su propia serie.

### 2.4 La PR

La descripción dice:
1. qué cambia y por qué;
2. la evidencia;
3. qué pruebas se corrieron y con qué resultado, **incluido lo que falló**;
4. qué ve el usuario;
5. si hay migración, secretos o variables nuevas;
6. si mueve cifras publicadas (eso va siempre en una PR aparte);
7. cómo verificarlo en producción y cómo deshacerlo.

---

## 3 · Estado de partida (verificado el 13-10-2026 en `6e3b7fb`)

### 3.1 Lo que ya está hecho y no se repite

- **Las rondas 1, 2 y 3 de la auditoría de Jorge están desplegadas:** todas sus correcciones son
  anteriores a la imagen `d7774dc` (revisión `scora-00007-2wc`). Entre ellas hay cinco piezas que el
  PR #3 daba por pendientes:
  - **D-7 / M-3**, los 27 errores que se veían como vacío (`b4227c3`);
  - **M-6**, la caché del esquema ya caduca (`4774969`), y **M-8**, un solo contrato de tipos
    (`7719f09`); M-5 se cerró sin cambio y con su razón;
  - **A-4**, el registro de auditoría de la IA lo escribe el servidor (`6b69191`), que pasa la
    compuerta (`lib/server/auditoriaIA.js` importa `checkGrounding`);
  - **A-6**, el borrado de cuenta (`672bdfd`) y el consentimiento de PostHog (`3590ae6`);
  - **B-1 / D-8**, las 16 rutas sin uso cerradas (`bbc5052`), y **B-4**, la URL propia en
    `lib/sitio.ts` (`518ea13`).
- **A-5, el rol `scora_app`, está preparado y probado, pero sin aplicar** (`4981119`,
  `sql/gcp/003_rol_app.sql`). Es la tarea 0.7.
- **C-5**, la migración de Supabase a Cloud SQL, hecha el 12-10.
- **Lo construido el 12-10:** `/api/batch` (una acción, una petición), la foto diaria versionada de
  la ficha, el asistente «Ask about this page» (`components/ScreenAssistant.tsx`), que ya avisa de
  que es una IA; el buscador por nombre con erratas; la app en inglés o en español y usable en el
  móvil; y la compuerta de grounding que también lee español (`c7779a6`).
- **La gestión activa:** `research/out/growth_series.json`, `informe_gestion_activa.json`,
  `lib/temporizacion.ts` y `lib/brinson.ts`. `/track-record` ya publica el Sharpe frente al S&P y la
  significación frente al S&P y al 60/40 (`app/track-record/page.tsx:62` y `:86`).
- **Cinco vídeos procesados el 03-09** (`PLAN_CUATRO_VIDEOS.md` y `PLAN_TRES_CAPAS.md`): de ahí
  salieron `vidaUtil.ts`, `recompras.ts`, `tipos.ts`, `flujoCaja.ts`, `research/soberano.mjs`,
  `research/tipos_reales.mjs` y `research/oro_respaldo.mjs`.
- **Ya existe, y lo repiten los vídeos nuevos:**
  - la liquidez de la Fed y la cuenta del Tesoro, dentro del régimen;
  - el diferencial de crédito con su tasa base (p = 0,146: no es señal);
  - la deuda y los intereses de EE. UU. (`soberano.mjs`), y los tipos reales y el oro;
  - las compras de directivos (`lib/form4.ts`, `lib/smartMoney.ts`) y los 13F (`lib/parse13f.ts`,
    `lib/mapaCusip.ts`);
  - Kelly (`lib/kelly.ts`) y la concentración del índice.
- **El lector de los informes de operaciones del Congreso ya está escrito:** `research/congreso_pdf.mjs`
  descifra y extrae el texto de los PTR de la Cámara sin dependencias, y
  `research/out/congreso_viabilidad.json` (04-09) documenta el índice oficial y el patrón de URL.
  Falta la ingesta (5.10).

### 3.2 Lo que sigue roto en `main`

| Qué | Dónde | Pieza |
|---|---|---|
| El DCF resta la deuda neta a un flujo que ya va después de intereses, descontado al coste del capital propio. En MCD el crecimiento implícito sale 7,2 % cuando el coherente es 2,4 % | `lib/reverseDcf.ts:91`, y una segunda implementación en `components/stock/StockValuation.tsx:43` y `:61` cuya deuda neta ignora las inversiones a corto (`:86`) | 1.5 |
| La señal viva de Picks no lee `InterestExpenseNonoperating`: `icov` falta en 215 de 371 empresas, y 15 empresas sin deuda quedan fuera | `research/edgar.mjs:828`; solo el laboratorio la lee (`research/ebit_reconstruccion.mjs:55`) | 1.3 |
| Las reglas de Picks no están en el repo: 4 comprobaciones de `cifras_publicadas` salen «NO EJECUTADAS» y la CI en verde | `scripts/cifras_publicadas.test.mjs:198` y `:218` | 1.1 |
| El asistente lee el diario (posiciones, P&L y tesis), lo manda a Anthropic y la auditoría guarda la respuesta con el `user_id` | `app/journal/page.tsx` no usa el atributo de exclusión que `lib/pantalla.ts:173` ya respeta | 1.2 |
| El optimizador calcula pesos sobre las posiciones abiertas y resalta el máximo Sharpe | `app/journal/page.tsx:267` | 1.2 |
| Exportación CSV de métricas de FMP y de los scores (redistribución según el contrato) | `app/stock/[ticker]/page.tsx`, `components/stock/StockScreener.tsx` | 1.2 |
| «Entry confirmed», «SHORT entry» y «CONFLICT» en un producto que solo va largo | `lib/technicalIndicators.ts:347-350` | 1.2 |
| `StockReport` publica el texto aunque no pase la compuerta, con un aviso | `components/stock/StockReport.tsx:117` y `:256` | 1.6 |
| El prompt de escenarios pide al modelo un «rough value» | `lib/aiGrounding.ts:180-182` | 1.6 |
| El squeeze no es el de LazyBear: regresión de 12 barras en vez de 20, canal de Keltner y ATR con EMA en vez de SMA, Bollinger a 2σ en vez de 1,5, y «liberado» con una banda fuera en vez de las dos | `lib/technicalIndicators.ts:91`, `:98`, `:104`, `:120` y `:123` | 2.2 |
| El veredicto técnico depende del botón de periodo, el ADX no se lee con ±DI y no existe el gatillo anticipado | `lib/technicalIndicators.ts:319-323`, `components/stock/StockChart.tsx:87` | 2.2 |
| La foto diaria recorta la historia a 252 sesiones: al reabrir la ficha el mismo día, «5Y» enseña un año, y el semanal y el mensual son imposibles | `app/stock/[ticker]/page.tsx:685-687` | 2.1 y 2.2 |
| Indicadores duplicados: una `emaOf` propia en el gráfico y copias en el servidor | `components/stock/StockChart.tsx:29`, `lib/server/technicals.js` | 2.2 |
| `ScoraBrief` y `MacroAI` generan un texto distinto por usuario sobre la misma `macro_state` | `components/macro/ScoraBrief.tsx:44`, `components/macro/MacroAI.tsx:263` | 2.3 |
| Las pestañas de la ficha no van en la URL | `app/stock/[ticker]/page.tsx` (sin `useSearchParams`) | 2.4 |
| No hay feedback en ninguna parte | — | 2.7 |
| El panel de research guarda solo cierres, sin máximo, mínimo ni volumen: ningún indicador técnico se puede medir | `research/prices.mjs`, `research/pricesLong.mjs` | 3.2 |
| `sl_picks_run` no guarda la huella de los datos ni las componentes por ticker | `sql/gcp/001_schema.sql:519` | 1.3 |
| `buildConsensus` está construido y probado, pero ningún componente lo usa | `lib/consensus.ts` | 5.4 |
| La fuente del Congreso da 403 desde el 04-09 | `app/stock/[ticker]/page.tsx` (`congressTrades: null`) | 5.10 |
| Los compuestos de los análogos históricos son estimaciones a mano | `lib/historicalAnalogs.ts` | 6.15 |
| El riesgo es solo mensual (`PERIODS = 12`): no hay EWMA ni VaR paramétrico | `lib/riskMetrics.ts:11` | 5.14 |

### 3.3 Producción y operaciones

- **Los crons viejos siguen vivos (comprobado el 13-10).**
  - En `alealvarado804-cmyk/scora-research` hay 12 workflows activos que escriben en Supabase.
  - El de Picks (`30 21 * * 1-5`) corrió la última vez a la vez en los dos repos: el 13-10 a las
    02:39 y a las 02:41 UTC.
  - El Vercel de `ic-proxy` sigue en producción con sus 8 crons, y el de `scora-research` se
    redespliega con cada commit de un bot (el último, el 04-10).
- **El cron de Picks del repo nuevo falló el 09-10 y el 10-10**, antes de activar C-5; el viejo no.
- **La recopia de Supabase tiene un riesgo que no está escrito en ninguna parte** (detalle en la
  tarea 0.2): resuelve los choques por la clave primaria, y desde el 12-10 las dos bases asignan los
  `id` cada una por su cuenta.
- **Dos workflows del repo nuevo hacen `git push` a `main` y fallan con GH006:**
  `scora-auditoria-simbolos`, cada hora, y `scora-monthly-factor-dist`, que falló el 04-10. La tanda
  de distribuciones del 04-10 solo existe en el repo viejo (`8cab498`).
- **D-11:** la sesión se rompe a la hora («14 data sources unavailable»). **D-10:** una sola clave de
  FMP para producción y pruebas, que se agotó el 12-10; cada análisis nuevo gasta unas 21 llamadas.
- **La CI está en rojo solo por la frescura de los backtests** (issue #2): cambió el S&P 500 y se
  reescribieron `cik_historicos.json`, `alias_ticker.json` y `simbolos_reutilizados.json`. El job de
  tests está en verde.
- **Hay 10 commits en `main` posteriores al último despliegue registrado** en `AUDIT_REPORT.md`
  (idiomas, móvil, asistente, buscador…).

### 3.4 Lo que condiciona el backtest

- **La Decisión B** (`DECISION_B_SELECCION.md`): la selección no aporta en el S&P 500 (IC ~0;
  Brinson, 96,1 % asignación y 3,9 % selección). Solo la reabren un universo menos eficiente, una
  señal con evidencia externa y datos nuevos, o un horizonte largo con reglas selladas.
- **344 ensayos gastados** y el Sharpe deflactado del asignador en el 81,1 %. El MDE del IC con 192
  meses es 0,044, y en un top-N el IC no sirve: cuenta el diferencial del top frente al universo
  equiponderado, replicado entre ventanas.
- **Precedentes:**
  - el momentum pierde 136 pp frente al SPY en 192 meses;
  - la regla de 180 días costó entre 63 y 74 pp (vendió NVDA tras un +220 %);
  - la rampa de entrada costó entre 32 y 96 pp.
- **Picks:** la ventaja de selección es de +30,1 pp en 2019-2026, tras el arreglo de cobertura, y de
  +1,3 pp en 2011-2018. El registro vivo es la única evidencia fuera de muestra, y es corto.
- **La medición del 11-07** (`research/multitimeframe_lab.mjs`):
  - solo el momentum 12-1 predice, y solo con correlación baja (IC +0,093);
  - el momentum a un mes revierte (IC −0,041);
  - la confluencia de temporalidades no añade nada.

### 3.5 Restricciones legales y de licencia

- **Asesoramiento** (guía de ESMA de 2023): hechos sobre la watchlist, sí. El rating sobre las
  posiciones del usuario, un chat que ve su diario o unos pesos «óptimos» sobre sus posiciones, no.
  Los descargos no salvan (§65 y §74).
- **MAR, art. 20:** un veredicto técnico con niveles, o un informe con precio objetivo, pueden ser
  «recomendación de inversión». Es pregunta para el abogado.
- **Licencias:**
  - FMP y Finnhub prohíben transmitir y crear **derivados** sin permiso, y los scores lo son;
  - el email y el CSV necesitan acuerdo;
  - Yahoo no da licencia comercial de su API no oficial;
  - las series de ICE BofA en FRED son de terceros.
- **Ley de IA, art. 50(1)**, aplicable desde el 02-08-2026: toda interacción con una IA lo dice.
- **Material de terceros:** las notas de Hermès y el factsheet de BlackRock no se reproducen ni se
  versionan.

---

## Fase 0 · Desbloqueo (personas, configuración y decisiones)

Sin código. Ninguna PR de la fase 1 espera a estas tareas, pero varias funciones sí.

| # | Qué | Quién | Por qué ahora |
|---|---|---|---|
| **0.1** | **Parar los crons de los repos viejos:** desactivar los 12 workflows de `alealvarado804-cmyk/scora-research` (`gh workflow disable`, reversible), quitar los 8 crons del Vercel `ic-proxy` y pausar el Vercel `scora-research` | Alejandro (Claude lo hace con su visto bueno) | Escriben en Supabase cada día laborable y gastan cuota de FMP si comparten clave. El de Picks decide en paralelo |
| **0.2** | **La recopia, sin lanzarla a ciegas** (detalle debajo) | Jorge | Integridad del registro vivo de Picks |
| **0.3** | **D-11:** permitir `securetoken.googleapis.com` en la clave web `scora-web` | Jorge | Sin esto ninguna prueba con sesión es fiable |
| **0.4** | **D-10:** una clave de FMP aparte para las pruebas, o subir de plan | Jorge + Alejandro | La cuota se agotó el 12-10 con las pruebas |
| **0.5** | **Los bots y la protección de `main`:** que `scora-auditoria-simbolos` y `scora-monthly-factor-dist` abran una PR, tengan un bot exento o escriban en Cloud SQL o en GCS. Y recuperar la tanda de distribuciones del 04-10 (`8cab498`, solo en el repo viejo) | Jorge | Sus artefactos nunca llegan |
| **0.6** | **D-2:** las claves que faltan, que son Stripe, Resend, Groq y Gemini (VAPID ya está desde el 12-10) | Jorge | Sin Resend no salen los correos de alertas |
| **0.7** | **Aplicar el rol `scora_app`** (`sql/gcp/003_rol_app.sql`, ya probado) | Jorge | La app conecta como `postgres`, y `policy.ts` es la única barrera |
| **0.8** | Registrar en `AUDIT_REPORT.md` el despliegue de los 10 commits posteriores a `scora-00007-2wc` | Jorge | Saber qué corre en producción |
| **0.9** | **D-9:** el dominio definitivo. El código ya lo lee de `lib/sitio.ts` | Alejandro + Jorge | Canónicas, sitemap y la vuelta de Stripe |
| **0.10** | **El abogado:** las siete preguntas de `INVESTIGACION_LEGAL_GOOGLE_FINANCE.md` §6, las de §9 de `SCORA_PICKS_REGLAS.md`, el art. 20 del MAR (lectura técnica con niveles e informes con precio objetivo), los perfiles de cartera y la idoneidad, la entidad y el Merchant of Record | Alejandro | Es el único bloqueante del lanzamiento |
| **0.11** | **La licencia de FMP y Finnhub:** los canales (web, PWA, push, email y CSV), los datos derivados, qué se conserva al terminar, si son diferidos o en tiempo real, y la atribución | Alejandro | Bloquea el email, el CSV, la ficha pública y todo lo derivado |
| **0.12** | Contrastar con las fuentes oficiales las cifras de mercado de los posts aportados (el 10 años al 5,24 % y al 5,347 %, el S&P +595 % desde 2009, las de Deutsche Bank y las de Ritsch) **antes de usar ninguna en un texto** | Claude, sin PR | Ninguna está verificada |

**La tarea 0.2, al detalle.** `infra/migrar-produccion.sh --sin-pisar` vuelve a copiar lo que
Supabase recibió después del 12-10. No conviene lanzarla sin más, por tres hechos comprobados:

1. **Desde el 12-10, los dos sistemas escriben las mismas tablas en paralelo**, y cada base asigna sus
   `id` por su cuenta. El mismo número puede ser dos filas distintas.
2. **La copia resuelve los choques por la clave primaria:** `on conflict (id) do nothing`
   (`scripts/migrar_supabase.mjs:128`). En las tablas con `id` generado (`sl_picks_run`,
   `sl_picks_position`, `sl_cohort`, `sl_paper_fund`, `sl_track_summary` y `kb_*`), una fila del
   sistema viejo cuyo `id` esté libre en Cloud SQL **entra**, aunque describa lo mismo que otra fila
   con otro `id`.
3. **El efecto depende de la tabla:**
   - en `sl_track_summary`, que no tiene clave natural, se duplican filas;
   - en `sl_picks_position` pueden mezclarse las posiciones de dos decisiones distintas;
   - si la fila choca con una clave natural (`decision_date` y `rules_version`, o una posición
     abierta del mismo ticker), la copia entera falla.

**Lo que se propone:**
- parar primero los crons viejos (0.1);
- comparar por **clave natural** (las fechas) qué falta de verdad en Cloud SQL, y copiar solo eso;
- **no tocar las tablas de Picks** sin una decisión expresa de Alejandro y Jorge;
- verificar que existe la fila de cada fecha de decisión desde C-5. **Las fechas que falten no se
  rellenan:** sellar tarde con la fecha original sería fabricar una decisión.

---

## Fase 1 · Lo roto y el riesgo vivo

Seis PRs pequeñas, en este orden. Arreglan lo que está mal publicado, mal calculado o expuesto en
producción.

### 1.1 `docs/reglas-picks-al-repo` · las reglas de Picks y la medición multitemporal, al repo

- **`SCORA_PICKS_REGLAS.md`** (el documento preregistrado de Picks, en su versión del 04-09) va a
  `apps/SCORA_PICKS_REGLAS.md`, que es donde lo busca `scripts/cifras_publicadas.test.mjs:198`. Hoy
  solo está en el repo padre viejo, que no entró en la fusión.
- **`SCORA_MULTITIMEFRAME_ANALISIS_2026_07_11.md`** es la medición que justifica `lib/timeframes.ts`
  y el diseño del ensayo 346 (§3.4). El código dice «medido» y la medición no está en el repo.
- Si se puede, se regenera el artefacto de `research/multitimeframe_lab.mjs` en `research/out/`.

**Hecho:** las 4 comprobaciones pasan de «NO EJECUTADAS» a ejecutadas, y sabotear una cifra del
documento las rompe. **Decide Jorge:** la ubicación; por defecto, la que espera el test.

### 1.2 `fix/higiene-legal-prebeta` · reducir la exposición antes de la beta

Es reversible y no espera al abogado.

- **(a) El asistente, fuera del diario**, y de toda vista con posiciones, P&L o datos personales
  (`/journal`; revisar `/audit` y `/account`). Basta el atributo `data-sr-asistente` en la raíz de esas
  páginas, o no montar `ScreenAssistant` en esas rutas. Es el riesgo legal más claro de lo desplegado:
  ESMA §69-73 y §84, y una EIPD por los criterios 4 y 10 de la AEPD.
- **(b) El optimizador:** el usuario escribe los tickers, que ya no se rellenan desde el diario, y
  desaparece el resaltado del máximo Sharpe (ESMA §41 y §46).
- **(c) Las exportaciones CSV** de la ficha y del screener: desactivadas, o solo con la lista de
  tickers, hasta que la licencia cubra ese canal.
- **(d) Ley de IA, art. 50(1):** el asistente ya avisa («Sends this page's content to the AI…»). Se
  comprueba que toda salida de IA lo diga.
- **(e) El lenguaje técnico** (`lib/technicalIndicators.ts:347-350` y su traducción): fuera «Entry
  confirmed», «SHORT entry», «CONFLICT» y el stop y el objetivo presentados como consejo. Dentro,
  «N de 4 condiciones del método» y el mapa de niveles, descriptivo.

**Hecho:**
- un test de texto con una lista negra de frases, que incluye también las del borrador de Trading
  Latino: «Compra confirmada», «Señal de salida», «Bajista: no se compra» y «Scora + timing»;
- un test de que, en `/journal`, la captura del asistente sale vacía o el botón no existe;
- `i18n.test`.

**Decide Alejandro:** es una decisión de producto con consecuencias legales.

### 1.3 `fix/datos-picks-taxonomia` · la señal viva vuelve a ser la medida

Medido el 22-09 sobre la decisión real del 15-09:
1. **`research/edgar.mjs:828` añade `InterestExpenseNonoperating`.** Desde la taxonomía de 2023-2024
   muchas empresas usan esa etiqueta. Recupera `icov` en unas 200 de las 215 empresas que lo
   perdieron.
2. **La regla estricta de «realmente sin deuda»**, que ya rechaza TXT, DASH, MNST, F, GM y AAPL. Con
   deuda cero, `icov` toma su tope y `lev` sale solo. Vuelven las de las 15 excluidas que la cumplan
   (ALGN, INCY, ISRG, VEEV, DECK, GRMN, WSM, ANET, FFIV, PLTR, TPL, RDDT, TTD, EXPD y CPRT).
3. **La amortización pasa a ser `Depreciation` + `AmortizationOfIntangibleAssets`.**

Con las tres, vuelven 23 de las 81 no financieras excluidas. Unas 45 siguen fuera por no tener
`OperatingIncomeLoss`: la vía antes de impuestos ya se rechazó y no se reabre.

**Además:**
- **Trazabilidad:** columnas `datos_version` y `data_huella` en `sl_picks_run`, y las 5 componentes
  por ticker. Hoy `signal` guarda solo el percentil agregado, y no se puede reconstruir por qué entró
  o salió un nombre.
- **Evidencia:** los scripts de diagnóstico de `diag_taxonomia_2026-09/` (15 ficheros, hoy sin
  rastrear en el repo viejo) entran en `research/`.
- **Una sola regeneración de las dos ventanas juntas** (`research/picks_rules_backtest.mjs
  --rebuild`). Cierra el issue #2 y devuelve la CI a verde. Las cifras de antes y de después se
  publican (la ventaja de +30,1 pp se moverá) y `cifras_publicadas` se actualiza.

**Hecho:**
- `picks.test`, `cifras_publicadas` y los guardianes, en verde;
- la comparación entre corridas, en la PR;
- quitar la etiqueta nueva hace saltar al guardián de la 1.4.

**Deciden Alejandro y Jorge:** `datos_version` (recomendado, porque las reglas no cambian) frente a
subir `PICKS_RULES_VERSION`. **Jorge:** la migración.

### 1.4 `feat/guardian-cobertura-metricas` · que no vuelva a pasar en silencio

El hueco de `icov` no hizo fallar nada: el artefacto guarda solo el percentil agregado, y el dato pasó
a `null` sin que nadie lo viera.
- La cobertura **por métrica** en el artefacto del panel.
- Un test que falla si alguna métrica cae más de 10 pp frente a la corrida anterior.
- La paridad de las listas de etiquetas entre el laboratorio y producción.
- El mismo contrato para cualquier capa nueva de las fases 6 y 7.

**Hecho:** quitar `InterestExpenseNonoperating` de la lista rompe el test, y desalinear las dos
listas también.

### 1.5 `fix/dcf-coherente` · el DCF deja de contar la deuda dos veces

**El fallo:**
- el flujo que se descuenta (flujo operativo más capex) va **después de intereses** en US GAAP;
- la tasa (`rf + β·ERP`) es el coste del capital propio, no un WACC;
- y encima se resta la deuda neta.

En MCD el crecimiento implícito sale 7,2 % cuando es 2,4 %. La diferencia es de unos 5 pp con
cualquier tasa, y puede cambiar la `realityBand`.

**El arreglo:**
- **Opción 1 (recomendada):** flujo al accionista coherente. No se resta la deuda neta, solo se suma
  la caja sobrante, y la interfaz dice «coste del capital propio». **Opción 2:** flujo a la empresa
  con `waccBridge` (`lib/valuation.ts`). **Decide Jorge.**
- **Una sola implementación:** `StockValuation.tsx` deja su `runDCFModel` y usa `lib/reverseDcf.ts`.
  El DCF inverso, `StockValuation`, `ValuationLab` (`dcfMatrix`) y `researchReport` dan lo mismo con
  las mismas entradas.
- **La caja incluye las inversiones a corto.** En AAPL se quedaban fuera 22.855 M$.
- **El método se versiona** en `sl_analyses.reverse_dcf`, para que el historial no mezcle fórmulas.

**Hecho:** golden con MCD (el crecimiento implícito baja), AAPL (caja neta) y un banco (sigue
excluido); volver a restar la deuda rompe el caso de MCD. **Desbloquea** la fase 4 entera.

### 1.6 `fix/ia-honesta` · los defectos de la IA

1. **Una sección que no pasa la compuerta no se publica:** cae a su versión determinista y dice por
   qué, como ya hace `narrativaLLM.ts`. Hoy `StockReport` la publica con un aviso.
2. **Fuera el «rough value»** de los escenarios (`lib/aiGrounding.ts:180-182`). Los valores los
   calcula el código (4.2).
3. **La compuerta comprueba contra el bloque de hechos**, no contra el prompt entero. Las citas del
   10-K se comprueban aparte, como texto literal.
4. **El veredicto se pasa al modelo como hecho.** `buildStockThesis` y `buildResearchReport` dejan de
   emitir el suyo, que podía contradecir a `Verdict.tsx`.
5. **El idioma:** `grounding.ts` ya lee español (`c7779a6`). Se comprueba, ruta por ruta, que cada
   salida pasa la compuerta del idioma en que sale.

**Hecho:** tres sabotajes (una cifra inventada, «deberías comprar» y «cayó por los aranceles»), y en
los tres el texto no se publica. El red team del grounding, en verde.

---

## Fase 2 · Arquitectura y cimientos

Lo que desbloquea las funciones de las fases 3 a 5.

### 2.1 `feat/capa-barras` · barras de precio con historia larga (dueño: Jorge)

Es la pieza nueva que más desbloquea: el semanal y el mensual del motor técnico, el registro
sellado, el panel de research, el ensayo 346, la EWMA y varias capas macro cuelgan de ella.
- **`lib/server/bars.js`** sirve barras diarias **ajustadas** (apertura, máximo, mínimo, cierre y
  volumen, ajustados los cinco, no solo el cierre), con 15 a 20 años de historia, de una fuente
  **con licencia para mostrar**.
- **Caché en una tabla nueva, `price_bars`:** `cik`, símbolo, fecha, OHLCV, factor de ajuste, fuente y
  fecha de descarga, con su entrada en `policy.ts` y en el rol.
- **Nunca cachea un error.** La auditoría encontró errores de FMP guardados 24 horas.
- **`lib/barras.ts`, compartido** por el navegador, el cron y research: el remuestreo a semanal
  (semana ISO) y a mensual del borrador de Trading Latino, con la vela en curso marcada como parcial.
- **Guardas:**
  - el máximo, por encima de la apertura y del cierre, y el mínimo, por debajo;
  - volumen no negativo;
  - ningún salto imposible sin evento corporativo (Yahoo trata una escisión como un split);
  - y los huecos de fechas, declarados.
- **FMP con `from=` como respaldo**, contando las llamadas. `lib/server/providers/fmp.js:112` ya
  reenvía los parámetros.
- **Arregla de raíz la foto de 252 sesiones:** el gráfico lee de aquí, nunca de la foto diaria.

**Hecho:**
- splits reales (AAPL 2020, 4:1; NVDA 2024, 10:1) y una escisión;
- el sabotaje del factor de ajuste;
- un error no se cachea;
- la integridad sobre las 503;
- los tests de remuestreo del borrador.

**Deciden Jorge y Alejandro:** el proveedor (Tiingo, el plan de FMP u otro) y el presupuesto. Yahoo
no sirve como fuente principal: no tiene licencia comercial.

### 2.2 `fix/motor-tecnico-unico` · Trading Latino fiel a los vídeos, en un solo módulo

Parte del borrador archivado de la sesión `a83d1ada`: `lib/tradingLatino.ts`, con 65 tests y 3
sabotajes, que con los parámetros por defecto da exactamente lo mismo que `main`. Estos son los
cambios:
- **Un solo módulo.** `technicalIndicators.ts` y el motor son la única fuente: el gráfico deja su
  `emaOf`, y `lib/server/technicals.js` importa de la librería (con la extensión en los imports de
  valor).
- **El squeeze de LazyBear como preset** (`SQUEEZE_LAZYBEAR`). El cálculo por defecto queda intacto
  para que los golden actuales no se muevan.
- **La regla del ADX con ±DI.** Con DI+ arriba, el ADX subiendo favorece el largo. Con DI− arriba, lo
  favorece el ADX **bajando**, porque la caída pierde fuerza.
- **Dos gatillos con nombre:**
  - el **anticipado:** el valle rojo empieza a girar al alza;
  - el **confirmado:** valle verde, con el squeeze liberado y el ADX por encima de 23 y subiendo.
- **El estado de entrada tardía:** el valle verde ya desarrollado o el precio muy extendido.
- **El veredicto, con ventana fija:** 252 sesiones en diario, 104 en semanal y 120 en mensual. El
  perfil de la ventana visible se sigue pintando, pero no decide.
- **Divergencias fechadas al confirmarse:** el pivote más 5 barras.
- **El mapa de niveles como dato:** POC, zona de valor, EMA 55, máximos y mínimos, y el recorrido
  hasta la próxima resistencia en múltiplos del riesgo. Nunca «pon el stop aquí».
- **Una sola voz para el momento de entrada.** El panel del método y la lectura diaria de
  `lib/timeframes.ts` (que es de reversión, y está medida) se muestran juntos. Si discrepan, la ficha
  dice «señales mixtas» y por qué. `timeframes.ts` no se toca: mueve el rating.
- **El rango real:** si la historia no llega al rango pedido, el botón lo dice («5Y (1,0 años)»),
  hasta que llegue la 2.1.
- **Los textos, en `lib/i18n`**, con el lenguaje de la 1.2.

**Hecho:**
- los 65 tests del borrador, adaptados, más los casos sintéticos de las cuatro combinaciones de DI y
  pendiente, y la «V» del ADX en el cruce;
- **invariancia:** el mismo veredicto en 1M, 3M, 6M, 1Y y 5Y;
- **sin mirar al futuro:** una divergencia no existe antes de confirmarse;
- **golden contra TradingView:** Alejandro lee, con la configuración de los vídeos, 3 tickers en las 3
  temporalidades en una fecha fija (el squeeze, el ADX, +DI, −DI y las EMA de 10 y 55), y se fijan con
  tolerancia;
- **sabotajes:** contar la divergencia desde el pivote, el perfil mirando al futuro, el ADX sin DI y
  quitar el preset de LazyBear;
- el test de «señales mixtas» y el de la lista negra de la 1.2.

**Depende de** la 1.2. El diario funciona ya; el semanal y el mensual necesitan la 2.1.

### 2.3 `feat/ia-compartida` · la IA como dato compartido

`ScoraBrief` y `MacroAI` se generan **una vez** por versión del prompt, hash de los datos e idioma,
en el servidor; se guardan en una tabla y los leen todos.
- Ahorra coste desde el primer día, da coherencia y refuerza el encuadre impersonal: el mismo texto
  para todos.
- La fila de auditoría guarda también los textos de las violaciones de la compuerta, que es lo que
  quedó abierto de A-4.

**Hecho:** dos usuarios ven el mismo texto; cambiar un valor de `macro_state` genera uno nuevo; quitar
el hash de la clave rompe el test.

### 2.4 `feat/ficha-url-y-tiempo` · las pestañas en la URL y el tiempo como dato

- Las pestañas de la ficha van en la URL (`?tab=`): se pueden enlazar, el botón de atrás funciona y se
  puede medir su uso.
- Cada dato dice **de dónde sale** tras los respaldos (FMP, Yahoo, EDGAR o Finnhub) y **de cuándo
  es:** hora, zona y sesión.

### 2.5 `chore/regla-cik` · la empresa no es su ticker

Toda tabla nueva por empresa lleva `cik` **desde ya**. Un guardián recorre `sql/gcp/` y falla si una
migración nueva crea una tabla con `ticker` y sin `cik`. La migración de las tablas viejas va después
de la beta (9.10). Cierra de raíz los símbolos reutilizados, el CIK predecesor y el doble conteo de
clases de acciones.

### 2.6 `feat/presupuesto-llamadas` · medir antes de construir

- Un contador de llamadas a FMP por día y por análisis, visible en el log.
- **Medir el «backend por ficha»**, que ya existe como `/api/batch` y la foto diaria versionada:
  cuántas llamadas hace una ficha nueva y cuántas una repetida.
- **El coste por pregunta del asistente** (`lib/costeIA.ts`), para decidir `ASSISTANT_MODEL` (hoy,
  `claude-opus-5`).

### 2.7 `feat/feedback` · el bucle de calidad de la beta

👍/👎 en cada salida de IA, **también en el asistente**, y «este dato está mal» en cada tarjeta. Se
guarda en una tabla `sl_feedback`, con revisión semanal.

### 2.8 Revocación inmediata de la sesión (D-3; dueño: Jorge)

El Admin SDK de Firebase comprueba la revocación en las rutas de IA y de Stripe. Hoy una sesión
revocada sigue valiendo hasta una hora.

---

## Fase 3 · Stock picking y backtest: sellar, medir y un ensayo cada vez

### 3.1 `feat/registro-tecnico-picks` · el estado técnico de cada decisión, sellado

En cada decisión real de Picks, para cada compra, se guarda el estado técnico en mensual, semanal y
diario: las cuatro condiciones, los dos gatillos, la alineación, la versión del motor y un hash de
`TL_PARAMS`.
- Se calcula **después** de escribir la decisión y no puede bloquearla.
- Una fila sellada no se reescribe.
- **La medida:** a los 12 y a los 24 meses, `research/tl_forward.mjs` compara las compras con estado
  favorable y desfavorable. El horizonte, el MDE y el criterio se declaran antes de mirar. Con unas 4
  compras al mes la potencia será baja durante años, y se dice desde el principio.
- **No gasta ensayo:** es la vía de las reglas selladas por adelantado de la Decisión B, y el dato no
  se puede fabricar después.

**Hecho:**
- la decisión se escribe aunque el cálculo técnico falle (sabotaje: forzar una excepción);
- `decide()` da lo mismo con el registro y sin él;
- una fila sellada no se puede reescribir.

**Depende de** la 2.2, y de la 2.1 para el semanal y el mensual. **Va cuanto antes:** cada decisión
que pasa sin sellar es evidencia que no se recupera. **Jorge:** la migración.

### 3.2 `research/panel-ohlcv` · el panel de research con máximos, mínimos y volumen

El panel consume la capa de barras (2.1), para que el laboratorio y producción no vuelvan a divergir.
**Hecho:** la huella de datos coincide en las dos ventanas, y el ajuste cubre también la apertura, el
máximo y el mínimo.

### 3.3 `docs/pagina-picks` · lo que Picks puede y no puede decir

- **El texto de `/picks`:** «funciona desde X, N cohortes, demasiado corto para concluir». Nunca
  «bate al índice» ni «selecciona». Las cifras, como banda (±2-5 pp).
- **El riesgo total con dos referencias** (el 60/40 y el SPY), como ya hace `/track-record`, si
  `/picks` no lo tiene.
- **`universe_asof` visible:** la foto gratuita del índice dejó de actualizarse el 23-08-2025.

### 3.4 `research/precheck-345` → `research/ensayo-345` · compras oportunistas de directivos

**Es el único candidato que cumple un criterio para reabrir la selección.** Tiene evidencia externa
(Lakonishok y Lee, 2001; Cohen, Malloy y Pomorski, 2012, que separan a los directivos «rutinarios»
de los «oportunistas») y usa datos nuevos de dominio público: los ficheros Form 3, 4 y 5 de la SEC,
desde 2006.
1. **Comprobación previa, sin gastar el ensayo:**
   - la cobertura sobre el panel;
   - la correlación con las señales ya auditadas: si es momentum disfrazado, no se gasta;
   - el MDE con los meses disponibles. La literatura concentra el efecto en empresas pequeñas, y en
     el S&P 500 podría ser indetectable: entonces se dice y no se gasta.
2. **Preregistro** (`PREREGISTRO_ENSAYO_345.md`): la definición de oportunista, la ventana, la regla
   de cartera y el criterio de éxito.
3. **Una sola corrida**, con las tres referencias, el Sharpe deflactado con el M actualizado y el
   resultado publicado.

**Depende de** la 1.3 y la 1.4.

### 3.5 `research/tests-opciones` · las afirmaciones falsables de los vídeos, con datos gratis

| Afirmación | Prueba | Datos |
|---|---|---|
| «VIX en mínimos y vencimiento → caída del 8-10 %» (Opla) | Caída máxima en los 20 días siguientes a cada vencimiento con el VIX en su quintil bajo, frente al resto de vencimientos y a fechas al azar. A nivel de episodio, con permutación y semilla fija | `VIXCLS` y SPY |
| «Las manos fuertes venden volatilidad: el MOVE frente al VIX» (Cava) | El MOVE es de ICE y está licenciado. Se sustituye por la volatilidad realizada del bono a 10 años (`DGS10` diario) frente al VIX | FRED |
| «Manos fuertes» como exposición gamma de los creadores de mercado | **Solo si existe un histórico gratuito con licencia**, y como predictor de volatilidad, no de dirección | — |
| «19 de 20 elecciones de mitad de mandato acabaron al alza» (Cava) | La tasa base con n = 20, publicada como lo que es | El S&P desde 1946 |

Cada prueba suma uno al libro de ensayos y se publica en `/evidence`, salga lo que salga.

### 3.6 `research/precheck-346` → `research/ensayo-346` · Trading Latino como momento de entrada

**La pregunta:** entre las compras de Picks, ¿esperar al **gatillo anticipado** mejora frente a
comprar el día de la decisión?
1. **Comprobación previa, sin gastar ensayo y sin mirar retornos:** en qué porcentaje aparece el
   gatillo dentro de las 10 sesiones, el retraso medio y el MDE. Si casi nunca aparece, o casi siempre
   aparece el día 0, el ensayo no puede distinguir nada y no se gasta.
2. **Preregistro:**
   - en semanal, la EMA de 10 por encima de la de 55;
   - en diario, las cuatro condiciones, con el valle rojo girando al alza en las 2 últimas barras y el
     ADX a favor según las DI;
   - todos los parámetros del borrador, fijados;
   - una espera máxima de 10 sesiones: si no hay gatillo, se compra igual el día 10, y así no cambia la
     selección;
   - las salidas, las de Picks, ninguna técnica;
   - el dinero que espera, en caja (modelo A) y en el índice (modelo C).
3. **Criterio de éxito:** una mejora mayor que la banda en las dos ventanas y en los dos modelos. Lo
   demás es «no se distingue».

**Por qué un solo gatillo:** «confirmado o 3 de 4» son dos hipótesis. El anticipado es el que
defienden los propios vídeos (la confirmación llega tarde) y el que encaja con la reversión a un mes
(Jegadeesh, 1990; Lehmann, 1990).

**La expectativa a priori es baja:** es de la familia del momentum. Si falla, Trading Latino se queda
como herramienta visual (5.1). Si pasara, no entra en Picks sin una decisión de Alejandro y una
versión nueva de las reglas. **Depende de** la 3.2, y va después del 345.

### 3.7 `research/precheck-proveedores-taiwan` · leer a los proveedores antes que a la marca

Las empresas cotizadas en Taiwán publican sus **ingresos mensuales** en los 10 días siguientes al
cierre de cada mes. Es un dato estructurado, con fecha y que no depende de ningún modelo de lenguaje;
por ejemplo, Hon Hai o TSMC para Apple y Nvidia. Y es **dato nuevo**, que es lo que piden las cuatro
hipótesis ya medidas.
- **Comprobación previa, sin ensayo:** cuántas empresas del S&P 500 tienen proveedores cotizados en
  Taiwán con una relación documentada; si el histórico existe con la fecha de publicación de cada
  cifra; y la licencia.
- **Si pasa:** una capa explicativa en la ficha, el «pulso de proveedores» (6.17).
- **Como señal**, solo una prueba hacia delante y preregistrada, contra una referencia ingenua y
  después del 345. Para distinguir un 65 % de aciertos de un 50 % hacen falta unas 67 predicciones;
  unas 150 si es un 60 %.
- **Lo que no se hace:** reconstruir trimestres pasados con un modelo de lenguaje, porque el modelo
  puede conocer el resultado.

### 3.8 `docs/delimitacion-mas-datos` · el único camino con base teórica

Un universo menos eficiente (empresas pequeñas y medianas, o Europa) es el criterio 1 de la Decisión
B. Está bloqueado por los precios de las empresas que dejaron de cotizar. La pieza es un documento que
delimite las fuentes, el sesgo de supervivencia y el coste. **Deciden Alejandro y Jorge:** el
presupuesto.

---

## Fase 4 · Valoración por escenarios: un solo motor

Tres documentos pedían escenarios por separado (Everything Money, Escuela FEF y la tesis). Hacerlos por
separado daría tres motores que acabarían contradiciéndose. Se construye uno. **Depende de** la 1.5.

| # | Rama | Qué | Hecho |
|---|---|---|---|
| **4.1** | `feat/libro-de-hechos` | Un único libro del que sale cada cifra (`lib/tesis/hechos.ts`) y un **auditor de coherencia** (`lib/tesis/coherencia.ts`) con diez reglas. **Bloquean:** la deuda contada dos veces; g igual o mayor que r; probabilidades que no suman 100 %. **Avisan:** activos y deuda con distinto perímetro o fecha (el caso de Acciona, con la cota en €/acción); g por encima de ~4 %; el valor terminal por encima del 75 % del total; una convención de descuento que no casa (Gordon con mitad de año a N − 0,5, múltiplo de salida a N); un múltiplo implícito fuera del rango del sector; acciones diluidas frente a básicas, o varias clases sumadas; la caja con o sin inversiones a corto; y los pesos del WACC sobre la deuda bruta y su puente con la neta | Un sabotaje por regla; Acciona dispara la regla de perímetro con una cota de 4,08 €; el DCF de CFI no dispara la de convención |
| **4.2** | `feat/escenarios` | Tres escenarios calculados por código (reutilizan `reverseDcf.ts`), cada uno con su valor por acción y la **TIR implícita al precio de hoy**; la rentabilidad exigida por el usuario como entrada; la lectura de **margen de seguridad** (si el precio queda por debajo incluso del escenario bajista); una rejilla de tasa × crecimiento × múltiplo; el **DCF inverso por método** (qué crecimiento, margen, tasa o flujo libre descuenta el precio); una fila de **choque de tipos** (de +25 a +100 pb); y una alerta al precio que hace rendir el escenario, sobre `price_below` | Nike reproduce el analizador de Everything Money con un error del 1-3 %; la rejilla coincide con un cálculo independiente; el múltiplo terminal pasa de 16,67× a 14,81× con +75 pb; despejar cada método devuelve el precio actual |
| **4.3** | `feat/escenarios-probabilidad` | Una probabilidad por escenario (por defecto 25/50/25, marcada «ilustrativa»), el precio y el retorno esperados, la asimetría y el **punto de equilibrio** de un supuesto clave | Acciona: 26,125 € y +14,9 %; el equilibrio de la eólica, en 0,765 M€/MW |
| **4.4** | `feat/expectativas` | El crecimiento que exige el precio frente al que la empresa **logró**, con una serie anual de al menos 6 puntos y las etiquetas de ingresos cosidas por fecha. Sustituye los umbrales fijos del DCF inverso (`reverseDcf.ts:189-190`: hasta un 12 %, «achievable»; hasta un 25 %, «ambitious»). Da un **falsador fundamental con número** en `verdict.ts`, que hoy solo tiene falsadores técnicos y macro, y una columna «Real (N años)» en la valoración | Cuatro tickers revisados a ojo contra su 10-K: uno de crecimiento, uno maduro, un banco y uno con flujo libre negativo |
| **4.5** | `feat/historico-junto-al-supuesto` | Junto a cada supuesto, sus valores de 1, 3, 5 y 10 años; hoy se siembran con un solo año. La ventana de 10 años espera a la serie larga de EDGAR | Contra el 10-K de dos empresas |
| **4.6** | `feat/catalizadores` | Catalizadores con fecha: los automáticos (resultados y dividendos) y los del usuario, con marcas en el gráfico | Las fechas, contra la fuente; los del usuario, aislados por `user_id` |
| **4.7** | `feat/suma-de-partes` | Los segmentos (ingresos XBRL de `lib/segmentos.ts` por un múltiplo, o una métrica por un valor unitario) y el puente del valor de empresa al de las acciones con fechas explícitas, que alimenta la regla de perímetro. Solo hay datos automáticos de las empresas que presentan en la SEC | Acciona reproducido (13.620 → 9.220 → 28,00 €) y la sensibilidad de la eólica, en 2,855 € por cada 0,10 M€/MW |
| **4.8** | `feat/seis-pasos` | La ficha en modo principiante, ordenada por los seis pasos; la pestaña de diligencia visible; negocio frente a precio; y el modo a ciegas (analizar sin ver el nombre) | e2e de los dos modos |

---

## Fase 5 · La ficha, el gráfico y la watchlist

| # | Rama | Qué | Depende de | Hecho |
|---|---|---|---|---|
| **5.1** | `feat/grafico-multitemporal` | Velas; diario, semanal y mensual, con los indicadores calculados sobre toda la historia; el panel de arriba abajo (filas mensual, semanal y diaria; columnas tendencia, fuerza, momento, volumen y divergencias; y el recuento de alineación); el mapa de niveles; los horizontes de los vídeos, marcados «regla de los vídeos, no medida»; detrás de un interruptor | 2.1 y 2.2 | El reagrupado con festivos y con la vela parcial; los indicadores semanales, iguales al cálculo a mano sobre velas semanales; e2e; `i18n.test`. **Decide Jorge:** Recharts propio o `lightweight-charts` (verificar antes su atribución) |
| **5.2** | `feat/alerta-tecnica-watchlist` | Un tipo `tl_alineacion` en el cron de alertas, solo sobre la **watchlist** y por push. El correo espera a la licencia | 2.2 | Un cambio de estado dispara y un estado igual no; aislamiento por usuario |
| **5.3** | `feat/calendario-resultados` | «Esta semana publican 3 de tus 12», con la hora (antes de la apertura o tras el cierre). Y, para los últimos 8-12 informes, la mediana del movimiento, el máximo y la parte propia de la empresa | — | Tres eventos fijados a mano, uno antes de la apertura y otro tras el cierre; los precios, ajustados por splits |
| **5.4** | `feat/consenso-calibrado` | Conectar `buildConsensus` junto a la tabla de objetivos, con la línea de calibración: solo el 38 % de los precios objetivo se cumple a los 12 meses, y el 64 % en algún momento del año (Bradshaw, Brown y Huang, 2013). El objetivo nunca se presenta como previsión | — | La versión por ticker espera al historial de FMP (9.9) |
| **5.5** | `feat/momentos-inusuales` | Los días con un residuo propio extremo (la rentabilidad menos β por el mercado y menos el exceso del sector, con un valor absoluto de z de al menos 3 frente a las 60 sesiones anteriores), y lo que **coincidió** ese día: resultados, Form 4 o titulares. Nunca «por» | 2.1, para algunas marcas | Un día de resultados conocido sale marcado; desplazar las fechas rompe el test; la beta no mira al futuro |
| **5.6** | `feat/acciones-relacionadas` | «Se mueve con…», por correlación de un año y por sector | — | Contra el cálculo a mano |
| **5.7** | `feat/ensena-la-cuenta` | Cada métrica enseña su fórmula, las variables con las que salió, su fuente y su fecha, y un «¿qué significa?» que lleva a `/evidence` o a la metodología | 2.4 | Comparada con la cifra que se muestra en el mismo render |
| **5.8** | `feat/lista-por-defecto` | Un usuario nuevo ve los 11 ETF sectoriales, **nunca los Picks**, que serían una recomendación | — | e2e sin sesión previa |
| **5.9** | `feat/importar-csv` | Importar la cartera del CSV del bróker (IBKR, Schwab, Fidelity, Degiro y Trading 212) al diario, con vista previa, confirmación, un lote con identificador y la opción de deshacer. Trampas: la coma decimal, el coste total frente al precio, los símbolos (`BRK.B` y `BRK-B`), las filas que no son acciones, que `null` no es 0, y la divisa: `sl_journal` no tiene columna, y se decide añadirla o limitarse al USD | 1.2 (a) | Tres CSV de brókers distintos y un sabotaje del separador decimal |
| **5.10** | `feat/congreso-camara` | Devolver las operaciones del Congreso con la **fuente oficial**: el índice anual de la Cámara (`{AAAA}FD.zip`), los PTR en PDF y `research/congreso_pdf.mjs`, que ya los lee. Son unas 515 declaraciones al año. Se usa la fecha de presentación, nunca la de la operación. Los PTR escaneados salen como «sin texto», sin OCR. El Senado, después: está detrás de una página de aceptación | — | Un PTR real como fixture; sabotear el mapa de glifos rompe el test. **Como señal** sería un ensayo aparte |
| **5.11** | `feat/visor-13f` | Buscar un fondo por nombre o por CIK: posiciones, cambios frente al trimestre anterior, calls y puts, concentración y sectores, con el aviso del retraso de 45 días. Sin «copiar este fondo» | — | `parse13f.test`, ampliado con un 13F real que tenga opciones |
| **5.12** | `feat/montecarlo-metas` | Un laboratorio de metas: lognormal, con la fórmula cerrada al lado, y remuestreo por bloques de la historia real, para tener colas gruesas y riesgo de secuencia. Un planificador con aportes, retiros, inflación y costes. Sin conexión con el diario | — | El caso publicado (meta ×5,4 en 27 años, μ del 6,8 % y σ del 7,0 %) da un 53,7 % de éxito ± el error de muestreo, una mediana de ×5,58 y una media que supera al 56,8 % de los escenarios; con 100.000 trayectorias converge a la fórmula cerrada; semilla fija |
| **5.13** | `feat/payoff-patas` | Un constructor pata a pata sobre `analyzeStrategy` (`lib/greeks.ts`), las 6 estrategias que faltan hasta 14, la zona esperada (si cae en un tramo plano o cruza un breakeven) y el coste neto **con** el subyacente. La volatilidad realizada se declara como aproximación, como en `OptionsLab` | — | Los payoffs de las 14 estrategias; la protective put de ejemplo (breakeven en 102 y pérdida máxima de −12) |
| **5.14** | `feat/riesgo-ewma` | EWMA (λ = 0,94) sobre series diarias y VaR paramétrico junto al histórico, en Risk Model, con la fórmula enseñada | 2.1 | La EWMA, contra el cálculo a mano en 5 días; el paramétrico, contra μ + zσ |
| **5.15** | `feat/listas-con-nombre` | Varias listas con nombre; hoy `sl_watchlist` es una sola | — | Aislamiento por usuario |
| **5.16** | `feat/tema-claro` | Tema claro, oscuro y del dispositivo. Prioridad baja | — | Los colores, revisados en los dos temas |

---

## Fase 6 · Capas explicativas: caja, balance y macro

**El mismo criterio que `soberano.mjs`:** hechos con fuente y fecha, nunca pronósticos, y cero
entradas al score y al asignador. Cada capa mide su cobertura sobre las 503 **antes** de construirse,
con el listón de §2.2, y cada serie se comprueba contra su API, con la unidad en el nombre de la
caché. **Depende de** la 1.4 (el contrato de cobertura), y la 6.2, también de la 1.3.

| # | Rama | Qué | Datos |
|---|---|---|---|
| **6.1** | `feat/muro-vencimientos` | La deuda que vence en 1, 2 y 3 años frente a la caja más el flujo libre, y el salto de coste: el cupón medio frente al rendimiento BBB de hoy | XBRL (`LongTermDebtMaturitiesRepaymentsOfPrincipal…`) |
| **6.2** | `feat/bandera-zombi` | Cobertura de intereses por debajo de 1 tres ejercicios seguidos (la definición del BIS) | XBRL; necesita la 1.3 |
| **6.3** | `feat/crecer-con-deuda` | El crecimiento financiado con deuda (sumando la de corto plazo), en `flujoCaja.ts` | XBRL |
| **6.4** | `feat/calidad-del-beneficio` | El peso del resultado no operativo y de las plusvalías no realizadas. Golden: Amazon y su participación en Anthropic. Antes, comprobar si la conversión a caja ya lo caza | XBRL |
| **6.5** | `feat/tesis-datos` | La tabla de crisis (2020 y 2022; 2008, «sin dato»), los agregados de sector del propio universo, el ROIC por la reinversión, y la remuneración frente a la rentabilidad (*Pay vs Performance*, con la cobertura primero) | XBRL |
| **6.6** | `feat/soberano-r-menos-g` | r − g por país (EE. UU., Francia, Italia, España, Alemania, Japón y Reino Unido), los diferenciales frente al Bund y la factura de intereses que se pone al día: el tipo medio efectivo frente al de mercado | FRED (la licencia, serie a serie) y FiscalData |
| **6.7** | `feat/quien-financia-al-tesoro` | El peso de las letras en la deuda negociable, las tenencias extranjeras (TIC) y las reservas. Con el matiz: pagar con letras o con bonos mueve las reservas igual; lo que se parece a un QE es que el mercado absorbe menos duración | FiscalData, TIC y `WRESBAL` |
| **6.8** | `feat/valoracion-indice-tipo-real` | El rendimiento de beneficios del S&P 500 menos el tipo **real** a 10 años (`DFII10`), con su percentil. No la versión «PER = 1 / bono» de los vídeos: es el modelo de la Fed, que compara algo real con algo nominal (Asness, 2003) | El agregado XBRL propio; la historia larga, solo si la licencia de la serie de Shiller lo permite |
| **6.9** | `feat/credito-no-bancario` | Los préstamos de la banca a instituciones financieras no bancarias (H.8). Contexto, no señal. Antes: el identificador, la historia y los cambios de definición | FRED |
| **6.10** | `feat/semaforo-regimen` | El régimen como semáforo **con la tasa base de cada color:** la rentabilidad y la caída a 3, 6 y 12 meses, y el número de episodios independientes. Dice cuántas veces se equivocó cada color | El régimen propio |
| **6.11** | `feat/correlacion-accion-bono` | La correlación móvil a 12 y 36 meses del SPY frente a IEF y TLT, con sus episodios (2022, positiva) | 2.1 |
| **6.12** | `feat/choque-de-tipos` | Qué hacen +X pb en el 10 años al múltiplo terminal y a la prima de riesgo implícita del índice, con la cuenta enseñada | FRED |
| **6.13** | `feat/caida-real-desde-maximos` | Los activos, rebasados a 1 al inicio de cada década y deflactados por el IPC (`lib/deflacion.ts`): SPY, QQQ, semiconductores, GLD y los sectores. «Las burbujas se ven a posteriori: no es una señal» | 2.1 y FRED |
| **6.14** | `feat/divergencia-mercados` | La variación del 10 años, la distancia del S&P a su máximo, el diferencial de crédito (con la cautela de ICE: solo desde 2023-07) y el Brent al contado, con los episodios de 2011, 2018, 2020 y 2022 | FRED |
| **6.15** | `fix/analogos-medidos` | Recalcular los compuestos de `lib/historicalAnalogs.ts` con FRED donde haya serie (`STLFSI4` sostiene el estrés), o marcarlos «ilustrativos» en la interfaz | FRED |
| **6.16** | `feat/curva-letras-fed` | Lo que descuenta el mercado sobre la Fed, leído en la curva de letras frente al tipo oficial. Es la alternativa limpia a los mercados de predicción | `DTB3`, `DGS1MO`, `DGS3MO` y `DGS6MO` |
| **6.17** | `feat/pulso-proveedores` | Los ingresos mensuales de los proveedores cotizados en Taiwán de cada empresa, con fecha y fuente. **Solo si pasa la 3.7** | MOPS (la licencia, por verificar) |

**Opcionales, tras las anteriores:** el poder de fijación de precios (el margen bruto durante el
choque de costes de 2021-2023) y el deflactor en horas de trabajo (`AHETPI`).

---

## Fase 7 · Tesis automáticas y su enganche con Picks

**La regla que no se toca:** la tesis explica, no decide. Nada vuelve a `decide()`. **Depende de** las
fases 4 y 6. Publicar las tesis de Picks espera al abogado; **sellarlas, no**.

| # | Rama | Qué | Hecho |
|---|---|---|---|
| **7.1** | `feat/tesis-servidor` | La generación en el servidor, la tabla `sl_tesis` y la pestaña *Thesis*, que agrupa *Report* y *Diligence* | Leer una tesis no gasta cuota; regenerarla, sí |
| **7.2** | `feat/falsadores-vivos` | Falsadores con umbral, comprobación periódica y aviso, en un solo camino del cron con la alerta `expectativa_rota` (el ejercicio nuevo crece por debajo de lo que exigía el precio) | Un falsador forzado dispara un aviso real en preproducción |
| **7.3** | `feat/picks-tesis-sellada` | `thesis_id` en cada posición de Picks: sellada al comprar, revisada en cada fecha y con autopsia al vender. Se genera después de escribir la decisión y no puede bloquearla | La decisión se escribe aunque la tesis falle, y la tesis no cambia ninguna decisión |
| **7.4** | `feat/calibracion-tesis` | Cuántas veces se cumplió el escenario bajista, el base y el alcista, y si los falsadores precedieron a las pérdidas | El horizonte y el MDE, declarados antes de mirar |
| **7.5** | `feat/informe-completo` | El informe completo, en diez secciones (el modelo es un análisis de Acciona Energía aportado como ejemplo): escenarios, qué es la empresa, el periodo bien leído, tesis y catalizadores, suma de partes, riesgos, lectura técnica, síntesis de asimetría y valor esperado. La IA redacta; los números salen del motor de la fase 4, y la lectura técnica, de la 2.2 | El red team (cifra inventada, «deberías comprar» y causa inventada), y ninguna cifra del texto fuera del libro de hechos. **Publicarlo con precio objetivo espera al abogado** (MAR) |

**Antes de la 7.1, decide Alejandro:**
- el idioma de las tesis;
- una pestaña que agrupe o una más;
- el acceso, Pro o para todos;
- el universo: solo los valores que han estado en Picks (más barato y coherente con la calibración) o
  todos.

---

## Fase 8 · Beta cerrada

**Requisitos:**
- las fases 1 y 2 desplegadas, y lo esencial de las 4 y 5;
- los textos legales mínimos revisados por el abogado, o una decisión explícita de Alejandro de hacer
  una beta privada con borradores.

**Con quién:** de 10 a 30 usuarios.

| Métrica | Para qué decisión |
|---|---|
| Activación: el % de usuarios con 5 o más valores o con una cartera importada en la primera sesión | ¿Funciona la entrada? |
| La vuelta a los 7 y a los 30 días | ¿Funciona el motivo para volver? |
| El coste de IA por usuario activo y mes | El precio |
| Las llamadas a FMP por usuario activo y día | El plan de FMP |
| El feedback por categoría, y el tiempo hasta arreglar un dato erróneo | La calidad |
| Las pestañas y las páginas más usadas (gracias a la 2.4) | Qué priorizar |

**Cadencia:** un triaje semanal de Alejandro → PRs `fix/beta-*` → Jorge despliega una vez a la
semana. **Sale cuando** se puede decidir el precio y el lanzamiento con cifras.

---

## Fase 9 · Lo que espera a la licencia o al abogado

| # | Qué | Espera a |
|---|---|---|
| **9.1** | El brief de la **watchlist**: hechos, fechas, movimientos y operaciones de directivos, sin el rating de Scora. Primero en la app y por push; el email, con la licencia | El abogado (pregunta 2) y la licencia |
| **9.2** | El diario de decisiones: la tesis del usuario, sus 3-5 indicadores, su probabilidad y su escenario guardado, con la **calibración del propio usuario** (golden: Intel 2021, que acertó el precio y falló los cuatro supuestos). Kelly toma la probabilidad que escribe el usuario | El abogado (pregunta 3) |
| **9.3** | Importar la cartera desde una captura o un PDF: el modelo solo lee, cada fila la confirma el usuario, la imagen no se guarda y no pasa por el registro de auditoría con contenido | La EIPD y el abogado |
| **9.4** | Preguntas a la ficha (solo el ticker, solo hechos calculados y nunca la cartera) y alertas en lenguaje natural que el usuario confirma | El abogado |
| **9.5** | La ficha pública renderizada en el servidor (SEO; refuerza el encuadre impersonal) | La licencia |
| **9.6** | El CSV de vuelta y el brief por email | La licencia |
| **9.7** | Publicar las tesis de Picks, y lo que dice su página | El abogado |
| **9.8** | Perfiles de cartera en `AllWeatherAllocator` (la estructura de un factsheet, sin volcar asignaciones de terceros) | El abogado (idoneidad) |
| **9.9** | La calibración del precio objetivo por ticker | La licencia y el historial de FMP |
| **9.10** | La migración de las tablas viejas a un emisor (`cik`) con 1-N cotizaciones | Después de la beta |

---

## 4 · Lo que no se construye, y por qué

| Idea | Motivo |
|---|---|
| Flujo de opciones (OPRA), barridos, gamma como producto o como dirección | Caro y con la premisa sin respaldo (decidido el 17-08). Lo comprobable va en la 3.5 |
| Mercados de predicción (Kalshi, Polymarket) | Cuatro bloqueos legales independientes. La alternativa es la 6.16 |
| Patrones técnicos o Trading Latino como señal del score o de `decide()` | Son momentum: −136 pp frente al SPY. Solo por la vía del ensayo 3.6 |
| Salidas técnicas en Picks | La regla de 180 días costó entre 63 y 74 pp |
| La entrada corta; stops y objetivos como consejo | Scora solo va largo, y es lenguaje de recomendación. Sí, el mapa de niveles descriptivo |
| Temporalidades de 4h, 1h o 15 minutos | Datos intradía con otra licencia; es la parte de futuros de los vídeos |
| Barrer parámetros | Cada variante suma al libro de ensayos: los umbrales se fijan una vez |
| Una tercera lectura multitemporal, aparte de `timeframes.ts` y de la 2.2 | Dos voces ya son demasiadas |
| Diversificación internacional en el asignador | Medida: el Sharpe cae de 0,99 a 0,73 |
| Sentimiento por portadas o por analistas; calendario electoral o Jackson Hole como regla | Sin datos históricos, o con n mínimo. Solo la tasa base de la 3.5 |
| Un fondo soberano que provoca una caída, las élites, la «manipulación» | No es falsable |
| Puntuar la inflación de **tu** cartera; un chat sobre **tu** diario; Monte Carlo o payoff sobre la cartera del diario | Asesoramiento personal |
| Apalancamiento, también en una cartera barbell | Decisión firme del 03-09 |
| Selector de región; personalización por historial | La cobertura es de grandes compañías de EE. UU., y personalizar rompe el encuadre impersonal |
| Los 8 pilares y su ROIC | Umbrales sin medir; el ROIC cuenta el patrimonio dos veces |
| El «Outlook» agregado y el ranking de analistas | Sin horizonte ni calibración; licencia de TipRanks; una tasa de acierto sin índice mide la beta |
| El peso óptimo de media-varianza como señal | Inestable frente a los retornos esperados |
| La curva de futuros del Brent; la deuda de margen de FINRA | Sin fuente gratuita fiable; licencia sin verificar |
| «Copiar este fondo» en el visor de 13F | Recomendación implícita |
| Volcar asignaciones de terceros (el factsheet de BlackRock) | No se pueden reproducir |
| Calculadoras de vivienda o inmobiliarias | Otro producto y otros datos |
| Reabrir la cuantización, `icov` como sesgo, las cuatro hipótesis o la vía antes de impuestos | Ya medidos: hacen falta datos, no variantes |
| El veto forense; el «Momentum Suite» | Medidos: no aportan |
| Reconstruir con un modelo de lenguaje predicciones de trimestres pasados | El modelo puede conocer el resultado: solo hacia delante (3.7) |
| Leer prensa asiática con agentes en producción | Unos 17 subagentes por publicación de resultados, y las noticias tienen derechos |
| Deep Search y la llamada de resultados en directo | No se persiguen: licencias |
| Versionar las notas de Hermès | Material protegido |

---

## 5 · Decisiones pendientes, y de quién

| Quién | Decisión | Bloquea |
|---|---|---|
| **Jorge** | Opción 1 o 2 del DCF | 1.5 |
| **Jorge** | La ubicación de `SCORA_PICKS_REGLAS.md` | 1.1 |
| **Jorge** | Cómo salvan los bots la protección de `main` | 0.5 |
| **Jorge** | Recharts propio o `lightweight-charts` | 5.1 |
| **Jorge** | El calendario de despliegues; D-3, D-11 y aplicar el rol | 0.3, 0.7 y 2.8 |
| **Jorge + Alejandro** | El proveedor de barras con licencia, y su presupuesto | 2.1, y todo lo que cuelga de ella |
| **Jorge + Alejandro** | Qué se recopia de Supabase y qué no, y las tablas de Picks | 0.2 |
| **Alejandro + Jorge** | `datos_version` frente a una versión nueva de las reglas | 1.3 |
| **Alejandro + Jorge** | El presupuesto de FMP (D-10) y el de datos sin sesgo de supervivencia | 0.4 y 3.8 |
| **Alejandro** | Parar los crons viejos | 0.1 |
| **Alejandro** | La higiene legal previa a la beta | 1.2 |
| **Alejandro** | Leer en TradingView los valores del golden de la 2.2 | 2.2 |
| **Alejandro** | Si Picks se mantiene, y por qué (Decisión B) | Fase 3 |
| **Alejandro** | El idioma, las pestañas, el acceso y el universo de las tesis | 7.1 |
| **Alejandro** | Beta con borradores legales, o esperar al abogado | Fase 8 |
| **Abogado** | Las siete preguntas de la investigación legal; las de §9 de las reglas de Picks; el art. 20 del MAR (lectura técnica e informes con precio objetivo); los perfiles y la idoneidad; la entidad y el Merchant of Record | Fase 9 y el lanzamiento |

---

## 6 · Orden y dependencias

```
Fase 0   personas y configuración, en paralelo. Lo primero, 0.1: el cron de Picks corre cada día laborable.
Fase 1   1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6
Fase 2   2.2 tras 1.2 · 2.1 tras decidir el proveedor · 2.3 a 2.8 en paralelo
Fase 3   3.1 tras 2.2, cuanto antes · 3.2 tras 2.1 · 3.4 tras 1.3 y 1.4 · 3.6 tras 3.2 y 3.4
         3.3, 3.5, 3.7 y 3.8 en paralelo
Fase 4   tras 1.5: 4.1 → 4.2 → 4.3; de 4.4 a 4.8, tras 4.1
Fase 5   tras 1.2; 5.1 y 5.2 tras 2.1 y 2.2; 5.5 y 5.14 tras 2.1; el resto sin dependencias
Fase 6   tras 1.4; 6.2 tras 1.3; 6.11 y 6.13 tras 2.1; 6.17 solo si pasa 3.7
Fase 7   tras las fases 4 y 6
Fase 8   con las fases 1 y 2 desplegadas y lo esencial de las 4 y 5
Fase 9   con la licencia o el abogado
```

**Por qué en este orden:**
- **La 0.1 es lo más urgente:** dos crons de Picks escribiendo en dos sitios pueden ensuciar el
  registro vivo.
- **La 1.1 va primera** porque es la más pequeña y devuelve a la CI cuatro comprobaciones sobre las
  reglas que la 1.3 va a tocar.
- **La 1.2 va segunda** porque es riesgo vivo en producción.
- **La 1.3 va antes que el DCF** porque devuelve la CI a verde (una CI en rojo esconde otras
  regresiones), con una sola regeneración.
- **La 2.2 va tras la 1.2** porque reescribe los textos que la 1.2 prohíbe.
- **La 3.1 va cuanto antes:** lo que no se sella en su fecha no se puede sellar después.
- **La 2.1 es la pieza nueva que más desbloquea**, pero espera a la decisión del proveedor.
- **Los ensayos van al final de su cadena y de uno en uno:** el 345 antes que el 346, que tiene menos
  probabilidad a priori.

---

## 7 · Qué cambia respecto al PR #3 y sus anexos

Verificado el 13-10 en `6e3b7fb`:

| En el PR #3 | Lo correcto | Consecuencia |
|---|---|---|
| 0.e: «desplegar las rondas 2 y 3» | Ya están desplegadas: todas son anteriores a `scora-00007-2wc` | Fuera |
| §3.7, D-7: los 27 errores | Hecho y desplegado (`b4227c3`) | Fuera |
| 1.3: la auditoría de la IA en el servidor | Hecho (`6b69191`). Queda guardar los textos de las violaciones | Dentro de la 2.3 |
| 7.3: el rol `scora_app` | Preparado y probado (`4981119`); solo falta aplicarlo | Tarea 0.7 |
| 7.4: M-6, M-8 y M-5 | M-6 y M-8, hechos (`4774969` y `7719f09`); M-5, cerrado sin cambio y con su razón | Fuera |
| 7.1: «backend por ficha» | Ya existe: `/api/batch` y la foto diaria versionada | Pasa a medirse (2.6) |
| §1.2: el Congreso «existe» | La fuente da 403 desde el 04-09; pero el lector de los PTR oficiales **ya está escrito** (`research/congreso_pdf.mjs`) | La 5.10: la ingesta |
| 0.b: recopiar lo que Supabase recibió tras el 12-10 | Resuelve los choques por `id`, y desde el 12-10 las dos bases asignan los `id` por su cuenta | 0.2: comparar por clave natural y no tocar Picks sin decisión |
| 0.4: higiene legal | Le faltaban el asistente que lee el diario y el lenguaje técnico | 1.2 (a) y (e) |
| 1.1: la compuerta en el idioma de salida | `grounding.ts` ya lee español (`c7779a6`) | Se comprueba ruta por ruta (1.6) |
| 1.4: feedback | También en el asistente | 2.7 |
| 0.g, D-2 | VAPID ya está desde el 12-10 | Quedan Stripe, Resend, Groq y Gemini (0.6) |
| 8.4: el ensayo 346 con «confirmado o 3 de 4» | Son dos hipótesis | Un solo gatillo, el anticipado, con una comprobación previa (3.6) |
| Trading Latino, solo como ensayo de prioridad baja | Se pidió también para el gráfico, en mensual, semanal y diario | 2.1, 2.2, 3.1, 5.1 y 5.2 |
| El riesgo total con dos referencias (borrador de `7a6dfd82`) | `/track-record` ya lo publica | Solo falta `/picks` (3.3) |
| El orden de las primeras PRs | La higiene legal es riesgo vivo, y de las más pequeñas | Pasa al segundo puesto |

**Lo nuevo que añade este plan al PR #3:**
- las piezas de las 19 aportaciones de la sesión `64dd764b`: escenarios con probabilidad,
  catalizadores, suma de partes, el auditor con diez reglas, los laboratorios de Monte Carlo, payoff
  y EWMA, el visor de 13F y cinco capas macro;
- la línea completa de Trading Latino como producto: el motor fiel, las barras, el gráfico, la alerta
  y el registro sellado;
- la beta cerrada con sus métricas;
- la ingesta del Congreso;
- las condiciones de la recopia de Supabase;
- y la comprobación previa de los proveedores de Taiwán.

**Qué hacer con el PR #3:** cerrarlo cuando este se fusione, con un comentario que apunte aquí. No
conviene tener dos planes abiertos.

---

## Apéndice A · Correspondencia de identificadores

| Antes | Ahora |
|---|---|
| PR #3: 0.a / 0.b / 0.c / 0.d | 0.1 / 0.2 / 0.3 / 0.4 |
| PR #3: 0.e | Hecho (desplegado) |
| PR #3: 0.f / 0.g / 0.h | 0.5 / 0.6 / 0.10 |
| PR #3: 0.1 / 0.2 / 0.3 / 0.4 / 0.5 | 1.5 / 1.3 / 1.4 / 1.2 / 1.1 |
| PR #3: D-7 | Hecho |
| PR #3: 1.1 / 1.2 / 1.3 / 1.4 / 1.5 / 1.6 | 1.6 / 2.3 / hecho, y el resto en la 2.3 / 2.7 / 2.4 / 5.7 |
| PR #3: 2.1 / 2.2 / 2.3 / 2.4 / 2.5 | 4.1 / 4.2 / 4.4 / 4.5 / 4.8 |
| PR #3: de 3.1 a 3.5 | De 6.1 a 6.5 |
| PR #3: de 4.1 a 4.5 | De 6.6 a 6.10 |
| PR #3: 5.1 / 5.2 / 5.3 / 5.4 / 5.5 / 5.6 / 5.7 / 5.8 | 5.9 / 5.3 / 5.4 / 5.8 / 9.1 / 5.5 / 9.2 / 5.6 |
| PR #3: de 6.1 a 6.4 | De 7.1 a 7.4 |
| PR #3: 7.1 / 7.2 / 7.3 / 7.4 / 7.5 / 7.6 | 2.6 / 2.5 y 9.10 / 0.7 / hecho / 2.8 / 2.6 |
| PR #3: 8.1 / 8.2 / 8.3 / 8.4 / 8.5 | 3.2 / 3.4 / 3.5 / 3.6 / 3.8 |
| Anexo de `64dd764b`: 0.i | 0.12 |
| Anexo de `64dd764b`: 1.7 | 2.2 |
| Anexo de `64dd764b`: 2.6 / 2.7 / 2.8 | 4.3 / 4.6 / 4.7 |
| Anexo de `64dd764b`: 4.6 / 4.7 / 4.8 / 4.9 / 4.10 | 6.11 / 6.12 / 6.13 / 6.14 / 6.15 |
| Anexo de `64dd764b`: 5.9 / 5.10 / 5.11 / 5.12 / 5.13 / 5.14 | 5.1 / 5.2 / 5.12 / 5.13 / 5.14 / 5.11 |
| Anexo de `64dd764b`: 6.x (el informe tipo Acciona) | 7.5 |
| Anexo de `64dd764b`: 7.7 / 8.6 | 2.1 / 3.1 |
| Correcciones de `7a6dfd82`: 1 / 2 / 3 / 4 / 5 | 1.2 (a) / 1.2 (e) / 2.6 / 5.10 / 2.7 |
| Borrador de `7a6dfd82`: Q3 / Q4 / Q6 / I6 / S2 / S3 y S4 / P7 / B11 / beta / F22 / H2 | 1.3 / 1.4 / 2.4 / 2.3 / 0.2 / 3.3 / 2.6 / 3.8 / fase 8 / 5.16 / 5.15 |
| Cambios de `a83d1ada` | Dentro de la 1.1, la 1.2, la 2.1, la 2.2, la 3.1, la 3.6 y la 5.1 |
| Sesión `e68c8a21` (este documento) | La verificación de §3, las condiciones de la 0.2, la 0.8, la 3.7, la 5.10 y la 6.17 |

## Apéndice B · Fuentes

**Los planes e informes que unifica.** Los informes de sesión están en el disco de Alejandro, fuera
del repo:
- `PLAN_MEJORAS_OCT_2026.md`, la PR #3 (sesión `cde7bbc0`), y su informe
  `SESION_2026-10-13_VIDEOS_EXTRACCIONES_Y_PLAN.md`: 27 vídeos, siete documentos de extracción y
  `AUDIT_REPORT.md`;
- `SESION_2026-10-13_APORTACIONES_TRADING_LATINO_Y_PLAN.md` (sesión `64dd764b`): 19 aportaciones
  (un DCF al estilo de CFI, un DCF inverso, Monte Carlo, payoff de opciones, las fórmulas del FRM, un
  análisis de Acciona Energía y varias lecturas macro) y Trading Latino;
- `SESION_2026-10-13_a83d1ada_TRADING_LATINO_MOTOR_Y_PLAN.md` (sesión `a83d1ada`) y su borrador
  archivado del motor (`lib/tradingLatino.ts`, con 65 tests);
- `SESION_7a6dfd82_GOOGLE_FINANCE_LEGAL_Y_PLAN.md` (sesión `7a6dfd82`): Google Finance, la
  investigación legal y las cinco correcciones al PR #3;
- la sesión `e68c8a21`, que escribe este documento: la verificación del código, de producción y de
  los repos viejos, y el análisis de la lectura de proveedores asiáticos.

**Los documentos de extracción locales**, sin versionar: `ESCUELA_FEF_EXTRACCION_SCORA.md`,
`EVERYTHING_MONEY_EXTRACCION_SCORA.md`, `GOOGLE_FINANCE_EXTRACCION_SCORA.md`,
`GOOGLE_FINANCE_ARQUITECTURA_SCORA.md`, `INVESTIGACION_LEGAL_GOOGLE_FINANCE.md` y
`PLAN_TESIS_INVERSION_SCORA.md`. Las notas de Hermès no se versionan ni se resumen.

**En el repo:** `AUDIT_REPORT.md`, `DECISION_B_SELECCION.md`, `PLAN_CUATRO_VIDEOS.md`,
`PLAN_TRES_CAPAS.md`, `PREREGISTRO_ENSAYO_343.md` y `PREREGISTRO_ENSAYO_344.md`.

**Literatura y normas:**
- Asness (2003), sobre el «modelo de la Fed»;
- Bradshaw, Brown y Huang (2013), sobre el cumplimiento de los precios objetivo;
- Cohen, Malloy y Pomorski (2012), y Lakonishok y Lee (2001), sobre las compras de directivos;
- Jegadeesh (1990) y Lehmann (1990), sobre la reversión a corto plazo;
- la guía de ESMA sobre la definición de asesoramiento (ESMA35-43-3861, 2023);
- el Reglamento de Abuso de Mercado, art. 20, y el Reglamento Delegado 2016/958;
- la Ley de IA, art. 50.
