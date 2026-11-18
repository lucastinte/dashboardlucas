import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { decodeFoto } from './quick-add.js';

// JPEG mínimo válido (cabecera FF D8 FF) con relleno para superar el mínimo
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(200)]);

function makeRes() {
    return {
        code: 0, body: null, headers: {},
        status(c) { this.code = c; return this; },
        json(b) { this.body = b; return this; },
        setHeader(k, v) { this.headers[k] = v; },
    };
}
const req = (body, token = 'secreto') => ({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body });

let calls;
function mockFetch({ groq = null, storageOk = true } = {}) {
    calls = [];
    globalThis.fetch = vi.fn(async (url, init = {}) => {
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
        calls.push({ url: String(url), body, headers: init.headers });
        if (String(url).includes('api.groq.com')) {
            const out = typeof groq === 'function' ? groq(body) : groq;
            if (!out) return { ok: false, json: async () => ({}) };
            return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(out) } }] }) };
        }
        if (String(url).includes('/storage/v1/object/')) return { ok: storageOk, text: async () => '' };
        if (String(url).includes('/rest/v1/items')) return { ok: true, json: async () => [{ id: 'nuevo-1', ...body }] };
        throw new Error('fetch inesperado: ' + url);
    });
}
const filaGuardada = () => calls.find(c => c.url.includes('/rest/v1/items')).body;

beforeEach(() => {
    process.env.QUICK_ADD_TOKEN = 'secreto';
    process.env.VITE_SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    process.env.GROQ_API_KEY = 'groq';
});
afterEach(() => { vi.restoreAllMocks(); });

describe('quick-add', () => {
    it('token correcto: no revienta (antes usaba require en un módulo ES)', async () => {
        mockFetch({ groq: { nombre: 'Parlante JBL Go 3', cantidad: 3, precioCompra: 15000 } });
        const res = makeRes();
        await handler(req({ texto: 'compré 3 parlantes jbl a 15 lucas' }), res);
        expect(res.code).toBe(200);
        expect(filaGuardada()).toMatchObject({ product_name: 'Parlante JBL Go 3', quantity: 3, purchase_price: 15000 });
    });

    it('token incorrecto: 401', async () => {
        mockFetch();
        const res = makeRes();
        await handler(req({ texto: 'x' }, 'otro'), res);
        expect(res.code).toBe(401);
        expect(calls).toHaveLength(0);
    });

    it('dictado + foto: sube la foto y la guarda como foto principal, usa el modelo con visión', async () => {
        mockFetch({ groq: (b) => (Array.isArray(b.messages[1].content) ? { nombre: 'Funda Starlink Mini', cantidad: 2, precioVenta: 55000 } : null) });
        const res = makeRes();
        await handler(req({ texto: 'dos de estas a vender en 55 lucas', foto: jpeg.toString('base64') }), res);
        expect(res.code).toBe(200);
        const up = calls.find(c => c.url.includes('/storage/v1/object/product-images/'));
        expect(up.url).toMatch(/[a-f0-9]{64}\.jpg$/);
        expect(up.headers['Content-Type']).toBe('image/jpeg');
        expect(filaGuardada()).toMatchObject({ product_name: 'Funda Starlink Mini', quantity: 2, sale_price: 55000 });
        expect(filaGuardada().image_url).toMatch(/^https:\/\/x\.supabase\.co\/storage\/v1\/object\/public\/product-images\/[a-f0-9]{64}\.jpg$/);
        expect(res.body.mensaje).toContain('📷 con foto');
    });

    it('foto sola (sin dictado): la IA identifica el producto por la foto', async () => {
        mockFetch({ groq: { nombre: 'Router Starlink Gen 3', cantidad: 1 } });
        const res = makeRes();
        await handler(req({ foto: `data:image/jpeg;base64,${jpeg.toString('base64')}` }), res);
        expect(res.code).toBe(200);
        expect(filaGuardada().product_name).toBe('Router Starlink Gen 3');
        expect(filaGuardada().image_url).toBeTruthy();
    });

    it('si falla la visión, reintenta solo con el dictado', async () => {
        mockFetch({ groq: (b) => (Array.isArray(b.messages[1].content) ? null : { nombre: 'Cable HDMI', cantidad: 2 }) });
        const res = makeRes();
        await handler(req({ texto: '2 cables hdmi', foto: jpeg.toString('base64') }), res);
        expect(filaGuardada()).toMatchObject({ product_name: 'Cable HDMI', quantity: 2 });
        expect(filaGuardada().image_url).toBeTruthy();
    });

    it('foto HEIC: el producto entra igual, sin foto, y avisa qué pasó', async () => {
        mockFetch({ groq: { nombre: 'Cable HDMI', cantidad: 1 } });
        const res = makeRes();
        await handler(req({ texto: 'un cable hdmi', foto: heic.toString('base64') }), res);
        expect(res.code).toBe(200);
        expect(filaGuardada().image_url).toBeUndefined();
        expect(res.body.mensaje).toContain('HEIC');
    });

    it('si no se puede subir la foto, guarda el producto igual', async () => {
        mockFetch({ groq: { nombre: 'Cable HDMI', cantidad: 1 }, storageOk: false });
        const res = makeRes();
        await handler(req({ texto: 'un cable', foto: jpeg.toString('base64') }), res);
        expect(res.code).toBe(200);
        expect(filaGuardada().image_url).toBeUndefined();
        expect(res.body.mensaje).toContain('no se pudo guardar la foto');
    });

    it('sin IA: el dictado entra marcado para revisar (nunca se pierde)', async () => {
        delete process.env.GROQ_API_KEY;
        mockFetch();
        const res = makeRes();
        await handler(req({ texto: 'algo raro que dicté' }), res);
        expect(filaGuardada()).toMatchObject({ product_name: 'algo raro que dicté' });
        expect(res.body.mensaje).toContain('para revisar');
    });

    it('nada para cargar: 400 sin escribir en la base', async () => {
        mockFetch();
        const res = makeRes();
        await handler(req({}), res);
        expect(res.code).toBe(400);
        expect(calls).toHaveLength(0);
    });
});

describe('decodeFoto', () => {
    it('acepta saltos de línea del base64 de Atajos y rechaza lo pesado', () => {
        const conSaltos = jpeg.toString('base64').replace(/(.{76})/g, '$1\n');
        expect(decodeFoto(conSaltos)).toMatchObject({ mime: 'image/jpeg', ext: 'jpg' });
        expect(decodeFoto(Buffer.concat([jpeg, Buffer.alloc(3.2 * 1024 * 1024)]).toString('base64')).error).toMatch(/pesada/);
        expect(decodeFoto('')).toBeNull();
    });
});
