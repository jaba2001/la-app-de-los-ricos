"use client";
// Una fila de pestañas que no corta ni esconde nada sin decirlo: enseña las que caben y el resto
// va a «More ▾». La usan Macro y la ficha de cada valor.
//
// POR QUÉ (13-10-2026). Las dos filas eran un contenedor con scroll horizontal: con poco sitio —el
// panel del asistente abierto, una ventana estrecha— las últimas pestañas quedaban cortadas a
// media palabra («Carter…») y había que adivinar que se podía deslizar. Ahora se mide de verdad
// (con un ResizeObserver, así que cambia en vivo al estrechar o ensanchar) y lo que no cabe se
// dice: está en el menú.
//
// La pestaña activa siempre queda a la vista: si no cabe en su sitio, entra al final quitando de
// las anteriores. Así se ve en qué pestaña se está sin abrir el menú. Y si no cabe ni ella (un
// móvil con la fecha y «Refresh» a la derecha), la fila es un solo botón con su nombre que abre la
// lista entera: el selector de siempre en un móvil. La fila nunca ensancha la página.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { t } from "@/lib/i18n/cliente";

export interface Pestana {
  id: string;
  /** Ya traducida: la fila la pinta tal cual. */
  label: string;
}

interface Props {
  tabs: Pestana[];
  active: string;
  onSelect: (id: string) => void;
  /** Lo que va a la derecha de la fila (fecha, un botón): se le reserva su sitio. */
  trailing?: ReactNode;
  /** Estilo del contenedor (sticky, fondo, padding, gap, altura): el de cada página. */
  style?: CSSProperties;
}

export default function OverflowTabs({ tabs, active, onSelect, trailing, style }: Props) {
  const fila = useRef<HTMLDivElement>(null);
  const medidor = useRef<HTMLDivElement>(null);
  const cola = useRef<HTMLDivElement>(null);
  const botonMas = useRef<HTMLButtonElement>(null);
  // null = caben todas. Si no, los id que se enseñan en la fila.
  const [visibles, setVisibles] = useState<string[] | null>(null);
  const [menu, setMenu] = useState<null | "izquierda" | "derecha">(null);
  // Las páginas crean `tabs` en cada render: el efecto depende de su CONTENIDO, no del array.
  // Si no, cada medida provocaría otro render, y este otra medida, sin fin.
  const clave = tabs.map((tab) => `${tab.id}\u0000${tab.label}`).join("\u0001");

  // Medir: lo que ocupa cada pestaña (en una copia invisible de la fila) frente al sitio libre.
  useLayoutEffect(() => {
    const igual = (a: string[] | null, b: string[] | null) =>
      a === b || (a != null && b != null && a.length === b.length && a.every((x, i) => x === b[i]));
    const fijar = (v: string[] | null) => setVisibles((prev) => (igual(prev, v) ? prev : v));
    // Las pestañas, sacadas de la clave: lo mismo que `tabs`, sin depender del array.
    const tabs: Pestana[] = clave ? clave.split("\u0001").map((p) => { const [id, label] = p.split("\u0000"); return { id, label }; }) : [];
    const medir = () => {
      const f = fila.current, m = medidor.current;
      if (!f || !m) return;
      const cs = getComputedStyle(f);
      const hueco = parseFloat(cs.columnGap) || 0;
      const libre = f.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
        - (cola.current ? cola.current.offsetWidth + hueco : 0);
      const piezas = [...m.children] as HTMLElement[];
      const anchoMas = piezas[piezas.length - 1]?.offsetWidth ?? 0; // la última es «More ▾»
      const ancho = new Map(tabs.map((tab, i) => [tab.id, piezas[i]?.offsetWidth ?? 0]));
      const total = tabs.reduce((s, tab, i) => s + (ancho.get(tab.id) ?? 0) + (i ? hueco : 0), 0);
      if (total <= libre + 1) { fijar(null); return; }

      const presupuesto = libre - anchoMas - hueco;
      const vis: string[] = [];
      let usado = 0;
      for (const tab of tabs) {
        const w = (ancho.get(tab.id) ?? 0) + (vis.length ? hueco : 0);
        if (usado + w > presupuesto) break;
        vis.push(tab.id); usado += w;
      }
      // La activa, siempre a la vista: si quedó fuera, entra quitando de las últimas. Si no cabe
      // ni sola, no se fuerza (desbordaría la página): queda solo el menú, con su nombre.
      if (!vis.includes(active) && ancho.has(active)) {
        const wa = (ancho.get(active) ?? 0) + hueco;
        while (vis.length && usado + wa > presupuesto) {
          const fuera = vis.pop()!;
          usado -= (ancho.get(fuera) ?? 0) + (vis.length ? hueco : 0);
        }
        if (usado + wa <= presupuesto) vis.push(active);
      }
      fijar(vis);
    };
    medir();
    const ro = new ResizeObserver(medir);
    if (fila.current) ro.observe(fila.current);
    if (cola.current) ro.observe(cola.current);
    return () => ro.disconnect();
  }, [clave, active]);

  // El menú se cierra al elegir, al pulsar fuera o con Escape.
  useEffect(() => {
    if (!menu) return;
    const fuera = (e: PointerEvent) => { if (!(e.target instanceof Node) || !fila.current?.contains(e.target)) setMenu(null); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(null); botonMas.current?.focus(); } };
    document.addEventListener("pointerdown", fuera, true);
    document.addEventListener("keydown", tecla);
    return () => { document.removeEventListener("pointerdown", fuera, true); document.removeEventListener("keydown", tecla); };
  }, [menu]);

  const enFila = visibles == null ? tabs : tabs.filter((tab) => visibles.includes(tab.id));
  const resto = visibles == null ? [] : tabs.filter((tab) => !visibles.includes(tab.id));
  // Solo menú: la activa está dentro, así que el botón lleva su nombre y se marca como activo.
  const activaEnMenu = resto.find((tab) => tab.id === active);

  const abrirMenu = () => {
    if (menu) { setMenu(null); return; }
    // Hacia donde haya sitio: cerca del borde derecho de la fila se abre hacia la izquierda.
    const b = botonMas.current?.getBoundingClientRect(), f = fila.current?.getBoundingClientRect();
    setMenu(b && f && b.left + 240 > f.right ? "derecha" : "izquierda");
  };

  return (
    // overflow-x: clip, la red de seguridad: pase lo que pase, la fila no ensancha la página (y, a
    // diferencia de hidden, no corta el menú que se abre hacia abajo).
    <div ref={fila} style={{ position: "relative", display: "flex", alignItems: "center", overflowX: "clip", ...style }}>
      {enFila.map((tab) => (
        <button key={tab.id} type="button" className={`subtab ${active === tab.id ? "active" : ""}`}
          style={{ flexShrink: 0 }} onClick={() => onSelect(tab.id)}>
          {tab.label}
        </button>
      ))}

      {resto.length > 0 && (
        <div style={{ position: "relative", flexShrink: 0 }}>
          <button ref={botonMas} type="button" className={`subtab ${activaEnMenu ? "active" : ""}`} aria-haspopup="menu" aria-expanded={!!menu}
            onClick={abrirMenu} title={resto.map((tab) => tab.label).join(" · ")}>
            {activaEnMenu ? activaEnMenu.label : t("More")} ▾
          </button>
          {menu && (
            <div role="menu" style={{
              position: "absolute", top: "calc(100% + 6px)", [menu === "derecha" ? "right" : "left"]: 0, zIndex: 60,
              minWidth: 200, maxWidth: "calc(100vw - 32px)", padding: 6, display: "flex", flexDirection: "column", gap: 2,
              background: "var(--sr-surface)", border: "1px solid var(--sr-border)", borderRadius: "var(--sr-radius)",
              boxShadow: "var(--sr-shadow-lg)",
            }}>
              {resto.map((tab) => (
                <button key={tab.id} type="button" role="menuitem" className={`subtab ${active === tab.id ? "active" : ""}`}
                  style={{ textAlign: "left", width: "100%" }}
                  onClick={() => { onSelect(tab.id); setMenu(null); }}>
                  {tab.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {trailing != null && (
        <div ref={cola} style={{ marginLeft: "auto", flexShrink: 0, display: "flex", alignItems: "center", gap: "var(--sr-sp-3)" }}>
          {trailing}
        </div>
      )}

      {/* Copia invisible de TODAS las pestañas (y de «More ▾») para medir lo que ocupa cada una. */}
      <div ref={medidor} aria-hidden="true" style={{
        position: "absolute", left: 0, top: 0, height: 0, overflow: "hidden", visibility: "hidden",
        pointerEvents: "none", display: "flex", gap: style?.gap, whiteSpace: "nowrap",
      }}>
        {tabs.map((tab) => <button key={tab.id} type="button" tabIndex={-1} className={`subtab ${active === tab.id ? "active" : ""}`}>{tab.label}</button>)}
        <button type="button" tabIndex={-1} className="subtab">{t("More")} ▾</button>
      </div>
    </div>
  );
}
