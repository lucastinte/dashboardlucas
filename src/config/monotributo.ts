export const CATEGORIA_ACTUAL = 'A' as const;

export const TOPES_2026 = {
  A: { anual: 8992597.87, mensualSeguro: 636900, mensualTope: 749383 },
  B: { anual: 13175201.52, mensualSeguro: 933034, mensualTope: 1097933 },
  C: { anual: 18473166.15, mensualSeguro: 1308516, mensualTope: 1539430 },
  D: { anual: 22934610.05, mensualSeguro: 1624201, mensualTope: 1911217 },
  E: { anual: 26977793.60, mensualSeguro: 1910928, mensualTope: 2248149 },
  F: { anual: 33809379.57, mensualSeguro: 2394831, mensualTope: 2817448 },
  G: { anual: 40431835.35, mensualSeguro: 2864421, mensualTope: 3369319 },
  H: { anual: 61344853.64, mensualSeguro: 4345260, mensualTope: 5112071 },
  I: { anual: 68664410.05, mensualSeguro: 4863729, mensualTope: 5722034 },
  J: { anual: 78632948.76, mensualSeguro: 5569833, mensualTope: 6552746 },
  K: { anual: 94805682.90, mensualSeguro: 6715403, mensualTope: 7900473 },
};

export const TOPE = TOPES_2026[CATEGORIA_ACTUAL];
