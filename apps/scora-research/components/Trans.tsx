"use client";
// Frase con formato dentro: <Trans text="Regresses <b>your portfolio</b> returns" b={(c) => <strong>{c}</strong>} />
// Se traduce la frase ENTERA (el orden de las palabras cambia entre idiomas) y luego se pintan
// las etiquetas con lo que diga cada prop. Sin prop para una etiqueta, el trozo sale en texto.
import { Fragment } from "react";
import { t, trocear } from "@/lib/i18n/cliente";

type Envoltorio = (contenido: string) => React.ReactNode;

export default function Trans({ text, ...envoltorios }: { text: string } & Record<string, Envoltorio | string>) {
  const trozos = trocear(t(text));
  return (
    <>
      {trozos.map((p, i) => {
        const env = p.etiqueta ? envoltorios[p.etiqueta] : null;
        return <Fragment key={i}>{typeof env === "function" ? env(p.texto) : p.texto}</Fragment>;
      })}
    </>
  );
}
