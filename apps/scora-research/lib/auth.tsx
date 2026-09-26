"use client";
// La sesión del usuario, ahora contra Identity Platform en vez de Supabase.
//
// LA INTERFAZ NO CAMBIA a propósito: sigue exponiendo `session.user.id`, `session.user.email`,
// `loading` y `signOut`. Hay 29 sitios en la app que leen eso, y mantener la forma es lo que
// permite cambiar de proveedor de identidad tocando solo este fichero y los dos del login.
//
// El `id` pasa a ser el `uid` de Identity Platform (una cadena de 28 caracteres) donde antes
// era un uuid de Supabase. Las columnas `user_id` de la base son de tipo uuid, así que
// sql/gcp/002_user_id_texto.sql las pasa a texto: un uid no es un uuid y forzarlo daría un
// error de tipo en cada inserción.
import { createContext, useContext, useEffect, useState } from "react";
import { onIdTokenChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { auth, authConfigurado } from "./firebaseClient";

/** La forma mínima que consume la app. Antes la daba @supabase/supabase-js. */
export interface Session {
  user: { id: string; email: string | null };
  /** Token para las llamadas al servidor. Se refresca solo; no cachearlo. */
  getToken: () => Promise<string | null>;
}

interface AuthCtxValue {
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthCtxValue>({ session: null, loading: true, signOut: async () => {} });

function aSesion(u: User): Session {
  return {
    user: { id: u.uid, email: u.email },
    // getIdToken() devuelve el token cacheado y lo renueva solo cuando le quedan menos de
    // cinco minutos. Por eso se guarda la FUNCIÓN y no el token: guardarlo daría 401 a la
    // hora, cuando caduca, y el usuario vería la sesión caerse sin motivo aparente.
    getToken: () => u.getIdToken(),
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authConfigurado()) { setLoading(false); return; }
    // onIdTokenChanged y no onAuthStateChanged: el primero avisa también cuando el token se
    // renueva, no solo al entrar o salir. Con el segundo, una pestaña abierta toda la tarde
    // se quedaría con un token viejo.
    const off = onIdTokenChanged(auth(), (u) => {
      setSession(u ? aSesion(u) : null);
      setLoading(false);
    });
    return () => off();
  }, []);

  async function signOut() {
    if (authConfigurado()) await fbSignOut(auth());
    setSession(null);
  }

  return <AuthCtx.Provider value={{ session, loading, signOut }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);

/** El token de la sesión actual, para quien no tenga el contexto a mano (lib/proxy.ts). */
export async function tokenActual(): Promise<string | null> {
  if (!authConfigurado()) return null;
  const u = auth().currentUser;
  return u ? u.getIdToken() : null;
}
