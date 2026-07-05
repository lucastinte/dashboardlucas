import { useState, useEffect } from 'react';
import { itemService } from '../services/itemService';
import type { Item } from '../types';

const conditionLabel: Record<string, string> = {
    nuevo: 'Nuevo',
    semi_uso: 'Semi uso',
    usado: 'Usado',
};

const conditionColor: Record<string, string> = {
    nuevo: 'bg-emerald-500 text-white',
    semi_uso: 'bg-amber-500 text-white',
    usado: 'bg-gray-500 text-white',
};

// Un "producto" en la tienda puede ser un grupo de variantes (mismo storeGroup)
export interface StoreEntry {
    rep: Item;          // item representativo (el que tiene título/desc/fotos)
    variants: Item[];   // todas las variantes (incluye al rep)
}

/** Agrupa items publicados por storeGroup; sin grupo → entrada individual */
export function groupPublicItems(items: Item[]): StoreEntry[] {
    const byGroup = new Map<string, Item[]>();
    const singles: Item[] = [];
    for (const it of items) {
        const g = (it.storeGroup || '').trim();
        if (g) {
            if (!byGroup.has(g)) byGroup.set(g, []);
            byGroup.get(g)!.push(it);
        } else {
            singles.push(it);
        }
    }
    const score = (i: Item) => (i.storeTitle ? 4 : 0) + (i.description ? 2 : 0) + (i.storeImages?.length ? 1 : 0) + (i.imageUrl ? 1 : 0);
    const entries: StoreEntry[] = [];
    for (const variants of byGroup.values()) {
        const rep = [...variants].sort((a, b) => score(b) - score(a))[0];
        entries.push({ rep, variants });
    }
    for (const it of singles) entries.push({ rep: it, variants: [it] });
    return entries;
}

function ProductCard({ entry }: { entry: StoreEntry }) {
    const { rep: item, variants } = entry;
    const [imgError, setImgError] = useState(false);
    const extraCount = (item.storeImages?.length || 0);
    const firstImage = [item.imageUrl, ...(item.storeImages || []), ...variants.map(v => v.imageUrl)].find(u => !!u) ?? null;
    const prices = variants.map(v => v.salePrice || v.estimatedSalePrice || 0);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const totalStock = variants.reduce((acc, v) => acc + v.quantity, 0);
    const locations = Array.from(new Set(variants.map(v => v.location).filter(Boolean))).join(' · ');

    return (
        <a
            href={`/tienda/producto/${item.id}`}
            className="group bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 flex flex-col hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
        >
            {/* Imagen */}
            <div className="aspect-square bg-gray-100 overflow-hidden relative">
                <span className={`absolute top-2.5 left-2.5 z-10 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shadow-sm ${conditionColor[item.condition] || conditionColor.nuevo}`}>
                    {conditionLabel[item.condition] || item.condition}
                </span>
                {extraCount > 0 && (
                    <span className="absolute top-2.5 right-2.5 z-10 bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        {extraCount + (item.imageUrl ? 1 : 0)}
                    </span>
                )}
                {item.storeVideoUrl && (
                    <span className="absolute bottom-2.5 right-2.5 z-10 bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                        <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        Video
                    </span>
                )}
                {firstImage && !imgError ? (
                    <img
                        src={firstImage}
                        alt={item.productName}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        onError={() => setImgError(true)}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        <svg className="w-16 h-16 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="p-4 flex flex-col gap-1.5 flex-1">
                <h3 className="font-semibold text-gray-900 leading-snug text-sm line-clamp-2">{item.storeTitle || item.productName}</h3>

                {variants.length > 1 && (
                    <p className="text-[11px] font-medium text-indigo-600">{variants.length} variantes disponibles</p>
                )}

                {item.description && (
                    <p className="text-xs text-gray-400 line-clamp-2">{item.description}</p>
                )}

                {locations && (
                    <p className="text-[11px] text-gray-400 flex items-center gap-1">
                        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {locations}
                    </p>
                )}

                <div className="mt-auto pt-2 flex items-end justify-between gap-2">
                    <div>
                        <p className="text-xl font-bold text-gray-900 leading-none">
                            {minPrice !== maxPrice && <span className="text-xs font-medium text-gray-400 mr-1">desde</span>}
                            ${minPrice.toLocaleString('es-AR')}
                        </p>
                        {totalStock > 1 && (
                            <p className="text-[11px] text-gray-400 mt-1">{totalStock} disponibles</p>
                        )}
                    </div>
                    <span className="shrink-0 text-xs font-medium text-indigo-600 group-hover:translate-x-0.5 transition-transform">
                        Ver →
                    </span>
                </div>
            </div>
        </a>
    );
}

export default function Store() {
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [search, setSearch] = useState('');
    const [condFilter, setCondFilter] = useState<string>('todos');

    useEffect(() => {
        itemService.getPublicItems()
            .then(setItems)
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, []);

    const filtered = items.filter(item => {
        const q = search.toLowerCase();
        const matchSearch = item.productName.toLowerCase().includes(q) ||
            (item.storeTitle || '').toLowerCase().includes(q) ||
            (item.location || '').toLowerCase().includes(q) ||
            (item.description || '').toLowerCase().includes(q);
        const matchCond = condFilter === 'todos' || item.condition === condFilter;
        return matchSearch && matchCond;
    });

    const entries = groupPublicItems(filtered);

    const conditions = ['todos', ...Array.from(new Set(items.map(i => i.condition)))];

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Hero header */}
            <header className="bg-gray-900 text-white">
                <div className="max-w-5xl mx-auto px-4 pt-10 pb-8 text-center">
                    <p className="text-3xl mb-2">🛍️</p>
                    <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Tienda</h1>
                    {!loading && !error && (
                        <p className="text-sm text-gray-400 mt-1.5">
                            {items.length} producto{items.length !== 1 ? 's' : ''} disponible{items.length !== 1 ? 's' : ''}
                        </p>
                    )}
                </div>
            </header>

            {/* Search & filters (sticky) */}
            <div className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-gray-100 shadow-sm">
                <div className="max-w-5xl mx-auto px-4 py-3 flex flex-col sm:flex-row gap-2.5 sm:items-center">
                    <div className="relative flex-1">
                        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        <input
                            type="search"
                            placeholder="Buscar producto..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 rounded-full border border-gray-200 bg-gray-50 text-sm outline-none focus:border-gray-400 focus:bg-white transition-all"
                        />
                    </div>
                    {conditions.length > 2 && (
                        <div className="flex gap-1.5 overflow-x-auto pb-0.5 sm:pb-0">
                            {conditions.map(c => (
                                <button
                                    key={c}
                                    onClick={() => setCondFilter(c)}
                                    className={`shrink-0 text-xs font-medium px-3.5 py-2 rounded-full transition-all ${condFilter === c
                                        ? 'bg-gray-900 text-white shadow-sm'
                                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                                >
                                    {c === 'todos' ? 'Todos' : conditionLabel[c] || c}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <main className="max-w-5xl mx-auto px-4 py-6 pb-16">
                {loading && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="bg-white rounded-2xl overflow-hidden border border-gray-100 animate-pulse">
                                <div className="aspect-square bg-gray-100" />
                                <div className="p-4 space-y-2">
                                    <div className="h-3.5 bg-gray-100 rounded-full w-4/5" />
                                    <div className="h-3 bg-gray-100 rounded-full w-3/5" />
                                    <div className="h-5 bg-gray-100 rounded-full w-2/5 mt-3" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {error && (
                    <div className="text-center py-24 text-gray-400">
                        <p className="text-lg font-medium">No se pudo cargar la tienda</p>
                        <p className="text-sm mt-1">Intentá de nuevo más tarde</p>
                    </div>
                )}

                {!loading && !error && filtered.length === 0 && (
                    <div className="text-center py-24 text-gray-400">
                        <svg className="w-12 h-12 mx-auto mb-3 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                        <p className="font-medium">{search || condFilter !== 'todos' ? 'Sin resultados' : 'Sin productos disponibles'}</p>
                        {(search || condFilter !== 'todos') && (
                            <button onClick={() => { setSearch(''); setCondFilter('todos'); }} className="text-sm text-indigo-600 underline mt-2">
                                Limpiar filtros
                            </button>
                        )}
                    </div>
                )}

                {!loading && !error && entries.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                        {entries.map(entry => (
                            <ProductCard key={entry.rep.id} entry={entry} />
                        ))}
                    </div>
                )}
            </main>

            <footer className="border-t border-gray-100 bg-white py-6 text-center text-xs text-gray-400">
                Los precios y el stock se actualizan en tiempo real.
            </footer>
        </div>
    );
}
