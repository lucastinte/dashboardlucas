import { describe, expect, it } from 'vitest';
import { cleanMediaLink, sniffBytes } from './sniff';

const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 0x18, ...Array.from('ftyp' + brand, c => c.charCodeAt(0)), 0, 0]);

describe('sniffBytes', () => {
    it('distingue MP4, MOV, AVIF y HEIC aunque todos empiecen con ftyp', () => {
        expect(sniffBytes(ftyp('isom'))?.type).toBe('video/mp4');
        expect(sniffBytes(ftyp('qt  '))?.type).toBe('video/quicktime');
        expect(sniffBytes(ftyp('avif'))?.kind).toBe('image');
        expect(sniffBytes(ftyp('heic'))?.kind).toBe('image');
    });
    it('reconoce JPEG y rechaza HTML', () => {
        expect(sniffBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.type).toBe('image/jpeg');
        expect(sniffBytes(new TextEncoder().encode('<!DOCTYPE html>'))).toBeNull();
    });
});

describe('cleanMediaLink', () => {
    it('saca el recorte/AVIF de las fotos de Temu', () => {
        expect(cleanMediaLink('https://img.kwcdn.com/product/fancy/08c2.jpg?imageView2/2/w/800/q/70/format/avif')).toBe('https://img.kwcdn.com/product/fancy/08c2.jpg');
    });
    it('no toca otros links', () => {
        expect(cleanMediaLink('https://goods-vod.kwcdn.com/goods-video/a.f30.mp4?x=1')).toBe('https://goods-vod.kwcdn.com/goods-video/a.f30.mp4?x=1');
        expect(cleanMediaLink('https://ejemplo.com/a.jpg?w=1')).toBe('https://ejemplo.com/a.jpg?w=1');
    });
});
