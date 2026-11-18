// Alta rápida de productos por voz y foto desde un Atajo de Siri (iOS Shortcuts).
// POST /api/quick-add
//   { texto?: string, foto?: string (base64 JPEG/PNG/WebP), nombre?, cantidad?,
//     precioCompra?, precioVenta?, ubicacion?, condicion?, notas? }
//
// Auth: header `Authorization: Bearer <token>`, token = env QUICK_ADD_TOKEN
// (el mismo token va dentro del atajo del teléfono).
//
// - Con GROQ_API_KEY, la IA separa nombre, cantidad, precios, ubicación y
//   condición del dictado. Si llega foto, la mira también (sirve para cargar
//   con foto sola, o cuando el dictado no dice qué es el producto).
// - La foto se sube al bucket product-images y queda como foto principal.
// - Si falla la IA, no hay key o la foto no se puede usar, el producto entra
//   igual marcado "para revisar": nunca se pierde lo que se mandó.
//
// Escribe directo en Supabase con la SERVICE ROLE KEY (env
// SUPABASE_SERVICE_ROLE_KEY), que bypasea RLS: es una operación de servidor
// de confianza, el token de la request es el único freno.

import { createHash, timingSafeEqual } from 'node:crypto';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b';
// Modelo con visión de Groq; se puede cambiar sin tocar código si Groq lo renombra.
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';
const BUCKET = 'product-images';
// Vercel corta el cuerpo en 4,5 MB y el base64 pesa un 33% más que la foto.
const MAX_FOTO_BYTES = 3 * 1024 * 1024;

const condLabel = { nuevo: 'nuevo', semi_uso: 'semi uso', usado: 'usado' };

// Comparación en tiempo constante para el token (evita filtrar el valor por
// tiempos de respuesta carácter a carácter).
function tokenOk(received, expected) {
    const a = Buffer.from(String(received || ''));
    const b = Buffer.from(String(expected || ''));
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

const toInt = (v, fallback = null) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
};

const toMoney = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Decodifica la foto del atajo. Devuelve { buffer, mime, ext } o { error }. */
export function decodeFoto(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    // "Codificar en Base64" de Atajos puede meter saltos de línea; también se
    // acepta una data URL completa.
    const b64 = raw.replace(/^data:[^;,]+;base64,/, '').replace(/\s+/g, '');
    let buffer;
    try {
        buffer = Buffer.from(b64, 'base64');
    } catch {
        return { error: 'la foto no es base64 válido' };
    }
    if (buffer.length < 100) return { error: 'la foto llegó vacía' };
    if (buffer.length > MAX_FOTO_BYTES) return { error: 'la foto es muy pesada (achicala a 1024 px en el atajo)' };
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { buffer, mime: 'image/jpeg', ext: 'jpg' };
    if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { buffer, mime: 'image/png', ext: 'png' };
    if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return { buffer, mime: 'image/webp', ext: 'webp' };
    if (buffer.slice(4, 8).toString('ascii') === 'ftyp') return { error: 'la foto está en HEIC (convertila a JPEG en el atajo)' };
    return { error: 'formato de foto no reconocido (usá JPEG)' };
}

// Sube la foto al bucket con nombre por hash (misma convención que el
// dashboard: la misma foto no se duplica). Devuelve la URL pública o null.
async function subirFoto(foto, supabaseUrl, serviceKey) {
    const name = `${createHash('sha256').update(foto.buffer).digest('hex')}.${foto.ext}`;
    try {
        const r = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${name}`, {
            method: 'POST',
            headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
                'Content-Type': foto.mime,
                'x-upsert': 'true',
            },
            body: foto.buffer,
        });
        if (!r.ok) return null;
        return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${name}`;
    } catch {
        return null;
    }
}

const PROMPT = `Sos el intérprete de un carrito de reventa. Un usuario argentino te manda un dictado por voz, en español rioplatense, y a veces una foto del producto que acaba de comprar o quiere cargar a su inventario. Convertilo a JSON estricto con este schema:
{"nombre": string, "cantidad": number, "precioCompra": number|null, "precioVenta": number|null, "ubicacion": string|null, "condicion": "nuevo"|"semi_uso"|"usado"|null, "notas": string|null}
Reglas:
- "nombre": nombre corto y limpio del producto, sin cantidades ni precios ("Parlante JBL Go 3"). Si hay foto, usala para identificar marca y modelo cuando el dictado no los dice; si el dictado nombra el producto, manda el dictado.
- "cantidad": cuántas unidades; 1 si no se dice.
- precios: pesos argentinos, números sin separadores. "15 lucas"=15000, "2 palos"=2000000, "medio palo"=500000, "5 kilos"=5000. Si no se menciona, null. Nunca inventes precios a partir de la foto.
- "precioCompra" es lo que costó; "precioVenta" a cuánto lo va a vender ("a vender en", "vender a").
- "ubicacion": dónde queda guardado si lo dice ("en el depósito", "en casa de ari").
- "condicion": sólo si lo dice o se ve claramente en la foto ("usado", "semi nuevo"=semi_uso).
- "notas": cualquier detalle extra en una frase corta; null si no hay.
- Si no hay forma de saber qué producto es, devolvé JSON con nombre=null.
- Respondé ÚNICAMENTE el JSON, sin texto alrededor.`;

// Interpreta dictado (y foto, si hay) con Groq. Devuelve campos sueltos o null si falla.
async function parseConIA({ texto, foto }, apiKey) {
    const userContent = foto
        ? [
            { type: 'text', text: texto ? `Dictado: ${String(texto).slice(0, 1000)}` : 'Sin dictado: identificá el producto por la foto.' },
            { type: 'image_url', image_url: { url: `data:${foto.mime};base64,${foto.buffer.toString('base64')}` } },
        ]
        : String(texto).slice(0, 1000);
    try {
        const res = await fetch(GROQ_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
                model: foto ? GROQ_VISION_MODEL : GROQ_MODEL,
                temperature: 0,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: PROMPT },
                    { role: 'user', content: userContent },
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
    const fotoDecodificada = decodeFoto(body.foto);
    const foto = fotoDecodificada && !fotoDecodificada.error ? fotoDecodificada : null;
    const avisoFoto = fotoDecodificada?.error || null;

    let nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
    let cantidad = toInt(body.cantidad, 1);
    let precioCompra = toMoney(body.precioCompra);
    let precioVenta = toMoney(body.precioVenta);
    let ubicacion = typeof body.ubicacion === 'string' ? body.ubicacion.trim() : '';
    let condicion = ['nuevo', 'semi_uso', 'usado'].includes(body.condicion) ? body.condicion : null;
    let notas = typeof body.notas === 'string' ? body.notas.trim() : '';
    let revisar = false;

    if (!texto && !nombre && !foto) {
        res.status(400).json({ ok: false, error: avisoFoto ? `No se pudo cargar: ${avisoFoto}` : 'Falta "texto", "nombre" o "foto"' });
        return;
    }

    if (!nombre && (texto || foto) && groqKey) {
        // Con foto se usa el modelo con visión; si falla, se reintenta solo con el texto.
        let ai = await parseConIA({ texto, foto }, groqKey);
        if ((!ai || !ai.nombre) && foto && texto) ai = await parseConIA({ texto, foto: null }, groqKey);
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
        nombre = texto || 'Producto cargado por foto';
        revisar = true;
    }

    const imageUrl = foto ? await subirFoto(foto, supabaseUrl, serviceKey) : null;
    const problemaFoto = avisoFoto || (foto && !imageUrl ? 'no se pudo guardar la foto' : null);

    const notasFinales = revisar
        ? (notas || (texto ? 'Dictado por voz sin interpretar' : 'Cargado por foto sin identificar'))
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
    if (imageUrl) row.image_url = imageUrl;

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
    if (imageUrl) partes.push('· 📷 con foto');
    let mensaje = `✅ ${partes.join(' ')}. ${revisar ? 'Completá los detalles en el dashboard.' : 'Ya está en el inventario.'}`;
    if (problemaFoto) mensaje += ` ⚠️ Sin foto: ${problemaFoto}.`;

    res.status(200).json({ ok: true, mensaje, id: saved?.id || null, foto: Boolean(imageUrl) });
}
