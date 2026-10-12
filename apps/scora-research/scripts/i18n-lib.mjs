// Saca las frases visibles que generan los módulos de lib/ (lecturas, alertas, explicaciones)
// como claves para el diccionario: los ${…} se vuelven {a}, {b}… Uso:
//   node scripts/i18n-lib.mjs lib/secular.ts lib/tipos.ts …
import ts from "typescript";
import { readFileSync } from "fs";
const letras = (s) => /[a-z]{2,}.*\s.*[a-z]{2,}/i.test(s) && /[a-z]/.test(s);
for (const f of process.argv.slice(2)) {
  const src = readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = new Set();
  (function ver(n) {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    let txt = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) txt = n.text;
    else if (ts.isTemplateExpression(n)) {
      let i = 0; const nom = () => String.fromCharCode(97 + i++);
      txt = n.head.text + n.templateSpans.map((s) => `{${nom()}}` + s.literal.text).join("");
    }
    if (txt !== null) {
      const p = n.parent;
      const esClaveObjeto = p && ts.isPropertyAssignment(p) && p.name === n;
      const esIndice = p && ts.isElementAccessExpression(p);
      const esComparacion = p && ts.isBinaryExpression(p) && /===|!==|==|!=/.test(p.operatorToken.getText(sf));
      const esCaso = p && ts.isCaseClause(p);
      if (!esClaveObjeto && !esIndice && !esComparacion && !esCaso && letras(txt) && txt.trim().split(/\s+/).length >= 2
          && !/^(var\(|#|rgba?\(|https?:|\/|[a-z_]+\.[a-z]+$)/.test(txt.trim()) && !/^[a-z0-9_-]+$/.test(txt)) out.add(txt.trim());
      if (!ts.isTemplateExpression(n)) return;
    }
    ts.forEachChild(n, ver);
  })(sf);
  if (out.size) { console.log(`## ${f} (${out.size})`); for (const x of out) console.log(x); }
}
