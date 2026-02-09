import { useState, useEffect } from 'react';
import type { Item, ItemStatus } from '../types';
import { itemService } from '../services/itemService';
import { Plus, Trash2, TrendingUp, DollarSign, Package, ArrowUpRight, ArrowDownRight, Edit2, Box, History, Save } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

type Tab = 'dashboard' | 'inventory';

export default function Dashboard() {
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [activeTab, setActiveTab] = useState<Tab>('dashboard');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Item | null>(null);

    // Form State
    const [formData, setFormData] = useState<Partial<Item>>({
        productName: '',
        purchasePrice: 0,
        salePrice: 0,
        quantity: 1,
        status: 'in_stock',
        date: new Date().toISOString().split('T')[0]
    });

    useEffect(() => {
        loadItems();
    }, []);

    const loadItems = async () => {
        try {
            setLoading(true);
            const dbItems = await itemService.getItems();

            // Auto-migration logic: If DB is empty but we have local data, migrate it
            if (dbItems.length === 0) {
                const localItems = localStorage.getItem('items_v1');
                if (localItems) {
                    try {
                        const parsedLocal = JSON.parse(localItems);
                        if (Array.isArray(parsedLocal) && parsedLocal.length > 0) {
                            console.log('Migrating local data to Supabase...');
                            const migratedItems = [];
                            for (const item of parsedLocal) {
                                // Remove ID to let DB generate a real UUID (or keep if valid UUID)
                                // We'll let DB generate new IDs to be safe
                                const { id, ...rest } = item;
                                const saved = await itemService.createItem({
                                    ...rest,
                                    date: rest.date || new Date().toISOString(), // Ensure date exists
                                    status: rest.status as ItemStatus
                                });
                                migratedItems.push(saved);
                            }
                            setItems(migratedItems);
                            // Optional: clear local storage or mark migrated
                            // localStorage.removeItem('items_v1'); 
                            setLoading(false);
                            return;
                        }
                    } catch (e) {
                        console.error('Migration failed', e);
                    }
                }
            }

            setItems(dbItems);
        } catch (err: any) {
            console.error('Error loading items:', err);
            setError('Error al cargar datos. Verifica tu conexión o configuración.');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveItem = async (e: React.FormEvent) => {
        e.preventDefault();

        const getISODate = (dateStr: string) => {
            if (!dateStr) return new Date().toISOString();
            return new Date(dateStr).toISOString();
        };

        try {
            if (editingItem) {
                // Update existing item
                const status = formData.status as ItemStatus;
                const formDateISO = formData.date ? getISODate(formData.date) : editingItem.date;

                // Calculate saleDate
                let saleDate = editingItem.saleDate;
                if (status === 'sold') {
                    saleDate = formDateISO;
                } else {
                    saleDate = undefined;
                }

                const updates = {
                    ...formData,
                    date: formDateISO,
                    saleDate: saleDate,
                    status
                };

                // Optimistic UI update
                const updatedItem = { ...editingItem, ...updates } as Item;
                setItems(items.map(i => i.id === editingItem.id ? updatedItem : i));

                // DB Update
                await itemService.updateItem(editingItem.id, updates);

                // Refresh to ensure consistency (optional)
                // loadItems(); 

                setEditingItem(null);
            } else {
                // Create new item
                const newItemData = {
                    productName: formData.productName || 'Producto sin nombre',
                    purchasePrice: Number(formData.purchasePrice) || 0,
                    salePrice: Number(formData.salePrice) || 0,
                    quantity: Number(formData.quantity) || 1,
                    date: formData.date ? getISODate(formData.date) : new Date().toISOString(),
                    status: formData.status as ItemStatus,
                    saleDate: formData.status === 'sold' ? (formData.date ? getISODate(formData.date) : new Date().toISOString()) : undefined
                };

                // Optimistic UI update (temporary ID)
                const tempId = crypto.randomUUID();
                const tempItem = { id: tempId, ...newItemData } as Item;
                setItems([tempItem, ...items]);

                // DB Insert
                const savedItem = await itemService.createItem(newItemData);

                // Replace temp item with real one
                setItems(prev => prev.map(i => i.id === tempId ? savedItem : i));
            }
            setIsModalOpen(false);
            resetForm();
        } catch (err) {
            console.error('Error saving item:', err);
            alert('Error al guardar. Intenta nuevamente.');
            // Revert optimistic update ideally
            loadItems();
        }
    };

    const handleDeleteItem = async (id: string) => {
        if (confirm('¿Estás seguro de eliminar este registro?')) {
            try {
                // Optimistic UI
                setItems(items.filter(i => i.id !== id));
                await itemService.deleteItem(id);
            } catch (err) {
                console.error('Error deleting:', err);
                alert('Error al eliminar.');
                loadItems();
            }
        }
    };



    const startEdit = (item: Item) => {
        setEditingItem(item);
        setFormData({
            ...item,
            date: item.saleDate ? item.saleDate.split('T')[0] : item.date.split('T')[0]
        });
        setIsModalOpen(true);
    };

    const resetForm = () => {
        setFormData({
            productName: '',
            purchasePrice: 0,
            salePrice: 0,
            quantity: 1,
            status: 'in_stock',
            date: new Date().toISOString().split('T')[0]
        });
        setEditingItem(null);
    };

    const openNewModal = (initialStatus: ItemStatus = 'in_stock') => {
        resetForm();
        setFormData(prev => ({ ...prev, status: initialStatus }));
        setIsModalOpen(true);
    };

    // Metrics Calculations
    const soldItems = items.filter(i => i.status === 'sold');
    const stockItems = items.filter(i => i.status === 'in_stock');

    const totalSales = soldItems.reduce((acc, item) => acc + ((item.salePrice || 0) * item.quantity), 0);
    const totalCostSold = soldItems.reduce((acc, item) => acc + (item.purchasePrice * item.quantity), 0);
    const totalProfit = totalSales - totalCostSold;
    const totalUnitsSold = soldItems.reduce((acc, item) => acc + item.quantity, 0);
    const profitMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

    // Stock value (potential revenue or sunk cost)
    const totalStockValue = stockItems.reduce((acc, item) => acc + (item.purchasePrice * item.quantity), 0);

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-black"></div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center p-6 bg-white rounded-2xl shadow-xl max-w-md">
                    <h2 className="text-xl font-bold text-red-600 mb-2">Error de Conexión</h2>
                    <p className="text-gray-600 mb-4">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-800 transition-colors"
                    >
                        Reintentar
                    </button>
                    <div className="mt-4 text-xs text-gray-400">
                        Asegúrate de haber configurado el archivo .env y creado la tabla en Supabase.
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50/50 p-6 md:p-12 font-sans text-gray-900">
            <div className="max-w-7xl mx-auto space-y-8">

                {/* Header & Tabs */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div>
                        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900">Control de Ventas</h1>
                        <p className="text-gray-500 mt-2 text-lg">Gestiona tu stock, ventas y ganancias en un solo lugar.</p>
                    </div>

                    <div className="flex bg-white p-1 rounded-xl shadow-sm border border-gray-200">
                        <button
                            onClick={() => setActiveTab('dashboard')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            <div className="flex items-center gap-2">
                                <TrendingUp className="w-4 h-4" />
                                Resumen
                            </div>
                        </button>
                        <button
                            onClick={() => setActiveTab('inventory')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'inventory' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            <div className="flex items-center gap-2">
                                <Box className="w-4 h-4" />
                                Inventario ({stockItems.length})
                            </div>
                        </button>
                    </div>
                </div>

                {/* Main Content Area */}
                {activeTab === 'dashboard' ? (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* Metrics Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                            <MetricCard
                                title="Ganancia Neta"
                                value={`$${totalProfit.toLocaleString()}`}
                                icon={<TrendingUp className="w-6 h-6 text-emerald-600" />}
                                trend={profitMargin > 0 ? `+${profitMargin.toFixed(1)}% margen` : '0% margen'}
                                trendColor="text-emerald-600"
                                bgColor="bg-white"
                            />
                            <MetricCard
                                title="Ingresos Totales"
                                value={`$${totalSales.toLocaleString()}`}
                                icon={<DollarSign className="w-6 h-6 text-blue-600" />}
                                bgColor="bg-white"
                            />
                            <MetricCard
                                title="Unidades Vendidas"
                                value={totalUnitsSold.toString()}
                                icon={<Package className="w-6 h-6 text-violet-600" />}
                                bgColor="bg-white"
                            />
                            <MetricCard
                                title="Valor en Stock"
                                value={`$${totalStockValue.toLocaleString()}`}
                                icon={<Box className="w-6 h-6 text-orange-600" />}
                                bgColor="bg-white"
                            />
                        </div>

                        {/* Charts */}
                        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-xl font-bold text-gray-800">Tendencia de Ganancias</h2>
                            </div>
                            <div className="h-[300px] w-full">
                                <ProfitChart items={soldItems} />
                            </div>
                        </div>

                        {/* Recent Sales Table */}
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/30">
                                <div className="flex items-center gap-2">
                                    <History className="w-5 h-5 text-gray-500" />
                                    <h2 className="text-xl font-bold text-gray-800">Historial de Ventas</h2>
                                </div>
                                <button
                                    onClick={() => openNewModal('sold')}
                                    className="bg-black hover:bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-sm"
                                >
                                    <Plus className="w-4 h-4" />
                                    Nueva Venta Directa
                                </button>
                            </div>
                            <SalesTable items={soldItems} onEdit={startEdit} onDelete={handleDeleteItem} />
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* Inventory Header */}
                        <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                            <div>
                                <h2 className="text-xl font-bold text-gray-800">Inventario Actual</h2>
                                <p className="text-gray-500 text-sm">Productos disponibles para la venta.</p>
                            </div>
                            <button
                                onClick={() => openNewModal('in_stock')}
                                className="bg-black hover:bg-gray-800 text-white px-6 py-3 rounded-xl flex items-center shadow-lg transition-all transform hover:scale-[1.02] active:scale-95 font-medium"
                            >
                                <Plus className="w-5 h-5 mr-2" />
                                Agregar Producto
                            </button>
                        </div>

                        {/* Inventory List */}
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <InventoryTable items={stockItems} onEdit={startEdit} onDelete={handleDeleteItem} onSell={(item) => {
                                setEditingItem(item);
                                setFormData({
                                    ...item,
                                    status: 'sold',
                                    salePrice: item.salePrice || item.purchasePrice * 1.5, // Suggest a markup
                                    date: new Date().toISOString().split('T')[0]
                                });
                                setIsModalOpen(true);
                            }} />
                        </div>
                    </div>
                )}
            </div>

            {/* Modal Overlay */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm transition-opacity">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100 ring-1 ring-black/5 animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                            <div>
                                <h2 className="text-xl font-bold text-gray-800">
                                    {editingItem ? (formData.status === 'sold' && editingItem.status === 'in_stock' ? 'Registrar Venta de Stock' : 'Editar Registro') : 'Nuevo Registro'}
                                </h2>
                                <p className="text-sm text-gray-500 mt-1">
                                    {formData.status === 'in_stock' ? 'Añadir al inventario' : 'Registrar una venta realizada'}
                                </p>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                                <span className="text-2xl">&times;</span>
                            </button>
                        </div>

                        <ProductForm
                            formData={formData}
                            setFormData={setFormData}
                            onSubmit={handleSaveItem}
                            onCancel={() => setIsModalOpen(false)}
                            isEditing={!!editingItem}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

// Subcomponents

function SalesTable({ items, onEdit, onDelete }: { items: Item[], onEdit: (i: Item) => void, onDelete: (id: string) => void }) {
    if (items.length === 0) {
        return <div className="p-12 text-center text-gray-400">No hay ventas registradas aún.</div>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
                <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs tracking-wider">
                    <tr>
                        <th className="px-6 py-4">Producto</th>
                        <th className="px-6 py-4 text-center">Unidades</th>
                        <th className="px-6 py-4 text-right">Compra (Unit)</th>
                        <th className="px-6 py-4 text-right">Venta (Unit)</th>
                        <th className="px-6 py-4 text-right">Ganancia</th>
                        <th className="px-6 py-4 text-center">Fecha Venta</th>
                        <th className="px-6 py-4 text-center">Acciones</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {items.map((item) => {
                        const profit = ((item.salePrice || 0) * item.quantity) - (item.purchasePrice * item.quantity);
                        const isPositive = profit >= 0;
                        return (
                            <tr key={item.id} className="hover:bg-gray-50/50 transition-colors group">
                                <td className="px-6 py-4 font-medium text-gray-900">{item.productName}</td>
                                <td className="px-6 py-4 text-center">
                                    <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-md text-xs font-semibold">{item.quantity}</span>
                                </td>
                                <td className="px-6 py-4 text-right font-mono text-gray-500">${item.purchasePrice.toLocaleString()}</td>
                                <td className="px-6 py-4 text-right font-mono font-medium text-gray-900">${item.salePrice?.toLocaleString()}</td>
                                <td className={`px-6 py-4 text-right font-bold w-32 ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                                    <div className="flex items-center justify-end gap-1">
                                        {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                        ${Math.abs(profit).toLocaleString()}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-center text-gray-400 text-xs">
                                    {item.saleDate ? new Date(item.saleDate).toLocaleDateString() : '-'}
                                </td>
                                <td className="px-6 py-4 text-center">
                                    <div className="flex justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={() => onEdit(item)}
                                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                            title="Editar"
                                        >
                                            <Edit2 className="w-4 h-4" />
                                        </button>
                                        <button
                                            onClick={() => onDelete(item.id)}
                                            className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                            title="Eliminar"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function InventoryTable({ items, onEdit, onDelete, onSell }: { items: Item[], onEdit: (i: Item) => void, onDelete: (id: string) => void, onSell: (i: Item) => void }) {
    if (items.length === 0) {
        return <div className="p-12 text-center text-gray-400">Tu inventario está vacío. Agrega productos para comenzar.</div>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-600">
                <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs tracking-wider">
                    <tr>
                        <th className="px-6 py-4">Producto</th>
                        <th className="px-6 py-4 text-center">Stock</th>
                        <th className="px-6 py-4 text-right">Costo Unit.</th>
                        <th className="px-6 py-4 text-right">Valor Total</th>
                        <th className="px-6 py-4 text-center">Fecha Ingreso</th>
                        <th className="px-6 py-4 text-center">Acciones</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {items.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50/50 transition-colors group">
                            <td className="px-6 py-4 font-medium text-gray-900">{item.productName}</td>
                            <td className="px-6 py-4 text-center">
                                <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-md text-xs font-semibold">{item.quantity}</span>
                            </td>
                            <td className="px-6 py-4 text-right font-mono">${item.purchasePrice.toLocaleString()}</td>
                            <td className="px-6 py-4 text-right font-mono font-medium text-gray-900">${(item.purchasePrice * item.quantity).toLocaleString()}</td>
                            <td className="px-6 py-4 text-center text-gray-400 text-xs">
                                {new Date(item.date).toLocaleDateString()}
                            </td>
                            <td className="px-6 py-4 text-center">
                                <div className="flex justify-center items-center gap-2">
                                    <button
                                        onClick={() => onSell(item)}
                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1"
                                    >
                                        <DollarSign className="w-3 h-3" />
                                        Vender
                                    </button>
                                    <div className="w-px h-4 bg-gray-200 mx-1"></div>
                                    <button
                                        onClick={() => onEdit(item)}
                                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                        title="Editar"
                                    >
                                        <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button
                                        onClick={() => onDelete(item.id)}
                                        className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                        title="Eliminar"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function ProductForm({ formData, setFormData, onSubmit, onCancel, isEditing }: {
    formData: Partial<Item>,
    setFormData: React.Dispatch<React.SetStateAction<Partial<Item>>>,
    onSubmit: (e: React.FormEvent) => void,
    onCancel: () => void,
    isEditing: boolean
}) {
    const [url, setUrl] = useState('');

    const handleUrlBlur = () => {
        if (!url) return;
        // Same extraction logic as before
        let extractedName = '';
        try {
            const urlObj = new URL(url);
            if (urlObj.hostname.includes('mercadolibre')) {
                const parts = urlObj.pathname.split('-');
                const idIndex = parts.findIndex(p => p.startsWith('MLA') || p.startsWith('MCO') || p.startsWith('MLM'));
                if (idIndex !== -1 && idIndex + 1 < parts.length) {
                    let titleParts = parts.slice(idIndex + 1);
                    if (titleParts.length > 0) {
                        const lastPart = titleParts[titleParts.length - 1];
                        if (lastPart.includes('_')) {
                            titleParts[titleParts.length - 1] = lastPart.split('_')[0];
                        }
                        extractedName = titleParts.join(' ');
                    }
                } else {
                    const possibleName = urlObj.pathname.split('/').pop()?.split('_')[0].replaceAll('-', ' ');
                    if (possibleName) extractedName = possibleName;
                }
            } else if (urlObj.hostname.includes('temu')) {
                const path = urlObj.pathname;
                if (path.includes('goods')) {
                    const namePart = path.split('goods-')[1]?.split('-g-')[0];
                    if (namePart) extractedName = namePart.replaceAll('-', ' ');
                }
            } else {
                const pathSegments = urlObj.pathname.split('/').filter(Boolean);
                if (pathSegments.length > 0) {
                    const lastSegment = pathSegments[pathSegments.length - 1];
                    extractedName = lastSegment.split('.')[0].replace(/-/g, ' ');
                }
            }

            if (extractedName) {
                extractedName = extractedName.replace(/\w\S*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase())));
                setFormData(prev => ({ ...prev, productName: decodeURIComponent(extractedName) }));
            }
        } catch (e) {
            console.error("Error parsing URL", e);
        }
    };

    return (
        <form onSubmit={onSubmit} className="p-6 space-y-5">
            {/* Context Toggle */}
            <div className="flex bg-gray-100 p-1 rounded-lg mb-4">
                <button
                    type="button"
                    onClick={() => setFormData({ ...formData, status: 'in_stock' })}
                    className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${formData.status === 'in_stock' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                >
                    Stock
                </button>
                <button
                    type="button"
                    onClick={() => setFormData({ ...formData, status: 'sold' })}
                    className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${formData.status === 'sold' ? 'bg-emerald-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                >
                    Venta Directa
                </button>
            </div>

            {!isEditing && (
                <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100 mb-2">
                    <label className="block text-[10px] font-bold text-blue-700 mb-1 uppercase tracking-wider">Auto-completar desde URL</label>
                    <input
                        type="url"
                        placeholder="Pega links de MercadoLibre o Temu..."
                        className="w-full px-3 py-1.5 text-sm rounded-lg border border-blue-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all bg-white"
                        value={url}
                        onChange={e => setUrl(e.target.value)}
                        onBlur={handleUrlBlur}
                    />
                </div>
            )}

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Producto</label>
                <input
                    type="text"
                    required
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white"
                    value={formData.productName}
                    onChange={e => setFormData({ ...formData, productName: e.target.value })}
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Costo ($)</label>
                    <input
                        type="number"
                        required
                        min="0"
                        step="0.01"
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white"
                        value={formData.purchasePrice || ''}
                        onChange={e => setFormData({ ...formData, purchasePrice: parseFloat(e.target.value) || 0 })}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        {formData.status === 'sold' ? 'Precio Venta ($)' : 'Precio Objetivo ($)'}
                    </label>
                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        className={`w-full px-4 py-2 rounded-xl border border-gray-200 outline-none transition-all bg-gray-50 focus:bg-white ${formData.status === 'sold' ? 'focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-bold text-emerald-700' : 'focus:border-black focus:ring-1 focus:ring-black'}`}
                        value={formData.salePrice || ''}
                        onChange={e => setFormData({ ...formData, salePrice: parseFloat(e.target.value) || 0 })}
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cantidad</label>
                    <input
                        type="number"
                        required
                        min="1"
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white"
                        value={formData.quantity}
                        onChange={e => setFormData({ ...formData, quantity: parseInt(e.target.value) || 1 })}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Fecha</label>
                    <input
                        type="date"
                        required
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white text-gray-600"
                        value={formData.date}
                        onChange={e => setFormData({ ...formData, date: e.target.value })}
                    />
                </div>
            </div>

            <div className="pt-4 flex gap-3">
                <button
                    type="button"
                    onClick={onCancel}
                    className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 font-medium transition-colors"
                >
                    Cancelar
                </button>
                <button
                    type="submit"
                    className={`flex-1 px-4 py-3 rounded-xl text-white font-medium shadow-lg transition-all transform active:scale-95 flex justify-center items-center gap-2 ${formData.status === 'sold' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200' : 'bg-black hover:bg-gray-800 shadow-gray-200'}`}
                >
                    <Save className="w-4 h-4" />
                    {isEditing ? 'Guardar Cambios' : (formData.status === 'sold' ? 'Registrar Venta' : 'Guardar en Stock')}
                </button>
            </div>
        </form>
    );
}

function MetricCard({ title, value, icon, trend, trendColor, bgColor }: { title: string, value: string, icon: React.ReactNode, trend?: string, trendColor?: string, bgColor: string }) {
    return (
        <div className={`${bgColor} p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md`}>
            <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-gray-50 rounded-xl">
                    {icon}
                </div>
                {trend && (
                    <span className={`text-xs font-semibold px-2 py-1 rounded-lg bg-opacity-10 ${trendColor?.replace('text-', 'bg-')} ${trendColor}`}>
                        {trend}
                    </span>
                )}
            </div>
            <div>
                <p className="text-gray-500 text-sm font-medium mb-1">{title}</p>
                <h3 className="text-2xl font-bold text-gray-900 tracking-tight">{value}</h3>
            </div>
        </div>
    );
}

function ProfitChart({ items }: { items: Item[] }) {
    // Group by Date 
    const dataMap = new Map<string, number>();

    // Sort items by date first
    // Use saleDate for profit charting, or generic date if saleDate missing (fallback)
    const sortedItems = [...items].sort((a, b) => new Date(a.saleDate || a.date).getTime() - new Date(b.saleDate || b.date).getTime());

    sortedItems.forEach(item => {
        const dateKey = item.saleDate || item.date;
        const date = new Date(dateKey).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
        const profit = ((item.salePrice || 0) - item.purchasePrice) * item.quantity;
        dataMap.set(date, (dataMap.get(date) || 0) + profit);
    });

    const data = Array.from(dataMap.entries()).map(([date, profit]) => ({
        date,
        profit
    }));

    if (data.length === 0) {
        return <div className="h-full w-full flex items-center justify-center text-gray-400">Sin datos suficientes para graficar</div>;
    }

    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart
                data={data}
                margin={{
                    top: 10,
                    right: 30,
                    left: 0,
                    bottom: 0,
                }}
            >
                <defs>
                    <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#9ca3af', fontSize: 12 }}
                    dy={10}
                />
                <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#9ca3af', fontSize: 12 }}
                    tickFormatter={(value) => `$${value}`}
                />
                <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                    cursor={{ stroke: '#10b981', strokeWidth: 2 }}
                />
                <Area
                    type="monotone"
                    dataKey="profit"
                    stroke="#10b981"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorProfit)"
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}
