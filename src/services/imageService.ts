import { supabase } from '../lib/supabase';
import { cleanMediaLink, sniffBytes } from '../lib/sniff';

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

const EXT_BY_TYPE: Record<string, string> = { 'image/avif': 'avif', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif' };

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

    /** Sube un video tal cual (sin comprimir), deduplicado por contenido. */
    async uploadVideo(blob: Blob, nameHint = ''): Promise<string> {
        const type = blob.type && blob.type.startsWith('video/') ? blob.type : 'video/mp4';
        const ext = (nameHint.match(/\.(mp4|mov|webm|m4v|ogv)(?:[?#]|$)/i)?.[1] || ({ 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v' } as Record<string, string>)[type] || 'mp4').toLowerCase();
        const filePath = `vid_${await hashBlob(blob)}.${ext}`;
        const { data: existing } = await supabase.storage.from(BUCKET).list('', { search: filePath });
        if (!existing?.some(f => f.name === filePath)) {
            const { error } = await supabase.storage.from(BUCKET).upload(filePath, blob, { contentType: type, upsert: false });
            if (error && !error.message?.includes('already exists') && !error.message?.includes('Duplicate')) throw error;
        }
        return getPublicUrl(filePath);
    },

    /**
     * Copia una foto o un video desde un link externo (ej. Temu) al almacenamiento
     * propio. Primero lo baja el navegador (sin Referer, como cuando lo abrís a
     * mano); si el sitio no lo permite, lo intenta el servidor.
     */
    async copyFromLink(rawLink: string, kind: 'image' | 'video'): Promise<string> {
        const link = cleanMediaLink(rawLink);
        let browserErr = '';
        try {
            const r = await fetch(link, { mode: 'cors', referrerPolicy: 'no-referrer', credentials: 'omit' });
            if (!r.ok) throw new Error(`respondió ${r.status}`);
            const raw = await r.blob();
            if (raw.size < 512) throw new Error('vino vacío');
            // Se mira el contenido real: el tipo que manda el sitio puede mentir
            const real = sniffBytes(new Uint8Array(await raw.slice(0, 32).arrayBuffer()));
            if (!real || real.kind !== kind) throw new Error('no es un archivo de ' + (kind === 'video' ? 'video' : 'imagen'));
            const blob = raw.type === real.type ? raw : new Blob([raw], { type: real.type });
            return kind === 'video'
                ? await this.uploadVideo(blob, new URL(link).pathname)
                : await this.upload(new File([blob], 'foto', { type: blob.type || 'image/jpeg' }));
        } catch (err) {
            browserErr = err instanceof Error ? err.message : String(err);
        }
        const { data } = await supabase.auth.getSession();
        let serverErr = '';
        try {
            const r = await fetch('/api/copiar-video', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
                body: JSON.stringify({ url: link, kind }),
            });
            const j = await r.json().catch(() => ({}));
            if (r.ok && j.url) return j.url as string;
            serverErr = j.error || `el servidor respondió ${r.status}`;
        } catch (err) {
            serverErr = err instanceof Error ? err.message : String(err);
        }
        console.warn('copyFromLink', { link, browserErr, serverErr });
        throw new Error(serverErr || browserErr || 'No se pudo copiar el archivo');
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
