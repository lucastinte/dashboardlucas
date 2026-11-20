import { supabase } from '../lib/supabase';

const BUCKET = 'product-images';
const MAX_SIZE = 800; // px max width/height
const QUALITY = 0.75; // JPEG quality

/** Calcula el tamaño final respetando MAX_SIZE */
function fitSize(width: number, height: number) {
    if (width <= MAX_SIZE && height <= MAX_SIZE) return { w: width, h: height };
    const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
    return { w: Math.round(width * ratio), h: Math.round(height * ratio) };
}

/** Decodifica con <img>: funciona en todos los navegadores, incluido Safari viejo */
function loadWithImg(source: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(source);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
        img.src = url;
    });
}

/**
 * Comprime a JPEG ≤ MAX_SIZE px. Usa OffscreenCanvas si está; si no (iPhone
 * con iOS < 16.4) un <canvas> común. Devuelve null si el navegador no puede
 * decodificar la imagen (ej. HEIC fuera de Safari): ahí se sube la original.
 */
async function compressImage(source: Blob): Promise<Blob | null> {
    try {
        if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
            const bitmap = await createImageBitmap(source);
            const { w, h } = fitSize(bitmap.width, bitmap.height);
            const canvas = new OffscreenCanvas(w, h);
            canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
            bitmap.close();
            return await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
        }
    } catch {
        /* sigue con el método clásico */
    }
    try {
        const img = await loadWithImg(source);
        const { w, h } = fitSize(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
        return await new Promise<Blob | null>(res => canvas.toBlob(b => res(b), 'image/jpeg', QUALITY));
    } catch {
        return null;
    }
}

const EXT_BY_TYPE: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif' };

/** SHA-256 hex hash of a blob */
async function hashBlob(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Download an external image URL as a Blob */
async function fetchImageBlob(url: string): Promise<Blob> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`No se pudo descargar la imagen (${res.status})`);
    return res.blob();
}

/** Get public URL for a file in the bucket */
function getPublicUrl(path: string): string {
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data.publicUrl;
}

export const imageService = {
    /**
     * Upload a product image (File or URL string).
     * Compresses to JPEG when possible, deduplicates by content hash.
     * Returns the permanent public URL.
     */
    async upload(source: File | string): Promise<string> {
        // Get the raw blob
        const rawBlob = typeof source === 'string'
            ? await fetchImageBlob(source)
            : source;

        // Comprimir; si no se puede, subir la original tal cual
        const compressed = await compressImage(rawBlob);
        const blob = compressed ?? rawBlob;
        const contentType = compressed ? 'image/jpeg' : (rawBlob.type || 'image/jpeg');
        const ext = compressed ? 'jpg' : (EXT_BY_TYPE[contentType] || 'jpg');

        // Hash for dedup
        const hash = await hashBlob(blob);
        const filePath = `${hash}.${ext}`;

        // Check if already exists
        const { data: existing } = await supabase.storage.from(BUCKET).list('', {
            search: filePath
        });

        if (existing && existing.some(f => f.name === filePath)) {
            return getPublicUrl(filePath);
        }

        // Upload
        const { error } = await supabase.storage.from(BUCKET).upload(filePath, blob, {
            contentType,
            upsert: false
        });

        if (error) {
            // If race condition (another upload beat us), it's fine
            if (error.message?.includes('already exists') || error.message?.includes('Duplicate')) {
                return getPublicUrl(filePath);
            }
            throw error;
        }

        return getPublicUrl(filePath);
    },

    /**
     * Delete a file from the bucket given its public URL.
     * External URLs (not from this bucket) are ignored.
     */
    async remove(url: string): Promise<void> {
        const marker = `/object/public/${BUCKET}/`;
        const idx = url.indexOf(marker);
        if (idx === -1) return; // URL externa, no hay nada que borrar
        const path = decodeURIComponent(url.slice(idx + marker.length).split('?')[0]);
        if (!path) return;
        await supabase.storage.from(BUCKET).remove([path]);
    }
};
