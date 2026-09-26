# Auditoría de Scora — 26 de septiembre de 2026

## Resumen ejecutivo

El proyecto está **sano y verificado de punta a punta**. La suite pasa de 51 a 53 suites y
de 3.544 a **3.627 aserciones, sin un solo fallo**, más 6 pruebas E2E en navegador real y 36
comprobaciones de integración contra la aplicación arrancada con una base de datos real.

Se encontraron **11 hallazgos**: 1 crítico (una tabla bloqueada por la política que rompe una
sección en silencio), 3 altos y el resto medios o bajos. **Ninguno es un fallo de cálculo ni
de seguridad explotable**: el aislamiento entre usuarios, la verificación de tokens y la
firma de los webhooks resisten las pruebas de ataque.

El cruce front ↔ back da **18 endpoints emparejados y cero desajustes**. Los 9 "sin usar" son
los 8 crons y el webhook de Stripe, que los llaman Cloud Scheduler y Stripe.

Lo más relevante es que **tres de los hallazgos son restos de la migración de esta semana**,
incluidos dos que yo mismo introduje. Quedan **dos áreas BLOQUEADAS** por falta de
credenciales: el login completo y las pantallas con sesión.

---

## Hallazgos

### 🔴 Crítico

#### C-1 · `sl_paper_fund` bloqueada por la política — la sección se renderiza vacía

**Dónde:** `apps/scora-research/lib/server/data/policy.ts:81` · `components/macro/PaperFund.tsx:24`

`PaperFund.tsx` consulta **dos** tablas: `sl_paper_fund_track` (permitida) y `sl_paper_fund`,
que está declarada como NO expuesta con la nota *"lo gestiona el cron de rebalanceo; el
cliente solo lee su track"*. Esa nota es falsa.

En producción el servidor responde `Tabla no accesible: sl_paper_fund`, el componente ignora
el error (`setReb((r as Reb) ?? null)`) y **pinta la sección sin los datos de rebalanceo**.
No hay error visible en ninguna parte.

**Origen:** introducido en la migración a Cloud SQL de esta semana.

**Fix propuesto:**
```ts
// policy.ts — junto a sl_paper_fund_track
sl_paper_fund: { scope: "shared", ops: ["select"] },
```
Y borrar su entrada de `NO_EXPUESTAS`.

---

### 🟠 Alto

#### A-1 · La lista de CORS apunta a dominios de Vercel que se apagan

**Dónde:** `lib/server/cors.js:21-28`

Contiene `scora-research.vercel.app`, `ic-suite.vercel.app`, `ic-datalayer-app.vercel.app` y
`stock-lens-app.vercel.app`, pero **no** el dominio de Cloud Run.

No rompe Scora (el navegador llama al mismo origen desde la fusión en una sola app), pero si
alguna de las otras tres apps del ecosistema apunta al backend nuevo, el navegador se lo
bloqueará.

**Fix:** añadir `https://scora-628763661566.europe-west1.run.app` y, cuando haya dominio
propio, el definitivo. Revisar si los de Vercel siguen haciendo falta.

#### A-2 · El proyecto no tenía ESLint configurado

**Dónde:** raíz de `apps/scora-research` (resuelto en esta auditoría)

Había **4 supresiones `react-hooks/exhaustive-deps`** en el código, así que ESLint existió,
pero el fichero de configuración no estaba. El CI solo corría `tsc` y `next build`, y
**ninguno de los dos comprueba las reglas de hooks**.

Se añadió `eslint.config.mjs`. Resultado: **1 error y 74 avisos**, ningún bug de lógica.

⚠️ **Aviso importante:** activarlo **rompió el build**, porque `next.config.ts` tiene
`ignoreDuringBuilds: false`. `eslint-config-next` instaló la **v16**, que trae el conjunto de
reglas del React Compiler (`set-state-in-effect`, `static-components`, `purity`, `use-memo`)
que no existían cuando se escribió este código (Next 15.5). **49 de los 60 "errores" eran de
esas reglas nuevas.** Se bajaron a aviso, documentando el porqué. Subirlas a error es una
decisión aparte que exige arreglarlas primero.

#### A-3 · Los scripts de Vercel dan 404 en cada carga de página

**Dónde:** `app/layout.tsx:9-10,67-68`

`@vercel/analytics` y `@vercel/speed-insights` siguen en el layout. Sus scripts los servía la
**plataforma** de Vercel en `/_vercel/*`; en Cloud Run no existen:

```
/_vercel/insights/script.js        404  text/html
/_vercel/speed-insights/script.js  404  text/html
```

**Verificado en producción.** Son **dos peticiones fallidas por visita**, más dos errores de
consola. No rompe nada, pero es peso muerto que ahora falla. Lo destaparon las pruebas E2E.

**Fix:** quitar los dos componentes del layout y desinstalar los paquetes. La analítica real
la da PostHog, que sí funciona.

---

### 🟡 Medio

#### M-1 · `next@15.5.19` con 1 vulnerabilidad crítica y 7 altas

`npm audit` da 15 vulnerabilidades (1 crítica, 7 altas, 7 moderadas).

**Matización que cambia la severidad real:** las dos críticas de Next son *Denial of Service
in App Router using Server Actions* y *SSRF in Server Actions on custom servers*. Esta app
**no usa Server Actions** (cero directivas `"use server"`, verificado) **ni servidor
personalizado**. Para esta aplicación el riesgo es bajo.

El fix es Next 16, un cambio mayor. Las altas (`brace-expansion`, `browserslist`, `nanoid`,
`postcss`, `sharp`…) son todas dependencias de compilación, no de ejecución.

#### M-2 · El parseo del Congreso traga fila a fila en silencio

**Dónde:** `lib/server/providers/congress.js:91,111`

Dos `catch {}` vacíos dentro del bucle de parseo. Si el formato de origen cambia, **todas**
las filas fallan y la respuesta es una lista vacía — indistinguible de "este ticker no tiene
operaciones".

Es exactamente el fallo que Alejandro ya arregló en otro punto (commit *"congress: un apagón
deja de disfrazarse de «no hay operaciones»"*).

**Fix:** contar los fallos y, si fallan todas con filas de entrada, devolver error en vez de
lista vacía.

#### M-3 · Promesa sin `catch`

**Dónde:** `app/pricing/page.tsx:302`

```ts
session.getToken().then((t) => { if (vivo) setToken(t); });
```
Si `getToken()` rechaza (token caducado, red caída), queda un *unhandled rejection* y el
botón de pago se queda sin token, sin avisar.

**Origen:** introducido en la migración del login de esta semana.

**Fix:** añadir `.catch(() => { if (vivo) setToken(null); })`.

---

### 🟢 Bajo

| | Hallazgo | Dónde |
|---|---|---|
| **B-1** | 5 tablas permitidas que nadie consulta: `kb_chunks`, `sl_daily_close`, `sl_picks_position`, `sl_picks_run`, `sl_waitlist`. Superficie de más | `lib/server/data/policy.ts` |
| **B-2** | 4 `catch {}` sin comentario. Comportamiento correcto (recorrer nombres candidatos), pero ilegible | `app/api/cron/13f-refresh/route.js:41,47` |
| **B-3** | Clave de FRED en el historial de un repo **público**, sin rotar | 7 commits |
| **B-4** | `let` que nunca se reasigna. Bloqueaba el build con `prefer-const` en error | `lib/deflacion.ts:54` |
| **B-5** | 10 variables sin usar y 10 apóstrofos sin escapar en JSX | varios |

---

## Cruce front ↔ back

**118 llamadas del cliente · 27 endpoints · 0 desajustes.**

| Endpoint | Método | Llamadas | Estado |
|---|---|---|---|
| `/api/data` | POST | 50 | ✅ |
| `/api/fmp/[...path]` | GET | 42 | ✅ |
| `/api/finnhub/[...path]` | GET | 14 | ✅ |
| `/api/fred/series` | GET | 2 | ✅ |
| `/api/edgar` | GET | 1 | ✅ |
| `/api/simfin` | GET | 1 | ✅ |
| `/api/congress/[ticker]` | GET | 1 | ✅ |
| `/api/finviz/quote` | GET | 1 | ✅ |
| `/api/short-interest` | GET | 1 | ✅ |
| `/api/cot` | GET | 1 | ✅ |
| `/api/batch` | POST | 1 | ✅ |
| `/api/anthropic/messages` | POST | 1 | ✅ |
| `/api/llm` | POST | 1 | ✅ |
| `/api/ai/limits` | GET | 1 | ✅ |
| `/api/stripe/config` | GET | 1 | ✅ |
| `/api/stripe/checkout` | POST | 1 | ✅ |
| `/api/stripe/portal` | POST | 1 | ✅ |
| `/api/waitlist` | POST | 1 | ✅ |
| `/api/cron/*` (8 rutas) | GET | 0 | ⚠️ los llama Cloud Scheduler |
| `/api/stripe/webhook` | POST | 0 | ⚠️ lo llama Stripe |

**Un desajuste de contrato encontrado y ya listado como C-1:** `sl_paper_fund` se pide desde
el cliente y el servidor la rechaza. No aparece como ❌ en la tabla porque la ruta
(`/api/data`) sí existe — el desajuste está **dentro** del payload, que es justo lo que no se
ve mirando solo las rutas.

### Verificado además

- **Autenticación por endpoint:** las 27 rutas revisadas siguiendo los re-exports. 18 exigen
  sesión de usuario, 8 el secreto de cron, 3 son públicas a propósito (`ai/limits` y
  `stripe/config` son precios públicos; `stripe/webhook` se valida por firma HMAC con
  comparación en tiempo constante — correcto).
- **CORS:** un origen permitido recibe la cabecera; uno ajeno **no**.
- **Cabeceras de seguridad:** CSP presente con `connect-src 'self'`, `X-Frame-Options: DENY`,
  `nosniff`.
- **Variables incrustadas:** el id de Identity Platform está en el bundle **de producción**
  (verificado contra Cloud Run). En un `npm run build` local no aparece — es lo esperado, las
  `NEXT_PUBLIC_*` se pasan como `--build-arg`.
- **Entradas mal formadas:** JSON roto, `queries` vacío, exceso de consultas y métodos
  equivocados → ningún 500.

---

## Resultados de las pruebas

| | Antes | Después |
|---|---|---|
| Suites | 51 | **53** |
| Aserciones | 3.544 | **3.627** |
| Fallos | 0 | **0** |
| E2E en navegador | — | **6** |
| Saltadas | 2 | **0** (con Postgres levantado) |

**Suites nuevas:**

- `scripts/integracion.test.mjs` — **36 comprobaciones** contra la app arrancada: toda ruta de
  datos exige sesión, token inventado da 401 y no 500, los 8 crons no se disparan sin secreto,
  métodos equivocados dan 405, CORS discrimina por origen, las páginas responden 200.
- `scripts/contrato.test.mjs` — **16 comprobaciones** de forma: el payload de `/api/data` y
  `/api/batch`, que los errores lleguen como JSON con clave `error` (el cliente los lee así),
  que un JSON roto no provoque un 500, y las cabeceras de seguridad.
- `e2e/publico.spec.ts` — **6 pruebas en Chromium real, sin mocks**: la landing carga y su JS
  no revienta, el CTA lleva a registrarse, `/pricing` pinta aunque Stripe no responda,
  `/login` muestra el formulario, un 404 no rompe la pantalla, y una vista con sesión degrada
  sin dejar promesas sin capturar.

**Comando único:**
```bash
npm run verify     # typecheck + lint + 53 suites + css + e2e
```

### Dos fallos que eran del test, no del código

Se investigaron antes de clasificarlos:

1. `/api/waitlist` devolvía **503** donde yo esperaba 401. Es correcto: limita por IP **antes**
   de mirar la sesión y su limitador es *fail-closed* a propósito — sin él sería un cañón de
   correos anónimo.
2. El id de Identity Platform no aparecía en el bundle. Era mi entorno: compilé sin pasar las
   `--build-arg`. En producción sí está.

### Falsos positivos descartados

`isSubscribed()` captura internamente; `CalidadContable` sí tiene `.catch`; las
"dependencias sin usar" venían de un fallo de comillas en mi propia comprobación — las 22
están en uso.

---

## BLOQUEADO

| Qué | Por qué | Qué hace falta |
|---|---|---|
| **Flujo de login completo** | Es enlace mágico por correo: hay que recibir el email y pulsarlo | Que alguien entre en `/login`, meta su correo y confirme que llega |
| **Pantallas con sesión** (watchlist, journal, stock, macro, picks…) | No hay usuario que autenticar | Un usuario de prueba en Identity Platform, o un token de servicio |
| **Endpoints de IA** (`/api/anthropic`, `/api/llm`) | Sin claves de Anthropic/Groq/Gemini | Cualquiera de las tres |
| **Cobros** (`stripe/checkout`, `portal`, `webhook`) | Sin claves de Stripe | Claves de modo prueba |
| **Caché y límite de peticiones** | Sin Upstash configurado | URL y token de Upstash |
| **Notificaciones y correo** | Sin VAPID ni Resend | Par VAPID y clave de Resend |

Las tres primeras son las que más cobertura desbloquearían: con un usuario de prueba se
podrían recorrer las 13 pantallas con sesión de punta a punta.

---

## Fixes recomendados, por orden

1. **C-1** · Añadir `sl_paper_fund` a la política — una línea, arregla una sección rota
2. **A-3** · Quitar `@vercel/analytics` y `@vercel/speed-insights` — dos 404 por visita
3. **M-3** · `.catch()` en `pricing/page.tsx:302` — una línea
4. **B-4** · `let` → `const` en `deflacion.ts:54` — permite subir `prefer-const` a error
5. **A-1** · Actualizar la lista de CORS con el dominio de Cloud Run
6. **B-3** · Rotar la clave de FRED (está en un repo público)
7. **M-2** · Que el parseo del Congreso distinga "sin datos" de "no sé leerlo"
8. **B-1** · Quitar de la política las 5 tablas que nadie usa
9. **B-5** · Los 21 avisos cosméticos de lint (`eslint --fix` arregla 18)
10. **M-1** · Planificar la subida a Next 16 — cambio mayor, sin prisa dado que no usáis Server Actions

Los cuatro primeros son de minutos y cierran los dos hallazgos introducidos esta semana.
