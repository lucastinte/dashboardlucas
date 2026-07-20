import { useState, useEffect } from 'react';
import { itemService } from '../services/itemService';
import type { Item } from '../types';
import { useCart } from '../contexts/CartContext';
import { getWhatsAppUrl } from '../config/storeConfig';
import { 
    ShoppingCart, 
    Search, 
    X, 
    Trash2, 
    Plus, 
    Minus, 
    Sun, 
    Moon, 
    ShoppingBag, 
    Eye, 
    SlidersHorizontal,
    ArrowUpDown
} from 'lucide-react';

const conditionLabel: Record<string, string> = {
    nuevo: 'Nuevo',
    semi_uso: 'Semi uso',
    usado: 'Usado',
};

const conditionColor: Record<string, string> = {
    nuevo: 'bg-emerald-500 dark:bg-emerald-600 text-white',
    semi_uso: 'bg-amber-500 dark:bg-amber-600 text-white',
    usado: 'bg-gray-500 dark:bg-gray-600 text-white',
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
    
    // Calcular precios mínimos y máximos
    const maxByKey = new Map<string, number>();
    for (const v of variants) {
        const key = `${(v.storeVariantName || '').trim().toLowerCase()}|${(v.location || '').trim().toLowerCase()}`;
        const p = v.salePrice || v.estimatedSalePrice || 0;
        maxByKey.set(key, Math.max(maxByKey.get(key) || 0, p));
    }
    const prices = Array.from(maxByKey.values());
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const totalStock = variants.reduce((acc, v) => acc + v.quantity, 0);
    const locations = Array.from(new Set(variants.map(v => v.location).filter(Boolean))).join(' · ');
    const variantCount = maxByKey.size;

    return (
        <a
            href={`/tienda/producto/${item.id}`}
            className="group bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-slate-800 flex flex-col hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
        >
            {/* Imagen del Producto */}
            <div className="aspect-square bg-gray-50 dark:bg-slate-950 overflow-hidden relative">
                <span className={`absolute top-3 left-3 z-10 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1 rounded-full shadow-sm ${conditionColor[item.condition] || conditionColor.nuevo}`}>
                    {conditionLabel[item.condition] || item.condition}
                </span>
                
                {extraCount > 0 && (
                    <span className="absolute top-3 right-3 z-10 bg-black/60 backdrop-blur-sm text-white text-[10px] font-medium px-2 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                        <ShoppingBag className="w-3 h-3" />
                        {extraCount + (item.imageUrl ? 1 : 0)}
                    </span>
                )}
                
                {item.storeVideoUrl && (
                    <span className="absolute bottom-3 right-3 z-10 bg-red-600/80 backdrop-blur-sm text-white text-[10px] font-semibold tracking-wider uppercase px-2.5 py-1 rounded-full flex items-center gap-1.5 shadow-sm">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
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
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 dark:text-slate-700">
                        <ShoppingBag className="w-12 h-12 stroke-[1.5]" />
                        <span className="text-[10px] uppercase font-bold mt-2 tracking-wider">Sin Imagen</span>
                    </div>
                )}
            </div>

            {/* Info del Producto */}
            <div className="p-4 flex flex-col gap-2 flex-1">
                {item.category && (
                    <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest leading-none">
                        {item.category}
                    </span>
                )}
                
                <h3 className="font-bold text-gray-900 dark:text-white leading-snug text-sm line-clamp-2 min-h-[2.5rem] group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {item.storeTitle || item.productName}
                </h3>

                {variantCount > 1 && (
                    <span className="inline-flex text-[10px] font-semibold text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-full self-start">
                        {variantCount} variantes
                    </span>
                )}

                {item.description && (
                    <p className="text-xs text-gray-500 dark:text-slate-400 line-clamp-2 leading-normal">
                        {item.description}
                    </p>
                )}

                {locations && (
                    <p className="text-[11px] text-gray-400 dark:text-slate-500 flex items-center gap-1 mt-1">
                        <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="truncate">{locations}</span>
                    </p>
                )}

                <div className="mt-auto pt-3 border-t border-gray-50 dark:border-slate-800/60 flex items-end justify-between gap-2">
                    <div>
                        <p className="text-xs font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Precio</p>
                        <p className="text-lg font-extrabold text-gray-900 dark:text-white leading-none mt-0.5">
                            {minPrice !== maxPrice && <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500 mr-1 uppercase">desde</span>}
                            ${minPrice.toLocaleString('es-AR')}
                        </p>
                        {totalStock > 0 ? (
                            <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mt-1">
                                {totalStock} disp.
                            </p>
                        ) : (
                            <p className="text-[10px] font-medium text-red-500 mt-1">
                                Sin stock
                            </p>
                        )}
                    </div>
                    <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-xl bg-gray-50 dark:bg-slate-800/80 text-gray-600 dark:text-slate-300 group-hover:bg-indigo-600 group-hover:text-white dark:group-hover:bg-indigo-600 transition-all duration-300">
                        <Eye className="w-4 h-4" />
                    </span>
                </div>
            </div>
        </a>
    );
}

export default function Store() {
    const { cart, removeFromCart, updateQuantity, clearCart, totalItems, totalPrice } = useCart();
    
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    
    // Filtros y ordenamiento
    const [search, setSearch] = useState('');
    const [condFilter, setCondFilter] = useState<string>('todos');
    const [catFilter, setCatFilter] = useState<string>('todos');
    const [orderBy, setOrderBy] = useState<string>('newest');
    const [priceRange, setPriceRange] = useState<number>(0);
    const [maxPriceLimit, setMaxPriceLimit] = useState<number>(0);
    const [showFilters, setShowFilters] = useState(false);
    
    // Control del Carrito (Drawer)
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [customerName, setCustomerName] = useState('');

    // Control del Tema (Modo Oscuro)
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        const saved = localStorage.getItem('dashboard_theme');
        return saved === 'dark' ? 'dark' : 'light';
    });

    useEffect(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('dashboard_theme', theme);
    }, [theme]);

    useEffect(() => {
        itemService.getPublicItems()
            .then(data => {
                setItems(data);
                // Calcular precio máximo del catálogo para el filtro deslizante
                const prices = data.map(i => i.salePrice || i.estimatedSalePrice || 0);
                const max = prices.length ? Math.max(...prices) : 0;
                setMaxPriceLimit(max);
                setPriceRange(max);
            })
            .catch(() => setError(true))
            .finally(() => setLoading(false));
    }, []);

    // Filtrar y ordenar productos
    const filtered = items.filter(item => {
        const q = search.toLowerCase();
        const matchSearch = item.productName.toLowerCase().includes(q) ||
            (item.storeTitle || '').toLowerCase().includes(q) ||
            (item.location || '').toLowerCase().includes(q) ||
            (item.description || '').toLowerCase().includes(q);
            
        const matchCond = condFilter === 'todos' || item.condition === condFilter;
        
        const matchCat = catFilter === 'todos' || item.category === catFilter;
        
        const price = item.salePrice || item.estimatedSalePrice || 0;
        const matchPrice = priceRange === 0 || price <= priceRange;

        return matchSearch && matchCond && matchCat && matchPrice;
    });

    // Ordenar los items filtrados
    const sorted = [...filtered].sort((a, b) => {
        const priceA = a.salePrice || a.estimatedSalePrice || 0;
        const priceB = b.salePrice || b.estimatedSalePrice || 0;
        
        if (orderBy === 'price_asc') return priceA - priceB;
        if (orderBy === 'price_desc') return priceB - priceA;
        if (orderBy === 'name_asc') return (a.storeTitle || a.productName).localeCompare(b.storeTitle || b.productName);
        // Default / 'newest': primero los agregados más recientemente
        return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    const entries = groupPublicItems(sorted);

    // Obtener listas únicas para filtros
    const conditions = ['todos', ...Array.from(new Set(items.map(i => i.condition)))];
    const categories = ['todos', ...Array.from(new Set(items.map(i => i.category).filter((c): c is string => !!c)))];

    // Enviar pedido por WhatsApp
    const handleCheckout = () => {
        if (cart.length === 0) return;
        
        let text = `🛒 *Nuevo Pedido - ${STORE_CONFIG.storeName}*\n`;
        text += `=====================================\n`;
        if (customerName.trim()) {
            text += `*Cliente:* ${customerName.trim()}\n`;
            text += `=====================================\n\n`;
        }
        
        cart.forEach((item, index) => {
            const variantDesc = item.variantName ? ` (${item.variantName})` : '';
            const locationDesc = item.location ? `\n   📍 Ubicación: ${item.location}` : '';
            const condDesc = conditionLabel[item.condition] || item.condition;
            
            text += `*${index + 1}. ${item.storeTitle || item.productName}*${variantDesc}\n`;
            text += `   Condición: ${condDesc}${locationDesc}\n`;
            text += `   Cantidad: ${item.quantity} x $${item.price.toLocaleString('es-AR')}\n`;
            text += `   Subtotal: $${(item.quantity * item.price).toLocaleString('es-AR')}\n\n`;
        });
        
        text += `=====================================\n`;
        text += `*Total del Pedido:* $${totalPrice.toLocaleString('es-AR')}\n\n`;
        text += `¡Hola! Me interesa coordinar la compra de estos productos de la tienda.`;
        
        const url = getWhatsAppUrl(text);
        window.open(url, '_blank');
        clearCart();
        setIsCartOpen(false);
    };

    const STORE_CONFIG = {
        storeName: 'Lucas Shop',
    };

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-[#0b1220] text-gray-900 dark:text-gray-100 transition-colors duration-300">
            {/* Header / Barra de Navegación */}
            <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg border-b border-gray-100 dark:border-slate-800/80 shadow-sm transition-colors duration-300">
                <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
                    {/* Logo/Nombre */}
                    <a href="/tienda" className="flex items-center gap-2">
                        <span className="text-2xl font-bold bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 bg-clip-text text-transparent tracking-tight">
                            {STORE_CONFIG.storeName}
                        </span>
                    </a>

                    {/* Botones de acción */}
                    <div className="flex items-center gap-3">
                        {/* Botón de Modo Oscuro */}
                        <button
                            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            className="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 hover:scale-105 transition-all shadow-sm"
                            aria-label="Toggle theme"
                        >
                            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                        </button>

                        {/* Botón del Carrito */}
                        <button
                            onClick={() => setIsCartOpen(true)}
                            className="relative flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold transition-all hover:scale-[1.03] shadow-md shadow-indigo-600/10 cursor-pointer"
                        >
                            <ShoppingCart className="w-4 h-4" />
                            <span className="hidden sm:inline text-xs">Mi Carrito</span>
                            {totalItems > 0 && (
                                <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white dark:border-slate-900 animate-pulse">
                                    {totalItems}
                                </span>
                            )}
                        </button>
                    </div>
                </div>
            </header>

            {/* Banner de Bienvenida / Hero */}
            <section className="relative overflow-hidden bg-gradient-to-r from-slate-900 to-indigo-950 text-white py-12 px-4 shadow-inner">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_800px_350px_at_50%_-20%,rgba(99,102,241,0.15),transparent)] pointer-events-none" />
                <div className="max-w-4xl mx-auto text-center relative z-10 flex flex-col items-center">
                    <span className="text-3xl mb-3 animate-bounce">🛍️</span>
                    <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-indigo-100 to-purple-200 bg-clip-text text-transparent">
                        Explorá Nuestro Catálogo
                    </h1>
                    <p className="text-slate-300 text-sm sm:text-base mt-2 max-w-lg leading-relaxed">
                        Productos únicos en stock real listos para entregar. Elegí lo que te guste y hacé tu pedido por WhatsApp.
                    </p>
                    {!loading && !error && (
                        <span className="mt-4 px-3.5 py-1 text-xs font-semibold bg-indigo-500/20 border border-indigo-400/30 rounded-full text-indigo-200">
                            {items.length} producto{items.length !== 1 ? 's' : ''} disponible{items.length !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
            </section>

            {/* Controles de Búsqueda y Filtros */}
            <section className="sticky top-16 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-gray-100 dark:border-slate-800 shadow-sm transition-colors duration-300">
                <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
                    {/* Fila Principal: Buscar + Botón Filtros Avanzados */}
                    <div className="flex flex-col md:flex-row gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-slate-500" />
                            <input
                                type="search"
                                placeholder="Buscar producto por nombre, descripción o ubicación..."
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-950 text-sm outline-none focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 transition-all shadow-inner"
                            />
                            {search && (
                                <button 
                                    onClick={() => setSearch('')}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-white"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                        
                        <div className="flex gap-2">
                            {/* Botón Filtros Avanzados */}
                            <button
                                onClick={() => setShowFilters(!showFilters)}
                                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border font-semibold text-xs transition-all shadow-sm cursor-pointer ${
                                    showFilters 
                                    ? 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400' 
                                    : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700'
                                }`}
                            >
                                <SlidersHorizontal className="w-4 h-4" />
                                <span>Filtros</span>
                            </button>

                            {/* Selector de Ordenamiento rápido */}
                            <div className="relative flex items-center gap-1 px-3 py-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
                                <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
                                <select
                                    value={orderBy}
                                    onChange={e => setOrderBy(e.target.value)}
                                    className="text-xs font-semibold bg-transparent border-none outline-none pr-6 text-gray-700 dark:text-gray-300 cursor-pointer"
                                >
                                    <option value="newest">Más recientes</option>
                                    <option value="price_asc">Menor precio</option>
                                    <option value="price_desc">Mayor precio</option>
                                    <option value="name_asc">Nombre (A-Z)</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Filtros Colapsables */}
                    {showFilters && (
                        <div className="pt-2 pb-1 border-t border-gray-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 animate-in fade-in slide-in-from-top-4 duration-300">
                            {/* Filtro Rango de Precio */}
                            {maxPriceLimit > 0 && (
                                <div className="space-y-1.5 p-3 rounded-xl bg-gray-50 dark:bg-slate-950/40 border border-gray-100 dark:border-slate-800/40">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Precio máximo</label>
                                        <span className="text-xs font-extrabold text-indigo-600 dark:text-indigo-400">${priceRange.toLocaleString('es-AR')}</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="0" 
                                        max={maxPriceLimit} 
                                        value={priceRange} 
                                        onChange={e => setPriceRange(Number(e.target.value))}
                                        className="w-full h-1.5 bg-gray-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                    />
                                    <div className="flex justify-between text-[10px] text-gray-400">
                                        <span>$0</span>
                                        <span>${maxPriceLimit.toLocaleString('es-AR')}</span>
                                    </div>
                                </div>
                            )}

                            {/* Filtro por Condición */}
                            {conditions.length > 2 && (
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider block">Estado del Ítem</label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {conditions.map(c => (
                                            <button
                                                key={c}
                                                onClick={() => setCondFilter(c)}
                                                className={`text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all cursor-pointer ${
                                                    condFilter === c
                                                    ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-950 shadow-sm'
                                                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'
                                                }`}
                                            >
                                                {c === 'todos' ? 'Todos' : conditionLabel[c] || c}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Filtro por Categorías */}
                            {categories.length > 2 && (
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider block">Categoría</label>
                                    <div className="flex flex-wrap gap-1.5">
                                        {categories.map(c => (
                                            <button
                                                key={c}
                                                onClick={() => setCatFilter(c)}
                                                className={`text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all cursor-pointer capitalize ${
                                                    catFilter === c
                                                    ? 'bg-indigo-600 text-white shadow-sm'
                                                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'
                                                }`}
                                            >
                                                {c === 'todos' ? 'Todas' : c}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {/* Catálogo de Productos */}
            <main className="max-w-6xl mx-auto px-4 py-8 pb-24">
                {/* Cargando */}
                {loading && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 sm:gap-6">
                        {Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl overflow-hidden border border-gray-100 dark:border-slate-800 animate-pulse">
                                <div className="aspect-square bg-gray-100 dark:bg-slate-850" />
                                <div className="p-4 space-y-3">
                                    <div className="h-3.5 bg-gray-100 dark:bg-slate-800 rounded-full w-4/5" />
                                    <div className="h-3 bg-gray-100 dark:bg-slate-800 rounded-full w-3/5" />
                                    <div className="h-6 bg-gray-100 dark:bg-slate-800 rounded-full w-2/5 mt-4" />
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="text-center py-24 text-gray-400 dark:text-slate-500 bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 p-8 shadow-sm">
                        <div className="w-16 h-16 bg-red-50 dark:bg-red-950/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <X className="w-8 h-8" />
                        </div>
                        <p className="text-lg font-bold text-gray-800 dark:text-white">No se pudo cargar la tienda</p>
                        <p className="text-sm mt-1 max-w-xs mx-auto">Tuvimos un problema al obtener los productos de la base de datos. Por favor reintentá.</p>
                        <button 
                            onClick={() => window.location.reload()} 
                            className="mt-4 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs transition-colors cursor-pointer"
                        >
                            Recargar página
                        </button>
                    </div>
                )}

                {/* Sin Resultados */}
                {!loading && !error && entries.length === 0 && (
                    <div className="text-center py-24 text-gray-400 dark:text-slate-500 bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 p-8 shadow-sm">
                        <svg className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                        </svg>
                        <p className="font-bold text-lg text-gray-800 dark:text-white">Sin productos disponibles</p>
                        <p className="text-sm mt-1">No encontramos productos con los filtros o la búsqueda activa.</p>
                        {(search || condFilter !== 'todos' || catFilter !== 'todos' || priceRange < maxPriceLimit) && (
                            <button
                                onClick={() => {
                                    setSearch('');
                                    setCondFilter('todos');
                                    setCatFilter('todos');
                                    setPriceRange(maxPriceLimit);
                                }}
                                className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 underline mt-3 inline-block cursor-pointer"
                            >
                                Limpiar filtros y reiniciar
                            </button>
                        )}
                    </div>
                )}

                {/* Grilla de productos */}
                {!loading && !error && entries.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 sm:gap-6">
                        {entries.map(entry => (
                            <ProductCard key={entry.rep.id} entry={entry} />
                        ))}
                    </div>
                )}
            </main>

            {/* Footer */}
            <footer className="border-t border-gray-100 dark:border-slate-800/80 bg-white dark:bg-slate-900 py-8 text-center text-xs text-gray-400 dark:text-slate-500 transition-colors duration-300">
                <div className="max-w-6xl mx-auto px-4">
                    <p className="font-medium text-slate-500 dark:text-slate-400">Lucas Shop - Catálogo Online</p>
                    <p className="mt-1">Los precios y el stock se actualizan en tiempo real desde nuestro sistema.</p>
                </div>
            </footer>

            {/* SIDEBAR DRAWER DEL CARRITO */}
            {isCartOpen && (
                <div className="fixed inset-0 z-50 overflow-hidden">
                    {/* Backdrop */}
                    <div 
                        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in"
                        onClick={() => setIsCartOpen(false)}
                    />
                    
                    {/* Panel del Drawer */}
                    <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
                        <div className="w-screen max-w-md bg-white dark:bg-slate-900 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                            
                            {/* Cabecera del Carrito */}
                            <div className="px-5 py-5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <ShoppingCart className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                                    <h2 className="text-lg font-bold text-gray-900 dark:text-white">Mi Carrito</h2>
                                    {totalItems > 0 && (
                                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                                            {totalItems} ítems
                                        </span>
                                    )}
                                </div>
                                <button 
                                    onClick={() => setIsCartOpen(false)}
                                    className="p-1 text-gray-400 hover:text-gray-700 dark:hover:text-white transition-colors cursor-pointer"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            {/* Contenido / Items */}
                            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                                {cart.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 dark:text-slate-500 py-12">
                                        <div className="w-16 h-16 rounded-full bg-gray-50 dark:bg-slate-800/40 flex items-center justify-center mb-4">
                                            <ShoppingCart className="w-8 h-8 stroke-[1.5]" />
                                        </div>
                                        <p className="font-bold text-gray-700 dark:text-slate-300">Tu carrito está vacío</p>
                                        <p className="text-xs mt-1 max-w-xs">Navegá por la tienda y agregá los productos que te interesen para coordinar la compra.</p>
                                    </div>
                                ) : (
                                    cart.map(item => (
                                        <div 
                                            key={item.id} 
                                            className="flex gap-3 bg-gray-50 dark:bg-slate-950/40 rounded-xl p-3 border border-gray-100 dark:border-slate-850"
                                        >
                                            {/* Imagen del Item */}
                                            <div className="w-16 h-16 bg-white dark:bg-slate-900 border border-gray-150 dark:border-slate-800 rounded-lg overflow-hidden shrink-0">
                                                {item.imageUrl ? (
                                                    <img src={item.imageUrl} alt={item.productName} className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                        <ShoppingBag className="w-6 h-6 stroke-[1.5]" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Detalles del Item */}
                                            <div className="flex-1 min-w-0 flex flex-col justify-between">
                                                <div>
                                                    <h4 className="font-bold text-sm text-gray-900 dark:text-white truncate">
                                                        {item.storeTitle || item.productName}
                                                    </h4>
                                                    {item.variantName && (
                                                        <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 block mt-0.5">
                                                            {item.variantName}
                                                        </span>
                                                    )}
                                                    {item.location && (
                                                        <span className="text-[10px] text-gray-400 block">
                                                            📍 {item.location}
                                                        </span>
                                                    )}
                                                </div>
                                                
                                                {/* Controles de Cantidad */}
                                                <div className="flex items-center justify-between gap-2 mt-2">
                                                    <div className="flex items-center gap-1 border border-gray-250 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900 px-1 py-0.5">
                                                        <button 
                                                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                                            className="p-1 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                                                        >
                                                            <Minus className="w-3 h-3" />
                                                        </button>
                                                        <span className="text-xs font-bold px-1.5 min-w-[1.25rem] text-center">
                                                            {item.quantity}
                                                        </span>
                                                        <button 
                                                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                                            className="p-1 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer"
                                                            disabled={item.quantity >= item.maxQuantity}
                                                        >
                                                            <Plus className="w-3 h-3" />
                                                        </button>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-xs text-gray-400">Subtotal</p>
                                                        <p className="text-sm font-extrabold text-gray-900 dark:text-white">
                                                            ${(item.price * item.quantity).toLocaleString('es-AR')}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Eliminar */}
                                            <button 
                                                onClick={() => removeFromCart(item.id)}
                                                className="self-start text-gray-300 hover:text-red-500 p-1 cursor-pointer transition-colors"
                                                title="Eliminar del carrito"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Resumen y Envío del Pedido */}
                            {cart.length > 0 && (
                                <div className="border-t border-gray-150 dark:border-slate-800 bg-gray-50 dark:bg-slate-950 p-5 space-y-4">
                                    {/* Nombre del cliente */}
                                    <div className="space-y-1">
                                        <label className="text-[10px] font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider block">Tu Nombre (Opcional)</label>
                                        <input 
                                            type="text" 
                                            placeholder="Ej. Lucas Pérez"
                                            value={customerName}
                                            onChange={e => setCustomerName(e.target.value)}
                                            className="w-full px-3.5 py-2.5 rounded-xl border border-gray-250 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus:border-indigo-500 transition-all"
                                        />
                                    </div>

                                    {/* Subtotal / Total */}
                                    <div className="space-y-1.5 pt-1">
                                        <div className="flex items-center justify-between text-xs text-gray-400">
                                            <span>Subtotal</span>
                                            <span>${totalPrice.toLocaleString('es-AR')}</span>
                                        </div>
                                        <div className="flex items-center justify-between pt-1 border-t border-gray-200 dark:border-slate-800">
                                            <span className="text-sm font-bold text-gray-700 dark:text-slate-300">Total</span>
                                            <span className="text-xl font-extrabold text-gray-900 dark:text-white">
                                                ${totalPrice.toLocaleString('es-AR')}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Botón Finalizar */}
                                    <button
                                        onClick={handleCheckout}
                                        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] text-white font-bold transition-all shadow-md shadow-emerald-600/10 text-sm cursor-pointer"
                                    >
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.739-1.456L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.37 9.864-9.799.002-2.63-1.023-5.101-2.885-6.965C16.59 1.977 14.113.953 11.483.951c-5.44 0-9.866 4.369-9.87 9.8-.001 1.702.463 3.364 1.34 4.825l-.93 3.398 3.484-.903-.002-.002z" />
                                        </svg>
                                        <span>Enviar Pedido por WhatsApp</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
