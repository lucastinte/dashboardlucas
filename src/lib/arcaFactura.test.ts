import { describe, expect, it } from 'vitest';
import { extractNumeroFactura, parseArcaMessage, resolveArcaMessage, totalNoCoincide } from './arcaFactura';

const mensaje = (overrides: Record<string, unknown> = {}) => ({
    tipo: 'RCEL_FACTURA_GENERADA',
    ventaId: 'venta-1',
    numero: '00001-00000106',
    cae: '86249570892295',
    archivo: '20414008438_011_00001_00000106.pdf',
    total: 215000,
    ...overrides,
});
const evento = (data: unknown, origin = 'https://fe.afip.gob.ar') => ({ origin, data });

const ventas = [
    { id: 'venta-1', productName: 'Starlink Mini', nroComprobante: undefined as string | undefined },
    { id: 'venta-2', productName: 'Cable USB-C', nroComprobante: '00001-00000099' },
];

describe('resolveArcaMessage', () => {
    it('origen de ARCA + número válido → abre el modal de esa venta con los datos', () => {
        const r = resolveArcaMessage(evento(mensaje()), ventas, null);
        expect(r.kind).toBe('abrir-modal');
        if (r.kind !== 'abrir-modal') return;
        expect(r.venta.id).toBe('venta-1');
        expect(r.factura).toMatchObject({ numero: '00001-00000106', cae: '86249570892295', total: 215000 });
    });

    it('acepta también serviciosweb.afip.gob.ar', () => {
        expect(resolveArcaMessage(evento(mensaje(), 'https://serviciosweb.afip.gob.ar'), ventas, null).kind).toBe('abrir-modal');
    });

    it('origen incorrecto → se ignora', () => {
        for (const origin of ['https://evil.com', 'http://fe.afip.gob.ar', 'https://fe.afip.gob.ar.evil.com', 'https://dashboardlucas.vercel.app']) {
            expect(resolveArcaMessage(evento(mensaje(), origin), ventas, null)).toEqual({ kind: 'ignorar' });
        }
    });

    it('otro tipo de mensaje → se ignora', () => {
        expect(resolveArcaMessage(evento(mensaje({ tipo: 'OTRA_COSA' })), ventas, null)).toEqual({ kind: 'ignorar' });
        expect(resolveArcaMessage(evento('texto'), ventas, null)).toEqual({ kind: 'ignorar' });
        expect(resolveArcaMessage(evento(null), ventas, null)).toEqual({ kind: 'ignorar' });
    });

    it('número inválido → se ignora', () => {
        for (const numero of ['0001-00000106', '00001-0000106', '00001-000001060', '00001_00000106', 'x00001-00000106', '', 106, undefined]) {
            expect(resolveArcaMessage(evento(mensaje({ numero })), ventas, null)).toEqual({ kind: 'ignorar' });
        }
    });

    it('venta que ya tiene número de factura → no se pisa', () => {
        const r = resolveArcaMessage(evento(mensaje({ ventaId: 'venta-2' })), ventas, null);
        expect(r.kind).toBe('ya-facturada');
        if (r.kind !== 'ya-facturada') return;
        expect(r.venta.nroComprobante).toBe('00001-00000099');
    });

    it('sin ventaId → usa la última venta mandada a facturar', () => {
        const r = resolveArcaMessage(evento(mensaje({ ventaId: undefined })), ventas, 'venta-1');
        expect(r.kind).toBe('abrir-modal');
        if (r.kind === 'abrir-modal') expect(r.venta.id).toBe('venta-1');
    });

    it('venta inexistente (o sin ventaId ni última venta) → avisa sin abrir modal', () => {
        expect(resolveArcaMessage(evento(mensaje({ ventaId: 'no-existe' })), ventas, null).kind).toBe('venta-no-encontrada');
        expect(resolveArcaMessage(evento(mensaje({ ventaId: undefined })), ventas, null).kind).toBe('venta-no-encontrada');
    });
});

describe('parseArcaMessage', () => {
    it('total ausente o no numérico queda undefined (no dispara el aviso)', () => {
        expect(parseArcaMessage(evento(mensaje({ total: undefined })))?.total).toBeUndefined();
        expect(parseArcaMessage(evento(mensaje({ total: 'abc' })))?.total).toBeUndefined();
        expect(parseArcaMessage(evento(mensaje({ total: '215000' })))?.total).toBe(215000);
    });
});

describe('extractNumeroFactura (botón Pegar)', () => {
    it('saca el primer número del texto pegado', () => {
        expect(extractNumeroFactura('Comprobante Nro 00001-00000106 CAE 862...')).toBe('00001-00000106');
        expect(extractNumeroFactura('20414008438_011_00001_00000106.pdf')).toBeNull();
        expect(extractNumeroFactura('nada por acá')).toBeNull();
    });
});

describe('totalNoCoincide', () => {
    it('avisa solo si difiere en $1 o más', () => {
        expect(totalNoCoincide(215000, 215000)).toBe(false);
        expect(totalNoCoincide(215000.4, 215000)).toBe(false);
        expect(totalNoCoincide(214000, 215000)).toBe(true);
        expect(totalNoCoincide(undefined, 215000)).toBe(false);
    });
});
