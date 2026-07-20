import { useState, useEffect } from 'react';
import { itemService } from '../services/itemService';
import type { Item } from '../types';
import { useCart } from '../contexts/CartContext';
import { getWhatsAppUrl } from '../config/storeConfig';
import {
    X,
    Copy,
    Check,
    ChevronLeft,
    ChevronRight,
    Maximize2,
    ShoppingCart,
    ShoppingBag,
    ArrowLeft,
    Plus,
    Minus,
    Sun,
    Moon,
    Trash2
} from 'lucide-react';

const conditionLabel: Record<string, string> = {
    nuevo: 'Nuevo',
    semi_uso: 'Semi uso',
    usado: 'Usado',
};

const conditionColor: Record<string, string> = {
    nuevo: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/30',
    semi_uso: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-200/30',
    usado: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200/30',
};

function getYouTubeId(url: string): string | null {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
    return match?.[1] ?? null;
}

function VideoPlayer({ url }: { url: string }) {
    const ytId = getYouTubeId(url);
    if (ytId) {
        return (
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black shadow-sm border border-slate-800">
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
            className="w-full rounded-xl bg-black shadow-sm border border-slate-800"
            style={{ maxHeight: '420px' }}
        />
    );
}

function ImagePlaceholder() {
    return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 dark:bg-slate-950 text-gray-300 dark:text-slate-700">
            <ShoppingBag className="w-16 h-16 stroke-[1.5]" />
            <span className="text-xs uppercase font-bold mt-3 tracking-wider">Sin Imagen</span>
        </div>
    );
}

export default function StoreProduct({ id }: { id: string }) {
    const { cart, addToCart, removeFromCart, updateQuantity, clearCart, totalItems, totalPrice } = useCart();
    
    const [item, setItem] = useState<Item | null>(null);
    const [variants, setVariants] = useState<Item[]>([]);
    const [related, setRelated] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [notFound, setNotFound] = useState(false);
    
    // Galería
    const [activeIdx, setActiveIdx] = useState(0);
    const [mainImgError, setMainImgError] = useState(false);
    const [showLightbox, setShowLightbox] = useState(false);
    
    // Variantes y Cantidades
    const [selectedVariantId, setSelectedVariantId] = useState<string>('');
    const [buyQty, setBuyQty] = useState(1);
    
    const [copied, setCopied] = useState(false);
    const [customerName, setCustomerName] = useState('');
    const [isCartOpen, setIsCartOpen] = useState(false);

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
        setLoading(true);
        itemService.getPublicItemById(id)
            .then(async data => {
                if (!data) { setNotFound(true); return; }
                setItem(data);
                setSelectedVariantId(data.id);
                
                // Cargar variantes si pertenece a un grupo
                let groupItems: Item[] = [];
                if (data.storeGroup) {
                    groupItems = await itemService.getPublicItemsByGroup(data.storeGroup);
                    if (groupItems.length > 1) {
                        setVariants(groupItems);
                    }
                }
                
                // Cargar relacionados (productos de la misma categoría o aleatorios)
                const allPublic = await itemService.getPublicItems();
                const filtered = allPublic.filter(i => i.id !== data.id && (data.storeGroup ? i.storeGroup !== data.storeGroup : true));
                
                // Filtrar por categoría similar, si coincide
                let matches = filtered.filter(i => i.category && i.category === data.category);
                if (matches.length < 4) {
                    // Rellenar con otros productos públicos si no hay suficientes
                    const rest = filtered.filter(i => !matches.find(m => m.id === i.id));
                    matches = [...matches, ...rest];
                }
                
                // Agruparlos para no mostrar variantes repetidas en recomendados
                const groupedMap = new Map<string, Item>();
                for (const m of matches) {
                    const groupKey = m.storeGroup ? m.storeGroup.trim().toLowerCase() : m.id;
                    if (!groupedMap.has(groupKey)) {
                        groupedMap.set(groupKey, m);
                    }
                }
                
                setRelated(Array.from(groupedMap.values()).slice(0, 4));
            })
            .catch(() => setNotFound(true))
            .finally(() => setLoading(false));
    }, [id]);

    // Fusional variante: nombre + ubicación
    const mergedVariants = (() => {
        const map = new Map<string, { ids: string[]; variantName: string; condition: string; quantity: number; price: number; location: string; repItem: Item }>();
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
                map.set(key, { ids: [v.id], variantName, condition: v.condition, quantity: v.quantity, price, location, repItem: v });
            }
        }
        return Array.from(map.values());
    })();

    const hasOptions = mergedVariants.length > 1;

    // Obtener la variante seleccionada actual
    const activeSelectedVariant = (() => {
        if (!hasOptions) return null;
        // Buscar cuál de los grupos de variantes fusionadas contiene el id de la variante seleccionada
        return mergedVariants.find(v => v.ids.includes(selectedVariantId)) || mergedVariants[0] || null;
    })();

    // Información de precio y stock en base a la selección
    const currentPrice = activeSelectedVariant ? activeSelectedVariant.price : (item ? (item.salePrice || item.estimatedSalePrice || 0) : 0);
    const currentStock = activeSelectedVariant ? activeSelectedVariant.quantity : (item?.quantity ?? 0);
    const currentLocation = activeSelectedVariant ? activeSelectedVariant.location : (item?.location ?? '');
    const currentCondition = activeSelectedVariant ? activeSelectedVariant.condition : (item?.condition ?? 'nuevo');

    // Resetear cantidad a comprar cuando cambia la variante
    useEffect(() => {
        setBuyQty(1);
    }, [selectedVariantId]);

    // Recolectar imágenes del producto y de sus variantes
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

    const handleNextImage = () => {
        setActiveIdx(prev => (prev + 1) % allImages.length);
        setMainImgError(false);
    };

    const handlePrevImage = () => {
        setActiveIdx(prev => (prev - 1 + allImages.length) % allImages.length);
        setMainImgError(false);
    };

    // Añadir al Carrito
    const handleAddToCart = () => {
        if (!item || currentStock <= 0) return;
        
        const itemId = selectedVariantId || item.id;
        const variantName = activeSelectedVariant?.variantName || item.storeVariantName;
        const image = allImages[0] || item.imageUrl;

        const success = addToCart({
            id: itemId,
            productName: item.productName,
            storeTitle: item.storeTitle || item.productName,
            variantName,
            imageUrl: image,
            price: currentPrice,
            maxQuantity: currentStock,
            location: currentLocation,
            condition: currentCondition,
            storeGroup: item.storeGroup
        }, buyQty);

        if (success) {
            setIsCartOpen(true);
        }
    };

    // Compra Directa por WhatsApp
    const handleDirectBuy = () => {
        if (!item) return;

        const variantDesc = activeSelectedVariant?.variantName ? ` (${activeSelectedVariant.variantName})` : '';
        const locDesc = currentLocation ? `\n   📍 Ubicación: ${currentLocation}` : '';
        const condDesc = conditionLabel[currentCondition] || currentCondition;

        let text = `🛒 *Compra Directa - Lucas Shop*\n`;
        text += `=====================================\n`;
        text += `Me interesa comprar el siguiente artículo:\n\n`;
        text += `*${item.storeTitle || item.productName}*${variantDesc}\n`;
        text += `   Condición: ${condDesc}${locDesc}\n`;
        text += `   Cantidad: ${buyQty} x $${currentPrice.toLocaleString('es-AR')}\n`;
        text += `   Total: $${(buyQty * currentPrice).toLocaleString('es-AR')}\n\n`;
        text += `=====================================\n`;
        text += `¡Hola! Me gustaría coordinar la compra de este producto de la tienda.`;

        const url = getWhatsAppUrl(text);
        window.open(url, '_blank');
    };

    // Enviar pedido por WhatsApp desde el Carrito
    const handleCartCheckout = () => {
        if (cart.length === 0) return;
        
        let text = `🛒 *Nuevo Pedido - Lucas Shop*\n`;
        text += `=====================================\n`;
        if (customerName.trim()) {
            text += `*Cliente:* ${customerName.trim()}\n`;
            text += `=====================================\n\n`;
        }
        
        cart.forEach((cItem, index) => {
            const variantDesc = cItem.variantName ? ` (${cItem.variantName})` : '';
            const locationDesc = cItem.location ? `\n   📍 Ubicación: ${cItem.location}` : '';
            const condDesc = conditionLabel[cItem.condition] || cItem.condition;
            
            text += `*${index + 1}. ${cItem.storeTitle || cItem.productName}*${variantDesc}\n`;
            text += `   Condición: ${condDesc}${locationDesc}\n`;
            text += `   Cantidad: ${cItem.quantity} x $${cItem.price.toLocaleString('es-AR')}\n`;
            text += `   Subtotal: $${(cItem.quantity * cItem.price).toLocaleString('es-AR')}\n\n`;
        });
        
        text += `=====================================\n`;
        text += `*Total del Pedido:* $${totalPrice.toLocaleString('es-AR')}\n\n`;
        text += `¡Hola! Me interesa coordinar la compra de estos productos de la tienda.`;
        
        const url = getWhatsAppUrl(text);
        window.open(url, '_blank');
        clearCart();
        setIsCartOpen(false);
    };



    if (loading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-[#0b1220] transition-colors duration-300">
                <div className="w-10 h-10 border-4 border-gray-200 dark:border-slate-800 border-t-indigo-600 rounded-full animate-spin" />
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-3 font-semibold uppercase tracking-wider">Cargando producto...</p>
            </div>
        );
    }

    if (notFound || !item) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-[#0b1220] flex flex-col items-center justify-center gap-4 text-center px-4 transition-colors duration-300">
                <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-950/20 text-red-500 flex items-center justify-center mb-2">
                    <X className="w-8 h-8" />
                </div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Producto no disponible</h1>
                <p className="text-gray-500 dark:text-slate-400 max-w-xs">El artículo que estás buscando no existe o ya no se encuentra publicado en la tienda.</p>
                <a href="/tienda" className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs shadow-md transition-all">
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Volver a la tienda</span>
                </a>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-[#0b1220] text-gray-900 dark:text-gray-100 transition-colors duration-300">
            {/* Header / Barra de Navegación */}
            <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg border-b border-gray-100 dark:border-slate-800/80 shadow-sm">
                <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
                    {/* Botón Volver */}
                    <a href="/tienda" className="inline-flex items-center gap-2 text-sm font-semibold text-gray-550 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors">
                        <ArrowLeft className="w-4 h-4" />
                        <span>Tienda</span>
                    </a>

                    {/* Botones de acción */}
                    <div className="flex items-center gap-2">
                        {/* Botón de Modo Oscuro */}
                        <button
                            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            className="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 hover:scale-105 transition-all shadow-sm"
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

            <main className="max-w-5xl mx-auto px-4 py-8 pb-24 space-y-12">
                {/* Caja Principal del Producto */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-gray-100 dark:border-slate-800 overflow-hidden transition-colors">
                    <div className="grid grid-cols-1 md:grid-cols-2">
                        {/* SECCIÓN IZQUIERDA: GALERÍA DE IMÁGENES */}
                        <div className="flex flex-col gap-3 p-6 bg-gray-50 dark:bg-slate-950/40 border-b md:border-b-0 md:border-r border-gray-100 dark:border-slate-800">
                            {/* Visualizador de Imagen Principal */}
                            <div className="aspect-square rounded-2xl overflow-hidden bg-white dark:bg-slate-900 border border-gray-150 dark:border-slate-800 relative group/viewer">
                                {activeUrl && !mainImgError ? (
                                    <>
                                        <img
                                            key={activeUrl}
                                            src={activeUrl}
                                            alt={item.productName}
                                            className="w-full h-full object-cover select-none"
                                            onError={() => setMainImgError(true)}
                                        />
                                        
                                        {/* Botones de navegación sobre imagen */}
                                        {allImages.length > 1 && (
                                            <>
                                                <button
                                                    onClick={handlePrevImage}
                                                    className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white flex items-center justify-center opacity-0 group-hover/viewer:opacity-100 transition-opacity cursor-pointer"
                                                >
                                                    <ChevronLeft className="w-5 h-5" />
                                                </button>
                                                <button
                                                    onClick={handleNextImage}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white flex items-center justify-center opacity-0 group-hover/viewer:opacity-100 transition-opacity cursor-pointer"
                                                >
                                                    <ChevronRight className="w-5 h-5" />
                                                </button>
                                            </>
                                        )}
                                        
                                        {/* Botón de Zoom Modal */}
                                        <button
                                            onClick={() => setShowLightbox(true)}
                                            className="absolute bottom-3 right-3 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white flex items-center justify-center opacity-0 group-hover/viewer:opacity-100 transition-opacity cursor-pointer"
                                            title="Expandir imagen"
                                        >
                                            <Maximize2 className="w-4 h-4" />
                                        </button>
                                    </>
                                ) : (
                                    <ImagePlaceholder />
                                )}
                            </div>

                            {/* Miniaturas de imágenes */}
                            {allImages.length > 1 && (
                                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                                    {allImages.map((url, i) => (
                                        <button
                                            key={url}
                                            onClick={() => { setActiveIdx(i); setMainImgError(false); }}
                                            className={`shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                                                i === activeIdx 
                                                ? 'border-indigo-500 scale-[1.02]' 
                                                : 'border-transparent opacity-60 hover:opacity-100'
                                            }`}
                                        >
                                            <img src={url} alt="" className="w-full h-full object-cover" />
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* Video del producto */}
                            {item.storeVideoUrl && (
                                <div className="mt-3 space-y-2">
                                    <h4 className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Video de Demostración</h4>
                                    <VideoPlayer url={item.storeVideoUrl} />
                                </div>
                            )}
                        </div>

                        {/* SECCIÓN DERECHA: INFORMACIÓN Y COMPRA */}
                        <div className="p-8 flex flex-col gap-6">
                            
                            {/* Encabezado: Título + Categoría + Condición */}
                            <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                    {item.category && (
                                        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-widest">
                                            {item.category}
                                        </span>
                                    )}
                                    <span className="text-[10px] font-bold text-gray-400 dark:text-slate-500">•</span>
                                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${conditionColor[currentCondition] || conditionColor.nuevo}`}>
                                        {conditionLabel[currentCondition] || currentCondition}
                                    </span>
                                </div>
                                <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white leading-tight">
                                    {item.storeTitle || item.productName}
                                </h1>
                            </div>

                            {/* Precio */}
                            <div className="flex items-baseline gap-2">
                                <span className="text-3xl font-extrabold text-gray-900 dark:text-white">
                                    ${currentPrice.toLocaleString('es-AR')}
                                </span>
                            </div>

                            {/* Descripción */}
                            {item.description && (
                                <div className="space-y-1">
                                    <h3 className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Detalles del Producto</h3>
                                    <p className="text-sm text-gray-600 dark:text-slate-350 whitespace-pre-line leading-relaxed">
                                        {item.description}
                                    </p>
                                </div>
                            )}

                            {/* Variantes (Opciones del grupo) */}
                            {hasOptions && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Opciones Disponibles</h3>
                                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-400 px-2 py-0.5 rounded-full">
                                            {variants.reduce((acc, v) => acc + v.quantity, 0)} disponibles en total
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-1 gap-2">
                                        {mergedVariants.map(v => {
                                            const isSelected = v.ids.includes(selectedVariantId);
                                            return (
                                                <button
                                                    key={v.ids[0]}
                                                    onClick={() => setSelectedVariantId(v.ids[0])}
                                                    disabled={v.quantity <= 0}
                                                    className={`w-full flex items-center justify-between gap-3 text-left rounded-xl border p-3.5 transition-all cursor-pointer ${
                                                        v.quantity <= 0 
                                                        ? 'opacity-40 border-gray-150 dark:border-slate-800 bg-gray-50 text-gray-400 cursor-not-allowed'
                                                        : isSelected
                                                        ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 ring-1 ring-indigo-500'
                                                        : 'border-gray-200 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900/50'
                                                    }`}
                                                >
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                                            {v.variantName || (v.location ? `📍 ${v.location}` : 'Disponible')}
                                                        </p>
                                                        <p className="text-[11px] text-gray-400 dark:text-slate-500 mt-0.5">
                                                            Condición: {conditionLabel[v.condition] || v.condition}
                                                            {v.variantName && v.location ? ` · 📍 ${v.location}` : ''}
                                                        </p>
                                                    </div>
                                                    
                                                    <div className="flex items-center gap-3 shrink-0">
                                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                                            v.quantity > 0 
                                                            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400' 
                                                            : 'bg-gray-100 text-gray-400'
                                                        }`}>
                                                            {v.quantity > 0 ? `Stock: ${v.quantity}` : 'Sin stock'}
                                                        </span>
                                                        <span className="text-sm font-extrabold text-gray-900 dark:text-white">
                                                            ${v.price.toLocaleString('es-AR')}
                                                        </span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Ubicación (cuando no se tiene variantes complejas) */}
                            {!hasOptions && currentLocation && (
                                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
                                    <svg className="w-4.5 h-4.5 text-gray-450 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    <span>Disponible en: <strong className="text-gray-800 dark:text-white font-semibold">{currentLocation}</strong></span>
                                </div>
                            )}

                            {/* Selector de Cantidad a Comprar */}
                            {currentStock > 0 && (
                                <div className="flex items-center gap-4">
                                    <span className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider">Cantidad</span>
                                    <div className="flex items-center gap-1.5 border border-gray-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-950 p-1">
                                        <button
                                            onClick={() => setBuyQty(prev => Math.max(1, prev - 1))}
                                            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-600 dark:text-gray-300 cursor-pointer"
                                            disabled={buyQty <= 1}
                                        >
                                            <Minus className="w-3.5 h-3.5" />
                                        </button>
                                        <span className="w-8 text-center text-sm font-bold text-gray-850 dark:text-white select-none">
                                            {buyQty}
                                        </span>
                                        <button
                                            onClick={() => setBuyQty(prev => Math.min(currentStock, prev + 1))}
                                            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-600 dark:text-gray-300 cursor-pointer"
                                            disabled={buyQty >= currentStock}
                                        >
                                            <Plus className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                    <span className="text-xs text-gray-400 dark:text-slate-500">
                                        ({currentStock} disponibles)
                                    </span>
                                </div>
                            )}

                            {/* Acciones del Carrito y Compra */}
                            <div className="flex flex-col sm:flex-row gap-3 pt-2">
                                {currentStock > 0 ? (
                                    <>
                                        {/* Botón Carrito */}
                                        <button
                                            onClick={handleAddToCart}
                                            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 text-sm font-bold transition-all cursor-pointer hover:scale-[1.01]"
                                        >
                                            <ShoppingCart className="w-4 h-4" />
                                            <span>Agregar al Carrito</span>
                                        </button>

                                        {/* Botón Compra Directa */}
                                        <button
                                            onClick={handleDirectBuy}
                                            className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-all cursor-pointer hover:scale-[1.01] shadow-md shadow-emerald-600/10"
                                        >
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.739-1.456L0 24zm6.59-4.846c1.6.95 3.188 1.449 4.825 1.451 5.436 0 9.86-4.37 9.864-9.799.002-2.63-1.023-5.101-2.885-6.965C16.59 1.977 14.113.953 11.483.951c-5.44 0-9.866 4.369-9.87 9.8-.001 1.702.463 3.364 1.34 4.825l-.93 3.398 3.484-.903-.002-.002z" />
                                            </svg>
                                            <span>Comprar Ahora</span>
                                        </button>
                                    </>
                                ) : (
                                    <div className="w-full py-4 bg-red-50 dark:bg-red-950/20 border border-red-200/40 rounded-2xl text-center">
                                        <p className="text-sm font-bold text-red-500 dark:text-red-400">Sin stock disponible</p>
                                        <p className="text-xs text-gray-500 mt-0.5">Este producto/opción no se encuentra disponible momentáneamente.</p>
                                    </div>
                                )}
                            </div>

                            {/* Enlace para compartir */}
                            <div className="pt-4 border-t border-gray-100 dark:border-slate-800">
                                <p className="text-xs font-bold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">Compartir Producto</p>
                                <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-950 rounded-xl border border-gray-200 dark:border-slate-800 px-3 py-2">
                                    <p className="text-xs text-gray-500 dark:text-slate-400 flex-1 truncate select-all">{window.location.href}</p>
                                    <button
                                        onClick={copyLink}
                                        className="shrink-0 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 hover:scale-105 transition-all p-1 cursor-pointer"
                                        title="Copiar link"
                                    >
                                        {copied ? <Check className="w-4 h-4 text-emerald-500 animate-in zoom-in" /> : <Copy className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* SECCIÓN: PRODUCTOS RECOMENDADOS */}
                {related.length > 0 && (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <h2 className="text-xl font-extrabold text-gray-900 dark:text-white">Te puede interesar</h2>
                            <span className="h-0.5 bg-gray-200 dark:bg-slate-800 flex-1 mx-4 hidden sm:block" />
                            <a href="/tienda" className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline">Ver todo el catálogo →</a>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6">
                            {related.map(r => {
                                const rPrice = r.salePrice || r.estimatedSalePrice || 0;
                                return (
                                    <a
                                        key={r.id}
                                        href={`/tienda/producto/${r.id}`}
                                        className="group bg-white dark:bg-slate-900 rounded-2xl overflow-hidden shadow-sm border border-gray-100 dark:border-slate-800 flex flex-col hover:shadow-md hover:-translate-y-0.5 transition-all duration-300"
                                    >
                                        <div className="aspect-square bg-gray-50 dark:bg-slate-950 overflow-hidden relative">
                                            {r.imageUrl ? (
                                                <img src={r.imageUrl} alt={r.productName} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-gray-200 dark:text-slate-800">
                                                    <ShoppingBag className="w-10 h-10 stroke-[1.5]" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-3.5 flex flex-col gap-1 flex-1">
                                            <h4 className="font-bold text-xs text-gray-800 dark:text-white line-clamp-2 min-h-[2rem]">
                                                {r.storeTitle || r.productName}
                                            </h4>
                                            <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-50 dark:border-slate-850">
                                                <p className="text-sm font-extrabold text-gray-900 dark:text-white">
                                                    ${rPrice.toLocaleString('es-AR')}
                                                </p>
                                                <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold group-hover:translate-x-0.5 transition-transform">Ver →</span>
                                            </div>
                                        </div>
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                )}
            </main>

            {/* LIGHTBOX MODAL (VISOR FULLSCREEN) */}
            {showLightbox && activeUrl && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 select-none animate-in fade-in duration-300">
                    <button
                        onClick={() => setShowLightbox(false)}
                        className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
                        aria-label="Cerrar visor"
                    >
                        <X className="w-6 h-6" />
                    </button>
                    
                    {allImages.length > 1 && (
                        <>
                            <button
                                onClick={handlePrevImage}
                                className="absolute left-5 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
                                aria-label="Anterior"
                            >
                                <ChevronLeft className="w-8 h-8" />
                            </button>
                            <button
                                onClick={handleNextImage}
                                className="absolute right-5 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer transition-colors"
                                aria-label="Siguiente"
                            >
                                <ChevronRight className="w-8 h-8" />
                            </button>
                        </>
                    )}

                    <div className="max-w-4xl max-h-[85vh] px-4 flex items-center justify-center">
                        <img 
                            src={activeUrl} 
                            alt="" 
                            className="max-w-full max-h-[80vh] object-contain rounded-lg animate-in zoom-in-95 duration-300 shadow-2xl" 
                        />
                    </div>
                    
                    {/* Contador inferior */}
                    <div className="absolute bottom-5 bg-white/10 backdrop-blur-sm text-white px-3.5 py-1.5 rounded-full text-xs font-semibold tracking-wider">
                        {activeIdx + 1} / {allImages.length}
                    </div>
                </div>
            )}

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
                                            className="w-full px-3.5 py-2.5 rounded-xl border border-gray-250 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm outline-none focus:border-indigo-500 transition-all animate-none"
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
                                        onClick={handleCartCheckout}
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
