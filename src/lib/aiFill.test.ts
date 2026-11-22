import { describe, expect, it } from 'vitest';
import { parseAiFill } from './aiFill';

describe('parseAiFill', () => {
    it('lee el JSON pedido', () => {
        const r = parseAiFill('{"titulo":"Cargador Boost 12V-30V 5m","descripcion":"⚡ **Salida:** 30V\\n📦 **Condición:** nuevo","precio_venta":50000,"estado":"nuevo","variante":null}');
        expect(r).toEqual({ titulo: 'Cargador Boost 12V-30V 5m', descripcion: '⚡ **Salida:** 30V\n📦 **Condición:** nuevo', precioVenta: 50000, estado: 'nuevo' });
    });

    it('tolera ```json, texto alrededor, claves en inglés y precio como texto', () => {
        const r = parseAiFill('Acá va:\n```json\n{ "title": "Funda Mini", "description": ["🛡 **Protección:** total", "📦 **Condición:** nuevo"], "price": "$55.000", "condition": "Semi uso", "variant": "negro" }\n```');
        expect(r).toEqual({ titulo: 'Funda Mini', descripcion: '🛡 **Protección:** total\n📦 **Condición:** nuevo', precioVenta: 55000, estado: 'semi_uso', variante: 'negro' });
    });

    it('precio null o ausente no se carga', () => {
        expect(parseAiFill('{"titulo":"X","precio_venta":null}').precioVenta).toBeUndefined();
    });

    it('avisa si no hay JSON o viene vacío', () => {
        expect(() => parseAiFill('hola')).toThrow(/No encontré/);
        expect(() => parseAiFill('{"titulo": "x", ')).toThrow(/No encontré|incompleto/);
        expect(() => parseAiFill('{"estado":"nuevo"}')).toThrow(/título ni descripción/);
    });
});
