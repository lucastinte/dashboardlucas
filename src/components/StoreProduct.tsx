import { useState, useEffect } from 'react';
import { itemService } from '../services/itemService';
import type { Item } from '../types';

const conditionLabel: Record<string, string> = {
    nuevo: 'Nuevo',
    semi_uso: 'Semi uso',
    usado: 'Usado',
};

const conditionColor: Record<string, string> = {
    nuevo: 'bg-emerald-100 text-emerald-700',
    semi_uso: 'bg-amber-100 text-amber-700',
    usado: 'bg-gray-100 text-gray-600',
};

function getYouTubeId(url: string): string | null {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return match?.[1] ?? null;
}

function VideoPlayer({ url }: { url: string }) {
    const ytId = getYouTubeId(url);
    if (ytId) {
        return (
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black shadow-sm">
                <iframe
                    src={`https://www.youtube.com/embed/${ytId}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 w-full h-full"
                    title="Video del producto"
                />
            </div>
        );
    }
    return (
        <video
            src={url}
            controls
            className="w-full rounded-xl bg-black shadow-sm"
            style={{ maxHeight: '420px' }}
        />
    );
}

function ImagePlaceholder() {
    return (
        <div className="w-full h-full flex items-center justify-center bg-gray-50">
            <svg className="w-16 h-16 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
        </div>
    );
}

export default function StoreProduct({ id }: { id: string }) {
    const [item, setItem] = useState<Item | null>(null);
    const [variants, setVariants] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [activeIdx, setActiveIdx] = useState(0);
    const [copied, setCopied] = useState(false);
    const [mainImgError, setMainImgError] = useState(false);

    useEffect(() => {
        itemService.getPublicItemById(id)
            .then(async data => {
                if (!data) { setNotFound(true); return; }
                setItem(data);
                if (data.storeGroup) {
                    const group = await itemService.getPublicItemsByGroup(data.storeGroup);
                    if (group.length > 1) setVariants(group);
                }
            })
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));
    }, [id]);

    // Solo el nombre de variante (y la ubicación) definen una variante.
    // Sin nombre y misma ubicación → se suma como cantidad del mismo producto.
    // Precios distintos dentro del mismo grupo → se muestra el más alto.
    const mergedVariants = (() => {
        const map = new Map<string, { ids: string[]; variantName: string; condition: string; quantity: number; price: number; location: string }>();
        for (const v of variants) {
            const variantName = (v.storeVariantName || '').trim();
            const location = (v.location || '').trim();
            const key = `${variantName.toLowerCase()}|${location.toLowerCase()}`;
            const price = v.salePrice || v.estimatedSalePrice || 0;
            const ex = map.get(key);
            if (ex) {
                ex.quantity += v.quantity;
                ex.price = Math.max(ex.price, price);
                ex.ids.push(v.id);
            } else {
                map.set(key, { ids: [v.id], variantName, condition: v.condition, quantity: v.quantity, price, location });
            }
        }
        return Array.from(map.values());
    })();

    const hasOptions = mergedVariants.length > 1;
    // Precio y stock a mostrar cuando el grupo se fusiona en una sola opción
    const displayPrice = mergedVariants.length === 1 ? mergedVariants[0].price : (item ? (item.salePrice || item.estimatedSalePrice || 0) : 0);
    const displayStock = mergedVariants.length === 1 ? mergedVariants[0].quantity : (item?.quantity ?? 0);

    // Imágenes del producto + las de sus variantes (sin duplicados)
    const allImages = item
        ? Array.from(new Set([
            item.imageUrl,
            ...(item.storeImages || []),
            ...variants.flatMap(v => [v.imageUrl, ...(v.storeImages || [])]),
        ].filter((u): u is string => !!u)))
        : [];

    const activeUrl = allImages[activeIdx] ?? null;

    const copyLink = () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50">
                <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
            </div>
        );
    }

    if (notFound || !item) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4 text-center px-4">
                <p className="text-2xl font-bold text-gray-300">404</p>
                <p className="text-gray-500">Este producto no está disponible</p>
                <a href="/tienda" className="text-sm text-indigo-600 underline">← Volver a la tienda</a>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
                <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
                    <a href="/tienda" className="flex items-center gap-1.5 text-gray-500 hover:text-gray-800 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        <span className="text-sm font-medium">Tienda</span>
                    </a>
                    <div className="flex-1" />
                    <button
                        onClick={copyLink}
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors"
                    >
                        {copied ? (
                            <>
                                <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                <span className="text-emerald-600">Copiado</span>
                            </>
                        ) : (
                            <>
                                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                <span>Copiar link</span>
                            </>
                        )}
                    </button>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 py-6">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                        {/* Galería */}
                        <div className="flex flex-col gap-2 p-4 bg-gray-50 border-b md:border-b-0 md:border-r border-gray-100">
                            {/* Imagen principal */}
                            <div className="aspect-square rounded-xl overflow-hidden bg-white border border-gray-100">
                                {activeUrl && !mainImgError ? (
                                    <img
                                        key={activeUrl}
                                        src={activeUrl}
                                        alt={item.productName}
                                        className="w-full h-full object-cover"
                                        onError={() => setMainImgError(true)}
                                    />
                                ) : (
                                    <ImagePlaceholder />
                                )}
                            </div>

                            {/* Miniaturas */}
                            {allImages.length > 1 && (
                                <div className="flex gap-2 overflow-x-auto pb-1">
                                    {allImages.map((url, i) => (
                                        <button
                                            key={i}
                                            onClick={() => { setActiveIdx(i); setMainImgError(false); }}
                                            className={`shrink-0 w-14 h-14 rounded-lg overflow-hidden border-2 transition-all ${i === activeIdx ? 'border-indigo-500' : 'border-transparent opacity-60 hover:opacity-100'}`}
                                        >
                                            <img src={url} alt="" className="w-full h-full object-cover" />
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Video debajo de la galería */}
                            {item.storeVideoUrl && (
                                <div className="mt-1">
                                    <VideoPlayer url={item.storeVideoUrl} />
                                </div>
                            )}
                        </div>

                        {/* Info */}
                        <div className="p-6 flex flex-col gap-4">
                            <div className="flex items-start justify-between gap-3">
                                <h1 className="text-xl font-bold text-gray-900 leading-tight">{item.storeTitle || item.productName}</h1>
                                {!hasOptions && (
                                    <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${conditionColor[item.condition] || conditionColor.nuevo}`}>
                                        {conditionLabel[item.condition] || item.condition}
                                    </span>
                                )}
                            </div>

                            {!hasOptions && (
                                <p className="text-3xl font-bold text-gray-900">
                                    ${displayPrice.toLocaleString('es-AR')}
                                </p>
                            )}

                            {item.description && (
                                <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed">{item.description}</p>
                            )}

                            {/* Variantes disponibles */}
                            {hasOptions && (
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Opciones disponibles</p>
                                        <span className="text-[11px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                                            {variants.reduce((acc, v) => acc + v.quantity, 0)} en stock total
                                        </span>
                                    </div>
                                    <div className="space-y-2">
                                        {mergedVariants.map(v => (
                                            <div
                                                key={v.ids[0]}
                                                className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 ${v.ids.includes(item.id) ? 'border-indigo-300 bg-indigo-50/50' : 'border-gray-200 bg-gray-50'}`}
                                            >
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-gray-900 truncate">
                                                        {v.variantName || (v.location ? `📍 ${v.location}` : 'Disponible')}
                                                    </p>
                                                    <p className="text-[11px] text-gray-400">
                                                        {conditionLabel[v.condition] || v.condition}
                                                        {v.variantName && v.location ? ` · 📍 ${v.location}` : ''}
                                                    </p>
                                                </div>
                                                <div className="shrink-0 flex items-center gap-2">
                                                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${v.quantity > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'}`}>
                                                        ×{v.quantity}
                                                    </span>
                                                    <p className="text-sm font-bold text-gray-900">
                                                        ${v.price.toLocaleString('es-AR')}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Stock cuando no hay opciones (producto único o grupo fusionado) */}
                            {!hasOptions && displayStock > 0 && (
                                <p className="text-xs font-semibold text-emerald-700 bg-emerald-50 self-start px-2.5 py-1 rounded-full">
                                    {displayStock} en stock
                                </p>
                            )}

                            <div className="space-y-2 text-sm text-gray-600">
                                {item.location && (
                                    <div className="flex items-center gap-2">
                                        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        <span>{item.location}</span>
                                    </div>
                                )}
                            </div>

                            {/* Link para compartir */}
                            <div className="mt-auto pt-4 border-t border-gray-100">
                                <p className="text-xs text-gray-400 mb-2">Link del producto</p>
                                <div className="flex items-center gap-2 bg-gray-50 rounded-xl border border-gray-200 px-3 py-2">
                                    <p className="text-xs text-gray-500 flex-1 truncate">{window.location.href}</p>
                                    <button
                                        onClick={copyLink}
                                        className="shrink-0 text-indigo-600 hover:text-indigo-800 transition-colors"
                                        title="Copiar link"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
