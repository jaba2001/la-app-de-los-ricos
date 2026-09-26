// Identity Platform (el login de Google) — sustituye a Supabase Auth.
//
// Se usa el SDK de Firebase porque Identity Platform ES el mismo servicio con otro nombre:
// Firebase Auth es la cara para desarrolladores, Identity Platform la de Google Cloud.
// Mismo backend, mismo SDK.
//
// De todo el SDK solo se importan las tres piezas que hacen falta (initializeApp, getAuth y
// las funciones de enlace por email). Importar `firebase/app` entero metería en el bundle
// Firestore, Storage y el resto, que no se usan.
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

// El proyecto y la clave son PÚBLICOS por diseño: van en el bundle del navegador y no
// autorizan nada por sí solos. Quién puede hacer qué lo decide Identity Platform y, para los
// datos, la política del servidor.
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
};

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

export function auth(): Auth {
  // getApps() evita reinicializar en el recarga en caliente del desarrollo, que lanza
  // "Firebase App named '[DEFAULT]' already exists".
  if (!_app) _app = getApps()[0] ?? initializeApp(config);
  if (!_auth) _auth = getAuth(_app);
  return _auth;
}

/** ¿Está configurado? Sin clave el SDK falla al primer uso; esto permite degradar antes. */
export const authConfigurado = () => Boolean(config.apiKey && config.projectId);
