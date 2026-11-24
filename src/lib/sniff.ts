// Qué es un archivo según sus primeros bytes. Los sitios (ej. Temu) a veces
// mandan un tipo equivocado, y AVIF/HEIC empiezan igual que un MP4 ("ftyp").
// Misma lógica que api/copiar-video.js.

export type Sniffed = { kind: 'image' | 'video'; type: string; ext: string };

export function sniffBytes(b: Uint8Array): Sniffed | null {
    const ascii = (a: number, z: number) => String.fromCharCode(...b.subarray(a, z));
    if (b.length >= 12 && ascii(4, 8) === 'ftyp') {
        const brand = ascii(8, 12);
        if (brand === 'avif' || brand === 'avis') return { kind: 'image', type: 'image/avif', ext: 'avif' };
        if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return { kind: 'image', type: 'image/heic', ext: 'heic' };
        if (brand.startsWith('qt')) return { kind: 'video', type: 'video/quicktime', ext: 'mov' };
        return { kind: 'video', type: 'video/mp4', ext: 'mp4' };
    }
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { kind: 'video', type: 'video/webm', ext: 'webm' };
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', type: 'image/jpeg', ext: 'jpg' };
    if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return { kind: 'image', type: 'image/png', ext: 'png' };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { kind: 'image', type: 'image/webp', ext: 'webp' };
    if (ascii(0, 3) === 'GIF') return { kind: 'image', type: 'image/gif', ext: 'gif' };
    return null;
}

/** Links de imágenes de Temu: sin los parámetros de recorte/formato se obtiene la original (JPG). */
export function cleanMediaLink(link: string): string {
    try {
        const u = new URL(link);
        if (/(^|\.)kwcdn\.com$/i.test(u.hostname) && /\.(jpe?g|png|webp)$/i.test(u.pathname)) { u.search = ''; return u.toString(); }
    } catch { /* link inválido: se devuelve igual */ }
    return link;
}
