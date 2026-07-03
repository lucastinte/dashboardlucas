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
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    const [activeIdx, setActiveIdx] = useState(0);
    const [copied, setCopied] = useState(false);
    const [mainImgError, setMainImgError] = useState(false);

    useEffect(() => {
        itemService.getPublicItemById(id)
            .then(data => {
                if (!data) setNotFound(true);
                else setItem(data);
            })
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));
    }, [id]);

    const allImages = item
        ? [item.imageUrl, ...(item.storeImages || [])].filter((u): u is string => !!u)
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
                        </div>

                        {/* Info */}
                        <div className="p-6 flex flex-col gap-4">
                            <div className="flex items-start justify-between gap-3">
                                <h1 className="text-xl font-bold text-gray-900 leading-tight">{item.productName}</h1>
                                <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${conditionColor[item.condition] || conditionColor.nuevo}`}>
                                    {conditionLabel[item.condition] || item.condition}
                                </span>
                            </div>

                            <p className="text-3xl font-bold text-gray-900">
                                ${(item.salePrice || item.estimatedSalePrice || 0).toLocaleString('es-AR')}
                            </p>

                            {item.description && (
                                <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed">{item.description}</p>
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
                                {item.quantity > 1 && (
                                    <div className="flex items-center gap-2">
                                        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                        </svg>
                                        <span>{item.quantity} unidades disponibles</span>
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

                {/* Video */}
                {item.storeVideoUrl && (
                    <div className="mt-4 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Video del producto</p>
                        <VideoPlayer url={item.storeVideoUrl} />
                    </div>
                )}
            </main>
        </div>
    );
}
