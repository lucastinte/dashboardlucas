// Passthrough hacia el Web App de Apps Script que escribe la hoja de stock.
// POST /api/sheets  → reenvía el payload al Web App y devuelve su respuesta.
//
// Existe porque el navegador no puede hablar directo con Apps Script: el Web App
// responde con un 302 a script.googleusercontent.com y esa respuesta no trae los
// headers CORS, así que el fetch del cliente muere con "Failed to fetch".
// Desde el servidor no hay CORS que valga.
//
// Env var requerida: VITE_SHEETS_WEBAPP_URL
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json({ ok: false, error: 'Método no permitido' });
        return;
    }

    const webappUrl = process.env.VITE_SHEETS_WEBAPP_URL;
    if (!webappUrl) {
        res.status(500).json({ ok: false, error: 'Falta configurar VITE_SHEETS_WEBAPP_URL' });
        return;
    }

    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {});

    let upstream;
    try {
        upstream = await fetch(webappUrl, {
            method: 'POST',
            body,
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            redirect: 'follow',
        });
    } catch (err) {
        res.status(502).json({ ok: false, error: 'No se pudo contactar la hoja de Google' });
        return;
    }

    const text = await upstream.text();
    let data = null;
    try {
        data = JSON.parse(text);
    } catch {
        data = null;
    }

    // Apps Script devuelve HTML cuando algo salió mal del lado de Google
    // (permisos, cuota, deploy vencido): lo reportamos como error legible.
    if (!upstream.ok || !data) {
        res.status(502).json({
            ok: false,
            error: `La hoja respondió HTTP ${upstream.status}. Revisá que el Web App siga publicado con acceso "Cualquier persona".`,
        });
        return;
    }

    res.status(200).json(data);
}
