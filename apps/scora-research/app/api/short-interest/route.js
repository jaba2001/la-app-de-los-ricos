// La ruta es fina a proposito: la logica esta en lib/server/providers/short-interest.js para que
// /api/batch pueda reutilizarla (Next no deja exportar nada mas que los handlers desde aqui).
export { GET, OPTIONS } from '../../../lib/server/providers/short-interest.js';

export const runtime = 'edge';
