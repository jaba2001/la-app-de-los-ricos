// La ruta es fina a proposito: la logica esta en lib/server/providers/congress.js para que
// /api/batch pueda reutilizarla (Next no deja exportar nada mas que los handlers desde aqui).
export { GET, OPTIONS } from '../../../../lib/server/providers/congress.js';

export const runtime = 'edge';
