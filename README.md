# Scora

**El repositorio oficial.** Una sola aplicación Next.js que sirve la web y sus rutas de API
desde el mismo sitio, con el historial completo de los dos repos que la formaban.

Los repos originales de Alejandro Alvarado quedan como referencia de solo lectura
(remotos `upstream-*`, con el push deshabilitado a propósito). El trabajo va aquí.

Para traer algo de ellos si hiciera falta:

```bash
git fetch upstream-scora-research   # o upstream-ic-proxy
```

## Cómo se trabaja

`main` es la rama de trabajo y está protegida:

| Quién | Cómo |
|---|---|
| Jorge (dueño del repo) | Empuja directo a `main` |
| Alejandro y demás colaboradores | Abren una PR hacia `main`; Jorge la revisa y aprueba |

La protección exige **1 aprobación** para fusionar una PR, descarta las aprobaciones
viejas si se sube código nuevo, y prohíbe el force-push y el borrado de `main`. Los
administradores del repo quedan exentos a propósito (`enforce_admins: false`), que es
lo que permite el flujo de arriba.

## Estructura

Una sola aplicación Next.js:

```
apps/scora-research/
  app/              18 páginas + 25 rutas /api/*  (la web y su backend)
  components/       88 componentes
  lib/              la lógica que también corre en el navegador
  lib/server/       la que SOLO corre en el servidor — claves, caché, proveedores
  research/         131 scripts de laboratorio y backtesting (GitHub Actions)
  sql/              migraciones de Supabase
  scripts/          47 suites de pruebas
infra/              todo lo de Google Cloud (Terraform + scripts)
```

`lib/` y `lib/server/` están separados a propósito: lo de `server/` toca claves de API y no
debe acabar nunca en un bundle de navegador.

## Un poco de historia

Esto fueron **dos repos** —`scora-research` (la web) e `ic-proxy` (el backend)— y luego dos
apps dentro de este monorepo. Se fusionaron en una sola el 25-09-2026 porque en realidad
siempre fueron un producto partido en dos, acoplado por cinco vías distintas.

La fusión eliminó tres cosas de golpe:

- **el CORS entre dominios** — el navegador llama a su propio origen
- **el salto de red** entre la app y su backend
- **la dependencia circular del despliegue** — la imagen de la app ya no necesita saber la
  URL del backend, porque es ella misma

Los repos originales de Alejandro Alvarado siguen existiendo como referencia de solo lectura
(remotos `upstream-*`, con el push deshabilitado).

## Desplegar

Ver [DEPLOY_GCP.md](DEPLOY_GCP.md). Resumen: una imagen, un servicio de Cloud Run, 8 crons
en Cloud Scheduler.

## Historial

Se preservó completo al fusionar los repos: el commit más antiguo es del 19-05-2026.

Los commits anteriores a agosto de 2026 referencian las rutas **originales** (`lib/proxy.ts`),
no las actuales (`apps/scora-research/lib/proxy.ts`). Para ver el historial de un fichero hay
que usar la ruta antigua y `--full-history`:

```bash
git log --full-history -- lib/proxy.ts
```

Las 7 ramas de los dos repos originales quedaron guardadas como tags `legacy/<repo>/<rama>`.
Incluye `legacy/ic-proxy/security/hardening-2026-08`, que ya fue borrada de GitHub y solo
sobrevivía en un clon local.
