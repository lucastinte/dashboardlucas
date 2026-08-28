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
    Package
} from 'lucide-react';
import { STORE_CONFIG } from '../config/storeConfig';

interface LocationsModalProps {
    isOpen: boolean;
    onClose: () => void;
    locations: LocationItem[];
    onSaveLocation: (loc: { id?: string; name: string; whatsapp?: string; phone?: string; address?: string; isDefault?: boolean }) => Promise<void>;
    onDeleteLocation: (id: string) => Promise<void>;
    items: Item[];
}

export function LocationsModal({
    isOpen,
    onClose,
    locations,
    onSaveLocation,
    onDeleteLocation,
    items
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

        // Check duplicates if new
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
                isDefault
            });
            resetForm();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al guardar la ubicación');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (loc: LocationItem) => {
        const stockCount = items.filter(i => (i.location || '').trim().toLowerCase() === loc.name.trim().toLowerCase() && i.status === 'in_stock').length;
        let confirmMsg = `¿Eliminar la ubicación "${loc.name}"?`;
        if (stockCount > 0) {
            confirmMsg = `⚠️ Hay ${stockCount} producto(s) en stock asignados a "${loc.name}".\n\n¿Estás seguro de que deseas eliminar esta ubicación? Los productos mantendrán el texto pero la ubicación ya no estará en la lista fija.`;
        }
        if (!window.confirm(confirmMsg)) return;

        try {
            await onDeleteLocation(loc.id);
            if (editingId === loc.id) resetForm();
        } catch (err) {
            alert('Error al eliminar la ubicación.');
        }
    };

    // Calculate stock per location
    const getStockCountForLocation = (locName: string) => {
        const norm = locName.trim().toLowerCase();
        return items
            .filter(i => (i.location || '').trim().toLowerCase() === norm && i.status === 'in_stock')
            .reduce((acc, i) => acc + (i.quantity || 1), 0);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-blue-50/50 via-indigo-50/30 to-white">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                            <MapPin className="w-5 h-5" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-900">Gestión de Ubicaciones Fijas</h2>
                            <p className="text-xs text-gray-500">Configura puntos de venta, retiros y sus números de WhatsApp.</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 flex items-center justify-center transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto space-y-6 flex-1">
                    {/* Add/Edit Form */}
                    {(isCreating || editingId) ? (
                        <form onSubmit={handleSubmit} className="bg-blue-50/50 rounded-2xl p-5 border border-blue-100 space-y-4 animate-in slide-in-from-top-2 duration-200">
                            <div className="flex items-center justify-between pb-2 border-b border-blue-100/80">
                                <h3 className="text-sm font-bold text-blue-900 flex items-center gap-2">
                                    <Building className="w-4 h-4 text-blue-600" />
                                    {isCreating ? 'Nueva Ubicación' : `Editar: ${name}`}
                                </h3>
                                <button
                                    type="button"
                                    onClick={resetForm}
                                    className="text-xs text-gray-500 hover:text-gray-700 font-medium"
                                >
                                    Cancelar
                                </button>
                            </div>

                            {error && (
                                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">
                                        Nombre de la ubicación *
                                    </label>
                                    <input
                                        type="text"
                                        required
                                        placeholder="Ej: Abra Pampa, San Salvador, Jujuy Centro"
                                        value={name}
                                        onChange={e => setName(e.target.value)}
                                        className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">
                                        WhatsApp de Contacto
                                    </label>
                                    <div className="relative">
                                        <MessageCircle className="w-4 h-4 text-emerald-500 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input
                                            type="text"
                                            placeholder="Ej: 5493885925942"
                                            value={whatsapp}
                                            onChange={e => setWhatsapp(e.target.value)}
                                            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition-all font-mono"
                                        />
                                    </div>
                                    <p className="text-[10px] text-gray-400 mt-0.5">Incluir código de país sin + (ej. 549388...)</p>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">
                                        Teléfono de llamadas (opcional)
                                    </label>
                                    <div className="relative">
                                        <Phone className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                        <input
                                            type="text"
                                            placeholder="Ej: 3885925942"
                                            value={phone}
                                            onChange={e => setPhone(e.target.value)}
                                            className="w-full pl-9 pr-3 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">
                                        Dirección o Referencia
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="Ej: Av. Belgrano 123 / Entrega en terminal"
                                        value={address}
                                        onChange={e => setAddress(e.target.value)}
                                        className="w-full px-3 py-2 text-sm rounded-xl border border-gray-200 bg-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                                    />
                                </div>
                            </div>

                            <div className="flex items-center justify-between pt-2">
                                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700 select-none">
                                    <input
                                        type="checkbox"
                                        checked={isDefault}
                                        onChange={e => setIsDefault(e.target.checked)}
                                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-gray-300"
                                    />
                                    <span>Ubicación predeterminada</span>
                                </label>

                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={resetForm}
                                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                                    >
                                        Cancelar
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={saving}
                                        className="px-4 py-1.5 rounded-lg text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
                                    >
                                        {saving ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                        {isCreating ? 'Agregar Ubicación' : 'Guardar Cambios'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    ) : (
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500">
                                Ubicaciones configuradas ({locations.length})
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

                    {/* Locations List */}
                    <div className="space-y-2.5">
                        {locations.length === 0 ? (
                            <div className="text-center py-8 text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-2xl">
                                No hay ubicaciones registradas. Agrega una para comenzar.
                            </div>
                        ) : (
                            locations.map(loc => {
                                const stockQty = getStockCountForLocation(loc.name);
                                const isSelected = editingId === loc.id;
                                return (
                                    <div
                                        key={loc.id}
                                        className={`rounded-xl border p-3.5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                                            isSelected
                                                ? 'border-blue-400 bg-blue-50/40 ring-1 ring-blue-400'
                                                : 'border-gray-200 bg-white hover:border-gray-300'
                                        }`}
                                    >
                                        <div className="space-y-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-bold text-gray-900 text-sm flex items-center gap-1.5">
                                                    <MapPin className="w-4 h-4 text-blue-500" />
                                                    {loc.name}
                                                </span>
                                                {loc.isDefault && (
                                                    <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                        <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
                                                        Predeterminada
                                                    </span>
                                                )}
                                                <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                                                    <Package className="w-3 h-3 text-gray-400" />
                                                    {stockQty} en stock
                                                </span>
                                            </div>

                                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                                                {loc.whatsapp && (
                                                    <span className="flex items-center gap-1 text-emerald-600 font-mono text-[11px]">
                                                        <MessageCircle className="w-3 h-3 text-emerald-500" />
                                                        WA: {loc.whatsapp}
                                                    </span>
                                                )}
                                                {loc.phone && (
                                                    <span className="flex items-center gap-1 text-gray-600 text-[11px]">
                                                        <Phone className="w-3 h-3 text-gray-400" />
                                                        {loc.phone}
                                                    </span>
                                                )}
                                                {loc.address && (
                                                    <span className="text-gray-500 truncate max-w-xs text-[11px]">
                                                        🏠 {loc.address}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                                            <button
                                                type="button"
                                                onClick={() => handleStartEdit(loc)}
                                                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                title="Editar ubicación"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(loc)}
                                                className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                                title="Eliminar ubicación"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-gray-100 bg-gray-50/50 flex justify-between items-center text-xs text-gray-500">
                    <span>Las ubicaciones se usan automáticamente al agregar o editar productos.</span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-900 hover:bg-black text-white font-bold rounded-xl transition-colors"
                    >
                        Listo
                    </button>
                </div>
            </div>
        </div>
    );
}
