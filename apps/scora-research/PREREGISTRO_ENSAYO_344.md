# Ensayo 344 · CERRADO POR DECISIÓN DE PRODUCTO, sin ejecutar

**Fecha:** 2026-09-03 · **Estado:** preregistrado y **NO ejecutado**. El registro sigue en 343.

---

## La decisión

> **Alejandro: «quisiera evitar apalancamientos, podrían ser peligrosos para una persona sin
> experiencia».**

Se cierra la vía del apalancamiento. No se ejecuta este ensayo, y `research/ensayo344.mjs` se
retiró antes de correrlo para no dejar un arma cargada en el repo.

**Es la decisión correcta**, y conviene dejar escrito por qué, porque el backtest decía lo
contrario y la tentación de volver es real:

- Un apalancamiento de 1,8x sobre una cartera propia se hace con **margen** o con financiación
  sintética. Las dos traen **llamada de margen**, y una llamada se resuelve en horas, no en
  meses. El backtest simula el evento; no simula a una persona mirando el móvil un lunes.
- La simulación dio **cero llamadas**, pero eso vale para la cartera de 2007-2026. Un bróker
  puede **subir el mantenimiento cuando quiera**, y suele hacerlo justo cuando peor viene.
- Y el hueco de apertura no se puede deshacer: un −20 % a 1,82x son −36 % sin salida.

Nada de eso es un problema para un profesional. Todo lo es para el usuario de Scora.

## Lo que esta decisión cuesta, dicho claro

**Cierra la única vía que encontramos que bate al índice.** Medido en la fase 1, con la llamada
de margen dentro y la financiación real:

| | total | Sharpe | caída máx | llamadas |
|---|---:|---:|---:|---:|
| B fijo 1,82x | 1.283,3 % | 0,852 | −32,9 % | 0 |
| S&P 500 | 670,5 % | 0,629 | −69,9 % | — |
| Scora sin apalancar | 734,3 % | 0,929 | −26,7 % | — |

Eso queda **medido y archivado**, no borrado. Si algún día hay una audiencia distinta —un
producto para inversores cualificados, por ejemplo— el trabajo está hecho: `margen_fase1.mjs`,
`apalancamiento.mjs`, `apalancamiento_coste.mjs` y `ROADMAP_APALANCAMIENTO.md`.

## Lo que queda en pie

Scora sigue siendo lo que era, y es lo que se puede vender sin letra pequeña:

- **Sharpe 0,929 contra 0,629 del índice**, con **−26,7 % de caída máxima contra −69,9 %**.
- Llegas aproximadamente al mismo sitio **sin el pánico**. Eso es cierto, es raro, y no necesita
  que nadie firme un contrato de margen.

**El registro de ensayos se queda en 343.** Un ensayo preregistrado y no ejecutado no cuenta:
no se miró nada, así que no se gastó grado de libertad.
