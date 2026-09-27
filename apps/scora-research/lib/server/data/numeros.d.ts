export interface ResultadoPg {
  rows: Record<string, unknown>[];
  fields?: { name: string; dataTypeID: number }[];
}
/** Convierte a número las columnas numéricas de un resultado de node-pg. */
export function filasConNumeros(res: ResultadoPg): Record<string, unknown>[];
