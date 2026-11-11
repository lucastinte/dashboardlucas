// Formato único de plata para todo el dashboard: pesos enteros, separador de
// miles argentino y el signo antes del "$" (-$1.500, no $-1.500).
// Sin fijar 'es-AR', toLocaleString() usa el idioma del navegador y el mismo
// número se veía "$1,091,936.5" en una tarjeta y "$1.091.936,5" en otra.

export function money(value?: number | null): string {
    const n = Math.round(Number(value) || 0);
    return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('es-AR')}`;
}

/** Plata abreviada para ejes y etiquetas chicas: $850, $48k, $1,9M. */
export function moneyCompact(value?: number | null): string {
    const n = Number(value) || 0;
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toLocaleString('es-AR', { maximumFractionDigits: 0 })}k`;
    return `${sign}$${Math.round(abs).toLocaleString('es-AR')}`;
}

/** Porcentaje con un decimal y coma argentina: 42,2% */
export function percent(value?: number | null, digits = 1): string {
    const n = Number(value);
    return `${(Number.isFinite(n) ? n : 0).toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
