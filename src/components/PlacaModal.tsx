import { useState, useEffect, useRef, useCallback } from 'react';
import qrcode from 'qrcode-generator';
import { X, Download, Upload, Loader2, Copy, Check } from 'lucide-react';
import type { Item } from '../types';

// Icono de WhatsApp (SVG → imagen) para dibujar nítido en canvas
const WA_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#ffffff" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.359.101 11.892c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652a11.882 11.882 0 005.71 1.454h.005c6.585 0 11.946-5.359 11.949-11.945a11.821 11.821 0 00-3.484-8.413"/></svg>`;

const CONFIG_KEY = 'placa_config_v1';

function loadConfig(): { wa: string; store: string } {
    try {
        const raw = localStorage.getItem(CONFIG_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { wa: '3885925942', store: `${window.location.host}/tienda` };
}

/** Carga una imagen intentando CORS anónimo (necesario para exportar el canvas). */
function loadImage(url: string): Promise<{ img: HTMLImageElement; tainted: boolean }> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve({ img, tainted: false });
        img.onerror = () => {
            // Reintentar sin CORS: se puede previsualizar pero no descargar
            const img2 = new Image();
            img2.onload = () => resolve({ img: img2, tainted: true });
            img2.onerror = () => reject(new Error('No se pudo cargar la imagen'));
            img2.src = url;
        };
        img.src = url;
    });
}

function qrImage(text: string): Promise<HTMLImageElement> {
    const qr = qrcode(0, 'H');
    qr.addData(text);
    qr.make();
    const url = qr.createDataURL(8, 0);
    return new Promise(res => {
        const img = new Image();
        img.onload = () => res(img);
        img.src = url;
    });
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}

function drawCover(c: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
    const ir = img.width / img.height, r = w / h;
    let sw, sh, sx, sy;
    if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2; }
    c.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

export default function PlacaModal({ item, onClose }: { item: Item; onClose: () => void }) {
    const initialConfig = useRef(loadConfig());
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [title, setTitle] = useState((item.storeTitle || item.productName).slice(0, 42));
    const [price, setPrice] = useState(() => {
        const p = item.salePrice || item.estimatedSalePrice || 0;
        return p > 0 ? `$ ${p.toLocaleString('es-AR')}` : '';
    });
    const [wa, setWa] = useState(initialConfig.current.wa);
    const [store, setStore] = useState(initialConfig.current.store);
    const [qrMode, setQrMode] = useState<'wa' | 'store'>('wa');
    const [fmt, setFmt] = useState<{ w: number; h: number }>({ w: 1080, h: 1080 });
    const [baseImg, setBaseImg] = useState<HTMLImageElement | null>(null);
    const [tainted, setTainted] = useState(false);
    const [loadingImg, setLoadingImg] = useState(false);
    const [waIcon, setWaIcon] = useState<HTMLImageElement | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // Fotos disponibles del producto para elegir la base
    const productImages = Array.from(new Set([item.imageUrl, ...(item.storeImages || [])].filter((u): u is string => !!u)));
    const [selectedUrl, setSelectedUrl] = useState<string | null>(productImages[0] ?? null);

    // Cargar icono de WhatsApp
    useEffect(() => {
        const img = new Image();
        img.onload = () => setWaIcon(img);
        img.src = 'data:image/svg+xml;base64,' + btoa(WA_SVG);
    }, []);

    // Cargar imagen base cuando cambia la selección
    useEffect(() => {
        if (!selectedUrl) { setBaseImg(null); return; }
        let cancelled = false;
        setLoadingImg(true);
        loadImage(selectedUrl)
            .then(({ img, tainted: t }) => {
                if (cancelled) return;
                setBaseImg(img);
                setTainted(t);
            })
            .catch(() => { if (!cancelled) { setBaseImg(null); } })
            .finally(() => { if (!cancelled) setLoadingImg(false); });
        return () => { cancelled = true; };
    }, [selectedUrl]);

    // Persistir WA/tienda
    useEffect(() => {
        try { localStorage.setItem(CONFIG_KEY, JSON.stringify({ wa, store })); } catch { /* ignore */ }
    }, [wa, store]);

    const waDigits = wa.replace(/\D/g, '');
    const waLink = () => `https://wa.me/549${waDigits}?text=${encodeURIComponent('Hola! Vi tu publicación en Marketplace, me interesa.')}`;
    const storeUrl = () => /^https?:\/\//.test(store.trim()) ? store.trim() : 'https://' + store.trim();
    const prettyWa = () => waDigits.length >= 10
        ? `+54 ${waDigits.slice(0, 3)} ${waDigits.slice(3, 6)} ${waDigits.slice(6)}`
        : `+54 ${waDigits}`;

    const render = useCallback(async () => {
        const cv = canvasRef.current;
        if (!cv) return;
        const ctx = cv.getContext('2d');
        if (!ctx) return;

        const W = fmt.w, H = fmt.h;
        cv.width = W; cv.height = H;
        const s = W / 1080;

        ctx.fillStyle = '#0b1020';
        ctx.fillRect(0, 0, W, H);

        if (baseImg) {
            drawCover(ctx, baseImg, 0, 0, W, H);
        } else {
            ctx.fillStyle = '#141b2e';
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = '#5a6890';
            ctx.textAlign = 'center';
            ctx.font = `600 ${34 * s}px -apple-system,Segoe UI,Roboto,sans-serif`;
            ctx.fillText(loadingImg ? 'Cargando foto...' : 'Elegí o subí una foto', W / 2, H / 2);
        }

        // Barra inferior de contacto
        const barH = 250 * s;
        const g = ctx.createLinearGradient(0, H - barH - 90 * s, 0, H);
        g.addColorStop(0, 'rgba(8,12,22,0)');
        g.addColorStop(.35, 'rgba(8,12,22,.72)');
        g.addColorStop(1, 'rgba(6,9,16,.94)');
        ctx.fillStyle = g;
        ctx.fillRect(0, H - barH - 90 * s, W, barH + 90 * s);

        const pad = 48 * s;
        const barTop = H - barH;

        ctx.fillStyle = '#e8b15b';
        ctx.fillRect(pad, barTop + 6 * s, 54 * s, 5 * s);

        // QR
        const qrSide = 176 * s;
        const qrCardPad = 16 * s;
        const qrCard = qrSide + qrCardPad * 2;
        const qrX = W - pad - qrCard;
        const qrY = barTop + (barH - qrCard) / 2 + 6 * s;

        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,.35)';
        ctx.shadowBlur = 24 * s; ctx.shadowOffsetY = 6 * s;
        ctx.fillStyle = '#ffffff';
        roundRect(ctx, qrX, qrY, qrCard, qrCard, 18 * s);
        ctx.fill();
        ctx.restore();

        try {
            const qi = await qrImage(qrMode === 'wa' ? waLink() : storeUrl());
            ctx.drawImage(qi, qrX + qrCardPad, qrY + qrCardPad, qrSide, qrSide);
        } catch { /* ignore */ }

        ctx.textAlign = 'center';
        ctx.fillStyle = '#e8b15b';
        ctx.font = `700 ${19 * s}px -apple-system,Segoe UI,Roboto,sans-serif`;
        ctx.fillText(qrMode === 'wa' ? 'ESCANEÁ Y CHATEÁ' : 'ESCANEÁ Y MIRÁ MÁS', qrX + qrCard / 2, qrY + qrCard + 30 * s);

        // Bloque izquierdo: WhatsApp + tienda
        const leftX = pad;
        const ly = barTop + 74 * s;
        const icoR = 34 * s;
        const icoCX = leftX + icoR, icoCY = ly + icoR - 6 * s;
        ctx.fillStyle = '#25d366';
        ctx.beginPath(); ctx.arc(icoCX, icoCY, icoR, 0, Math.PI * 2); ctx.fill();
        if (waIcon) {
            const ic = icoR * 1.15;
            ctx.drawImage(waIcon, icoCX - ic / 2, icoCY - ic / 2, ic, ic);
        }

        ctx.textAlign = 'left';
        ctx.fillStyle = '#ffffff';
        ctx.font = `800 ${42 * s}px -apple-system,Segoe UI,Roboto,sans-serif`;
        ctx.fillText(prettyWa(), leftX + icoR * 2 + 20 * s, icoCY + 15 * s);

        ctx.fillStyle = '#aeb8d4';
        ctx.font = `500 ${21 * s}px -apple-system,Segoe UI,Roboto,sans-serif`;
        ctx.fillText('Consultá disponibilidad', leftX, icoCY + icoR + 40 * s);

        ctx.fillStyle = '#e8b15b';
        ctx.font = `700 ${22 * s}px -apple-system,Segoe UI,Roboto,sans-serif`;
        ctx.fillText(store.trim(), leftX, icoCY + icoR + 74 * s);

        // Título arriba
        const t = title.trim();
        if (t) {
            const tg = ctx.createLinearGradient(0, 0, 0, 150 * s);
            tg.addColorStop(0, 'rgba(6,9,16,.82)');
            tg.addColorStop(1, 'rgba(6,9,16,0)');
            ctx.fillStyle = tg;
            ctx.fillRect(0, 0, W, 170 * s);
            ctx.textAlign = 'left';
            ctx.fillStyle = '#ffffff';
            ctx.font = `800 ${40 * s}px -apple-system,Segoe UI,Roboto,sans-serif`;
            ctx.fillText(t, pad, 74 * s);
        }

        // Precio badge
        const p = price.trim();
        if (p) {
            ctx.font = `800 ${34 * s}px -apple-system,Segoe UI,Roboto,sans-serif`;
            const tw = ctx.measureText(p).width;
            const bw = tw + 44 * s, bh = 62 * s;
            const bx = W - pad - bw, by = pad;
            ctx.save();
            ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 18 * s; ctx.shadowOffsetY = 4 * s;
            ctx.fillStyle = '#e8b15b';
            roundRect(ctx, bx, by, bw, bh, 14 * s); ctx.fill();
            ctx.restore();
            ctx.fillStyle = '#22160a';
            ctx.textAlign = 'center';
            ctx.fillText(p, bx + bw / 2, by + bh / 2 + 12 * s);
        }

        // Exportar a imagen arrastrable (falla si la foto externa no permite CORS)
        try {
            setPreviewUrl(cv.toDataURL('image/png'));
        } catch {
            setPreviewUrl(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [title, price, wa, store, qrMode, fmt, baseImg, waIcon, loadingImg]);

    useEffect(() => { render(); }, [render]);

    const handleFile = (f: File | undefined) => {
        if (!f) return;
        const reader = new FileReader();
        reader.onload = ev => {
            const img = new Image();
            img.onload = () => { setBaseImg(img); setTainted(false); setSelectedUrl(null); };
            img.src = ev.target?.result as string;
        };
        reader.readAsDataURL(f);
    };

    const download = () => {
        if (!previewUrl) {
            alert('Esta foto viene de un sitio externo que no permite exportarla. Subí el archivo de la foto manualmente y volvé a intentar.');
            return;
        }
        const a = document.createElement('a');
        const t = (title.trim() || 'producto').replace(/[^\w]+/g, '-').toLowerCase().slice(0, 30);
        a.download = `placa-${t}.png`;
        a.href = previewUrl;
        a.click();
    };

    const copyImage = async () => {
        const cv = canvasRef.current;
        if (!cv || !previewUrl) return;
        try {
            const blob: Blob = await new Promise((res, rej) =>
                cv.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/png')
            );
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            alert('Tu navegador no permite copiar imágenes al portapapeles. Usá arrastrar o descargar.');
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col ring-1 ring-black/5">
                {/* Header */}
                <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between sticky top-0 z-10 rounded-t-3xl sm:rounded-t-2xl">
                    <div>
                        <h2 className="text-base font-bold text-gray-800">Placa para Marketplace</h2>
                        <p className="text-xs text-gray-500 truncate max-w-[300px]">{item.productName}</p>
                    </div>
                    <button onClick={onClose} className="h-8 w-8 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-gray-600 flex items-center justify-center">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        {/* Controles */}
                        <div className="space-y-4">
                            {/* Selector de foto base */}
                            {productImages.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Foto base</p>
                                    <div className="flex gap-2 flex-wrap">
                                        {productImages.map(url => (
                                            <button
                                                key={url}
                                                onClick={() => setSelectedUrl(url)}
                                                className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${selectedUrl === url ? 'border-amber-500' : 'border-transparent opacity-60 hover:opacity-100'}`}
                                            >
                                                <img src={url} alt="" className="w-full h-full object-cover" />
                                            </button>
                                        ))}
                                        <label className="w-14 h-14 rounded-lg border-2 border-dashed border-gray-200 hover:border-gray-400 flex items-center justify-center cursor-pointer transition-all" title="Subir otra foto">
                                            <Upload className="w-4 h-4 text-gray-400" />
                                            <input type="file" accept="image/*" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
                                        </label>
                                    </div>
                                    {tainted && (
                                        <p className="text-[11px] text-amber-600 mt-1.5">⚠ Esta foto es de un sitio externo: se ve en la vista previa pero puede no descargar. Si falla, subila como archivo.</p>
                                    )}
                                </div>
                            )}

                            <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Título (corto)</p>
                                <input type="text" maxLength={42} value={title} onChange={e => setTitle(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-amber-400" />
                            </div>

                            <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Precio</p>
                                <input type="text" maxLength={18} value={price} onChange={e => setPrice(e.target.value)}
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-amber-400" />
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">WhatsApp</p>
                                    <input type="text" value={wa} onChange={e => setWa(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-amber-400" />
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Tienda</p>
                                    <input type="text" value={store} onChange={e => setStore(e.target.value)}
                                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-amber-400" />
                                </div>
                            </div>

                            <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">El QR abre…</p>
                                <div className="flex bg-gray-50 border border-gray-200 rounded-xl p-1 gap-1">
                                    <button onClick={() => setQrMode('wa')} className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-all ${qrMode === 'wa' ? 'bg-amber-500 text-white' : 'text-gray-500'}`}>Chat de WhatsApp</button>
                                    <button onClick={() => setQrMode('store')} className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-all ${qrMode === 'store' ? 'bg-amber-500 text-white' : 'text-gray-500'}`}>Tu tienda</button>
                                </div>
                            </div>

                            <div>
                                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Formato</p>
                                <div className="flex bg-gray-50 border border-gray-200 rounded-xl p-1 gap-1">
                                    <button onClick={() => setFmt({ w: 1080, h: 1080 })} className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-all ${fmt.h === 1080 ? 'bg-amber-500 text-white' : 'text-gray-500'}`}>Cuadrado 1:1</button>
                                    <button onClick={() => setFmt({ w: 1080, h: 1350 })} className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-all ${fmt.h === 1350 ? 'bg-amber-500 text-white' : 'text-gray-500'}`}>Vertical 4:5</button>
                                </div>
                            </div>
                        </div>

                        {/* Preview */}
                        <div className="flex flex-col gap-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Vista previa</p>
                            {/* Canvas oculto: solo genera la imagen */}
                            <canvas ref={canvasRef} className="hidden" />
                            <div className="rounded-xl overflow-hidden border border-gray-200 bg-gray-900 relative">
                                {loadingImg && (
                                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30">
                                        <Loader2 className="w-6 h-6 text-white animate-spin" />
                                    </div>
                                )}
                                {previewUrl ? (
                                    <img
                                        src={previewUrl}
                                        alt="Placa"
                                        draggable
                                        className="w-full h-auto block cursor-grab active:cursor-grabbing"
                                        title="Arrastrá esta imagen directo a Facebook Marketplace"
                                    />
                                ) : (
                                    <div className="aspect-square flex items-center justify-center text-gray-500 text-sm px-6 text-center">
                                        {baseImg ? 'Esta foto externa no permite exportar — subí el archivo manualmente' : 'Elegí o subí una foto'}
                                    </div>
                                )}
                            </div>

                            {previewUrl && (
                                <div className="flex items-center justify-center gap-1.5 text-[11px] text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" /></svg>
                                    <span><b>Arrastrá la imagen de arriba</b> directo a "Agregar fotos" de Marketplace</span>
                                </div>
                            )}

                            <div className="flex gap-2">
                                <button
                                    onClick={copyImage}
                                    disabled={!previewUrl}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-semibold disabled:opacity-40 transition-all"
                                >
                                    {copied ? <><Check className="w-4 h-4 text-emerald-500" /><span className="text-emerald-600">Copiada</span></> : <><Copy className="w-4 h-4" />Copiar</>}
                                </button>
                                <button
                                    onClick={download}
                                    disabled={!baseImg}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold disabled:opacity-40 transition-all"
                                >
                                    <Download className="w-4 h-4" />
                                    Descargar
                                </button>
                            </div>
                            <p className="text-[11px] text-gray-400 text-center">La imagen se genera en tu dispositivo — nada se sube a ningún lado.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
