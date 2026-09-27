# Auditoría front ↔ back y gobernanza del dato — 27 de septiembre de 2026

> Sustituye al informe del 26-09-2026 (recuperable con `git show 524fc02:AUDIT_REPORT.md`).
> Auditado: `main` en `165e697` (*fix(infra): el build no pasaba la configuración de
> Identity Platform*). Todo lo que se afirma aquí sale de código leído, de comandos
> ejecutados o de pruebas contra una base Postgres local creada con
> `sql/gcp/001_schema.sql` + `002_user_id_texto.sql`. Lo que no se pudo probar está marcado
> **NO VERIFICADO** con el motivo.

## Resumen ejecutivo

La migración de Supabase a Google Cloud está **a medias**, y hay cosas rotas que las pruebas
no ven:

1. **Toda la IA y todo el cobro rechazan a cualquier usuario (503).** El modo `strict` de la
   autenticación todavía intenta llamar a Supabase y, como ya no puede, deniega siempre.
   Probado firmando un token válido. (C-1)
2. **Los datos se escriben en un sitio y se leen de otro.** Nueve workflows de GitHub
   (score, picks, paper fund, discovery, breadth, filings, revisions…) siguen escribiendo en
   **Supabase**; la app lee de **Cloud SQL**, que se creó vacía. Y `/daily` y `/picks` hacen
   lo contrario: leen de Supabase con unas variables que el build ya no recibe. En producción
   `/daily` dice «No close published yet» aunque su cron escriba en Cloud SQL. (C-2, C-5)
3. **Todas las columnas `date` cambiaron de formato** al pasar de PostgREST a `node-pg`, y en
   un servidor fuera de UTC salen **un día antes**. (C-3)
4. **La suite está en rojo en `main`** y CI lleva hoy 5 de 5 ejecuciones fallidas. (C-4)
5. **Producción no es `main`** y su configuración no coincide con el Terraform: faltan en el
   servicio las claves de Anthropic, Stripe, Upstash, Resend y VAPID, y `GCP_PROJECT_ID`
   está puesta a mano. Un `terraform apply` hoy tumbaría el login. (A-1, A-2)

Lo que **sí está bien**, verificado: la capa `/api/data` + `policy.ts` que sustituye a la RLS
(denegar por defecto, dueño inyectado desde el token, identificadores contra lista blanca,
valores parametrizados); la lista blanca de proveedores (las 29 rutas que usa el front están
permitidas y la clave de API no se puede sustituir); los 8 crons exigen `CRON_SECRET` con
comparación en tiempo constante; el webhook de Stripe verifica firma; y no hay secretos en los
ficheros versionados (`tfstate` y `tfvars` están ignorados).

---

## Fase 1 · Inventario del front

**Transporte.** El navegador no toca ninguna base de datos. Usa cuatro vías:

| vía | fichero | qué hace |
|---|---|---|
| `authedFetch` | `lib/proxy.ts` | GET a `/api/*` con el token de Identity Platform; agrupa en `/api/batch` las de proveedores (FMP, Finnhub, EDGAR, SimFin, Finviz, short-interest, congress) |
| `datos.from(...)` | `lib/dataQuery.ts` + `lib/dataClient.ts` | imita el cliente de Supabase y manda lotes de hasta 20 consultas a `POST /api/data` |
| `aiAnalyzeAudited` | `lib/proxy.ts` | `POST /api/anthropic/messages` (o `/api/llm`), pasa el filtro de grounding en el cliente y escribe `ai_audit_log` desde el navegador |
| `fetch` directo | `app/pricing`, `/demo`, `/track-record`, `PaperFund` | `/api/stripe/*`, `/api/ai/limits`, `/api/waitlist`, `/api/publico` |

**Pantallas → datos** (60 consultas a tabla, 29 rutas de proveedor distintas, 8 llamadas a IA):

| pantalla / componente | proveedor (`/api/…`) | tablas | IA |
|---|---|---|---|
| `/stock/[ticker]` | 25 rutas FMP/Finnhub/EDGAR/SimFin/Finviz/short-interest/congress | `macro_state`, `sl_watchlist`, `stock_snapshot`, `sl_analyses`, `sl_score_log` | — |
| `StockResearch`, `StockThesis`, `StockReport`, `StockNews`, `EarningsTone`, `DueDiligence` | finnhub (noticias, transcripciones) | — | 7 |
| `StockScreener` | fmp quote/profile/ratios/metrics/growth, finnhub metric | `sl_analyses`, `sl_watchlist` | — |
| `StockOverview`, `latestAnalyses` | — | `sl_analyses`, `sl_analyses_latest` | — |
| `AlertConfig` | — | `sl_alerts` (CRUD) | — |
| `StockSmartMoney` | — | `smart_money_top_buyers` | — |
| `/macro` + `MacroOverview`, `MacroBrief`, `MacroPortfolio` | — | `macro_state`, `macro_state_history`, `sl_briefings`, `sl_analyses`, `sl_watchlist` | — |
| `MacroAI` | — | `sl_alert_prefs`, `ic_briefs`, `alerts_log` | 1 |
| `ScoraBrief` | — | — | 1 |
| `MacroMarkets`, `MetalsCockpit`, `SectorRotation`, `SignalBacktest`, `VarianceRiskPremium`, `AllWeatherAllocator` | fmp quote / EOD, finnhub quote, `/api/cot` | — | — |
| `CurvaTipos`, `lib/factorData` | `/api/fred/series` | — | — |
| `MacroNews` | finnhub company-news | — | — |
| `PaperFund`, `/demo`, `/track-record` | `/api/publico` (sin sesión) | — | — |
| `/discovery` | — | `sl_discovery`, `macro_state` | — |
| `/momentum` | — | `macro_state` | — |
| `/journal` + `ExposureAudit`, `FactorExposure`, `PortfolioOptimizer` | fmp quote/profile/EOD | `sl_journal` (CRUD) | — |
| `/watchlist`, `/stock`, `Nav` | fmp quote/search, finnhub metric | `sl_watchlist` | — |
| `/audit` | — | `ai_audit_log` | — |
| `/pricing` | `/api/stripe/{config,checkout,portal}`, `/api/ai/limits`, `/api/waitlist` | — | — |
| `/daily`, `/picks` (servidor) | ⚠️ `fetch` a `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1` | `sl_daily_close`, `sl_picks_*` | — |
| `lib/knowledge.ts` | — | `kb_cards`, `kb_docs`, rpc `search_kb_chunks` | — |
| `lib/entitlements.ts`, `lib/push.ts` | — | `sl_subscriptions`, `push_subscriptions` | — |

**Estados de carga, vacío y error.** De las 60 consultas a tabla, **27 ignoran `error`**: si
la consulta falla, la pantalla pinta lo mismo que si no hubiera filas, o el guardado no ocurre
sin avisar (lista en M-3). Las de proveedor lanzan excepción (`authedFetch` tira en cualquier
respuesta que no sea 2xx) y cada componente la recoge.

**Estático / placeholder.** Las cifras del backtest (`lib/trackRecord.ts`) son estáticas **a
propósito** y documentadas como tal. No se encontraron mocks ni TODO en caminos de datos vivos.

## Fase 2 · Inventario del back

**28 rutas** en `app/api`. Autenticación verificada leyendo cada una:

| ruta | auth | validación de entrada | lee / escribe |
|---|---|---|---|
| `POST /api/data` | `requireUser` | lista blanca de tabla, operación y columna (`policy.ts` + esquema real); valores parametrizados; ≤ 20 consultas, ≤ 500 filas, `LIMIT` ≤ 5000 | 24 tablas de `POLICY` + rpc `search_kb_chunks` |
| `GET /api/publico` | ninguna (límite por IP) | sin parámetros; consultas fijas | `sl_track_summary`, `sl_cohort`, `sl_paper_fund(_track)`, `macro_state` (16 columnas) |
| `/api/fmp/*`, `/api/finnhub/*`, `/api/edgar`, `/api/simfin`, `/api/finviz/quote`, `/api/short-interest`, `/api/congress/[ticker]`, `/api/cot`, `/api/fred/series` | `requireUser` | lista blanca de ruta, segmentos seguros, `symbol ^[A-Z.\-]{1,15}$` | terceros (caché Redis) |
| `POST /api/batch` | `requireUser` | ≤ 40 sub-peticiones, cada una por el mismo `serve()` | terceros |
| `POST /api/anthropic/messages` | `requireUser` **strict** | modelo en lista blanca, `max_tokens` 1-4096, ≤ 50 KB — **pero reenvía el cuerpo entero** | Anthropic + cuota Redis |
| `POST /api/llm` | `requireUser` **strict** | ver fase 6 | Groq / Gemini |
| `GET /api/ai/limits` | ninguna | — | constantes |
| `/api/stripe/checkout`, `/portal` | `requireUser` **strict** | — | Stripe, `sl_subscriptions` |
| `/api/stripe/config` | ninguna | — | constantes |
| `/api/stripe/webhook` | firma de Stripe | evento verificado; idempotencia en `sl_stripe_events` | `sl_subscriptions`, `sl_stripe_events` |
| `POST /api/waitlist` | `optionalUser` + límite por IP (fail-closed) | email validado | `sl_waitlist` |
| `/api/cron/*` (8) | `assertCron` (`CRON_SECRET`, tiempo constante) | — | ver fuente de verdad (fase 4.1) |

**Esquema** (`sql/gcp/001_schema.sql`): 31 tablas + 1 vista + 1 función. Todas con clave
primaria; únicas donde el front hace upsert (`sl_analyses (ticker, analysis_date, user_id)`,
`sl_watchlist (user_id, ticker)`, `sl_score_log (user_id, ticker, score_date)`,
`stock_snapshot` PK compuesta). **Se quitaron las 11 FK a `auth.users`** a propósito (esa
tabla era de Supabase): no hay borrado en cascada de los datos de un usuario.
Migraciones aplicadas en Cloud SQL: **NO VERIFICADO** — no hay registro de qué se aplicó y no
tengo credenciales de lectura de la base.

**Variables de entorno.** El código lee **62**; `infra/.env.gcp.example` documenta **31**.
Faltan 33 (entre ellas `GCP_PROJECT_ID`, `CLOUD_SQL_INSTANCE`, `PG*`, `NEXT_PUBLIC_FIREBASE_*`,
`ALLOWED_ORIGINS`, `APP_URL`) y documenta como **IMPRESCINDIBLE** `NEXT_PUBLIC_SUPABASE_URL`,
que ya no debería existir (M-7).

## Fase 3 · Matriz de conexión front ↔ back

| elemento del front | estado | detalle |
|---|---|---|
| 29 rutas de proveedor (FMP, Finnhub…) | ✅ | todas en lista blanca; forma de respuesta = la del proveedor |
| tickers internacionales numéricos (`0700.HK`, `7203.T`) que ofrece el buscador | ⚠️ | el servidor exige `^[A-Z.\-]{1,15}$` → 400 *Invalid symbol* (M-4) |
| `/api/data` — select / insert / upsert / update / delete | ✅ | contrato de filas correcto; los numéricos ya se convierten (`numeros.js`) |
| `/api/data` — columnas `date` (14 tablas) | ❌ | `"2026-09-27"` llega como `"2026-09-27T00:00:00.000Z"`, o `"2026-09-26T22:00…"` fuera de UTC (C-3) |
| `/api/data` — `.not(col, "is", null)` (`/stock/[ticker]:250`) | ❌ | se traduce a `col <> NULL` → 0 filas siempre (M-1) |
| `/api/data` — `{ count: "exact", head: true }` | ⚠️ | devuelve `rowCount` limitado por `LIMIT` (1000 de 1500) y manda las filas. Sin llamador hoy (M-2) |
| IA: 8 superficies → `/api/anthropic/messages` | ❌ | 503 para todo usuario (C-1) |
| `/pricing` → `/api/stripe/checkout`, `/portal` | ❌ | 503 (C-1) |
| `/daily`, `/picks` | ❌ | leen el REST de Supabase; sin variables → vacío (C-2) |
| `/track-record`, `/demo`, `PaperFund`, `/discovery`, smart money, base de conocimiento | ⚠️ | conectados a Cloud SQL, pero quien alimenta esas tablas escribe en Supabase (C-5) |
| `/audit` ← `ai_audit_log` | ⚠️ | conectado; el registro lo escribe el propio cliente (A-4) |
| resto de tablas de usuario (watchlist, diario, alertas, preferencias, snapshot) | ✅ | contrato correcto y aislado por usuario (política) |

**Back que el front no usa:** los 8 crons y el webhook (los llaman Cloud Scheduler y Stripe:
correcto) y **16 rutas de proveedor permitidas que nadie pide** (B-1).

**Tipos compartidos.** No hay fuente única: `lib/dataQuery.ts` (cliente) y
`lib/server/data/query.ts` (servidor) definen `Peticion` y `Filtro` **por duplicado**, y ya
divergen: el cliente manda `count`, `head` e `ignoreDuplicates`; el servidor no los declara.
Las filas se tipan como `unknown` y cada pantalla hace su propio `as` (M-8).

## Fase 4 · Gobernanza del dato

1. **Fuente de verdad.** Rota para 11 tablas compartidas (C-5):

   | tabla | la escribe | dónde | la app la lee de |
   |---|---|---|---|
   | `macro_state`, `macro_state_history`, `sl_briefings`, `sl_daily_close`, `smart_money_top_buyers`, `alerts_log`, `push_*` | crons de Cloud Scheduler | Cloud SQL | Cloud SQL ✅ (salvo `/daily` → Supabase ❌) |
   | `sl_cohort`, `sl_track_summary`, `sl_paper_fund(_track)`, `sl_picks_*`, `sl_discovery`, `sl_revisions`, `kb_*`, campos de breadth de `macro_state` | 9 workflows de GitHub Actions | **Supabase** (`acxaosesbsprrusdvgop`, URL fija como valor por defecto en el código) | Cloud SQL ❌ |

   El repo nuevo **no tiene ningún secreto** en GitHub y ninguno de esos 9 workflows ha
   corrido nunca en él (5 ejecuciones en total, todas de tests). Siguen corriendo, si acaso,
   en los repos de Alejandro.
2. **Validación.** En el servidor, y bien, en `/api/data` y en los proveedores. Excepción:
   `/api/anthropic/messages` reenvía el cuerpo del cliente tal cual (`system`, `tools`…) (A-7).
3. **Precisión numérica.** `numeric`/`int8` → `Number` (misma pérdida que PostgREST,
   documentada). Los precios del diario son `numeric` en BD. Es una herramienta de análisis,
   no un libro contable: aceptable, pero **no hay divisa explícita** en `sl_journal`.
4. **Fechas.** `timestamptz` bien. `date` rota (C-3). La base local de desarrollo corre en
   `Europe/Madrid`, que es donde el desfase se ve.
5. **Integridad.** Claves y únicas correctas. Sin FK de usuario (decisión documentada).
   `/api/data` ejecuta el lote **sin transacción** (M-5). Los upsert usan `ON CONFLICT`:
   sin carreras evidentes.
6. **Seguridad y acceso.** La política sustituye a la RLS y está bien construida (la prueba
   `aislamiento.test.mjs` lo cubre). Pero es **la única** barrera: la app conecta como
   `postgres`, dueño del esquema (A-5). Sin límite de peticiones en producción (A-2). Sin
   secretos en el repo.
7. **Datos personales.** Emails (`sl_alert_prefs`, `sl_waitlist`, Stripe), endpoints push,
   posiciones de inversión (`sl_journal`), prompts de IA. **No hay borrado de cuenta**, ni
   página de privacidad o términos, y PostHog pone cookie + `identify` **sin
   consentimiento** (A-6). No se encontraron emails ni IPs en los logs.
8. **Frescura y linaje.** Las pantallas macro muestran `snapshot_date`; `/daily` y `/picks`
   confunden «fuente caída» con «no hay datos» (C-2); las tablas de C-5 envejecerán sin que
   nada lo diga.
9. **Errores.** 27 consultas convierten un error en vacío (M-3). El 503 de C-1 deja en el log
   un mensaje falso («GCP_PROJECT_ID sin configurar»).
10. **Auditoría.** Stripe deja rastro (`sl_stripe_events`). La IA, en realidad, no: el registro
    lo escribe el cliente y puede omitirse o falsearse (A-4). Los borrados del usuario
    (watchlist, diario, alertas) no dejan rastro.

---

## Fase 5 · Hallazgos priorizados

Estados: **ARREGLADO** (commit) · **PENDIENTE DE DECISIÓN** (pregunta D-n al final) ·
**NO VERIFICADO** (motivo). Las rutas son relativas a `apps/scora-research/` salvo `infra/`.

### 🔴 Crítico

**C-1 · El modo `strict` deniega siempre: toda la IA y el cobro devuelven 503.**
`lib/server/auth.js:146-161`. Con `strict: true` se salta la verificación local y cae en el
«fail closed» que antes tenía detrás una llamada a Supabase. Lo usan
`/api/anthropic/messages`, `/api/llm`, `/api/stripe/checkout` y `/api/stripe/portal`.
*Prueba:* token RS256 válido firmado con una JWKS local → sin `strict`, usuario `uid123`; con
`strict`, `503 Server misconfigured: auth unavailable`. Entró en `01e5c55` (25-09) y ningún
test cubre `strict`.
*Arreglo:* `strict` verifica la firma localmente igual que el resto; la revocación inmediata
necesita el Admin SDK (D-3).

**C-2 · `/daily` y `/picks` leen de Supabase.** `lib/dailyClose.ts:39-58`,
`lib/picksData.ts:39-55`. Hacen `fetch` a `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1` con la clave
anónima; el build no recibe esas variables (`infra/build-and-push.sh:71-80`), así que la
función devuelve `null` y la página pinta su estado vacío. *Prueba en producción:* `/daily` →
«No close published yet». El cron `daily-close` escribe en Cloud SQL: el informe existe y no se
ve.
*Arreglo:* leer de Cloud SQL con el pool del servidor, y distinguir «fuente caída» de «vacío».

**C-3 · Las columnas `date` cambian de formato y se desplazan un día.**
`lib/server/data/pool.ts` no registra conversor para el OID 1082 y `node-pg` crea un `Date` a
medianoche **local**. *Prueba* contra el esquema real: `snapshot_date = 2026-09-27` →
`"2026-09-26T22:00:00.000Z"` con `TZ=Europe/Madrid`, `"2026-09-27T00:00:00.000Z"` con `UTC`.
Rompe `components/stock/StockScreener.tsx:285` (`a.analysis_date + "T00:00:00Z"` →
`Invalid Date` → «NaN días») y enseña la marca ISO completa en `/macro` («Snapshot: …»), el
diario, `MacroBrief`, `PaperFund` y `/picks`. Afecta también a `sbFetch` (crons).
*Arreglo:* devolver `date` como el texto `YYYY-MM-DD` que da Postgres, igual que PostgREST.

**C-4 · La suite está en rojo en `main`.** `scripts/guardianes.test.mjs`: `numeros.test.mjs`
corre en `npm test` pero no en CI. Como `npm test` encadena con `&&`, las suites posteriores no
se ejecutaban. CI: 5 de 5 ejecuciones fallidas el 27-09.
*Arreglo:* añadir el paso al workflow.

**C-5 · Doble fuente de verdad: 9 workflows escriben en Supabase, la app lee de Cloud SQL.**
`research/cron-score.mjs:34`, `research/paperfund_measure.mjs:16` y demás;
`.github/workflows/scora-{picks,monthly-score,weekly-measure,paperfund-measure,
paperfund-rebalance,weekly-discovery,weekly-filings,monthly-revisions,macro-breadth}.yml`.
Track record, picks, paper fund, discovery, base de conocimiento y breadth no se actualizan en
la app. **NO VERIFICADO** qué hay hoy en Cloud SQL: no tengo credenciales de lectura de la base.
*Propuesta:* un `sbFetch` para scripts (conexión por Cloud SQL Auth Proxy o IP autorizada) y
copiar los datos históricos de Supabase. **PENDIENTE DE DECISIÓN (D-1)**: implica mover datos
entre bases y dar a GitHub acceso a Cloud SQL.

### 🟠 Alto

**A-1 · El Terraform no describe el servicio real.** `GCP_PROJECT_ID` está puesta a mano en
Cloud Run y no en `infra/terraform/cloudrun.tf:6-17`: un `terraform apply` la borraría y
**todas** las rutas con sesión darían 503. Y el servicio en marcha **no tiene**
`ANTHROPIC_KEY`, `STRIPE_*`, `UPSTASH_*`, `RESEND_*`, `VAPID_*`, `GROQ/GEMINI`,
`ALLOWED_ORIGINS` ni `APP_URL` (leído con `gcloud run services describe`, solo nombres).
Además producción corre un build anterior a `main` (`/api/publico` → 404).
*Arreglo de código:* añadir `GCP_PROJECT_ID = var.project_id` al Terraform (sin aplicar). Lo
demás es de configuración: D-2.

**A-2 · Sin límite de peticiones ni cuota de IA en producción.** Sin Upstash, `ratelimit.js`
y `quota.js` dejan pasar todo (`RATELIMIT_FAIL_CLOSED=0`). Cualquier cuenta puede agotar la
cuota de FMP/Finnhub. **PENDIENTE DE DECISIÓN (D-2).**

**A-3 · Guardas de Supabase muertas desactivan funciones.** `lib/server/entitlements.js:31`
(`isPro` → `false` para todo el mundo si falta `SUPABASE_SERVICE_KEY`, y en producción falta:
quien pague recibe la cuota gratuita), `app/api/waitlist/route.js:74`,
`app/api/stripe/portal/route.js:38`, `app/api/stripe/checkout/route.js:64`,
`app/api/cron/macro-brief/route.js:42`, `lib/server/tts.js:50`. `sbFetch` ya no usa esas
variables.
*Arreglo:* quitar las guardas. Quitar los secretos de Supabase del Terraform
(`secrets.tf:19-21`) destruiría recursos → D-2.

**A-4 · El registro de auditoría de la IA lo escribe el cliente.** `lib/proxy.ts:340-353`.
Puede omitirse o falsearse (solo sobre las filas propias), y es la pieza que `/audit` y la
landing presentan como garantía. **PENDIENTE DE DECISIÓN (D-4).**

**A-5 · La app conecta a Cloud SQL como `postgres`.** `infra/terraform/cloudrun.tf:83`.
`policy.ts` es la única barrera; un fallo en ella expone todo con privilegios de dueño.
*Propuesta:* rol `scora_app` con `SELECT/INSERT/UPDATE/DELETE` sobre las tablas y nada más.
Cambio de roles en BD → **PENDIENTE DE DECISIÓN (D-5).**

**A-6 · RGPD.** Sin borrado de cuenta (y sin FK, borrar el usuario en Identity Platform deja
huérfanas sus filas en 13 tablas); sin política de privacidad ni términos; PostHog sin
consentimiento (`lib/analytics.ts:101-112`). **PENDIENTE DE DECISIÓN (D-6).**

**A-7 · `/api/anthropic/messages` es un relé abierto de Claude.**
`app/api/anthropic/messages/route.js:60-68` reenvía el cuerpo del cliente entero.
*Arreglo:* reenviar solo `model`, `max_tokens` y `messages` (texto; roles `user`/`assistant`).

### 🟡 Medio

**M-1 · `.not()` devuelve siempre 0 filas.** `lib/dataQuery.ts:124-128` → `sector <> NULL`.
Único uso: `app/stock/[ticker]/page.tsx:250` (el ETF sectorial nunca se adelanta en el lote).
*Arreglo:* operador `not_null` → `IS NOT NULL`.

**M-2 · `count: "exact"` no es exacto.** `app/api/data/route.ts:57` devuelve `rowCount`
(≤ `LIMIT`) y `head` se ignora. Probado: 1000 de 1500. Sin llamador hoy.
*Arreglo:* `count(*)` real, y sin filas cuando `head`.

**M-3 · 27 consultas ignoran el error.** `app/stock/[ticker]/page.tsx:169,176,179,213,239,
246,551,690,744`, `app/stock/page.tsx:50,107,112`, `app/discovery/page.tsx:36-37`,
`app/momentum/page.tsx:24`, `app/audit/page.tsx:31`,
`components/macro/MacroOverview.tsx:98,107`, `components/stock/StockOverview.tsx:118,135`,
`components/stock/StockScreener.tsx:41,129,139,148`, `lib/knowledge.ts:21,82`,
`lib/push.ts:58`, `lib/useWatchlistAnalyses.ts:34`. Un fallo se ve como «no hay datos» o
como un guardado que no ocurre. **PENDIENTE DE DECISIÓN (D-7)**: son 27 cambios de interfaz.

**M-4 · El servidor rechaza tickers con dígitos que el buscador ofrece.**
`lib/server/providers/*.js` (`^[A-Z.\-]{1,15}$`). *Arreglo:* admitir dígitos.

**M-5 · `/api/data` no usa transacción en lotes con escrituras.** Un lote puede aplicarse a
medias. No he encontrado ninguna pantalla que mande dos escrituras dependientes en el mismo
lote, pero el agrupado depende del orden de los `await` (**NO VERIFICADO** en ejecución).
Propuesta documentada, sin cambio.

**M-6 · El esquema se cachea para siempre** (`lib/server/data/pool.ts:47-72`): tras añadir
una columna, la app la rechaza hasta reiniciar la instancia. Propuesta documentada, sin cambio.

**M-7 · `.env.gcp.example` desactualizado.** 33 variables usadas sin documentar; Supabase
marcado como imprescindible. *Arreglo:* rehacerlo.

**M-8 · Tipos duplicados cliente/servidor, ya divergentes** (`Peticion`, `Filtro`).
*Propuesta:* un único `lib/dataContract.ts` importado por los dos. Sin cambio en esta pasada.

### ⚪ Bajo

**B-1 · 16 rutas de proveedor permitidas que nadie usa** (`fmp/news`, `senate-trading`,
`insider-trading`, `finnhub/crypto/candle`…). Superficie sobrante. Quitarlas puede afectar a
scripts de research → **PENDIENTE DE DECISIÓN (D-8).**

**B-2 · 121 avisos de lint** (0 errores). Sin cambio.

**B-3 · Heredados del informe del 26-09:** rotar la clave de FRED y subir a Next 16. Siguen
abiertos.

---

## Fase 6 y 7

*(Se completa tras los arreglos.)*
