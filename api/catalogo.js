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
        select: 'id,product_name,sale_price,estimated_sale_price,quantity,item_condition,location,description,image_url,store_images,store_video_url,store_title,store_group,store_variant_name',
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

    const toVariant = (it) => ({
        nombre: it.store_variant_name || it.product_name,
        precio: Number(it.sale_price || it.estimated_sale_price || 0),
        condicion: condLabel[it.item_condition] || 'Nuevo',
        cantidad: it.quantity,
        ubicacion: it.location || null,
        link: `${baseUrl}/tienda/producto/${it.id}`,
    });

    // Variante = nombre de variante + ubicación. Sin nombre y misma ubicación
    // se fusionan: suma cantidades, precio más alto.
    const mergeItems = (group) => {
        const map = new Map();
        for (const it of group) {
            const key = `${(it.store_variant_name || '').trim().toLowerCase()}|${(it.location || '').trim().toLowerCase()}`;
            const ex = map.get(key);
            if (ex) {
                ex.quantity = (ex.quantity || 0) + (it.quantity || 0);
                const exPrice = Number(ex.sale_price || ex.estimated_sale_price || 0);
                const price = Number(it.sale_price || it.estimated_sale_price || 0);
                if (price > exPrice) {
                    ex.sale_price = it.sale_price;
                    ex.estimated_sale_price = it.estimated_sale_price;
                }
            } else {
                map.set(key, { ...it });
            }
        }
        return [...map.values()];
    };

    // Agrupar variantes por store_group; sin grupo → publicación individual
    const byGroup = new Map();
    const singles = [];
    for (const it of rows) {
        const g = (it.store_group || '').trim();
        if (g) {
            if (!byGroup.has(g)) byGroup.set(g, []);
            byGroup.get(g).push(it);
        } else {
            singles.push(it);
        }
    }
    const score = (it) => (it.store_title ? 4 : 0) + (it.description ? 2 : 0) + (Array.isArray(it.store_images) && it.store_images.length ? 1 : 0) + (it.image_url ? 1 : 0);

    const productos = [];
    for (const group of byGroup.values()) {
        const rep = [...group].sort((a, b) => score(b) - score(a))[0];
        productos.push({
            titulo: rep.store_title || rep.product_name,
            descripcion: rep.description || null,
            ubicacion: rep.location || null,
            imagen: rep.image_url || (Array.isArray(rep.store_images) ? rep.store_images[0] : null) || null,
            video: rep.store_video_url || null,
            link: `${baseUrl}/tienda/producto/${rep.id}`,
            stockTotal: group.reduce((acc, it) => acc + (it.quantity || 0), 0),
            variantes: mergeItems(group).map(toVariant),
        });
    }
    for (const it of singles) {
        productos.push({
            titulo: it.store_title || it.product_name,
            descripcion: it.description || null,
            ubicacion: it.location || null,
            imagen: it.image_url || (Array.isArray(it.store_images) ? it.store_images[0] : null) || null,
            video: it.store_video_url || null,
            link: `${baseUrl}/tienda/producto/${it.id}`,
            stockTotal: it.quantity || 0,
            variantes: [toVariant(it)],
        });
    }
    productos.sort((a, b) => a.titulo.localeCompare(b.titulo));

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
            lines.push(`• ${p.titulo}`);
            if (p.descripcion) lines.push(`  ${p.descripcion.replace(/\n/g, ' ')}`);
            if (p.ubicacion) lines.push(`  Ubicación: ${p.ubicacion}`);
            if (p.variantes.length === 1) {
                const v = p.variantes[0];
                lines.push(`  ${fmt(v.precio)} — ${v.condicion}${v.cantidad > 1 ? ` — ${v.cantidad} disponibles` : ''}`);
            } else {
                lines.push(`  Stock total: ${p.stockTotal} unidad${p.stockTotal !== 1 ? 'es' : ''}. Opciones:`);
                for (const v of p.variantes) {
                    lines.push(`    - ${v.nombre}: ${fmt(v.precio)} — ${v.condicion} — ${v.cantidad} disponible${v.cantidad !== 1 ? 's' : ''}${v.ubicacion ? ` — Ubicación: ${v.ubicacion}` : ''}`);
                }
            }
            lines.push(`  Link: ${p.link}`);
            lines.push('');
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.status(200).send(lines.join('\n'));
        return;
    }

    res.status(200).json({ total: productos.length, tienda: `${baseUrl}/tienda`, productos });
}
