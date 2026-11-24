// Copia un video desde un link externo (ej. el CDN de Temu) al almacenamiento
// propio, para que no venza ni lo bloqueen. Lo hace el servidor porque el
// navegador no puede bajar videos de otros sitios (CORS / Referer).
//
// POST /api/copiar-video   { url }   Authorization: Bearer <sesión del dashboard>
// → { url: <link público permanente> }

import { createHash } from 'node:crypto';

export const config = { maxDuration: 60 };

const BUCKET = 'product-images';
const MAX_BYTES = 50 * 1024 * 1024;
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v', 'video/ogg': 'ogv' };

// Nada de direcciones internas: el servidor no tiene que poder pedir cosas de su propia red
const isPrivateHost = (host) =>
    /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i.test(host) ||
    host.endsWith('.internal') || host.endsWith('.local');

// Qué es el archivo según sus primeros bytes (el tipo que manda el sitio a veces miente)
export function sniff(buf) {
    const ascii = (a, b) => buf.subarray(a, b).toString('latin1');
    if (buf.length >= 12 && ascii(4, 8) === 'ftyp') {
        const brand = ascii(8, 12);
        if (brand === 'avif' || brand === 'avis') return { kind: 'image', type: 'image/avif', ext: 'avif' };
        if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return { kind: 'image', type: 'image/heic', ext: 'heic' };
        return { kind: 'video', type: brand.startsWith('qt') ? 'video/quicktime' : 'video/mp4', ext: brand.startsWith('qt') ? 'mov' : 'mp4' };
    }
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { kind: 'video', type: 'video/webm', ext: 'webm' };
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { kind: 'image', type: 'image/jpeg', ext: 'jpg' };
    if (buf[0] === 0x89 && ascii(1, 4) === 'PNG') return { kind: 'image', type: 'image/png', ext: 'png' };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind: 'image', type: 'image/webp', ext: 'webp' };
    if (ascii(0, 3) === 'GIF') return { kind: 'image', type: 'image/gif', ext: 'gif' };
    return null;
}

const refererFor = (host) => (/temu|kwcdn/i.test(host) ? 'https://www.temu.com/' : `https://${host}/`);

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Usá POST' });
        return;
    }
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
    const auth = req.headers.authorization || '';
    if (!supabaseUrl || !anonKey) { res.status(500).json({ error: 'Supabase no configurado' }); return; }
    if (!/^Bearer\s+\S+/.test(auth)) { res.status(401).json({ error: 'Sesión requerida' }); return; }

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const kind = body?.kind === 'image' ? 'image' : 'video';
    let target;
    try {
        target = new URL(String(body?.url || ''));
        // Fotos de Temu: sin recorte ni formato AVIF se baja la original
        if (/(^|\.)kwcdn\.com$/i.test(target.hostname) && /\.(jpe?g|png|webp)$/i.test(target.pathname)) target.search = '';
    } catch {
        res.status(400).json({ error: 'Link inválido' });
        return;
    }
    if (!/^https?:$/.test(target.protocol) || isPrivateHost(target.hostname)) {
        res.status(400).json({ error: 'Link no permitido' });
        return;
    }

    // 1) Bajar el video
    let buf, type;
    try {
        const r = await fetch(target, {
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                Referer: refererFor(target.hostname),
                Accept: 'video/*,*/*;q=0.8',
            },
        });
        if (!r.ok) throw new Error(`el sitio respondió ${r.status}`);
        type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const len = Number(r.headers.get('content-length') || 0);
        if (len > MAX_BYTES) throw new Error('El video pesa más de 50 MB');
        buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > MAX_BYTES) throw new Error('El video pesa más de 50 MB');
        if (buf.length < 512) throw new Error(`el archivo vino vacío (${buf.length} bytes, tipo ${type || 'sin tipo'})`);
        const real = sniff(buf);
        if (!real || real.kind !== kind) {
            const head = buf.subarray(0, 60).toString('latin1').replace(/[^\x20-\x7e]+/g, ' ').trim().slice(0, 40);
            throw new Error(`no es ${kind === 'video' ? 'un video' : 'una imagen'}: llegó ${type || 'sin tipo'}, ${Math.round(buf.length / 1024)} KB, empieza con «${head}»`);
        }
        type = real.type;
    } catch (err) {
        res.status(422).json({ error: `el servidor no pudo bajarlo (${err.message})` });
        return;
    }

    // 2) Subirlo con la sesión del usuario (mismas reglas que una subida normal)
    const urlExt = (target.pathname.match(/\.(mp4|mov|webm|m4v|ogv|jpe?g|png|webp|gif|avif)$/i) || [])[1];
    const ext = EXT_BY_TYPE[type] || (urlExt || (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase().replace('jpeg', 'jpg');
    const contentType = type.startsWith(kind + '/') ? type : kind === 'video' ? `video/${ext === 'mov' ? 'quicktime' : ext}` : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    const hash = createHash('sha256').update(buf).digest('hex');
    const path = kind === 'video' ? `vid_${hash}.${ext}` : `${hash}.${ext}`;
    const up = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: auth, 'Content-Type': contentType, 'x-upsert': 'false' },
        body: buf,
    });
    if (!up.ok) {
        const txt = await up.text().catch(() => '');
        // Ya estaba subido (mismo contenido): sirve igual
        if (!/already exists|Duplicate|409/i.test(`${up.status} ${txt}`)) {
            res.status(502).json({ error: `no se pudo guardar en el almacenamiento (${up.status}: ${txt.slice(0, 120)})` });
            return;
        }
    }
    res.status(200).json({ url: `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${path}` });
}
