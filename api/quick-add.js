// Alta rápida de productos por voz desde un Atajo de Siri (iOS Shortcuts).
// POST /api/quick-add  { texto?: string, nombre?, cantidad?, precioCompra?, precioVenta?, ubicacion?, condicion?, notas? }
//
// Auth: header `Authorization: Bearer <token>`, token = env QUICK_ADD_TOKEN
// (el mismo token va dentro del atajo del teléfono).
//
// Si sólo llega `texto` (el dictado de Siri) y hay GROQ_API_KEY configurada,
// se interpreta el texto con IA para separar nombre, cantidad, precios,
// ubicación y condición. Si falla la IA o no hay key, se guarda el texto tal
// cual marcado "para revisar" — nunca se pierde el dictado.
//
// Escribe directo en Supabase con la SERVICE ROLE KEY (env
// SUPABASE_SERVICE_ROLE_KEY), que bypasea RLS: es una operación de servidor
// de confianza, el token de la request es el único freno.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';

const condLabel = { nuevo: 'nuevo', semi_uso: 'semi uso', usado: 'usado' };

// Comparación en tiempo constante para el token (evita filtrar el valor por
// tiempos de respuesta carácter a carácter).
function tokenOk(received, expected) {
    const a = Buffer.from(String(received || ''));
    const b = Buffer.from(String(expected || ''));
    if (a.length !== b.length) return false;
    return require('crypto').timingSafeEqual(a, b);
}

const toInt = (v, fallback = null) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
};

const toMoney = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

// Interpreta el dictado con Groq. Devuelve campos sueltos o null si falla.
async function parseConIA(texto, apiKey) {
    const prompt = `Sos el intérprete de un carrito de reventa. Te pasa un usuario argentino un dictado por voz, en español rioplatense, describiendo producto(s) que acaba de comprar o quiere cargar a su inventario. Convertilo a JSON estricto con este schema:
{"nombre": string, "cantidad": number, "precioCompra": number|null, "precioVenta": number|null, "ubicacion": string|null, "condicion": "nuevo"|"semi_uso"|"usado"|null, "notas": string|null}
Reglas:
- "nombre": nombre corto y limpio del producto, sin cantidades ni precios ("Parlante JBL Go 3").
- "cantidad": cuántas unidades; 1 si no se dice.
- precios: pesos argentinos, números sin separadores. "15 lucas"=15000, "2 palos"=2000, "medio palo"=500, "5 kilos"=5000. Si no se menciona, null.
- "precioCompra" es lo que costó; "precioVenta" a cuánto lo va a vender ("a vender en", "vender a").
- "ubicacion": dónde queda guardado si lo dice ("en el depósito", "en casa de ari").
- "condicion": sólo si lo dice ("usado", "semi nuevo"=semi_uso).
- "notas": cualquier detalle extra en una frase corta; null si no hay.
- Si el dictado no parece un producto (un recordatorio, un saludo), igual devolvé JSON con nombre=null.
- Respondé ÚNICAMENTE el JSON, sin texto alrededor.`;
    try {
        const res = await fetch(GROQ_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: GROQ_MODEL,
                temperature: 0,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: prompt },
                    { role: 'user', content: String(texto).slice(0, 1000) },
                ],
            }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const raw = data?.choices?.[0]?.message?.content;
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch {
        return null;
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ ok: false, error: 'Método no permitido' });
        return;
    }

    const token = process.env.QUICK_ADD_TOKEN;
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const groqKey = process.env.GROQ_API_KEY;

    if (!token || !supabaseUrl || !serviceKey) {
        res.status(500).json({ ok: false, error: 'Faltan env vars: QUICK_ADD_TOKEN, VITE_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY' });
        return;
    }

    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ') || !tokenOk(auth.slice(7), token)) {
        res.status(401).json({ ok: false, error: 'Token inválido' });
        return;
    }

    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const texto = typeof body.texto === 'string' ? body.texto.trim() : '';

    let nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
    let cantidad = toInt(body.cantidad, 1);
    let precioCompra = toMoney(body.precioCompra);
    let precioVenta = toMoney(body.precioVenta);
    let ubicacion = typeof body.ubicacion === 'string' ? body.ubicacion.trim() : '';
    let condicion = ['nuevo', 'semi_uso', 'usado'].includes(body.condicion) ? body.condicion : null;
    let notas = typeof body.notas === 'string' ? body.notas.trim() : '';
    let revisar = false;

    if (!nombre && texto && groqKey) {
        const ai = await parseConIA(texto, groqKey);
        if (ai && ai.nombre) {
            nombre = String(ai.nombre).trim();
            cantidad = toInt(ai.cantidad, 1);
            precioCompra = precioCompra ?? toMoney(ai.precioCompra);
            precioVenta = precioVenta ?? toMoney(ai.precioVenta);
            ubicacion = ubicacion || String(ai.ubicacion || '').trim();
            if (!condicion && ['nuevo', 'semi_uso', 'usado'].includes(ai.condicion)) condicion = ai.condicion;
            notas = notas || String(ai.notas || '').trim();
        }
    }

    if (!nombre) {
        // Sin IA (o la IA no entendió): entra igual, marcado para revisar.
        nombre = texto || nombre;
        revisar = true;
    }

    if (!nombre) {
        res.status(400).json({ ok: false, error: 'Falta "texto" o "nombre"' });
        return;
    }

    const notasFinales = revisar
        ? (notas ? `${notas}` : 'Dictado por voz sin interpretar')
        : notas;

    const row = {
        product_name: nombre.slice(0, 200),
        purchase_price: precioCompra ?? 0,
        sale_price: precioVenta,
        quantity: cantidad,
        item_condition: condicion || 'nuevo',
        location: ubicacion ? ubicacion.slice(0, 120) : null,
        description: notasFinales ? `🎙️ ${notasFinales}` : null,
        status: 'in_stock',
        public_in_store: false,
        item_type: 'resale',
    };

    const r = await fetch(`${supabaseUrl}/rest/v1/items`, {
        method: 'POST',
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation',
        },
        body: JSON.stringify(row),
    });

    if (!r.ok) {
        const detail = await r.text();
        res.status(502).json({ ok: false, error: `Supabase ${r.status}: ${detail.slice(0, 200)}` });
        return;
    }

    const saved = (await r.json().catch(() => []))?.[0];
    const n = row.quantity;

    const partes = [];
    partes.push(revisar ? 'Anotado para revisar' : 'Agregado');
    partes.push(`${n}× ${row.product_name}`);
    partes.push(`(${condLabel[row.item_condition]})`);
    if (precioCompra != null) partes.push(`costo $${precioCompra.toLocaleString('es-AR')}`);
    if (precioVenta != null) partes.push(`a vender $${precioVenta.toLocaleString('es-AR')}`);
    if (row.location) partes.push(`· 📍 ${row.location}`);
    const mensaje = `✅ ${partes.join(' ')}. ${revisar ? 'Completá los detalles en el dashboard.' : 'Ya está en el inventario.'}`;

    res.status(200).json({ ok: true, mensaje, id: saved?.id || null });
}
