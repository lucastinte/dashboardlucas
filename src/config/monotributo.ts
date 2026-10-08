// Topes de ingresos brutos anuales del monotributo (ARCA).
// Escala vigente desde agosto 2026 — rige hasta enero 2027,
// próxima actualización por IPC en febrero 2027.
//
// ÚNICO lugar donde se definen topes: el dashboard lee todo desde acá.
// Para recategorizar, cambiar solo CATEGORIA_ACTUAL.

export const CATEGORIA_ACTUAL = 'A' as const;

export type CategoriaMonotributo = 'A' | 'B' | 'C' | 'D' | 'E';

// mensualTope = tope anual / 12 (referencia mensual del gráfico)
// mensualSeguro = tope anual / 12 × 0.85 (margen "holgado")
const conMensuales = (anual: number) => ({
    anual,
    mensualTope: anual / 12,
    mensualSeguro: (anual / 12) * 0.85,
});

export const TOPES_VIGENTES: Record<CategoriaMonotributo, { anual: number; mensualTope: number; mensualSeguro: number }> = {
    A: conMensuales(12009410.45),
    B: conMensuales(17595182.74),
    C: conMensuales(24670494.31),
    D: conMensuales(30628651.43),
    E: conMensuales(36028231.33),
};

export const TOPE = TOPES_VIGENTES[CATEGORIA_ACTUAL];

// Categoría siguiente (referencia para recategorización)
const ORDEN: CategoriaMonotributo[] = ['A', 'B', 'C', 'D', 'E'];
export const CATEGORIA_SIGUIENTE: CategoriaMonotributo =
    ORDEN[Math.min(ORDEN.indexOf(CATEGORIA_ACTUAL) + 1, ORDEN.length - 1)];
export const TOPE_SIGUIENTE = TOPES_VIGENTES[CATEGORIA_SIGUIENTE];
