// ─────────────────────────────────────────────────────────────────────────────
// LECTOR DE PTR DEL CONGRESO — sin dependencias, y sin adivinar posiciones
//
// Los tres intentos anteriores fallaron por lo mismo: emparejar objetos con flujos buscando
// `obj` y `stream` con expresiones regulares. Cuando un objeto no tiene flujo, o su diccionario
// es largo, o hay bytes binarios que parecen una cabecera, el emparejamiento se equivoca y la
// clave por objeto sale mal. El sintoma es «incorrect header check», que parece un fallo de
// cifrado y no lo es.
//
// LA SOLUCION es dejar de adivinar: el PDF trae una TABLA DE REFERENCIAS CRUZADAS con el
// desplazamiento EXACTO en bytes de cada objeto. `startxref` al final dice donde empieza.
//
// ⚠️ ESTADO: LLEGA HASTA LA CAPA DE GLIFOS, NO HASTA EL TEXTO.
//
// Lo que YA funciona, probado sobre un PTR real (DocID 20032062):
//   · descifrado completo sin dependencias — RC4 propio validado contra el vector conocido
//     RC4("Key","Plaintext") = BBF316E8D940AF0AD3
//   · el flujo de contenido descomprime a 32.040 bytes con 94 % de caracteres legibles
//
// Lo que FALTA: el texto va en cadenas HEXADECIMALES que son INDICES DE GLIFO (0033, 0287,
// 0294...), no ASCII ni UTF-16 — hay 199 operadores Tj y CERO parentesis. Convertirlos a
// letras necesita el mapa /ToUnicode de cada fuente subconjunto, que es otro flujo del MISMO
// fichero. Alcanzable, ~40-60 lineas mas.
//
// ⚠️ Y ESTA APARCADO A PROPOSITO, no por dificultad. Todo lo medido dice que la ventaja de
// Scora esta en la ASIGNACION, no en la seleccion: Brinson 96/4, IC 0,007, y una ventaja de
// seleccion que pasa de +30,1 pp en una ventana a +1,3 en la otra. Añadir otra señal de
// seleccion mejora el eje que no aporta. Se retoma si el registro vivo llega a mostrar que
// esa capa funciona, o si se quiere enseñar las operaciones como DATO EN PANTALLA, que no
// exige medir nada ni gastar ensayo del presupuesto.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { inflateSync } from "zlib";

export function leerPTR(buf) {
  const s = buf.toString("latin1");

  // ── 1. Tabla de referencias cruzadas: objeto -> desplazamiento ──────────────────────────
  const sx = /startxref\s+(\d+)/.exec(s.slice(-2048));
  if (!sx) throw new Error("sin startxref");
  const tablaIni = +sx[1];
  const offsets = new Map();
  const cab = /xref\s+(\d+)\s+(\d+)/.exec(s.slice(tablaIni, tablaIni + 64));
  if (!cab) throw new Error("la tabla no es clasica (xref stream): no soportado aqui");
  let pos = tablaIni + cab[0].length;
  const primero = +cab[1], cuantos = +cab[2];
  for (let i = 0; i < cuantos; i++) {
    const linea = s.slice(pos, pos + 20);
    const m = /(\d{10})\s+(\d{5})\s+([nf])/.exec(linea);
    if (m && m[3] === "n") offsets.set(primero + i, { off: +m[1], gen: +m[2] });
    pos += 20;
  }

  // ── 2. Clave maestra (contraseña vacia, algoritmo 2 del estandar) ───────────────────────
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

  /** Diccionario y flujo de un objeto, por su desplazamiento exacto. */
  function objeto(num) {
    const e = offsets.get(num);
    if (!e) return null;
    const trozo = s.slice(e.off, e.off + 2000);
    const iniStream = trozo.indexOf("stream");
    const dic = iniStream >= 0 ? trozo.slice(0, iniStream) : trozo;
    if (iniStream < 0) return { dic, flujo: null };
    let d0 = e.off + iniStream + "stream".length;
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

  // ── 3. De la pagina a su contenido, y a los XObject que dibuje ──────────────────────────
  const aLeer = [];
  for (const [num] of offsets) {
    const o = objeto(num);
    if (!o || !/\/Type\s*\/Page[^s]/.test(o.dic)) continue;
    const c = /\/Contents\s+(\d+)\s+\d+\s+R/.exec(o.dic);
    if (c) aLeer.push(+c[1]);
    for (const m of o.dic.matchAll(/\/X\w*\s+(\d+)\s+\d+\s+R/g)) aLeer.push(+m[1]);
  }

  const partes = [];
  const vistos = new Set();
  const recoger = (num, prof = 0) => {
    if (prof > 3 || vistos.has(num)) return;
    vistos.add(num);
    const o = objeto(num);
    if (!o?.flujo) return;
    // Una IMAGEN no es texto: su JPEG descomprimido tiene parentesis por todas partes y
    // ensuciaba la extraccion. Se salta por subtipo, no por adivinar.
    if (/\/Subtype\s*\/Image/.test(o.dic)) return;
    // Las cadenas literales de los operadores de texto.
    for (const g of o.flujo.matchAll(/\(((?:\\.|[^()\\])*)\)/g)) partes.push(g[1]);
    // Un contenido puede dibujar otro XObject: se sigue la cadena.
    for (const m of o.dic.matchAll(/\/X\w*\s+(\d+)\s+\d+\s+R/g)) recoger(+m[1], prof + 1);
  };
  for (const num of aLeer) recoger(num);

  const desesc = (t) => t.replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: "\n", r: "\r", t: "\t", b: "", f: "" }[c] ?? c));
  return { objetos: [...vistos], texto: partes.map(desesc).join("") };
}

if (process.argv[2]) {
  const { objetos, texto } = leerPTR(readFileSync(process.argv[2]));
  console.log(`  objetos leidos: ${objetos.join(", ")}`);
  console.log(`  texto extraido: ${texto.length} caracteres`);
  console.log(`  muestra: ${texto.slice(0, 420).replace(/\s+/g, " ")}`);
}
