// Envuelve el texto visible de componentes TSX en t() / <Trans>, con el analizador de TypeScript
// (no con expresiones regulares: en TSX, «>» y «<» también son flechas y genéricos).
//
//   node scripts/i18n-envolver.mjs components/stock/StockSignals.tsx [más ficheros…] [--seco]
//
// Qué toca:
//   · texto de JSX («>Sign out<») → {t("Sign out")}, con las reglas de espacios de React;
//   · tramos de texto + {expresiones} («You hold {n} names») → {t(`You hold ${n} names`)};
//   · tramos con etiquetas de formato dentro («Regresses <strong>your</strong> returns») →
//     <Trans text="Regresses <s1>your</s1> returns" s1={(c) => <strong>{c}</strong>} />;
//   · atributos de texto (placeholder, title, aria-label, alt, label, hint…) con cadena literal;
//   · cadenas literales dentro de {…} de JSX («{loading ? "Loading…" : "Load"}»);
//   · cadenas pasadas a setError/setAviso/setStatus/setMsg/alert.
// Qué NO toca: lo que no tiene letras minúsculas (tickers, «P/E», «—»), <code>/<pre>, y lo que
// ya está envuelto. Imprime las claves nuevas para el diccionario.
import ts from "typescript";
import { readFileSync, writeFileSync } from "fs";

const SECO = process.argv.includes("--seco");
// --servidor: para componentes de servidor. t sale de «await tServidor()» y las frases con
// formato usan <TransServidor> (al <Trans> de cliente no se le pueden pasar funciones).
const SERVIDOR = process.argv.includes("--servidor");
// --campos: SOLO envuelve con tv() lo que se pinta desde campos de texto de lib/
// ({s.detail}, {x.reading}, {lecturaTipoReal(d)}, label={x.label}…). Nada más.
const CAMPOS = process.argv.includes("--campos");
const CAMPOS_TEXTO = new Set(["detail", "details", "message", "headline", "reading", "lectura", "summary", "label", "text", "note", "nota", "why", "motivo", "reason", "desc", "description", "explanation", "caveat", "hint", "title", "sub", "subtitle", "verdict", "narrative", "lean", "explain", "comment", "role", "watch", "moves", "flows", "risk", "benefits", "trigger", "context", "outcome", "region", "tilt", "action", "stance", "line", "read", "frase", "texto", "titulo", "aviso", "razon", "explica", "tagline", "blurb", "kicker", "badge", "nombre", "etiqueta", "veredicto", "conclusion", "warning", "flag"]);
const IDENT_TEXTO = new Set(["label", "text", "reading", "detail", "note", "hint", "title", "sub", "desc", "description", "why", "motivo", "reason", "caveat", "frase", "warning", "flag", "lean", "headline", "summary", "verdict", "role", "region"]);
const FUNCIONES_TEXTO = new Set(["lecturaTipoReal", "avisoConTasaBase", "liston", "etiquetaDe", "lecturaCurva"]);
const ficheros = process.argv.slice(2).filter((a) => !a.startsWith("--"));

const ATRIBUTOS = new Set(["placeholder", "title", "aria-label", "alt", "label", "hint", "sub", "subtitle", "description", "tooltip", "heading", "caption", "mensaje", "emptyText", "note"]);
const SETTERS = new Set(["setError", "setAviso", "setStatus", "setMsg", "setMensaje", "setErrorCarga", "setNota", "alert", "setWarning", "setInfo"]);
const SIN_TOCAR = new Set(["code", "pre", "script", "style", "svg", "text", "tspan"]);
const INLINE = new Set(["strong", "b", "em", "i", "span", "a", "u", "small", "mark", "sup", "sub", "abbr"]);

const ENTIDADES = { "&apos;": "'", "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&ldquo;": "“", "&rdquo;": "”", "&lsquo;": "‘", "&rsquo;": "’", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…", "&times;": "×", "&middot;": "·", "&rarr;": "→", "&larr;": "←", "&le;": "≤", "&ge;": "≥", "&minus;": "−", "&plusmn;": "±", "&deg;": "°", "&#39;": "'" };
const decodificar = (s) => s.replace(/&[a-z#0-9]+;/gi, (e) => ENTIDADES[e] ?? e);

/** Las reglas de React para el texto de JSX (cleanJSXElementLiteralChild de Babel). */
function limpiarJsx(raw) {
  const lineas = raw.split(/\r\n|\n|\r/);
  let ultima = 0;
  lineas.forEach((l, i) => { if (/[^ \t]/.test(l)) ultima = i; });
  let out = "";
  lineas.forEach((l, i) => {
    let x = l.replace(/\t/g, " ");
    if (i !== 0) x = x.replace(/^[ ]+/, "");
    if (i !== lineas.length - 1) x = x.replace(/[ ]+$/, "");
    if (x) { if (i !== ultima) x += " "; out += x; }
  });
  return out;
}

// Las etiquetas que salen de mapas («FACTOR_LABELS[k]», «KIND_LABEL[a.kind] ?? a.kind») también
// se traducen: si no, «comes from the market» quedaría a medias dentro de la frase en español.
const MAPA_ETIQUETAS = /\b[A-Z][A-Z0-9_]*(LABELS?|ETIQUETAS?|NOMBRES?|TITULOS?)\b\s*\[/;
let T_ACTUAL = "t";
const envolverEtiqueta = (x) => (MAPA_ETIQUETAS.test(x) && !/^tr?\(/.test(x) ? `${T_ACTUAL}(${x})` : x);

const tieneTexto = (s) => /[a-záéíóúñ]{2,}/.test(s);
const comillas = (s) => JSON.stringify(s);
const plantilla = (s) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

for (const f of ficheros) {
  const src = readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  // Si el fichero ya tiene una variable o parámetro «t» (p. ej. trades.map(t => …)), el
  // traductor se importa como «tr» para no quedar tapado.
  let usaNombreT = false;
  (function buscar(n) {
    if ((ts.isParameter(n) || ts.isVariableDeclaration(n) || ts.isBindingElement(n)) && n.name && ts.isIdentifier(n.name) && n.name.text === "t") usaNombreT = true;
    ts.forEachChild(n, buscar);
  })(sf);
  const T = usaNombreT ? "tr" : "t";
  T_ACTUAL = T;
  const cambios = []; // { ini, fin, texto }
  let usaT = false, usaTrans = false;

  const dentroDe = (n, nombres) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isJsxElement(p) && nombres.has(p.openingElement.tagName.getText(sf))) return true;
    }
    return false;
  };
  const yaEnvuelto = (n) => {
    const p = n.parent;
    return p && ts.isCallExpression(p) && (p.expression.getText(sf) === "t" || p.expression.getText(sf) === "tr");
  };

  // ── 1. Hijos de cada elemento: tramos de texto, expresiones y etiquetas de formato ──
  function tramos(el) {
    const hijos = el.children;
    let i = 0;
    while (i < hijos.length) {
      // Un tramo: texto, {expresión simple} y etiquetas de formato con solo texto dentro.
      let j = i; const piezas = [];
      while (j < hijos.length) {
        const h = hijos[j];
        if (ts.isJsxText(h)) { piezas.push(h); j++; continue; }
        if (ts.isJsxExpression(h)) {
          const e = h.expression;
          if (!e) { piezas.push(h); j++; continue; }
          if (ts.isStringLiteral(e) || ts.isIdentifier(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)
              || (ts.isCallExpression(e) && !e.getText(sf).includes("<"))
              || ts.isNumericLiteral(e) || (ts.isTemplateExpression(e) && !e.getText(sf).includes("<"))
              || (ts.isBinaryExpression(e) && !e.getText(sf).includes("<") && !/&&|\|\||\?\?/.test(e.operatorToken.getText(sf)))) { piezas.push(h); j++; continue; }
          break;
        }
        if (ts.isJsxElement(h) && INLINE.has(h.openingElement.tagName.getText(sf)) && esEstatico(h.openingElement)
            && h.children.every((c) => ts.isJsxText(c) || (ts.isJsxExpression(c) && c.expression && !c.expression.getText(sf).includes("<")))) { piezas.push(h); j++; continue; }
        break;
      }
      if (j === i) { i++; continue; }
      procesarTramo(piezas);
      i = j;
    }
  }

  // Una etiqueta se puede mover a una función (s1={(c) => <strong …>{c}</strong>}) solo si sus
  // atributos no usan variables: si no, TypeScript pierde el estrechamiento de tipos dentro de
  // la función y el componente deja de compilar.
  function esEstatico(abre) {
    let ok = true;
    const ver = (n) => {
      if (ts.isIdentifier(n) && !(n.parent && ts.isPropertyAssignment(n.parent) && n.parent.name === n) && !(n.parent && ts.isJsxAttribute(n.parent))) ok = false;
      ts.forEachChild(n, ver);
    };
    abre.attributes.properties.forEach((a) => { if (ts.isJsxAttribute(a) && a.initializer) ver(a.initializer); else if (!ts.isJsxAttribute(a)) ok = false; });
    return ok;
  }

  function procesarTramo(piezas) {
    // Si no hay texto con letras, nada que hacer.
    const conTexto = piezas.some((p) => ts.isJsxText(p) && tieneTexto(decodificar(limpiarJsx(p.text))))
      || piezas.some((p) => ts.isJsxElement(p) && p.children.some((c) => ts.isJsxText(c) && tieneTexto(decodificar(limpiarJsx(c.text)))));
    if (!conTexto) return;
    // Quitar piezas de borde que son solo espacio en blanco (no aportan y no se pintan).
    let a = 0, b = piezas.length - 1;
    const vacio = (p) => (ts.isJsxText(p) && !limpiarJsx(p.text).trim()) || (ts.isJsxExpression(p) && !p.expression);
    while (a <= b && vacio(piezas[a])) a++;
    while (b >= a && vacio(piezas[b])) b--;
    const ps = piezas.slice(a, b + 1);
    if (!ps.length) return;
    // Si el tramo no tiene texto PROPIO (solo etiquetas juntas), cada etiqueta va por su cuenta.
    if (!ps.some((p) => ts.isJsxText(p) && tieneTexto(decodificar(limpiarJsx(p.text))))) {
      if (ps.some((p) => ts.isJsxElement(p))) return;
    }
    const ini = ps[0].getStart(sf), fin = ps[ps.length - 1].getEnd();

    const hayEtiquetas = ps.some((p) => ts.isJsxElement(p));

    // Construir el texto como trozos: literales y ${expresiones}; las etiquetas de formato
    // como <sN>…</sN>. Los literales se escapan para cada destino; las expresiones van tal cual.
    const trozos = []; let n = 0; const envolt = [];
    const meter = (p) => {
      if (ts.isJsxText(p)) { trozos.push({ lit: decodificar(limpiarJsx(p.text)) }); return; }
      const e = p.expression;
      if (!e) return;
      if (ts.isStringLiteral(e)) { trozos.push({ lit: e.text }); return; }
      trozos.push({ expr: envolverEtiqueta(e.getText(sf)) });
    };
    for (const p of ps) {
      if (ts.isJsxElement(p)) {
        n++;
        const tag = "s" + n;
        trozos.push({ lit: `<${tag}>` });
        p.children.forEach(meter);
        trozos.push({ lit: `</${tag}>` });
        const abre = p.openingElement.getText(sf), cierra = p.closingElement.getText(sf);
        envolt.push(`${tag}={(c) => ${abre}{c}${cierra}}`);
      } else meter(p);
    }
    // Espacios de los bordes: fuera de la traducción (los pone el JSX de alrededor).
    let pre = "", post = "";
    if (trozos.length && "lit" in trozos[0]) { const m0 = /^\s*/.exec(trozos[0].lit)[0]; pre = m0; trozos[0] = { lit: trozos[0].lit.slice(m0.length) }; }
    const ul = trozos.length - 1;
    if (ul >= 0 && "lit" in trozos[ul]) { const m1 = /\s*$/.exec(trozos[ul].lit)[0]; post = m1; trozos[ul] = { lit: trozos[ul].lit.slice(0, trozos[ul].lit.length - m1.length) }; }
    const clave = trozos.map((x) => ("lit" in x ? x.lit : "{x}")).join("");
    if (!tieneTexto(clave.replace(/\{x\}/g, ""))) return;
    const hayExpr = trozos.some((x) => "expr" in x);
    const comoPlantilla = "`" + trozos.map((x) => ("lit" in x ? plantilla(x.lit) : "${" + x.expr + "}")).join("") + "`";
    const comoCadena = comillas(trozos.map((x) => x.lit).join(""));
    const espacioPre = pre ? '{" "}' : "", espacioPost = post ? '{" "}' : "";

    let nuevo;
    if (hayEtiquetas) {
      usaTrans = true;
      // text={"…"} y no text="…": en un atributo JSX entre comillas «\"» no es un escape.
      nuevo = `<${SERVIDOR ? "TransServidor" : "Trans"} text={${hayExpr ? comoPlantilla : comoCadena}} ${envolt.join(" ")} />`;
    } else {
      usaT = true;
      nuevo = `{${T}(${hayExpr ? comoPlantilla : comoCadena})}`;
    }
    cambios.push({ ini, fin, texto: espacioPre + nuevo + espacioPost, clave });
  }

  // ── 2. Recorrido ──
  function visitar(n) {
    if (ts.isJsxElement(n)) {
      const tag = n.openingElement.tagName.getText(sf);
      if (SIN_TOCAR.has(tag) || tag === "Trans" || tag === "TransServidor") return;
      tramos(n);
      // Los hijos que son elementos se visitan aparte (sus propios tramos).
      for (const h of n.children) if (!ts.isJsxText(h)) { ts.forEachChild(h, visitar); if (ts.isJsxElement(h)) visitar(h); }
      ts.forEachChild(n.openingElement, visitar);
      return;
    }
    if (ts.isJsxExpression(n) && n.expression && n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))
        && MAPA_ETIQUETAS.test(n.expression.getText(sf)) && !n.expression.getText(sf).includes("<") && !/^tr?\(/.test(n.expression.getText(sf))) {
      usaT = true;
      cambios.push({ ini: n.expression.getStart(sf), fin: n.expression.getEnd(), texto: `${T}(${n.expression.getText(sf)})`, clave: null });
    }
    if (ts.isJsxFragment(n)) { tramos(n); for (const h of n.children) if (!ts.isJsxText(h)) { ts.forEachChild(h, visitar); if (ts.isJsxElement(h)) visitar(h); } return; }
    // Atributos de texto
    if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer) && ATRIBUTOS.has(n.name.getText(sf))) {
      const v = n.initializer.text;
      if (tieneTexto(v) && !dentroDe(n, SIN_TOCAR)) {
        usaT = true;
        cambios.push({ ini: n.initializer.getStart(sf), fin: n.initializer.getEnd(), texto: `{${T}(${comillas(v)})}`, clave: v });
      }
      return;
    }
    // Cadenas dentro de {…} de JSX (ternarios, ??, ||) y en setters de mensajes
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) && !yaEnvuelto(n)) {
      let p = n.parent, ok = false;
      while (p && (ts.isConditionalExpression(p) || ts.isParenthesizedExpression(p) || (ts.isBinaryExpression(p) && /\?\?|\|\||&&/.test(p.operatorToken.getText(sf))))) p = p.parent;
      if (p && ts.isJsxExpression(p) && p.parent && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent))) ok = true;
      if (p && ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent) && ATRIBUTOS.has(p.parent.name.getText(sf))) ok = true;
      if (p && ts.isCallExpression(p) && SETTERS.has(p.expression.getText(sf))) ok = true;
      // La rama de un ternario cuyo padre es un JsxExpression ya está cubierta arriba.
      const texto = ts.isTemplateExpression(n) ? n.getText(sf).slice(1, -1) : n.text;
      if (ok && tieneTexto(texto.replace(/\$\{[^}]*\}/g, "")) && !dentroDe(n, SIN_TOCAR)) {
        usaT = true;
        if (ts.isTemplateExpression(n)) cambios.push({ ini: n.getStart(sf), fin: n.getEnd(), texto: `${T}(${n.getText(sf)})`, clave: texto.replace(/\$\{[^}]*\}/g, "{x}") });
        else cambios.push({ ini: n.getStart(sf), fin: n.getEnd(), texto: `${T}(${comillas(texto)})`, clave: texto });
        return;
      }
    }
    ts.forEachChild(n, visitar);
  }
  if (CAMPOS) {
    // Solo los campos de texto. Un acceso a propiedad, un identificador o una llamada conocida.
    const esCampo = (e) => {
      if (!e) return false;
      if (ts.isParenthesizedExpression(e)) return esCampo(e.expression);
      if (ts.isPropertyAccessExpression(e)) return CAMPOS_TEXTO.has(e.name.text);
      if (ts.isIdentifier(e)) return IDENT_TEXTO.has(e.text);
      if (ts.isCallExpression(e)) return ts.isIdentifier(e.expression) && FUNCIONES_TEXTO.has(e.expression.text);
      if (ts.isBinaryExpression(e) && /\?\?|\|\|/.test(e.operatorToken.getText(sf))) return esCampo(e.left);
      return false;
    };
    (function ver(n) {
      if (ts.isJsxExpression(n) && n.expression && esCampo(n.expression) && !/^tv?\(/.test(n.expression.getText(sf))
          && n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent) || (ts.isJsxAttribute(n.parent) && ATRIBUTOS.has(n.parent.name.getText(sf))))) {
        usaT = true;
        cambios.push({ ini: n.expression.getStart(sf), fin: n.expression.getEnd(), texto: `tv(${n.expression.getText(sf)})`, clave: null });
      }
      ts.forEachChild(n, ver);
    })(sf);
  } else {
    visitar(sf);
  }

  if (!cambios.length) { console.log(`· ${f}: nada que envolver`); continue; }
  if (SERVIDOR && usaT) {
    // Cada componente (función con nombre en mayúscula) que contenga un cambio pasa a ser
    // async y obtiene su t al principio del cuerpo.
    const funciones = [];
    (function buscar(n) {
      if (ts.isFunctionDeclaration(n) && n.name && /^[A-Z]/.test(n.name.text) && n.body) funciones.push(n);
      ts.forEachChild(n, buscar);
    })(sf);
    for (const fn of funciones) {
      const ini = fn.body.getStart(sf), fin = fn.body.getEnd();
      if (!cambios.some((c) => c.ini > ini && c.fin <= fin && /\bt[a-z]*\(/.test(c.texto))) continue;
      const esAsync = (fn.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (!esAsync) {
        const kw = fn.getChildren(sf).find((c) => c.kind === ts.SyntaxKind.FunctionKeyword);
        cambios.push({ ini: kw.getStart(sf), fin: kw.getStart(sf), texto: "async ", clave: null });
      }
      cambios.push({ ini: ini + 1, fin: ini + 1, texto: `\n  const ${T} = await tServidor();`, clave: null });
    }
  }
  // Aplicar de atrás hacia delante; descartar solapes (gana el exterior, que se anotó antes).
  cambios.sort((x, y) => x.ini - y.ini || y.fin - x.fin);
  const finales = [];
  let hasta = -1;
  for (const c of cambios) { if (c.ini < hasta) continue; finales.push(c); hasta = c.fin; }
  let out = src;
  for (const c of finales.reverse()) out = out.slice(0, c.ini) + c.texto + out.slice(c.fin);
  // Imports
  const imps = [];
  if (SERVIDOR) {
    if (usaT && !/tServidor/.test(src)) imps.push('import { tServidor } from "@/lib/i18n/servidor";');
    if (usaTrans && !/import TransServidor from/.test(out)) imps.push('import TransServidor from "@/components/TransServidor";');
  } else {
    if (CAMPOS) {
      if (usaT && !/\btv\b[^\n]*from "@\/lib\/i18n\/cliente"/.test(out)) {
        if (/import \{([^}]*)\} from "@\/lib\/i18n\/cliente";/.test(out)) out = out.replace(/import \{([^}]*)\} from "@\/lib\/i18n\/cliente";/, (m, g) => `import {${g.replace(/\s+$/, "")}, tv } from "@/lib/i18n/cliente";`);
        else imps.push('import { tv } from "@/lib/i18n/cliente";');
      }
    } else if (usaT && !/from "@\/lib\/i18n\/cliente"/.test(out)) imps.push(T === "t" ? 'import { t } from "@/lib/i18n/cliente";' : `import { t as ${T} } from "@/lib/i18n/cliente";`);
    if (usaTrans && !/import Trans from/.test(out)) imps.push('import Trans from "@/components/Trans";');
  }
  if (imps.length) {
    // Tras la ÚLTIMA declaración import (puede ocupar varias líneas).
    const sf2 = ts.createSourceFile(f, out, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const decl = sf2.statements.filter(ts.isImportDeclaration);
    const pos = decl.length ? decl[decl.length - 1].getEnd() : (out.startsWith('"use client"') ? out.indexOf("\n") : 0);
    out = out.slice(0, pos) + "\n" + imps.join("\n") + out.slice(pos);
  }
  if (!SECO) writeFileSync(f, out);
  console.log(`✓ ${f}: ${finales.length} cambios`);
  for (const k of new Set(finales.map((c) => c.clave).filter(Boolean))) console.log("  KEY\t" + k);
}
