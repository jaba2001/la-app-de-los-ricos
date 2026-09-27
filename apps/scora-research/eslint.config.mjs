// Configuración de ESLint.
//
// El proyecto TENÍA ESLint —quedan 4 supresiones `react-hooks/exhaustive-deps` en el
// código— pero el fichero de configuración no estaba, así que esas reglas llevaban tiempo
// sin comprobarse. El CI solo corría `tsc` y `next build`, y ninguno mira los hooks.
//
// Se usa la configuración plana nativa de eslint-config-next (v16), no el puente
// FlatCompat: con el puente, validar el esquema de `next/typescript` revienta con
// "Converting circular structure to JSON".
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "public/sw.js",           // generado por next-pwa
      "public/workbox-*.js",    // idem
      "research/out/**",        // artefactos JSON de los backtests
      "research/.cache/**",
    ],
  },
  ...(Array.isArray(nextCoreWebVitals) ? nextCoreWebVitals : [nextCoreWebVitals]),
  ...(Array.isArray(nextTypescript) ? nextTypescript : [nextTypescript]),
  {
    rules: {
      // Los scripts de research leen JSON externo cuya forma no controlamos. Avisar, no romper.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

      // ── Reglas del plugin NUEVO de react-hooks, bajadas a aviso ────────────────────
      //
      // eslint-config-next v16 trae el conjunto de reglas del React Compiler, que no
      // existía cuando se escribió este código (el proyecto va con Next 15.5). Como
      // next.config.ts lleva `ignoreDuringBuilds: false`, dejarlas en error TUMBA EL BUILD
      // por 49 avisos de estilo — y eso convierte una mejora de calidad en un bloqueo.
      //
      // No se silencian: siguen saliendo como avisos y el informe las recoge. Subirlas a
      // error es una decisión aparte, que pide arreglarlas primero.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/use-memo": "warn",
      // Cosméticas: apóstrofos sin escapar en JSX. Reales pero sin efecto en el usuario.
      "react/no-unescaped-entities": "warn",
      // Un `let` que nunca se reasigna en lib/deflacion.ts:54. Es un arreglo de una palabra,
      // pero es codigo de PRODUCCION y esta auditoria no lo toca: queda como hallazgo B-4 del
      // informe. En error tumbaria el build por eso solo.
      "prefer-const": "warn",
    },
  },
];
