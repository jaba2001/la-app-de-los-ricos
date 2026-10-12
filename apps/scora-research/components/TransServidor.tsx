// <Trans> para componentes de SERVIDOR (/daily, /evidence, /picks). El de cliente no sirve ahí:
// a un componente de cliente no se le pueden pasar funciones desde el servidor.
import { Fragment } from "react";
import { tServidor } from "@/lib/i18n/servidor";
import { trocear } from "@/lib/i18n/traducir";

type Envoltorio = (contenido: string) => React.ReactNode;

export default async function TransServidor({ text, ...envoltorios }: { text: string } & Record<string, Envoltorio | string>) {
  const t = await tServidor();
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
