"use client";
// El guía de Scora: un panel que comparte la pantalla con la página, como el de la extensión de
// Claude en el navegador, y ayuda a ENTENDER lo que se ve: qué significa un concepto, cómo se
// lee un gráfico, por qué importa. No es un buscador de la pantalla (eso fue la primera versión).
//
// LA FORMA (13-10-2026). Nunca tapa la página, para que todo se pueda seguir leyendo:
//   · con sitio (ventana de 1100 px o más) es una COLUMNA a la derecha, de arriba abajo, y la
//     página entera —su barra incluida— ocupa el resto, como con el panel lateral de Chrome. La
//     barra enseña las secciones que le caben y el resto va al menú ☰, en vivo mientras se cambia
//     el ancho del panel (ver ajustarBarra). El ancho se arrastra desde el borde izquierdo;
//   · con menos sitio (tableta, móvil) es una hoja ABAJO, y la página gana ese mismo espacio de
//     margen inferior para poder desplazarla entera por encima. La altura se arrastra desde arriba.
// El tamaño elegido se recuerda en este navegador.
//
// Con cada pregunta se manda una foto NUEVA de la página (lib/pantalla.ts) para que el guía sepa
// de qué se habla; la conversación sobrevive a la navegación porque el panel vive en el layout.
//
// Lo que el usuario selecciona en la página se guarda al vuelo: al hacer clic en el panel para
// escribir, el navegador borra la selección, así que leerla al enviar llegaría tarde.
import "./ScreenAssistant.css";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { t, idiomaActivo } from "@/lib/i18n/cliente";
import { capturarPantalla, ATRIBUTO_EXCLUIR } from "@/lib/pantalla";
import { preguntarAsistente, RechazoError, type Cierre, type Turno } from "@/lib/asistente";
import { QuotaError } from "@/lib/proxy";
import { GroundedBadge } from "@/components/ui/GroundedBadge";

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
// Rutas donde el guía estorba: el login y la vuelta del proveedor de identidad.
const SIN_ASISTENTE = /^\/(login|auth)(\/|$)/;
const asistenteVisible = (ruta: string) => !SIN_ASISTENTE.test(ruta);

type Modo = "lateral" | "inferior";
// Por debajo de esto, estrechar la página la dejaría con el diseño de escritorio en muy poco
// sitio (los media queries miran la ventana, no el hueco): el panel va abajo.
const VENTANA_LATERAL = 1100;
// La página nunca se queda con menos de esto al lado del panel: el diseño de móvil (640 px y
// menos, en globals.css) no hace falta emularlo.
const PAGINA_MIN = 640;
// Por debajo de esto el buscador de la barra ya no sirve (no se lee lo que se escribe).
const BUSCADOR_MIN = 180;

const OCULTO = "data-sr-oculto";

/**
 * Con el panel al lado, la barra enseña lo que le cabe y el resto pasa a su menú ☰ (el mismo de
 * una ventana estrecha, que ya trae todas las secciones, la cuenta y el idioma). Se MIDE: los
 * media queries de globals.css miran la ventana, no el hueco que deja el panel. Al estrechar el
 * panel vuelven a aparecer secciones; al ensancharlo se van al menú.
 *
 * Orden en que se esconden: Cerrar sesión, Cuenta e idioma (están en el menú), y después las
 * secciones desde la última, con la de la página actual al final de todo.
 */
/** ¿Está el nodo dentro del propio panel (o del botón)? Lo seleccionado ahí no es la página. */
const enPanel = (n: Node | null) =>
  !!(n?.nodeType === Node.ELEMENT_NODE ? (n as Element) : n?.parentElement)?.closest(`[${ATRIBUTO_EXCLUIR}]`);

function ajustarBarra(lateral: boolean) {
  const html = document.documentElement;
  const nav = document.querySelector<HTMLElement>(".nav-header");
  // Todo a la vista otra vez, y se mide desde ahí (sin pintar entre medias: no parpadea).
  nav?.querySelectorAll(`[${OCULTO}]`).forEach((e) => e.removeAttribute(OCULTO));
  html.classList.remove("sr-asis-nav-menu");
  if (!lateral || !nav) return;
  const buscador = nav.querySelector("input");
  const cabe = () => nav.scrollWidth <= nav.clientWidth + 1
    && (buscador == null || buscador.getBoundingClientRect().width >= BUSCADOR_MIN);
  if (cabe()) return;
  html.classList.add("sr-asis-nav-menu"); // el botón ☰ también ocupa: se mide con él
  const extras = [...nav.querySelectorAll<HTMLElement>(".nav-desktop")].filter((e) => e.tagName !== "NAV").reverse();
  const secciones = [...nav.querySelectorAll<HTMLElement>("nav.nav-desktop > *")].reverse();
  const orden = [...extras, ...secciones.filter((e) => !e.classList.contains("active")), ...secciones.filter((e) => e.classList.contains("active"))];
  for (const e of orden) {
    e.setAttribute(OCULTO, "");
    if (cabe()) return;
  }
}

const CLAVE_TAMANO = "sr-asis-tamano";

const limitarAncho = (px: number) =>
  Math.round(Math.max(340, Math.min(px, 760, window.innerWidth * 0.55, window.innerWidth - PAGINA_MIN)));
/** La altura de la hoja de abajo, como fracción de la ventana. */
const limitarAlto = (f: number) => Math.max(0.3, Math.min(0.85, f));

function tamanoGuardado(): { ancho?: number; alto?: number } {
  try { return JSON.parse(localStorage.getItem(CLAVE_TAMANO) ?? "{}") ?? {}; } catch { return {}; }
}
function guardarTamano(t: { ancho: number; alto: number }) {
  try { localStorage.setItem(CLAVE_TAMANO, JSON.stringify(t)); } catch { /* sin almacenamiento: no se recuerda */ }
}

// Preguntas para empezar, según la sección: sobre conceptos, no sobre «qué pone aquí».
const SUGERENCIAS: [RegExp, string[]][] = [
  [/^\/macro/, ["What is a macro regime?", "What do these indicators tell me?", "Explain this page in simple terms"]],
  [/^\/stock\/[^/]+/, ["How should I read this company's page?", "How is fair value estimated here?", "Explain the key metrics on this page"]],
  [/^\/stock/, ["How do I research a stock in Scora?", "What does the screener measure?", "Explain this page in simple terms"]],
  [/^\/(discovery|momentum)/, ["What is momentum?", "How is this ranking built?", "Explain this page in simple terms"]],
  [/^\/(track-record|evidence)/, ["What is a Sharpe ratio?", "What does drawdown mean?", "How do I know these results are honest?"]],
  [/^\/journal/, ["What is concentration risk?", "How do I read my exposure?", "Explain this page in simple terms"]],
  [/^\/daily/, ["What is the daily report for?", "What is a macro regime?", "Explain this page in simple terms"]],
  [/^\/audit/, ["How does Scora check its AI?", "What does 'grounded' mean?", "Explain this page in simple terms"]],
];
const SUGERENCIAS_GENERALES = ["What am I looking at?", "Explain the key concepts on this page", "How should I read this page?"];
const sugerenciasPara = (path: string) => SUGERENCIAS.find(([re]) => re.test(path))?.[1] ?? SUGERENCIAS_GENERALES;

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
  const pathname = usePathname() ?? "/";
  const { session, loading } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [borrador, setBorrador] = useState("");
  const [seleccion, setSeleccion] = useState("");
  const [ocupado, setOcupado] = useState(false);
  // Leídos de la ventana al crear el componente (con el panel cerrado no cambian el HTML, así que
  // el servidor puede pintar con los valores por defecto sin romper la hidratación).
  const enNavegador = typeof window !== "undefined";
  const [modo, setModo] = useState<Modo>(() => (enNavegador && window.innerWidth < VENTANA_LATERAL ? "inferior" : "lateral"));
  const [ancho, setAncho] = useState(() =>
    enNavegador ? limitarAncho(tamanoGuardado().ancho ?? Math.max(380, Math.min(500, window.innerWidth * 0.32))) : 420);
  const [alto, setAlto] = useState(() => (enNavegador ? limitarAlto(tamanoGuardado().alto ?? 0.5) : 0.5));
  const abortar = useRef<AbortController | null>(null);
  const lista = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLTextAreaElement>(null);
  const arrastre = useRef<{ desde: number; base: number; vivo: number } | null>(null);

  // En /login el guía no existe; si estaba abierto, la página no puede quedarse estrechada.
  const visible = asistenteVisible(pathname);

  // Si cambia la ventana (girar la tableta, estrecharla), el panel cambia de forma o de ancho.
  useEffect(() => {
    const medir = () => {
      setModo(window.innerWidth >= VENTANA_LATERAL ? "lateral" : "inferior");
      setAncho((a) => limitarAncho(a));
      // Con el mismo ancho de panel, a la página le queda otro sitio: la barra puede caber o no.
      if (document.documentElement.classList.contains("sr-asis-lateral")) ajustarBarra(true);
    };
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  // La página deja sitio al panel (ver ScreenAssistant.css): a la derecha o por abajo.
  useEffect(() => {
    if (!abierto || !visible) return;
    document.documentElement.classList.add(`sr-asis-${modo}`);
    const html = document.documentElement;
    html.style.setProperty("--sr-asis-ancho", `${ancho}px`);
    html.style.setProperty("--sr-asis-alto", `${Math.round(alto * 100)}dvh`);
    ajustarBarra(modo === "lateral");
    // La barra cambia de contenido sin que cambie su ancho (la cuota aparece tras la primera
    // pregunta, cambia la sesión…): se vuelve a medir. Solo hijos añadidos o quitados, así que
    // esconder o enseñar elementos (un atributo) no lo vuelve a disparar.
    const nav = document.querySelector(".nav-header");
    const vigia = nav && modo === "lateral" ? new MutationObserver(() => ajustarBarra(true)) : null;
    if (vigia && nav) vigia.observe(nav, { childList: true, subtree: true });
    return () => { vigia?.disconnect(); ajustarBarra(false); html.classList.remove(`sr-asis-${modo}`); };
    // pathname: al navegar cambia la sección activa, que es la última en esconderse.
  }, [abierto, visible, modo, ancho, alto, pathname]);

  // La selección de la página, guardada mientras el panel está abierto (ver cabecera).
  useEffect(() => {
    if (!abierto || !visible) return;
    const alCambiar = () => {
      // Arrastrando el borde del panel no se está eligiendo texto.
      if (document.documentElement.classList.contains("sr-asis-arrastrando")) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      // Lo que empieza o acaba dentro del panel no es texto de la página que explicar.
      if (enPanel(sel.anchorNode) || enPanel(sel.focusNode)) return;
      const texto = sel.toString().trim();
      if (texto) setSeleccion(texto.slice(0, 4000));
    };
    alCambiar();
    document.addEventListener("selectionchange", alCambiar);
    return () => document.removeEventListener("selectionchange", alCambiar);
  }, [abierto, visible]);

  // Al abrir, el foco va al cuadro de texto. Esc cierra si el foco está en el panel: en la página
  // puede estar cerrando un desplegable o un buscador.
  useEffect(() => { if (abierto && visible) entrada.current?.focus(); }, [abierto, visible]);

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

  // ── Redimensionar ──
  // Mientras se arrastra se toca solo la variable CSS (sin re-render del chat por cada píxel);
  // al soltar, el tamaño pasa al estado y se recuerda.
  const lateral = modo === "lateral";
  const aplicarVivo = (v: number) => {
    document.documentElement.style.setProperty(lateral ? "--sr-asis-ancho" : "--sr-asis-alto", lateral ? `${v}px` : `${Math.round(v * 100)}dvh`);
    if (lateral) ajustarBarra(true);
  };
  const confirmar = (v: number) => {
    if (lateral) { setAncho(v); guardarTamano({ ancho: v, alto }); }
    else { setAlto(v); guardarTamano({ ancho, alto: v }); }
  };
  const alPulsarTirador = (e: React.PointerEvent) => {
    e.preventDefault();
    window.getSelection()?.removeAllRanges(); // sin esto, arrastrar seleccionaba media pantalla
    e.currentTarget.setPointerCapture(e.pointerId);
    arrastre.current = { desde: lateral ? e.clientX : e.clientY, base: lateral ? ancho : alto, vivo: lateral ? ancho : alto };
    document.documentElement.classList.add("sr-asis-arrastrando");
  };
  const alMoverTirador = (e: React.PointerEvent) => {
    const a = arrastre.current;
    if (!a) return;
    a.vivo = lateral
      ? limitarAncho(a.base + (a.desde - e.clientX))
      : limitarAlto(a.base + (a.desde - e.clientY) / window.innerHeight);
    aplicarVivo(a.vivo);
  };
  const alSoltarTirador = () => {
    const a = arrastre.current;
    if (!a) return;
    arrastre.current = null;
    document.documentElement.classList.remove("sr-asis-arrastrando");
    confirmar(a.vivo);
  };
  const alTeclearTirador = (e: React.KeyboardEvent) => {
    const paso = { ArrowLeft: 1, ArrowUp: 1, ArrowRight: -1, ArrowDown: -1 }[e.key];
    if (!paso) return;
    e.preventDefault();
    confirmar(lateral ? limitarAncho(ancho + paso * 24) : limitarAlto(alto + paso * 0.05));
  };

  // En /login no hay botón ni panel. El componente sigue montado en el layout, así que la
  // conversación vuelve intacta al salir.
  if (!visible) return null;

  const nueva = () => { abortar.current?.abort(); setMensajes([]); setSeleccion(""); entrada.current?.focus(); };
  const sugerencias = sugerenciasPara(pathname);

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
        <aside className={`sr-asis-panel sr-asis-${modo}`} {...{ [ATRIBUTO_EXCLUIR]: "" }}
          role="complementary" aria-label={t("Page assistant")}
          onKeyDown={(e) => { if (e.key === "Escape") setAbierto(false); }}>
          <div className="sr-asis-tirador" role="separator" tabIndex={0}
            aria-orientation={lateral ? "vertical" : "horizontal"} aria-label={t("Resize the assistant")}
            aria-valuenow={lateral ? ancho : Math.round(alto * 100)}
            onPointerDown={alPulsarTirador} onPointerMove={alMoverTirador} onPointerUp={alSoltarTirador}
            onPointerCancel={alSoltarTirador} onKeyDown={alTeclearTirador} />

          <header className="sr-asis-cabecera">
            <div>
              <div className="sr-asis-titulo"><Destello /> {t("Page assistant")}</div>
              <div className="sr-asis-sub">{t("Helps you understand what you're looking at")}</div>
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

          <div className="sr-asis-cuerpo">
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
                    <p>{t("I'm here to help you understand this page: what each concept means, how to read the charts and why it matters.")}</p>
                    <div className="sr-asis-sugerencias">
                      {sugerencias.map((s) => (
                        <button key={s} type="button" className="sr-asis-chip" onClick={() => enviar(t(s))}>{t(s)}</button>
                      ))}
                    </div>
                  </div>
                ) : mensajes.map((m) => <Burbuja key={m.id} m={m} />)}
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
                    placeholder={seleccion ? t("Ask about the selected text…") : t("Ask about anything on this page…")}
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
                <p className="sr-asis-aviso">{t("Sends this page's content to the AI to explain it. Educational only — not investment advice.")}</p>
              </div>
            </>
          )}
          </div>
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
        <div className="sr-asis-leyendo"><span /><span /><span /> {t("Thinking…")}</div>
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

// ── Markdown mínimo ──────────────────────────────────────────────────────────────────
// Párrafos, listas, **negrita** y `código`: lo que el prompt de sistema le pide al modelo. Se
// pinta con elementos de React, nunca como HTML, así que la respuesta no puede inyectar nada.

function enLinea(texto: string): React.ReactNode[] {
  // Unos [[corchetes dobles]] eran las citas de la primera versión; si el modelo aún los escribe,
  // se quedan en texto.
  return texto.replace(/\[\[([^\]\n]{1,200})\]\]/g, "$1").split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((trozo, i) => {
    if (trozo.startsWith("**") && trozo.endsWith("**") && trozo.length > 4) return <strong key={i}>{trozo.slice(2, -2)}</strong>;
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
