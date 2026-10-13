// Páginas donde NO se monta el asistente de pantalla (components/ScreenAssistant.tsx).
//
// Dos motivos distintos:
//   · el login y la vuelta del proveedor de identidad, donde el botón solo estorba;
//   · las páginas con datos personales del usuario: su diario (posiciones, P&L y tesis), su
//     registro de IA y su cuenta. Una IA que lee el diario de alguien y le contesta es, en la
//     práctica, asesoramiento personal (guía de ESMA de 2023 sobre la definición de
//     asesoramiento, §69-73 y §84; un descargo no lo arregla, §65 y §74). Además, mandar a un
//     modelo datos de la situación financiera de una persona exige una EIPD (lista de la AEPD,
//     criterios 4 y 10). Plan único, pieza 1.2 (a).
//
// Va en un módulo aparte, sin React, para que la prueba (scripts/higiene_legal.test.mjs) lo
// importe tal cual.
export const RUTAS_SIN_ASISTENTE = /^\/(login|auth|journal|audit|account)(\/|$)/;

/** ¿Se puede mostrar el asistente en esta ruta? */
export const asistenteVisibleEn = (ruta: string | null | undefined): boolean =>
  !RUTAS_SIN_ASISTENTE.test(ruta ?? "");
