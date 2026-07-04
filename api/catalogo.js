// Catálogo público de la tienda para consumo de bots (WhatsApp, etc.)
// GET /api/catalogo          → JSON
// GET /api/catalogo?formato=texto → texto plano legible
export default async function handler(req, res) {
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
        res.status(500).json({ error: 'Supabase no configurado' });
        return;
    }

    const query = new URLSearchParams({
        select: 'id,product_name,sale_price,estimated_sale_price,quantity,item_condition,location,description,image_url,store_images,store_video_url',
        public_in_store: 'eq.true',
        status: 'eq.in_stock',
        order: 'product_name.asc',
    });

    let rows;
    try {
        const r = await fetch(`${supabaseUrl}/rest/v1/items?${query}`, {
            headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
        });
        if (!r.ok) throw new Error(`Supabase ${r.status}`);
        rows = await r.json();
    } catch (err) {
        res.status(502).json({ error: 'No se pudo cargar el catálogo' });
        return;
    }

    const condLabel = { nuevo: 'Nuevo', semi_uso: 'Semi uso', usado: 'Usado' };
    const baseUrl = `https://${req.headers.host}`;

    const productos = rows.map((it) => ({
        nombre: it.product_name,
        precio: Number(it.sale_price || it.estimated_sale_price || 0),
        condicion: condLabel[it.item_condition] || 'Nuevo',
        cantidad: it.quantity,
        ubicacion: it.location || null,
        descripcion: it.description || null,
        link: `${baseUrl}/tienda/producto/${it.id}`,
        imagen: it.image_url || (Array.isArray(it.store_images) ? it.store_images[0] : null) || null,
        video: it.store_video_url || null,
    }));

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    if ((req.query.formato || '').toLowerCase() === 'texto') {
        const fmt = (n) => '$' + n.toLocaleString('es-AR');
        const lines = [
            `CATÁLOGO DE PRODUCTOS DISPONIBLES (${productos.length})`,
            `Tienda: ${baseUrl}/tienda`,
            '',
        ];
        for (const p of productos) {
            lines.push(`• ${p.nombre} — ${fmt(p.precio)} — ${p.condicion}${p.cantidad > 1 ? ` — ${p.cantidad} disponibles` : ''}`);
            if (p.ubicacion) lines.push(`  Ubicación: ${p.ubicacion}`);
            if (p.descripcion) lines.push(`  ${p.descripcion.replace(/\n/g, ' ')}`);
            lines.push(`  Link: ${p.link}`);
            lines.push('');
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(lines.join('\n'));
        return;
    }

    res.status(200).json({ total: productos.length, tienda: `${baseUrl}/tienda`, productos });
}
