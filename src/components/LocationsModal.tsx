import { useState } from 'react';
import type { LocationItem, Item } from '../types';
import { 
    MapPin, 
    Plus, 
    Trash2, 
    Edit2, 
    Check, 
    X, 
    Phone, 
    MessageCircle, 
    Building, 
    Star, 
    AlertCircle,
    Package,
    ChevronDown,
    ChevronRight,
    Tag,
    Boxes
} from 'lucide-react';
import { STORE_CONFIG } from '../config/storeConfig';

interface LocationsModalProps {
    isOpen: boolean;
    onClose: () => void;
    locations: LocationItem[];
    onSaveLocation: (loc: { id?: string; name: string; whatsapp?: string; phone?: string; address?: string; isDefault?: boolean }) => Promise<void>;
    onDeleteLocation: (id: string) => Promise<void>;
    items: Item[];
    theme?: 'light' | 'dark';
}

type ViewTab = 'locations' | 'stock';

// Paleta de colores por índice de ubicación
const LOCATION_COLORS = [
    { bg: 'bg-blue-500', light: 'bg-blue-50 dark:bg-blue-950/40', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-600 dark:text-blue-400', badge: 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300' },
    { bg: 'bg-emerald-500', light: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-200 dark:border-emerald-800', text: 'text-emerald-600 dark:text-emerald-400', badge: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300' },
    { bg: 'bg-violet-500', light: 'bg-violet-50 dark:bg-violet-950/40', border: 'border-violet-200 dark:border-violet-800', text: 'text-violet-600 dark:text-violet-400', badge: 'bg-violet-100 dark:bg-violet-900/50 text-violet-700 dark:text-violet-300' },
    { bg: 'bg-amber-500', light: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-200 dark:border-amber-800', text: 'text-amber-600 dark:text-amber-400', badge: 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300' },
    { bg: 'bg-rose-500', light: 'bg-rose-50 dark:bg-rose-950/40', border: 'border-rose-200 dark:border-rose-800', text: 'text-rose-600 dark:text-rose-400', badge: 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300' },
    { bg: 'bg-cyan-500', light: 'bg-cyan-50 dark:bg-cyan-950/40', border: 'border-cyan-200 dark:border-cyan-800', text: 'text-cyan-600 dark:text-cyan-400', badge: 'bg-cyan-100 dark:bg-cyan-900/50 text-cyan-700 dark:text-cyan-300' },
];

const conditionLabel: Record<string, string> = {
    nuevo: 'Nuevo',
    semi_uso: 'Semi uso',
    usado: 'Usado',
};

const typeLabel: Record<string, string> = {
    resale: 'Comercial',
    personal: 'Personal',
};

const fmt = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

export function LocationsModal({
    isOpen,
    onClose,
    locations,
    onSaveLocation,
    onDeleteLocation,
    items,
}: LocationsModalProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [name, setName] = useState('');
    const [whatsapp, setWhatsapp] = useState('');
    const [phone, setPhone] = useState('');
    const [address, setAddress] = useState('');
    const [isDefault, setIsDefault] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<ViewTab>('locations');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    if (!isOpen) return null;

    const resetForm = () => {
        setEditingId(null);
        setIsCreating(false);
        setName('');
        setWhatsapp('');
        setPhone('');
        setAddress('');
        setIsDefault(false);
        setError(null);
    };

    const handleStartCreate = () => {
        resetForm();
        setWhatsapp(STORE_CONFIG.defaultWhatsApp);
        setIsCreating(true);
    };

    const handleStartEdit = (loc: LocationItem) => {
        setEditingId(loc.id);
        setIsCreating(false);
        setName(loc.name);
        setWhatsapp(loc.whatsapp || '');
        setPhone(loc.phone || '');
        setAddress(loc.address || '');
        setIsDefault(loc.isDefault || false);
        setError(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError('El nombre de la ubicación es obligatorio.');
            return;
        }
        if (isCreating && locations.some(l => l.name.toLowerCase() === trimmedName.toLowerCase())) {
            setError('Ya existe una ubicación con este nombre.');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await onSaveLocation({
                id: editingId || undefined,
                name: trimmedName,
                whatsapp: whatsapp.trim() || undefined,
                phone: phone.trim() || undefined,
                address: address.trim() || undefined,
                isDefault,
            });
            resetForm();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al guardar la ubicación');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (loc: LocationItem) => {
        const stockCount = items.filter(
            i => (i.location || '').trim().toLowerCase() === loc.name.trim().toLowerCase() && i.status === 'in_stock'
        ).length;
        let confirmMsg = `¿Eliminar la ubicación "${loc.name}"?`;
        if (stockCount > 0) {
            confirmMsg = `⚠️ Hay ${stockCount} producto(s) en stock asignados a "${loc.name}".\n\n¿Estás seguro de que deseas eliminar esta ubicación?`;
        }
        if (!window.confirm(confirmMsg)) return;
        try {
            await onDeleteLocation(loc.id);
            if (editingId === loc.id) resetForm();
        } catch {
            alert('Error al eliminar la ubicación.');
        }
    };

    // ── Stock agrupado por ubicación ──────────────────────────────────────
    const inStockItems = items.filter(i => i.status === 'in_stock');

    type ProductEntry = {
        name: string;
        totalQty: number;
        totalValue: number;
        byCondition: Record<string, number>; // condition -> qty
        byType: Record<string, number>;      // type -> qty
    };

    type LocationGroup = {
        locName: string;
        locObj: LocationItem | null;
        colorIdx: number;
        totalQty: number;
        totalValue: number;
        byCondition: Record<string, number>;
        byType: Record<string, number>;
        products: ProductEntry[]; // grouped strictly by name
    };

    const grouped: Record<string, LocationGroup> = {};

    // Seed con todas las ubicaciones configuradas (para mostrar las vacías también)
    locations.forEach((loc, idx) => {
        const key = loc.name.trim().toLowerCase();
        grouped[key] = {
            locName: loc.name,
            locObj: loc,
            colorIdx: idx % LOCATION_COLORS.length,
            totalQty: 0,
            totalValue: 0,
            byCondition: {},
            byType: {},
            products: [],
        };
    });

    inStockItems.forEach(item => {
        const raw = (item.location || '').trim();
        const key = raw.toLowerCase() || '__sin_ubicacion__';
        const locName = raw || 'Sin ubicación';

        if (!grouped[key]) {
            const idx = Object.keys(grouped).length % LOCATION_COLORS.length;
            grouped[key] = {
                locName,
                locObj: null,
                colorIdx: idx,
                totalQty: 0,
                totalValue: 0,
                byCondition: {},
                byType: {},
                products: [],
            };
        }

        const g = grouped[key];
        const qty = item.quantity || 1;
        const val = (item.estimatedSalePrice || item.salePrice || item.purchasePrice || 0) * qty;
        const cond = item.condition || 'nuevo';
        const type = item.itemType || 'resale';

        g.totalQty += qty;
        g.totalValue += val;
        g.byCondition[cond] = (g.byCondition[cond] || 0) + qty;
        g.byType[type] = (g.byType[type] || 0) + qty;

        // Agrupar por nombre de producto únicamente (sin importar precio ni condición)
        const existingProd = g.products.find(p => p.name === item.productName);
        if (existingProd) {
            existingProd.totalQty += qty;
            existingProd.totalValue += val;
            existingProd.byCondition[cond] = (existingProd.byCondition[cond] || 0) + qty;
            existingProd.byType[type] = (existingProd.byType[type] || 0) + qty;
        } else {
            g.products.push({
                name: item.productName,
                totalQty: qty,
                totalValue: val,
                byCondition: { [cond]: qty },
                byType: { [type]: qty },
            });
        }
    });

    const groupList = Object.values(grouped).sort((a, b) => b.totalQty - a.totalQty);
    const totalStock = inStockItems.reduce((s, i) => s + (i.quantity || 1), 0);

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700/60 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700/60 flex items-center justify-between bg-gradient-to-r from-blue-50/50 dark:from-blue-950/30 via-indigo-50/30 dark:via-indigo-950/20 to-white dark:to-gray-900">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                            <MapPin className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">Gestión de Ubicaciones</h2>
                            <p className="text-xs text-gray-500 dark:text-gray-400">Puntos de venta, retiros y stock por lugar.</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-lg text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="px-6 pt-3 flex gap-1 border-b border-gray-100 dark:border-gray-700/60">
                    <button
                        onClick={() => setActiveTab('locations')}
                        className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors flex items-center gap-1.5 -mb-px border-b-2 ${
                            activeTab === 'locations'
                                ? 'border-blue-500 text-blue-600 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/30'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                    >
                        <MapPin className="w-3.5 h-3.5" />
                        Ubicaciones ({locations.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('stock')}
                        className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-colors flex items-center gap-1.5 -mb-px border-b-2 ${
                            activeTab === 'stock'
                                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30'
                                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                        }`}
                    >
                        <Boxes className="w-3.5 h-3.5" />
                        Stock por Ubicación ({totalStock})
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto space-y-5 flex-1">

                    {/* ═══ TAB UBICACIONES ═══ */}
                    {activeTab === 'locations' && (
                        <>
                            {(isCreating || editingId) ? (
                                <form onSubmit={handleSubmit} className="bg-blue-50/50 dark:bg-blue-950/25 rounded-2xl p-5 border border-blue-100 dark:border-blue-800/50 space-y-4 animate-in slide-in-from-top-2 duration-200">
                                    <div className="flex items-center justify-between pb-2 border-b border-blue-100/80 dark:border-blue-800/40">
                                        <h3 className="text-sm font-bold text-blue-900 dark:text-blue-300 flex items-center gap-2">
                                            <Building className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                                            {isCreating ? 'Nueva Ubicación' : `Editar: ${name}`}
                                        </h3>
                                        <button type="button" onClick={resetForm} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium transition-colors">
                                            Cancelar
                                        </button>
                                    </div>

                                    {error && (
                                        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 text-xs text-rose-700 dark:text-rose-400 flex items-center gap-2">
                                            <AlertCircle className="w-4 h-4 shrink-0" />
                                            <span>{error}</span>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                                Nombre de la ubicación *
                                            </label>
                                            <input
                                                type="text"
                                                required
                                                placeholder="Ej: Abra Pampa, San Salvador…"
                                                value={name}
                                                onChange={e => setName(e.target.value)}
                                                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                                WhatsApp de Contacto
                                            </label>
                                            <div className="relative">
                                                <MessageCircle className="w-4 h-4 text-emerald-500 absolute left-3 top-1/2 -translate-y-1/2" />
                                                <input
                                                    type="text"
                                                    placeholder="Ej: 3885925942"
                                                    value={whatsapp}
                                                    onChange={e => setWhatsapp(e.target.value)}
                                                    className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all font-mono"
                                                />
                                            </div>
                                            <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">Sin + ni código de país (ej. 388592…)</p>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                                Teléfono (opcional)
                                            </label>
                                            <div className="relative">
                                                <Phone className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                                                <input
                                                    type="text"
                                                    placeholder="Ej: 3885925942"
                                                    value={phone}
                                                    onChange={e => setPhone(e.target.value)}
                                                    className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                                                Dirección o Referencia
                                            </label>
                                            <input
                                                type="text"
                                                placeholder="Ej: Av. Belgrano 123"
                                                value={address}
                                                onChange={e => setAddress(e.target.value)}
                                                className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                            />
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between pt-2">
                                        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700 dark:text-gray-300 select-none">
                                            <input
                                                type="checkbox"
                                                checked={isDefault}
                                                onChange={e => setIsDefault(e.target.checked)}
                                                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300 dark:border-gray-600"
                                            />
                                            <span>Ubicación predeterminada</span>
                                        </label>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={resetForm} className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                                                Cancelar
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={saving}
                                                className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
                                            >
                                                {saving
                                                    ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                                    : <Check className="w-3.5 h-3.5" />
                                                }
                                                {isCreating ? 'Agregar' : 'Guardar'}
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            ) : (
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                        {locations.length} ubicación{locations.length !== 1 ? 'es' : ''} configurada{locations.length !== 1 ? 's' : ''}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleStartCreate}
                                        className="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-all flex items-center gap-1.5"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        Nueva Ubicación
                                    </button>
                                </div>
                            )}

                            <div className="space-y-2.5">
                                {locations.length === 0 ? (
                                    <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
                                        No hay ubicaciones registradas. Agrega una para comenzar.
                                    </div>
                                ) : (
                                    locations.map((loc, idx) => {
                                        const color = LOCATION_COLORS[idx % LOCATION_COLORS.length];
                                        const stockQty = inStockItems
                                            .filter(i => (i.location || '').trim().toLowerCase() === loc.name.trim().toLowerCase())
                                            .reduce((acc, i) => acc + (i.quantity || 1), 0);
                                        const isSelected = editingId === loc.id;

                                        return (
                                            <div
                                                key={loc.id}
                                                className={`rounded-xl border p-3.5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                                                    isSelected
                                                        ? 'border-blue-400 dark:border-blue-600 bg-blue-50/40 dark:bg-blue-950/30 ring-1 ring-blue-400 dark:ring-blue-600'
                                                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 hover:border-gray-300 dark:hover:border-gray-600'
                                                }`}
                                            >
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className={`w-2.5 h-2.5 rounded-full ${color.bg} shrink-0`} />
                                                    <div className="space-y-1 min-w-0">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <span className="font-bold text-gray-900 dark:text-gray-100 text-sm flex items-center gap-1.5">
                                                                <MapPin className={`w-3.5 h-3.5 ${color.text}`} />
                                                                {loc.name}
                                                            </span>
                                                            {loc.isDefault && (
                                                                <span className="text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-400 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                                    <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                                                                    Predeterminada
                                                                </span>
                                                            )}
                                                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${color.badge}`}>
                                                                <Package className="w-3 h-3" />
                                                                {stockQty} en stock
                                                            </span>
                                                        </div>
                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
                                                            {loc.whatsapp && (
                                                                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-mono">
                                                                    <MessageCircle className="w-3 h-3" />
                                                                    {loc.whatsapp}
                                                                </span>
                                                            )}
                                                            {loc.phone && (
                                                                <span className="flex items-center gap-1">
                                                                    <Phone className="w-3 h-3" />
                                                                    {loc.phone}
                                                                </span>
                                                            )}
                                                            {loc.address && (
                                                                <span className="truncate max-w-xs">🏠 {loc.address}</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleStartEdit(loc)}
                                                        className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-lg transition-colors"
                                                        title="Editar"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDelete(loc)}
                                                        className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors"
                                                        title="Eliminar"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </>
                    )}

                    {/* ═══ TAB STOCK POR UBICACIÓN ═══ */}
                    {activeTab === 'stock' && (
                        <div className="space-y-3">
                            {groupList.length === 0 ? (
                                <div className="text-center py-10 text-gray-400 dark:text-gray-500 text-sm border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
                                    No hay items en stock.
                                </div>
                            ) : (
                                groupList.map(grp => {
                                    if (grp.totalQty === 0 && !grp.locObj) return null;
                                    const color = LOCATION_COLORS[grp.colorIdx];
                                    const groupKey = grp.locName;
                                    const isExpanded = expandedGroups.has(groupKey);
                                    const pct = totalStock > 0 ? Math.round((grp.totalQty / totalStock) * 100) : 0;

                                    return (
                                        <div key={groupKey} className={`rounded-xl border overflow-hidden transition-all ${grp.totalQty > 0 ? `${color.light} ${color.border}` : 'bg-gray-50 dark:bg-gray-800/30 border-gray-200 dark:border-gray-700'}`}>
                                            <button
                                                type="button"
                                                onClick={() => grp.totalQty > 0 && toggleGroup(groupKey)}
                                                className={`w-full p-4 text-left flex items-center gap-3 transition-colors ${grp.totalQty > 0 ? 'hover:opacity-90 cursor-pointer' : 'cursor-default'}`}
                                            >
                                                <div className={`w-3 h-3 rounded-full ${color.bg} shrink-0 ${grp.totalQty === 0 ? 'opacity-30' : ''}`} />

                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                                                        <span className={`font-bold text-sm ${grp.totalQty > 0 ? color.text : 'text-gray-400 dark:text-gray-500'}`}>
                                                            <MapPin className="w-3.5 h-3.5 inline mr-1" />
                                                            {grp.locName}
                                                        </span>
                                                        {grp.locObj?.isDefault && (
                                                            <span className="text-[10px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">★ Default</span>
                                                        )}
                                                        {grp.totalQty === 0 && (
                                                            <span className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">Vacía</span>
                                                        )}
                                                    </div>

                                                    {grp.totalQty > 0 && (
                                                        <>
                                                            <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mb-2">
                                                                <div
                                                                    className={`h-full rounded-full ${color.bg} transition-all duration-500`}
                                                                    style={{ width: `${pct}%` }}
                                                                />
                                                            </div>
                                                            <div className="flex flex-wrap gap-1.5">
                                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color.badge}`}>
                                                                    <Package className="w-3 h-3 inline mr-0.5" />
                                                                    {grp.totalQty} unid. ({pct}%)
                                                                </span>
                                                                {grp.totalValue > 0 && (
                                                                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                                                                        {fmt(grp.totalValue)}
                                                                    </span>
                                                                )}
                                                                {Object.entries(grp.byCondition).map(([cond, qty]) => (
                                                                    <span key={cond} className="text-[10px] px-2 py-0.5 rounded-full bg-white/70 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 font-medium">
                                                                        {conditionLabel[cond] || cond}: {qty}
                                                                    </span>
                                                                ))}
                                                                {Object.entries(grp.byType).map(([type, qty]) => (
                                                                    <span key={type} className="text-[10px] px-2 py-0.5 rounded-full bg-white/70 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600 font-medium flex items-center gap-0.5">
                                                                        <Tag className="w-2.5 h-2.5" />
                                                                        {typeLabel[type] || type}: {qty}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </>
                                                    )}
                                                </div>

                                                {grp.totalQty > 0 && (
                                                    <div className="shrink-0">
                                                        {isExpanded
                                                            ? <ChevronDown className={`w-4 h-4 ${color.text}`} />
                                                            : <ChevronRight className={`w-4 h-4 ${color.text}`} />
                                                        }
                                                    </div>
                                                )}
                                            </button>

                                            {/* Lista de productos expandida */}
                                            {isExpanded && grp.totalQty > 0 && (
                                                <div className="border-t border-gray-200 dark:border-gray-700/60 divide-y divide-gray-100 dark:divide-gray-700/40">
                                                    {grp.products
                                                        .sort((a, b) => b.totalQty - a.totalQty)
                                                        .map((prod, i) => (
                                                            <div
                                                                key={i}
                                                                className="px-4 py-2.5 flex items-start justify-between gap-3 bg-white/60 dark:bg-gray-800/40 hover:bg-white/90 dark:hover:bg-gray-800/70 transition-colors"
                                                            >
                                                                {/* Nombre + subdivisions */}
                                                                <div className="flex flex-col gap-1 min-w-0">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 mt-0.5 ${color.bg}`} />
                                                                        <span className="text-xs text-gray-800 dark:text-gray-200 font-semibold truncate">{prod.name}</span>
                                                                    </div>
                                                                    {/* Subdivisiones: condición y tipo */}
                                                                    <div className="flex flex-wrap gap-1 pl-3.5">
                                                                        {Object.entries(prod.byCondition).map(([cond, qty]) => (
                                                                            <span key={cond} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 font-medium">
                                                                                {conditionLabel[cond] || cond}: {qty}
                                                                            </span>
                                                                        ))}
                                                                        {Object.entries(prod.byType).some(([t]) => t === 'personal') && (
                                                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400 font-medium">
                                                                                Personal: {prod.byType['personal']}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                {/* Cantidad + valor */}
                                                                <div className="flex items-center gap-2 shrink-0 pt-0.5">
                                                                    <span className={`text-xs font-bold ${color.badge} px-2 py-0.5 rounded-full`}>×{prod.totalQty}</span>
                                                                    {prod.totalValue > 0 && (
                                                                        <span className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">{fmt(prod.totalValue)}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700/60 bg-gray-50/50 dark:bg-gray-800/30 flex justify-between items-center text-xs text-gray-500 dark:text-gray-400">
                    <span>Las ubicaciones se usan automáticamente al agregar productos.</span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-900 dark:bg-gray-700 hover:bg-black dark:hover:bg-gray-600 text-white font-bold rounded-xl transition-colors"
                    >
                        Listo
                    </button>
                </div>
            </div>
        </div>
    );
}
