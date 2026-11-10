// Recepción del número de factura que emite ARCA (RCEL).
//
// El userscript que corre en fe.afip.gob.ar responde a la pestaña que abrió
// ARCA (window.opener) con un postMessage:
//   { tipo: 'RCEL_FACTURA_GENERADA', ventaId, numero, cae, archivo, total }
// Para que exista window.opener, ARCA se abre con window.open(url, 'arca_rcel')
// sin noopener/noreferrer.

export const ARCA_ORIGINS = ['https://fe.afip.gob.ar', 'https://serviciosweb.afip.gob.ar'] as const;
export const ARCA_WINDOW_NAME = 'arca_rcel';
export const RCEL_MESSAGE_TYPE = 'RCEL_FACTURA_GENERADA';

/** Número de comprobante de RCEL: punto de venta (5) - número (8). Ej: 00001-00000106 */
export const NUMERO_FACTURA_RE = /^\d{5}-\d{8}$/;
const NUMERO_FACTURA_SEARCH_RE = /\d{5}-\d{8}/;

export interface ArcaFactura {
    ventaId?: string;
    numero: string;
    cae?: string;
    archivo?: string;
    total?: number;
}

export interface VentaFacturable {
    id: string;
    nroComprobante?: string;
}

export type ArcaAction<V extends VentaFacturable = VentaFacturable> =
    | { kind: 'ignorar' }
    | { kind: 'venta-no-encontrada'; factura: ArcaFactura }
    | { kind: 'ya-facturada'; venta: V; factura: ArcaFactura }
    | { kind: 'abrir-modal'; venta: V; factura: ArcaFactura };

/** Última venta mandada a facturar: respaldo si el mensaje llega sin ventaId. */
export const ultimaVentaFacturada: { current: string | null } = { current: null };

/**
 * Valida un MessageEvent y devuelve los datos de la factura, o null si hay que
 * ignorarlo: origen distinto de ARCA, otro tipo de mensaje o número inválido.
 */
export function parseArcaMessage(event: Pick<MessageEvent, 'origin' | 'data'>): ArcaFactura | null {
    if (!(ARCA_ORIGINS as readonly string[]).includes(event.origin)) return null;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.tipo !== RCEL_MESSAGE_TYPE) return null;
    const numero = typeof data.numero === 'string' ? data.numero.trim() : '';
    if (!NUMERO_FACTURA_RE.test(numero)) return null;
    const total = Number(data.total);
    return {
        ventaId: typeof data.ventaId === 'string' && data.ventaId ? data.ventaId : undefined,
        numero,
        cae: typeof data.cae === 'string' && data.cae ? data.cae : undefined,
        archivo: typeof data.archivo === 'string' && data.archivo ? data.archivo : undefined,
        total: Number.isFinite(total) && data.total !== null && data.total !== '' ? total : undefined,
    };
}

/**
 * Decide qué hacer con un mensaje de ARCA: buscar la venta (por ventaId o la
 * última mandada a facturar) y no pisar un número de factura ya cargado.
 */
export function resolveArcaMessage<V extends VentaFacturable>(
    event: Pick<MessageEvent, 'origin' | 'data'>,
    ventas: V[],
    ultimaVentaId: string | null,
): ArcaAction<V> {
    const factura = parseArcaMessage(event);
    if (!factura) return { kind: 'ignorar' };
    const id = factura.ventaId || ultimaVentaId;
    const venta = id ? ventas.find(v => v.id === id) : undefined;
    if (!venta) return { kind: 'venta-no-encontrada', factura };
    if (venta.nroComprobante?.trim()) return { kind: 'ya-facturada', venta, factura };
    return { kind: 'abrir-modal', venta, factura };
}

/** Primer número de factura (00001-00000106) que aparezca en un texto, o null. */
export function extractNumeroFactura(text: string): string | null {
    return text.match(NUMERO_FACTURA_SEARCH_RE)?.[0] ?? null;
}

/** True si el total que informó ARCA difiere del total de la venta (tolerancia $1 por redondeos). */
export function totalNoCoincide(totalArca: number | undefined, totalVenta: number): boolean {
    return totalArca !== undefined && Math.abs(totalArca - totalVenta) >= 1;
}

// ── Puente entre el listener (Dashboard) y los modales abiertos ──────────────
// El modal de facturación vive en dos lugares (pestaña Facturación y tabla de
// Ventas) con estado propio. Cada modal abierto se registra acá; si el mensaje
// es para una venta con el modal ya abierto, se le entregan los datos por un
// evento en lugar de abrir otro modal encima.
export const ARCA_PREFILL_EVENT = 'arca:factura-recibida';
export const modalesFacturaAbiertos = new Set<string>();
