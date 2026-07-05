import { supabase } from '../lib/supabase';

const BUCKET = 'product-images';
const MAX_SIZE = 800; // px max width/height
const QUALITY = 0.75; // JPEG quality

/** Compress an image file/blob to JPEG ≤ MAX_SIZE px */
async function compressImage(source: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(source);
    const { width, height } = bitmap;

    let w = width;
    let h = height;
    if (w > MAX_SIZE || h > MAX_SIZE) {
        const ratio = Math.min(MAX_SIZE / w, MAX_SIZE / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
    }

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    return canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY });
}

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
     * Compresses to JPEG, deduplicates by content hash.
     * Returns the permanent public URL.
     */
    async upload(source: File | string): Promise<string> {
        // Get the raw blob
        const rawBlob = typeof source === 'string'
            ? await fetchImageBlob(source)
            : source;

        // Compress
        const compressed = await compressImage(rawBlob);

        // Hash for dedup
        const hash = await hashBlob(compressed);
        const filePath = `${hash}.jpg`;

        // Check if already exists
        const { data: existing } = await supabase.storage.from(BUCKET).list('', {
            search: filePath
        });

        if (existing && existing.some(f => f.name === filePath)) {
            return getPublicUrl(filePath);
        }

        // Upload
        const { error } = await supabase.storage.from(BUCKET).upload(filePath, compressed, {
            contentType: 'image/jpeg',
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
