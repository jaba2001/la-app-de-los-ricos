// Fina a proposito: la logica esta en lib/server/providers/batch.js para poder probar el
// enrutado por separado (Next no deja exportar nada mas que los handlers desde aqui).
export { POST, OPTIONS } from '../../../lib/server/providers/batch.js';

export const runtime = 'edge';
