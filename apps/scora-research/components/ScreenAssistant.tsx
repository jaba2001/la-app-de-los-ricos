"use client";
// El asistente de pantalla: un botón fijo abajo a la derecha que abre un panel de chat para
// preguntar por lo que hay en la página («¿qué significa este gráfico?», «explícame esta
// tabla»), como la extensión de Claude en el navegador.
//
// Con cada pregunta se manda una foto NUEVA de la página (lib/pantalla.ts): si el usuario cambia
// de página o se desplaza entre pregunta y pregunta, la respuesta habla de lo que ve AHORA. La
// conversación sobrevive a la navegación porque el panel vive en el layout raíz.
//
// Lo que el usuario selecciona en la página se guarda al vuelo: al hacer clic en el panel para
// escribir, el navegador borra la selección, así que leerla al enviar llegaría tarde.
//
// Lo que el modelo cita de la página entre [[dobles corchetes]] se pinta como un enlace: al
// pulsarlo, la página se desplaza hasta ese texto y lo resalta (lib/resaltar.ts).
import "./ScreenAssistant.css";
import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { t, idiomaActivo } from "@/lib/i18n/cliente";
import { capturarPantalla, ATRIBUTO_EXCLUIR } from "@/lib/pantalla";
import { preguntarAsistente, RechazoError, type Cierre, type Turno } from "@/lib/asistente";
import { QuotaError } from "@/lib/proxy";
import { GroundedBadge } from "@/components/ui/GroundedBadge";
import { resaltarEnPagina, limpiarResaltado } from "@/lib/resaltar";

/** Lo que hace el panel cuando el usuario pulsa una cita (en el móvil, apartarse). */
const AlCitar = createContext<() => void>(() => {});

interface Mensaje {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Página sobre la que se preguntó (solo en los del usuario). */
  path?: string;
  estado?: "escribiendo" | "ok" | "error";
  cierre?: Cierre;
  error?: string;
  /** El error es de cuota: se ofrece subir de plan. */
  cuota?: boolean;
}

// Debe coincidir con MAX_MENSAJES de lib/server/asistente.js.
const MAX_HISTORIAL = 12;
// Rutas donde el botón estorba: el login y la vuelta del proveedor de identidad.
const SIN_ASISTENTE = /^\/(login|auth)(\/|$)/;

const SUGERENCIAS = [
  "Explain this page",
  "What are the key numbers on screen?",
  "How do I read this chart?",
  "Explain the jargon on screen",
];

let siguienteId = 1;

/** El historial que se manda: solo turnos completos, empezando por el usuario, hasta el tope. */
function historialParaEnviar(mensajes: Mensaje[], pregunta: string): Turno[] {
  const completos: Turno[] = [];
  for (let i = 0; i < mensajes.length; i++) {
    const m = mensajes[i], r = mensajes[i + 1];
    // Una pregunta cuya respuesta falló no se manda: el modelo la vería sin contestar.
    if (m.role === "user" && r?.role === "assistant" && r.estado === "ok") {
      completos.push({ role: "user", content: m.content }, { role: "assistant", content: r.content });
      i++;
    }
  }
  let turnos = [...completos, { role: "user" as const, content: pregunta }].slice(-MAX_HISTORIAL);
  if (turnos[0].role !== "user") turnos = turnos.slice(1);
  return turnos;
}

export default function ScreenAssistant() {
  const pathname = usePathname();
  const { session, loading } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [borrador, setBorrador] = useState("");
  const [seleccion, setSeleccion] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const abortar = useRef<AbortController | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // La selección de la página, guardada mientras el panel está abierto (ver cabecera).
  useEffect(() => {
    if (!abierto) return;
    const alCambiar = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const nodo = sel.getRangeAt(0).commonAncestorContainer;
      const el = nodo.nodeType === Node.ELEMENT_NODE ? (nodo as Element) : nodo.parentElement;
      if (el?.closest(`[${ATRIBUTO_EXCLUIR}]`)) return; // lo seleccionado dentro del panel no cuenta
      const texto = sel.toString().trim();
      if (texto) setSeleccion(texto.slice(0, 4000));
    };
    alCambiar();
    document.addEventListener("selectionchange", alCambiar);
    return () => document.removeEventListener("selectionchange", alCambiar);
  }, [abierto]);

  // En escritorio la página se estrecha para dejar sitio al panel (ver ScreenAssistant.css) en
  // vez de quedar tapada: lo que el usuario pregunta tiene que seguir a la vista.
  useEffect(() => {
    if (!abierto) return;
    document.documentElement.classList.add("sr-asis-abierto");
    return () => document.documentElement.classList.remove("sr-asis-abierto");
  }, [abierto]);

  // Esc cierra; al abrir, el foco va al cuadro de texto.
  useEffect(() => {
    if (!abierto) return;
    entrada.current?.focus();
    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  // Bajar al último mensaje mientras llega la respuesta, salvo que el usuario haya subido a leer.
  useEffect(() => {
    const el = lista.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [mensajes]);

  // Cerrar el panel no corta una respuesta a medias; desmontarlo (salir de la app) sí.
  useEffect(() => () => abortar.current?.abort(), []);

  const enviar = useCallback(async (pregunta: string) => {
    const q = pregunta.trim();
    if (!q || ocupado) return;
    const idUsuario = siguienteId++, idRespuesta = siguienteId++;
    const turnos = historialParaEnviar(mensajes, q);
    const path = window.location.pathname;
    setMensajes((ms) => [...ms,
      { id: idUsuario, role: "user", content: q, path },
      { id: idRespuesta, role: "assistant", content: "", estado: "escribiendo" }]);
    setBorrador("");
    setOcupado(true);
    const ctrl = new AbortController();
    abortar.current = ctrl;
    const actualizar = (cambios: Partial<Mensaje>) =>
      setMensajes((ms) => ms.map((m) => (m.id === idRespuesta ? { ...m, ...cambios } : m)));

    try {
      const captura = await capturarPantalla(seleccion);
      const cierre = await preguntarAsistente({
        mensajes: turnos, captura, idioma: idiomaActivo(), signal: ctrl.signal,
        alTexto: (acumulado) => actualizar({ content: acumulado }),
      });
      actualizar({ estado: "ok", cierre });
      setSeleccion(""); // usada: la siguiente pregunta no la arrastra sin querer
    } catch (e) {
      if (ctrl.signal.aborted) {
        actualizar({ estado: "error", error: "Stopped." });
      } else {
        const err = e instanceof Error ? e : new Error(String(e));
        // Un rechazo descarta lo recibido: era parcial y la cadena entera lo declinó.
        actualizar({ estado: "error", error: err.message, cuota: err instanceof QuotaError,
          ...(err instanceof RechazoError ? { content: "" } : {}) });
      }
    } finally {
      setOcupado(false);
      abortar.current = null;
    }
  }, [mensajes, ocupado, seleccion]);

  // Una marca de otra página no tiene sentido en esta.
  useEffect(() => { limpiarResaltado(); }, [pathname]);

  // En el móvil el panel tapa la página entera: tras pulsar una cita se cierra para que se vea
  // dónde está. La conversación sigue ahí al volver a abrirlo.
  const alCitar = useCallback(() => {
    if (window.matchMedia("(max-width: 640px)").matches) setAbierto(false);
  }, []);

  if (SIN_ASISTENTE.test(pathname ?? "")) return null;

  const nueva = () => { abortar.current?.abort(); setMensajes([]); setSeleccion(""); entrada.current?.focus(); };

  return (
    <>
      {!abierto && (
        <button type="button" className="sr-asis-lanzador" onClick={() => setAbierto(true)}
          {...{ [ATRIBUTO_EXCLUIR]: "" }} aria-label={t("Ask AI about this page")}>
          <Destello />
          <span className="sr-asis-lanzador-txt">{t("Ask about this page")}</span>
        </button>
      )}

      {abierto && (
        <aside ref={panel} className="sr-asis-panel" {...{ [ATRIBUTO_EXCLUIR]: "" }}
          role="dialog" aria-label={t("Page assistant")}>
          <header className="sr-asis-cabecera">
            <div>
              <div className="sr-asis-titulo"><Destello /> {t("Page assistant")}</div>
              <div className="sr-asis-sub">{t("Reads what's on your screen and explains it")}</div>
            </div>
            <div className="sr-asis-acciones">
              {mensajes.length > 0 && (
                <button type="button" className="sr-asis-icono" onClick={nueva} title={t("New conversation")} aria-label={t("New conversation")}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                </button>
              )}
              <button type="button" className="sr-asis-icono" onClick={() => setAbierto(false)} title={t("Close")} aria-label={t("Close")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          </header>

          {!loading && !session ? (
            <div className="sr-asis-vacio">
              <p>{t("Sign in to ask the assistant about this page.")}</p>
              <Link href="/login" className="sr-asis-boton">{t("Sign in")}</Link>
            </div>
          ) : (
            <>
              <div className="sr-asis-lista" ref={lista} aria-live="polite">
                {mensajes.length === 0 ? (
                  <div className="sr-asis-vacio">
                    <p>{t("Ask anything about what you're looking at: a chart, a table, a metric or the whole page.")}</p>
                    <div className="sr-asis-sugerencias">
                      {SUGERENCIAS.map((s) => (
                        <button key={s} type="button" className="sr-asis-chip" onClick={() => enviar(t(s))}>{t(s)}</button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <AlCitar.Provider value={alCitar}>{mensajes.map((m) => <Burbuja key={m.id} m={m} />)}</AlCitar.Provider>
                )}
              </div>

              <div className="sr-asis-pie">
                {seleccion && (
                  <div className="sr-asis-seleccion">
                    <span className="sr-asis-seleccion-txt">{t("Selected")}: “{seleccion}”</span>
                    <button type="button" className="sr-asis-icono" onClick={() => setSeleccion("")} aria-label={t("Clear selection")}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                )}
                <form className="sr-asis-form" onSubmit={(e) => { e.preventDefault(); enviar(borrador); }}>
                  <textarea ref={entrada} rows={1} value={borrador} maxLength={4000}
                    placeholder={seleccion ? t("Ask about the selected text…") : t("Ask about this page…")}
                    onChange={(e) => setBorrador(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); enviar(borrador); } }} />
                  {ocupado ? (
                    <button type="button" className="sr-asis-enviar" onClick={() => abortar.current?.abort()} aria-label={t("Stop")} title={t("Stop")}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                    </button>
                  ) : (
                    <button type="submit" className="sr-asis-enviar" disabled={!borrador.trim()} aria-label={t("Send")} title={t("Send")}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
                    </button>
                  )}
                </form>
                <p className="sr-asis-aviso">{t("Sends this page's content to the AI. Educational only — not investment advice.")}</p>
              </div>
            </>
          )}
        </aside>
      )}
    </>
  );
}

function Burbuja({ m }: { m: Mensaje }) {
  if (m.role === "user") {
    return (
      <div className="sr-asis-usuario">
        <div className="sr-asis-usuario-txt">{m.content}</div>
        {m.path && <div className="sr-asis-ruta">{t(`on ${m.path}`)}</div>}
      </div>
    );
  }
  return (
    <div className="sr-asis-respuesta">
      {m.content ? <TextoRico texto={m.content} /> : m.estado === "escribiendo" && (
        <div className="sr-asis-leyendo"><span /><span /><span /> {t("Reading the page…")}</div>
      )}
      {m.estado === "error" && m.error && (
        <div className="sr-asis-error">
          {t(m.error)}
          {m.cuota && <> <Link href="/pricing">{t("See plans")}</Link></>}
        </div>
      )}
      {m.estado === "ok" && m.cierre?.truncated && <div className="sr-asis-error">{t("The answer was cut short.")}</div>}
      {m.estado === "ok" && m.cierre?.logged && <GroundedBadge violations={m.cierre.violations} />}
    </div>
  );
}

function Destello() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.9 6.1L20 10l-6.1 1.9L12 18l-1.9-6.1L4 10l6.1-1.9z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" opacity=".7" />
    </svg>
  );
}

/** Un trozo citado de la página. Pulsarlo lleva hasta él; pulsarlo otra vez, a la siguiente aparición. */
function Cita({ texto }: { texto: string }) {
  const alCitar = useContext(AlCitar);
  const vez = useRef(0);
  const [estado, setEstado] = useState<{ total: number; i: number } | null>(null);
  const ir = () => {
    const { total } = resaltarEnPagina(texto, vez.current);
    setEstado({ total, i: total ? (vez.current % total) + 1 : 0 });
    if (total) { vez.current++; alCitar(); }
  };
  return (
    <>
      <span role="button" tabIndex={0} className="sr-asis-cita" title={t("Show on page")} onClick={ir}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ir(); } }}>
        {texto}
      </span>
      {estado?.total === 0 && <span className="sr-asis-cita-nota">{t("not found on this page")}</span>}
      {estado && estado.total > 1 && <span className="sr-asis-cita-nota">{estado.i}/{estado.total}</span>}
    </>
  );
}

// ── Markdown mínimo ──────────────────────────────────────────────────────────────────
// Párrafos, listas, **negrita**, `código` y las [[citas]] de la página: lo que el prompt de
// sistema le pide al modelo. Se pinta con elementos de React, nunca como HTML, así que la
// respuesta no puede inyectar nada.

function enLinea(texto: string): React.ReactNode[] {
  return texto.split(/(\[\[[^\]\n]{1,200}\]\]|\*\*[^*]+\*\*|`[^`]+`)/g).map((trozo, i) => {
    if (trozo.startsWith("[[") && trozo.endsWith("]]") && trozo.length > 4) return <Cita key={i} texto={trozo.slice(2, -2).trim()} />;
    // La negrita puede llevar una cita dentro («**[[Sharpe]]**»).
    if (trozo.startsWith("**") && trozo.endsWith("**") && trozo.length > 4) return <strong key={i}>{enLinea(trozo.slice(2, -2))}</strong>;
    if (trozo.startsWith("`") && trozo.endsWith("`") && trozo.length > 2) return <code key={i}>{trozo.slice(1, -1)}</code>;
    return <Fragment key={i}>{trozo}</Fragment>;
  });
}

function TextoRico({ texto }: { texto: string }) {
  const bloques: React.ReactNode[] = [];
  let lista: { ordenada: boolean; items: string[] } | null = null;
  let parrafo: string[] = [];
  const cerrarParrafo = () => {
    if (parrafo.length) bloques.push(<p key={bloques.length}>{parrafo.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{enLinea(l)}</Fragment>)}</p>);
    parrafo = [];
  };
  const cerrarLista = () => {
    if (lista) {
      const Etiqueta = lista.ordenada ? "ol" : "ul";
      bloques.push(<Etiqueta key={bloques.length}>{lista.items.map((it, i) => <li key={i}>{enLinea(it)}</li>)}</Etiqueta>);
    }
    lista = null;
  };
  for (const linea of texto.split("\n")) {
    const vineta = /^\s*[-*•]\s+(.*)$/.exec(linea);
    const numero = /^\s*\d+[.)]\s+(.*)$/.exec(linea);
    if (vineta || numero) {
      cerrarParrafo();
      const ordenada = !!numero;
      if (!lista || lista.ordenada !== ordenada) { cerrarLista(); lista = { ordenada, items: [] }; }
      lista.items.push((vineta ?? numero)![1]);
    } else if (!linea.trim()) {
      cerrarParrafo(); cerrarLista();
    } else {
      cerrarLista();
      // Un título del modelo (pese al prompt) se pinta como una línea en negrita.
      parrafo.push(linea.replace(/^#{1,6}\s+(.*)$/, "**$1**"));
    }
  }
  cerrarParrafo(); cerrarLista();
  return <div className="sr-asis-rico">{bloques}</div>;
}
