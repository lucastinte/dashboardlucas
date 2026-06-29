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

function ProductCard({ item }: { item: Item }) {
    const [imgError, setImgError] = useState(false);

    return (
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-gray-100 flex flex-col">
            {/* Imagen */}
            <div className="aspect-square bg-gray-50 overflow-hidden">
                {item.imageUrl && !imgError ? (
                    <img
                        src={item.imageUrl}
                        alt={item.productName}
                        className="w-full h-full object-cover"
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
            <div className="p-4 flex flex-col gap-2 flex-1">
                <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-gray-900 leading-tight text-sm">{item.productName}</h3>
                    <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${conditionColor[item.condition] || conditionColor.nuevo}`}>
                        {conditionLabel[item.condition] || item.condition}
                    </span>
                </div>

                {item.location && (
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        {item.location}
                    </p>
                )}

                {item.quantity > 1 && (
                    <p className="text-xs text-gray-400">{item.quantity} disponibles</p>
                )}

                <div className="mt-auto pt-2">
                    <p className="text-lg font-bold text-gray-900">
                        ${(item.salePrice || item.estimatedSalePrice || 0).toLocaleString('es-AR')}
                    </p>
                </div>
            </div>
        </div>
    );
}

export default function Store() {
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [search, setSearch] = useState('');

    useEffect(() => {
        itemService.getPublicItems()
            .then(setItems)
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, []);

    const filtered = items.filter(item =>
        item.productName.toLowerCase().includes(search.toLowerCase()) ||
        (item.location || '').toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
                <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1">
                        <h1 className="text-xl font-bold text-gray-900">Tienda</h1>
                        {!loading && !error && (
                            <p className="text-xs text-gray-400">{filtered.length} producto{filtered.length !== 1 ? 's' : ''} disponible{filtered.length !== 1 ? 's' : ''}</p>
                        )}
                    </div>
                    <input
                        type="search"
                        placeholder="Buscar producto o ubicación..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full sm:w-64 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 text-sm outline-none focus:border-gray-400 focus:bg-white transition-all"
                    />
                </div>
            </header>

            <main className="max-w-5xl mx-auto px-4 py-6">
                {loading && (
                    <div className="flex items-center justify-center py-24">
                        <div className="w-8 h-8 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
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
                        <p className="font-medium">{search ? 'Sin resultados' : 'Sin productos disponibles'}</p>
                    </div>
                )}

                {!loading && !error && filtered.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
                        {filtered.map(item => (
                            <ProductCard key={item.id} item={item} />
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
