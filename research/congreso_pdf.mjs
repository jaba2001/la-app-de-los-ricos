// ─────────────────────────────────────────────────────────────────────────────
// LECTOR DE LOS PTR DEL CONGRESO — sin ninguna dependencia
//
// Los informes de operaciones (Periodic Transaction Reports) que la Cámara publica por
// obligación legal son PDF de TEXTO, cifrados con el manejador estándar y contraseña VACÍA:
// el cifrado sólo fija permisos, no protege nada. Node trae todo lo necesario —MD5 en
// `crypto`, inflate en `zlib`— y RC4 son veinte líneas.
//
// ⚠️ LAS CUATRO TRAMPAS QUE COSTARON LLEGAR AQUÍ, y que quedan escritas porque las cuatro
// producían el mismo síntoma engañoso —«incorrect header check»— que parece un fallo de
// cifrado y no lo es:
//
//   1. **Buscar `/P` en todo el fichero** capturaba un 22 de otro objeto. Los parámetros hay
//      que leerlos DENTRO del diccionario de cifrado, localizado por su referencia.
//   2. **`/O` es una cadena HEXADECIMAL** `<...>`, no literal `(...)`.
//   3. **Emparejar `obj` con `stream` por expresión regular** asigna el número de un objeto al
//      flujo de OTRO cuando hay objetos sin flujo por medio. Cazado por fuerza bruta: el flujo
//      que yo leía como del objeto 6 descifraba con la clave del 11. Se resuelve usando la
//      TABLA DE REFERENCIAS CRUZADAS, que da el desplazamiento exacto en bytes.
//   4. **Un XObject de imagen** tiene paréntesis por todas partes en su JPEG y ensuciaba el
//      texto. Se salta por `/Subtype`.
//
// ⚠️ Y LA QUINTA, que es la que hace falta entender: el texto NO va en `(...) Tj` sino en
// `<hex> Tj`, y ese hexadecimal son **índices de glifo**, no letras. Las fuentes son Type0 con
// codificación Identity-H, así que cada par de bytes es un identificador dentro de la fuente
// subconjunto. Para convertirlo a caracteres hay que leer el mapa `/ToUnicode` de cada fuente
// —otro flujo del mismo fichero— y seguir qué fuente está activa con el operador `Tf`.
//
//   node research/congreso_pdf.mjs fichero.pdf
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { inflateSync } from "zlib";

export function leerPTR(buf) {
  const s = buf.toString("latin1");

  // ── 1. Tabla de referencias cruzadas: objeto → desplazamiento exacto ────────────────────
  const sx = /startxref\s+(\d+)/.exec(s.slice(-2048));
  if (!sx) throw new Error("sin startxref");
  const offsets = new Map();
  const tablaIni = +sx[1];
  const cab = /xref\s+(\d+)\s+(\d+)/.exec(s.slice(tablaIni, tablaIni + 64));
  if (!cab) {
    // ⚠️ DOS CAUSAS DISTINTAS, y confundirlas manda a depurar el sitio equivocado.
    // Un PTR ESCANEADO —presentado en papel— llega como PDF 1.5 sin cifrar, con la tabla en
    // formato de flujo y CERO fuentes: son imagenes. Ahi no hay texto que extraer, hace falta
    // OCR, y eso es otro problema. Un PDF electronico con tabla de flujo si seria una carencia
    // de este lector.
    const sinFuentes = !/\/Font/.test(s);
    throw new Error(sinFuentes
      ? "documento ESCANEADO (sin fuentes, solo imagenes): necesita OCR, no un lector de texto"
      : "tabla de referencias en formato de flujo: no soportado por este lector");
  }
  let pos = tablaIni + cab[0].length;
  for (let i = 0; i < +cab[2]; i++) {
    const m = /(\d{10})\s+(\d{5})\s+([nf])/.exec(s.slice(pos, pos + 20));
    if (m && m[3] === "n") offsets.set(+cab[1] + i, { off: +m[1], gen: +m[2] });
    pos += 20;
  }

  // ── 2. Clave maestra: algoritmo 2 del estándar, contraseña vacía ────────────────────────
  const ref = /\/Encrypt\s+(\d+)\s+(\d+)\s+R/.exec(s);
  let key = null, n = 0;
  if (ref) {
    const e = offsets.get(+ref[1]);
    const dict = e ? s.slice(e.off, e.off + 400) : "";
    const O = /\/O\s*<([0-9A-Fa-f]+)>/.exec(dict);
    const P = /\/P\s*(-?\d+)/.exec(dict);
    const ID = /\/ID\s*\[\s*<([0-9A-Fa-f]+)>/.exec(s);
    const R = /\/R\s*(\d+)/.exec(dict);
    const LEN = /\/Length\s*(\d+)/.exec(dict);
    if (!O || !P || !ID || !R) throw new Error("diccionario de cifrado incompleto");
    const PAD = Buffer.from([0x28,0xBF,0x4E,0x5E,0x4E,0x75,0x8A,0x41,0x64,0x00,0x4E,0x56,0xFF,0xFA,0x01,0x08,
                             0x2E,0x2E,0x00,0xB6,0xD0,0x68,0x3E,0x80,0x2F,0x0C,0xA9,0xFE,0x64,0x53,0x69,0x7A]);
    const pb = Buffer.alloc(4); pb.writeInt32LE(parseInt(P[1], 10));
    n = LEN ? Math.floor(parseInt(LEN[1], 10) / 8) : 5;
    let h = createHash("md5").update(PAD).update(Buffer.from(O[1], "hex")).update(pb).update(Buffer.from(ID[1], "hex")).digest();
    if (+R[1] >= 3) for (let i = 0; i < 50; i++) h = createHash("md5").update(h.subarray(0, n)).digest();
    key = h.subarray(0, n);
  }
  const rc4 = (k, data) => {
    const S = [...Array(256).keys()];
    let j = 0;
    for (let i = 0; i < 256; i++) { j = (j + S[i] + k[i % k.length]) & 255; [S[i], S[j]] = [S[j], S[i]]; }
    const out = Buffer.alloc(data.length);
    let i = 0; j = 0;
    for (let c = 0; c < data.length; c++) {
      i = (i + 1) & 255; j = (j + S[i]) & 255; [S[i], S[j]] = [S[j], S[i]];
      out[c] = data[c] ^ S[(S[i] + S[j]) & 255];
    }
    return out;
  };
  const objKey = (num, gen) => {
    const e = Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255]);
    return createHash("md5").update(Buffer.concat([key, e])).digest().subarray(0, Math.min(n + 5, 16));
  };

  /** Diccionario y flujo (descifrado y descomprimido) de un objeto. */
  function objeto(num) {
    const e = offsets.get(num);
    if (!e) return null;
    const trozo = s.slice(e.off, e.off + 3000);
    const iS = trozo.indexOf("stream");
    const dic = iS >= 0 ? trozo.slice(0, iS) : trozo;
    if (iS < 0) return { dic, flujo: null };
    let d0 = e.off + iS + 6;
    if (s[d0] === "\r") d0++;
    if (s[d0] === "\n") d0++;
    const L = /\/Length\s+(\d+)/.exec(dic);
    const largo = L ? +L[1] : (s.indexOf("endstream", d0) - d0);
    if (largo <= 0) return { dic, flujo: null };
    try {
      let d = buf.subarray(d0, d0 + largo);
      if (key) d = rc4(objKey(num, e.gen), d);
      if (/FlateDecode/.test(dic)) d = inflateSync(d);
      return { dic, flujo: d.toString("latin1") };
    } catch { return { dic, flujo: null }; }
  }

  // ── 3. Mapa de glifos a caracteres, desde el CMap /ToUnicode de cada fuente ─────────────
  //
  // El CMap declara los pares en dos formas, y hay que soportar las dos:
  //   · `beginbfchar`  <origen> <destino>              — uno a uno
  //   · `beginbfrange` <desde> <hasta> <destinoInicial> — un rango consecutivo
  // El destino es UTF-16BE, así que puede tener más de un carácter por glifo.
  function mapaDeFuente(numFuente) {
    const f = objeto(numFuente);
    if (!f) return null;
    const tu = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(f.dic);
    if (!tu) return null;
    const cmap = objeto(+tu[1])?.flujo;
    if (!cmap) return null;
    const mapa = new Map();
    const aTexto = (hex) => {
      let t = "";
      for (let i = 0; i + 3 < hex.length + 1; i += 4) t += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
      return t;
    };
    for (const bloque of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const p of bloque[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        mapa.set(parseInt(p[1], 16), aTexto(p[2]));
      }
    }
    for (const bloque of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const p of bloque[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const desde = parseInt(p[1], 16), hasta = parseInt(p[2], 16), base = parseInt(p[3], 16);
        for (let c = desde; c <= hasta && c - desde < 65536; c++) mapa.set(c, String.fromCharCode(base + (c - desde)));
      }
    }
    return mapa;
  }

  // ── 4. Del objeto de página a su contenido, siguiendo los XObject de formulario ─────────
  const contenidos = [];
  for (const [num] of offsets) {
    const o = objeto(num);
    if (!o || !/\/Type\s*\/Page[^s]/.test(o.dic)) continue;
    const c = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(o.dic);
    if (c) contenidos.push(+c[1]);
    // ⚠️ Los XObject se declaran en los RECURSOS DE LA PAGINA, no en el diccionario del flujo
    // de contenido. Buscarlos ahi dejaba fuera justo el formulario que tiene todo el texto.
    for (const x of o.dic.matchAll(/\/X\w*\s+(\d+)\s+\d+\s+R/g)) contenidos.push(+x[1]);
  }

  const vistos = new Set();
  let texto = "";
  let glifos = 0, mapeados = 0;
  const recorrer = (num, prof = 0) => {
    if (prof > 4 || vistos.has(num)) return;
    vistos.add(num);
    const o = objeto(num);
    if (!o?.flujo || /\/Subtype\s*\/Image/.test(o.dic)) return;

    // Fuentes disponibles en ESTE flujo: /F5 15 0 R, /F6 20 0 R…
    const fuentes = new Map();
    const bloqueFont = /\/Font\s*<<([\s\S]*?)>>/.exec(o.dic);
    if (bloqueFont) {
      for (const m of bloqueFont[1].matchAll(/\/(\w+)\s+(\d+)\s+\d+\s+R/g)) {
        const mapa = mapaDeFuente(+m[2]);
        if (mapa) fuentes.set(m[1], mapa);
      }
    }

    // Recorrido del flujo en orden: `Tf` cambia la fuente activa, `Tj`/`TJ` emiten texto.
    let activa = null, ultimaY = null;
    // ⚠️ NADA de emitir un salto por cada operador de posición. Este PDF coloca CADA CARÁCTER
    // con su propia matriz de texto, así que hacerlo llenaba la salida de saltos y la volvía
    // ilegible aunque el texto estuviera bien extraído. El salto se decide por la coordenada
    // VERTICAL de la matriz: si baja de línea, hay salto.
    const re = /\/(\w+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj|\[([^\]]*)\]\s*TJ|[-\d.]+\s+([-\d.]+)\s+Tm/g;
    let m;
    while ((m = re.exec(o.flujo))) {
      if (m[1] !== undefined) { activa = fuentes.get(m[1]) ?? activa; continue; }
      const decodifica = (hex) => {
        let t = "";
        for (let i = 0; i + 3 < hex.length + 1; i += 4) {
          const g = parseInt(hex.slice(i, i + 4), 16);
          glifos++;
          const c = activa?.get(g);
          // Un destino U+0000 significa que la PROPIA FUENTE declara que ese glifo no tiene
          // caracter unicode. No es un fallo de lectura: es informacion que el PDF no lleva.
          if (c && c !== String.fromCharCode(0)) { mapeados++; t += c; }
        }
        return t;
      };
      if (m[2] !== undefined) { texto += decodifica(m[2]); continue; }
      if (m[3] !== undefined) {
        for (const h of m[3].matchAll(/<([0-9A-Fa-f]+)>/g)) texto += decodifica(h[1]);
        continue;
      }
      // Un cambio apreciable en la vertical es una línea nueva.
      const y = parseFloat(m[4]);
      if (Number.isFinite(y)) {
        if (ultimaY !== null && Math.abs(y - ultimaY) > 1.5) texto += "\n";
        ultimaY = y;
      }
    }

    for (const x of o.dic.matchAll(/\/X\w*\s+(\d+)\s+\d+\s+R/g)) recorrer(+x[1], prof + 1);
  };
  for (const c of contenidos) recorrer(c);

  return { objetos: [...vistos], texto, glifos, mapeados,
    cobertura: glifos ? +(mapeados / glifos * 100).toFixed(1) : null };
}

if (process.argv[2]) {
  const { objetos, texto, glifos, mapeados, cobertura } = leerPTR(readFileSync(process.argv[2]));
  console.log(`  objetos leídos: ${objetos.join(", ")}`);
  console.log(`  glifos: ${glifos} · con carácter unicode: ${mapeados} (${cobertura} %)`);
  console.log(`  texto extraído: ${texto.length} caracteres`);
  console.log(`  ─────────────────────────────────────────────`);
  console.log(texto.slice(0, 900));
}
