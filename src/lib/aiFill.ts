// ── Completar producto con IA (Gemini, ChatGPT, etc.) ─────────────────────
// Se copian estas instrucciones, se pegan en la IA junto con las fotos del
// producto, y la respuesta (un JSON) se pega de vuelta en el formulario.

import type { ItemCondition } from '../types';

export const CIERRE_CONTACTO = '💬 **Contacto:** escribime un mensaje directo y coordinamos la entrega';

export const AI_PROMPT = `Sos experto en publicaciones de venta online en Argentina. Te paso fotos y/o datos de un producto. Respondé SOLO con un JSON válido (sin texto antes ni después, sin \`\`\`), con esta forma exacta:

{
  "titulo": "",
  "descripcion": "",
  "precio_venta": null,
  "estado": "nuevo",
  "variante": null
}

Reglas:
- titulo: nombre claro del producto, como lo buscaría un comprador (tipo de producto, marca, modelo, medida o potencia). Máximo 70 caracteres. Sin emojis y sin precio.
- descripcion: entre 4 y 6 líneas separadas con \\n, sin líneas en blanco. Cada línea sigue este molde: EMOJI **Etiqueta:** contenido
  · La etiqueta tiene 1 a 3 palabras y los dos puntos van dentro de la negrita. El contenido va sin negrita y sin punto final.
  · Un emoji distinto al principio de cada línea.
  · No pongas precios, ubicación ni datos de envío. Ignorá marcas de agua o texto repetido de las fotos.
  · Las dos últimas líneas son siempre estas (si el producto no es nuevo, adaptá solo la de Condición):
📦 **Condición:** producto totalmente nuevo en caja
${CIERRE_CONTACTO}
- precio_venta: número en pesos, sin puntos ni signo, SOLO si yo te lo dije. Si no, null.
- estado: "nuevo", "semi_uso" o "usado".
- variante: color o medida si es una opción de un producto con variantes (ej. "2 metros", "negro"). Si no, null.

Ejemplo de descripcion:
🔋 **Batería:** 20000mAh para varias cargas completas\\n⚡ **Carga rápida:** 18W por USB-C\\n🔌 **Puertos:** 2 USB para cargar dos equipos a la vez\\n📦 **Condición:** producto totalmente nuevo en caja\\n${CIERRE_CONTACTO}

Datos del producto:`;

export interface AiFill {
    titulo?: string;
    descripcion?: string;
    precioVenta?: number;
    estado?: ItemCondition;
    variante?: string;
}

const pick = (o: Record<string, unknown>, ...keys: string[]) => {
    for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
    return undefined;
};

/** Lee la respuesta de la IA. Tolera ```json, texto alrededor, claves en inglés
 *  y descripciones como lista. Tira un error con un mensaje claro si no hay JSON. */
export function parseAiFill(raw: string): AiFill {
    const text = (raw || '').replace(/```(?:json)?/gi, '');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('No encontré un JSON en lo que pegaste. Pedile a la IA que responda solo con el JSON.');
    let obj: Record<string, unknown>;
    try {
        obj = JSON.parse(text.slice(start, end + 1));
    } catch {
        throw new Error('El JSON está incompleto o mal formado. Copiá la respuesta entera de la IA.');
    }

    const out: AiFill = {};
    const titulo = pick(obj, 'titulo', 'título', 'title', 'nombre', 'name');
    if (typeof titulo === 'string' && titulo.trim()) out.titulo = titulo.trim().replace(/\s+/g, ' ');

    const desc = pick(obj, 'descripcion', 'descripción', 'description');
    if (Array.isArray(desc)) out.descripcion = desc.map(String).join('\n').trim();
    else if (typeof desc === 'string' && desc.trim()) out.descripcion = desc.replace(/\\n/g, '\n').trim();

    const precio = pick(obj, 'precio_venta', 'precioVenta', 'precio', 'price');
    const n = typeof precio === 'number' ? precio : typeof precio === 'string' ? Number(precio.replace(/[^\d]/g, '')) : NaN;
    if (Number.isFinite(n) && n > 0) out.precioVenta = Math.round(n);

    const estado = String(pick(obj, 'estado', 'condicion', 'condición', 'condition') ?? '').toLowerCase().replace(/[\s-]+/g, '_');
    if (estado === 'nuevo' || estado === 'new') out.estado = 'nuevo';
    else if (estado.startsWith('semi')) out.estado = 'semi_uso';
    else if (estado === 'usado' || estado === 'used') out.estado = 'usado';

    const variante = pick(obj, 'variante', 'variant', 'opcion', 'opción');
    if (typeof variante === 'string' && variante.trim()) out.variante = variante.trim();

    if (!out.titulo && !out.descripcion) throw new Error('El JSON no trae título ni descripción.');
    return out;
}
