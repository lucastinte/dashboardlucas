import { useState, useEffect } from 'react';
import type { Item, ItemCondition, ItemStatus } from '../types';
import { itemService } from '../services/itemService';
import { Plus, Trash2, TrendingUp, DollarSign, Package, ArrowUpRight, ArrowDownRight, Edit2, Box, History, Save, Moon, Sun } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

type Tab = 'dashboard' | 'inventory' | 'pricing';

type PricingItem = {
    id: string;
    productName: string;
    quantity: number;
    listedUnitPrice: number;
    unitSalePrice: number;
    condition: ItemCondition;
    disposition: 'sell' | 'keep';
};

type BatchRecord = {
    id: string;
    batchCode: string;
    batchType: 'venta' | 'mixta' | 'retenido';
    createdAt: string;
    totalPaid: number;
    totalSellRevenue: number;
    cashProfit: number;
    retainedValue: number;
    itemsCount: number;
    items: PricingItem[];
};

const conditionLabelMap: Record<ItemCondition, string> = {
    nuevo: 'Nuevo',
    semi_uso: 'Semi uso',
    usado: 'Usado'
};

const getBatchLabel = (batchRef?: string) => {
    if (!batchRef) return 'Sin tanda';
    const digits = batchRef.match(/\d+/)?.[0];
    if (!digits) return batchRef;
    return `N° ${Number(digits)}`;
};

const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

const reconcileItemBatchMap = (inventoryItems: Item[], currentMap: Record<string, string>) => {
    if (inventoryItems.length === 0) return null;

    let parsedHistory: Array<Partial<BatchRecord>> = [];
    try {
        const raw = localStorage.getItem('pricing_batch_history_v1');
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        parsedHistory = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Error reading batch history for reconciliation', error);
        return null;
    }

    const history = parsedHistory
        .filter((record) => typeof record?.batchCode === 'string' && record.batchCode)
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    if (history.length === 0) return null;

    const nextMap = { ...currentMap };
    const usedIds = new Set<string>();
    let changed = false;

    const unassigned = inventoryItems.filter((item) => {
        const alreadyTagged = item.batchRef || nextMap[item.id];
        return item.status === 'in_stock' && !alreadyTagged;
    });

    for (const record of history) {
        const batchCode = record.batchCode as string;
        const recordDate = new Date(record.createdAt || Date.now()).getTime();
        const recordItems = (Array.isArray(record.items) ? record.items : [])
            .map((entry) => ({
                productName: entry?.productName || '',
                quantity: Number(entry?.quantity) || 1,
                unitSalePrice: Number(entry?.unitSalePrice) || 0,
                condition: (entry?.condition as ItemCondition) || 'nuevo',
                disposition: (entry?.disposition as 'sell' | 'keep') || 'sell'
            }))
            .filter((entry) => entry.disposition !== 'keep' && entry.productName);

        for (const recordItem of recordItems) {
            const candidates = unassigned
                .filter((item) => !usedIds.has(item.id))
                .filter((item) => normalizeText(item.productName) === normalizeText(recordItem.productName))
                .filter((item) => (item.condition || 'nuevo') === recordItem.condition);

            if (candidates.length === 0) continue;

            const bestMatch = [...candidates].sort((a, b) => {
                const aSaleMatch = Math.round(a.salePrice || 0) === Math.round(recordItem.unitSalePrice || 0) ? 1 : 0;
                const bSaleMatch = Math.round(b.salePrice || 0) === Math.round(recordItem.unitSalePrice || 0) ? 1 : 0;
                if (aSaleMatch !== bSaleMatch) return bSaleMatch - aSaleMatch;

                const aQtyDistance = Math.abs((a.quantity || 0) - recordItem.quantity);
                const bQtyDistance = Math.abs((b.quantity || 0) - recordItem.quantity);
                if (aQtyDistance !== bQtyDistance) return aQtyDistance - bQtyDistance;

                const aDateDistance = Math.abs(new Date(a.date).getTime() - recordDate);
                const bDateDistance = Math.abs(new Date(b.date).getTime() - recordDate);
                return aDateDistance - bDateDistance;
            })[0];

            if (!bestMatch) continue;
            nextMap[bestMatch.id] = batchCode;
            usedIds.add(bestMatch.id);
            changed = true;
        }
    }

    return changed ? nextMap : null;
};

export default function Dashboard() {
    const [items, setItems] = useState<Item[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [activeTab, setActiveTab] = useState<Tab>('dashboard');
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        const saved = localStorage.getItem('dashboard_theme');
        return saved === 'dark' ? 'dark' : 'light';
    });
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<Item | null>(null);
    const [batchTotalPaid, setBatchTotalPaid] = useState(0);
    const [batchItems, setBatchItems] = useState<PricingItem[]>([]);
    const [itemBatchMap, setItemBatchMap] = useState<Record<string, string>>({});
    const [hasLocalData, setHasLocalData] = useState(false);
    const [hasLocalHistory, setHasLocalHistory] = useState(false);
    const getItemBatchRef = (item: Item) => item.batchRef || itemBatchMap[item.id];

    // Form State
    const [formData, setFormData] = useState<Partial<Item>>({
        productName: '',
        purchasePrice: 0,
        salePrice: 0,
        quantity: 1,
        status: 'in_stock',
        condition: 'nuevo',
        date: new Date().toISOString().split('T')[0]
    });

    useEffect(() => {
        loadItems();
        checkLocalData();
    }, []);

    const checkLocalData = () => {
        const local = localStorage.getItem('items_v1');
        const history = localStorage.getItem('pricing_batch_history_v1');

        if (local) {
            try {
                const parsed = JSON.parse(local);
                if (Array.isArray(parsed) && parsed.length > 0) setHasLocalData(true);
            } catch (e) { }
        }

        if (history) {
            try {
                const parsed = JSON.parse(history);
                if (Array.isArray(parsed) && parsed.length > 0) setHasLocalHistory(true);
            } catch (e) { }
        }
    };

    useEffect(() => {
        try {
            const saved = localStorage.getItem('pricing_batch_v1');
            if (!saved) return;
            const parsed = JSON.parse(saved) as { totalPaid?: number; items?: PricingItem[] };
            setBatchTotalPaid(Number(parsed.totalPaid || 0));
            setBatchItems(Array.isArray(parsed.items) ? parsed.items : []);
        } catch (error) {
            console.error('Error loading pricing batch', error);
        }
    }, []);

    useEffect(() => {
        try {
            const raw = localStorage.getItem('item_batch_map_v1');
            if (!raw) return;
            const parsed = JSON.parse(raw) as Record<string, string>;
            setItemBatchMap(parsed && typeof parsed === 'object' ? parsed : {});
        } catch (error) {
            console.error('Error loading item batch map', error);
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('pricing_batch_v1', JSON.stringify({
            totalPaid: batchTotalPaid,
            items: batchItems
        }));
    }, [batchTotalPaid, batchItems]);

    useEffect(() => {
        localStorage.setItem('item_batch_map_v1', JSON.stringify(itemBatchMap));
    }, [itemBatchMap]);

    useEffect(() => {
        setItemBatchMap((prev) => {
            const reconciled = reconcileItemBatchMap(items, prev);
            return reconciled || prev;
        });
    }, [items]);

    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle('dark', theme === 'dark');
        root.style.colorScheme = theme;
        localStorage.setItem('dashboard_theme', theme);
    }, [theme]);

    const handleMigrateLocalData = async () => {
        const localItemsResource = localStorage.getItem('items_v1');
        const localHistoryResource = localStorage.getItem('pricing_batch_history_v1');

        try {
            setLoading(true);

            // 1. Migrar Items
            if (localItemsResource) {
                const parsedLocal = JSON.parse(localItemsResource);
                if (Array.isArray(parsedLocal) && parsedLocal.length > 0) {
                    const itemsToMigrate = parsedLocal.map((item: any) => ({
                        productName: item.productName || 'Producto',
                        purchasePrice: Number(item.purchasePrice) || 0,
                        salePrice: item.salePrice ? Number(item.salePrice) : undefined,
                        quantity: Number(item.quantity) || 1,
                        date: item.date || new Date().toISOString(),
                        saleDate: item.saleDate || undefined,
                        status: (item.status as ItemStatus) || 'in_stock',
                        condition: (item.condition as ItemCondition) || 'nuevo',
                        batchRef: item.batchRef || undefined
                    }));
                    await itemService.createItems(itemsToMigrate);
                    localStorage.setItem('items_v1_migrated', localItemsResource);
                    localStorage.removeItem('items_v1');
                }
            }

            // 2. Migrar Historial de Tandas (T-001, T-002, etc.)
            if (localHistoryResource) {
                const parsedHistory = JSON.parse(localHistoryResource);
                if (Array.isArray(parsedHistory) && parsedHistory.length > 0) {
                    for (const batch of parsedHistory) {
                        await itemService.createBatch(batch);
                    }
                    localStorage.setItem('pricing_batch_history_v1_migrated', localHistoryResource);
                    localStorage.removeItem('pricing_batch_history_v1');
                }
            }

            setHasLocalData(false);
            setHasLocalHistory(false);
            alert('¡Sincronización completa con Supabase!');
            window.location.reload();
        } catch (err) {
            console.error('Migration error:', err);
            alert('Error al migrar los datos. Revisa la conexión con Supabase.');
        } finally {
            setLoading(false);
        }
    };

    const loadItems = async () => {
        try {
            setLoading(true);
            const dbItems = await itemService.getItems();
            let finalItems = dbItems;
            let finalBatchesExist = false;

            try {
                const dbBatches = await itemService.getBatches();
                finalBatchesExist = dbBatches.length > 0;
            } catch (e) {
                console.error("Batches table might not be ready", e);
            }

            // Auto-migration items
            if (dbItems.length === 0) {
                const localItems = localStorage.getItem('items_v1');
                if (localItems) {
                    try {
                        const parsedLocal = JSON.parse(localItems);
                        if (Array.isArray(parsedLocal) && parsedLocal.length > 0) {
                            console.log('Migrando items locales...');
                            const itemsToMigrate = parsedLocal.map((item: any) => ({
                                productName: item.productName || 'Producto',
                                purchasePrice: Number(item.purchasePrice) || 0,
                                salePrice: item.salePrice ? Number(item.salePrice) : undefined,
                                quantity: Number(item.quantity) || 1,
                                date: item.date || new Date().toISOString(),
                                saleDate: item.saleDate || undefined,
                                status: (item.status as ItemStatus) || 'in_stock',
                                condition: (item.condition as ItemCondition) || 'nuevo',
                                batchRef: item.batchRef || undefined
                            }));
                            await itemService.createItems(itemsToMigrate);
                            localStorage.setItem('items_v1_migrated', localItems);
                            localStorage.removeItem('items_v1');
                            finalItems = await itemService.getItems();
                        }
                    } catch (e) {
                        console.error('Auto-migration items failed', e);
                    }
                }
            }

            // Auto-migration batches (Tandas)
            if (!finalBatchesExist) {
                const localHistory = localStorage.getItem('pricing_batch_history_v1');
                if (localHistory) {
                    try {
                        const parsedHistory = JSON.parse(localHistory);
                        if (Array.isArray(parsedHistory) && parsedHistory.length > 0) {
                            console.log('Migrando historial de tandas...');
                            for (const batch of parsedHistory) {
                                await itemService.createBatch(batch);
                            }
                            localStorage.setItem('pricing_batch_history_v1_migrated', localHistory);
                            localStorage.removeItem('pricing_batch_history_v1');
                        }
                    } catch (e) {
                        console.error('Auto-migration batches failed', e);
                    }
                }
            }

            setItems(finalItems);
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
                const status = formData.status as ItemStatus;
                const condition = (formData.condition as ItemCondition) || editingItem.condition || 'nuevo';
                const formDateISO = formData.date ? getISODate(formData.date) : editingItem.date;
                const quantity = Math.max(1, Math.floor(Number(formData.quantity) || editingItem.quantity));

                // Selling from stock creates a sold record and discounts stock.
                if (editingItem.status === 'in_stock' && status === 'sold') {
                    if (quantity > editingItem.quantity) {
                        alert(`No puedes vender ${quantity}. Solo tienes ${editingItem.quantity} en stock.`);
                        return;
                    }

                    const unitSalePrice = Number(formData.salePrice) || Number(editingItem.salePrice) || editingItem.purchasePrice;

                    await itemService.createItem({
                        productName: editingItem.productName,
                        purchasePrice: editingItem.purchasePrice,
                        salePrice: unitSalePrice,
                        quantity,
                        date: editingItem.date,
                        status: 'sold',
                        condition: editingItem.condition,
                        batchRef: editingItem.batchRef,
                        saleDate: formDateISO
                    });

                    const remaining = editingItem.quantity - quantity;
                    if (remaining > 0) {
                        await itemService.updateItem(editingItem.id, { quantity: remaining });
                    } else {
                        await itemService.deleteItem(editingItem.id);
                    }

                    await loadItems();
                    setEditingItem(null);
                    setIsModalOpen(false);
                    resetForm();
                    return;
                }

                // Calculate saleDate
                let saleDate = editingItem.saleDate;
                if (status === 'sold') {
                    saleDate = formDateISO;
                } else {
                    saleDate = undefined;
                }

                // Returning sold item to inventory can merge into existing stock item.
                if (editingItem.status === 'sold' && status === 'in_stock') {
                    const existingStock = items.find(i =>
                        i.id !== editingItem.id &&
                        i.status === 'in_stock' &&
                        i.productName === (formData.productName || editingItem.productName) &&
                        i.purchasePrice === (Number(formData.purchasePrice) || editingItem.purchasePrice) &&
                        i.condition === condition &&
                        getItemBatchRef(i) === editingItem.batchRef
                    );

                    if (existingStock) {
                        await itemService.updateItem(existingStock.id, {
                            quantity: existingStock.quantity + quantity
                        });
                        await itemService.deleteItem(editingItem.id);
                        await loadItems();
                        setEditingItem(null);
                        setIsModalOpen(false);
                        resetForm();
                        return;
                    }
                }

                const updates: Partial<Item> = {
                    productName: formData.productName ?? editingItem.productName,
                    purchasePrice: Number(formData.purchasePrice) || editingItem.purchasePrice,
                    salePrice: formData.salePrice !== undefined ? Number(formData.salePrice) || 0 : editingItem.salePrice,
                    quantity,
                    date: formDateISO,
                    saleDate,
                    status,
                    condition,
                    batchRef: editingItem.batchRef
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
                    condition: (formData.condition as ItemCondition) || 'nuevo',
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
        const resolvedBatchRef = getItemBatchRef(item);
        setEditingItem({ ...item, batchRef: resolvedBatchRef });
        setFormData({
            ...item,
            batchRef: resolvedBatchRef,
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
            condition: 'nuevo',
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
    const soldBatchRefs = Array.from(new Set(soldItems.map(getItemBatchRef).filter(Boolean)));
    const soldDirectCount = soldItems.filter(i => !getItemBatchRef(i)).length;

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
        <div className="dashboard-shell min-h-screen bg-gradient-to-b from-slate-50 via-gray-50 to-white px-3 py-4 sm:px-6 sm:py-6 md:px-10 md:py-10 font-sans text-gray-900">
            <div className="max-w-7xl mx-auto space-y-5 sm:space-y-8">

                {/* Header & Tabs */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 sm:gap-6">
                    <div>
                        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Control de Ventas</h1>
                        <p className="text-gray-500 mt-1.5 sm:mt-2 text-sm sm:text-lg">Gestiona tu stock, ventas y ganancias en un solo lugar.</p>
                    </div>

                    <div className="w-full md:w-auto flex flex-col sm:flex-row gap-2">
                        <div className="grid grid-cols-3 bg-white p-1 rounded-xl shadow-sm border border-gray-200">
                            <button
                                onClick={() => setActiveTab('dashboard')}
                                className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <TrendingUp className="w-4 h-4" />
                                    Resumen
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('inventory')}
                                className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'inventory' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <Box className="w-4 h-4" />
                                    Inventario ({stockItems.length})
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('pricing')}
                                className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'pricing' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <DollarSign className="w-4 h-4" />
                                    Pedidos
                                </div>
                            </button>
                        </div>

                        <button
                            type="button"
                            onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
                            className="h-11 px-4 rounded-xl border border-gray-200 bg-white text-gray-700 hover:text-gray-900 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2 shadow-sm"
                            title={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
                        >
                            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                            <span className="text-sm font-medium">{theme === 'light' ? 'Oscuro' : 'Claro'}</span>
                        </button>
                    </div>
                </div>

                {/* Main Content Area */}
                {activeTab === 'dashboard' ? (
                    <div className="space-y-5 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

                        {/* Migration Banner */}
                        {(hasLocalData || hasLocalHistory) && (
                            <div className="bg-amber-50 border border-amber-200 p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm border-l-4 border-l-amber-500">
                                <div className="flex items-center gap-3">
                                    <div className="bg-amber-100 p-2 rounded-full">
                                        <History className="w-5 h-5 text-amber-600" />
                                    </div>
                                    <div>
                                        <p className="text-amber-900 font-bold text-sm sm:text-base">Datos locales detectados</p>
                                        <p className="text-amber-700 text-xs sm:text-sm">
                                            Se detectó historial de tandas y productos en este navegador.
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleMigrateLocalData}
                                    className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-sm"
                                >
                                    <Save className="w-4 h-4" />
                                    Subir historial a Supabase
                                </button>
                            </div>
                        )}
                        {/* Metrics Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
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
                        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100">
                            <div className="flex justify-between items-center mb-4 sm:mb-6">
                                <h2 className="text-lg sm:text-xl font-bold text-gray-800">Tendencia de Ganancias</h2>
                            </div>
                            <div className="h-[240px] sm:h-[300px] w-full">
                                <ProfitChart items={soldItems} />
                            </div>
                        </div>

                        {/* Recent Sales Table */}
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-4 sm:p-6 border-b border-gray-100 flex flex-col sm:flex-row justify-between sm:items-center gap-3 bg-gray-50/30">
                                <div className="flex items-center gap-2">
                                    <History className="w-5 h-5 text-gray-500" />
                                    <div>
                                        <h2 className="text-lg sm:text-xl font-bold text-gray-800">Historial de Ventas</h2>
                                        <p className="text-xs text-gray-500">Tandas: {soldBatchRefs.length} | Ventas directas: {soldDirectCount}</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => openNewModal('sold')}
                                    className="w-full sm:w-auto bg-black hover:bg-gray-800 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 shadow-sm"
                                >
                                    <Plus className="w-4 h-4" />
                                    Nueva Venta Directa
                                </button>
                            </div>
                            <SalesTable items={soldItems} onEdit={startEdit} onDelete={handleDeleteItem} resolveBatchRef={getItemBatchRef} />
                        </div>
                    </div>
                ) : activeTab === 'inventory' ? (
                    <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* Inventory Header */}
                        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100">
                            <div>
                                <h2 className="text-lg sm:text-xl font-bold text-gray-800">Inventario Actual</h2>
                                <p className="text-gray-500 text-sm">Productos disponibles para la venta.</p>
                            </div>
                            <button
                                onClick={() => openNewModal('in_stock')}
                                className="w-full sm:w-auto bg-black hover:bg-gray-800 text-white px-5 py-3 rounded-xl flex items-center justify-center shadow-lg transition-all transform hover:scale-[1.02] active:scale-95 font-medium"
                            >
                                <Plus className="w-5 h-5 mr-2" />
                                Agregar Producto
                            </button>
                        </div>

                        {/* Inventory List */}
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <InventoryTable items={stockItems} onEdit={startEdit} onDelete={handleDeleteItem} resolveBatchRef={getItemBatchRef} onSell={(item) => {
                                const resolvedBatchRef = getItemBatchRef(item);
                                setEditingItem({ ...item, batchRef: resolvedBatchRef });
                                setFormData({
                                    ...item,
                                    status: 'sold',
                                    quantity: 1,
                                    salePrice: item.salePrice || item.purchasePrice,
                                    condition: item.condition || 'nuevo',
                                    batchRef: resolvedBatchRef,
                                    date: new Date().toISOString().split('T')[0]
                                });
                                setIsModalOpen(true);
                            }} />
                        </div>
                    </div>
                ) : (
                    <BulkPricingBoard
                        totalPaid={batchTotalPaid}
                        setTotalPaid={setBatchTotalPaid}
                        batchItems={batchItems}
                        setBatchItems={setBatchItems}
                        inventoryItems={items}
                        onInventoryRefresh={loadItems}
                        itemBatchMap={itemBatchMap}
                        setItemBatchMap={setItemBatchMap}
                    />
                )}
            </div>

            {/* Modal Overlay */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/30 backdrop-blur-sm transition-opacity">
                    <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] sm:max-h-[88vh] overflow-y-auto transform transition-all scale-100 ring-1 ring-black/5 animate-in zoom-in-95 duration-200">
                        <div className="p-4 sm:p-6 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center sticky top-0 z-10">
                            <div>
                                <h2 className="text-lg sm:text-xl font-bold text-gray-800">
                                    {editingItem
                                        ? (
                                            editingItem.status === 'sold' && formData.status === 'in_stock'
                                                ? 'Volver al Inventario'
                                                : editingItem.status === 'in_stock' && formData.status === 'sold'
                                                    ? 'Registrar Venta de Stock'
                                                    : editingItem.status === 'sold'
                                                        ? 'Editar Venta'
                                                        : 'Editar Stock'
                                        )
                                        : 'Nuevo Registro'}
                                </h2>
                                <p className="text-sm text-gray-500 mt-1">
                                    {formData.status === 'in_stock' ? 'Añadir al inventario' : 'Registrar una venta realizada'}
                                </p>
                            </div>
                            <button onClick={() => setIsModalOpen(false)} className="h-9 w-9 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-gray-600 flex items-center justify-center">
                                <span className="text-2xl leading-none">&times;</span>
                            </button>
                        </div>

                        <ProductForm
                            formData={formData}
                            setFormData={setFormData}
                            onSubmit={handleSaveItem}
                            onCancel={() => setIsModalOpen(false)}
                            isEditing={!!editingItem}
                            editingItemStatus={editingItem?.status}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

// Subcomponents

function SalesTable({ items, onEdit, onDelete, resolveBatchRef }: {
    items: Item[],
    onEdit: (i: Item) => void,
    onDelete: (id: string) => void,
    resolveBatchRef: (item: Item) => string | undefined
}) {
    if (items.length === 0) {
        return <div className="p-8 sm:p-12 text-center text-gray-400">No hay ventas registradas aún.</div>;
    }

    return (
        <>
            <div className="sm:hidden p-3 space-y-3">
                {items.map((item) => {
                    const profit = ((item.salePrice || 0) * item.quantity) - (item.purchasePrice * item.quantity);
                    const isPositive = profit >= 0;

                    return (
                        <div key={item.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                                <h3 className="font-semibold text-gray-900 leading-tight">{item.productName}</h3>
                                <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-md text-xs font-semibold shrink-0">
                                    x{item.quantity}
                                </span>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                                <div>
                                    <p className="text-gray-400 text-xs">Compra</p>
                                    <p className="font-medium text-gray-700">${item.purchasePrice.toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-xs">Venta</p>
                                    <p className="font-medium text-gray-900">${item.salePrice?.toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-xs">Ganancia</p>
                                    <p className={`font-bold flex items-center gap-1 ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                        ${Math.abs(profit).toLocaleString()}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-xs">Fecha</p>
                                    <p className="font-medium text-gray-700">{item.saleDate ? new Date(item.saleDate).toLocaleDateString() : '-'}</p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-gray-400 text-xs">Estado</p>
                                    <p className="font-medium text-gray-700">{conditionLabelMap[item.condition || 'nuevo']}</p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-gray-400 text-xs">Tanda</p>
                                    <p className="font-medium text-gray-700">{resolveBatchRef(item) || 'Venta directa'}</p>
                                </div>
                            </div>
                            <div className="mt-4 flex gap-2">
                                <button
                                    onClick={() => onEdit(item)}
                                    className="flex-1 h-10 rounded-xl border border-blue-100 bg-blue-50 text-blue-700 text-sm font-medium flex items-center justify-center gap-2"
                                >
                                    <Edit2 className="w-4 h-4" />
                                    Editar
                                </button>
                                <button
                                    onClick={() => onDelete(item.id)}
                                    className="flex-1 h-10 rounded-xl border border-rose-100 bg-rose-50 text-rose-700 text-sm font-medium flex items-center justify-center gap-2"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Eliminar
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-600">
                    <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs tracking-wider">
                        <tr>
                            <th className="px-6 py-4">Producto</th>
                            <th className="px-6 py-4 text-center">Unidades</th>
                            <th className="px-6 py-4 text-right">Compra (Unit)</th>
                            <th className="px-6 py-4 text-right">Venta (Unit)</th>
                            <th className="px-6 py-4 text-right">Ganancia</th>
                            <th className="px-6 py-4 text-center">Estado</th>
                            <th className="px-6 py-4 text-center">Tanda</th>
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
                                    <td className="px-6 py-4 text-center text-xs font-semibold text-gray-700">
                                        {conditionLabelMap[item.condition || 'nuevo']}
                                    </td>
                                    <td className="px-6 py-4 text-center text-xs text-gray-600 font-medium">
                                        {resolveBatchRef(item) || 'Directa'}
                                    </td>
                                    <td className="px-6 py-4 text-center text-gray-400 text-xs">
                                        {item.saleDate ? new Date(item.saleDate).toLocaleDateString() : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <div className="flex justify-center gap-2">
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
        </>
    );
}

function InventoryTable({ items, onEdit, onDelete, onSell, resolveBatchRef }: {
    items: Item[],
    onEdit: (i: Item) => void,
    onDelete: (id: string) => void,
    onSell: (i: Item) => void,
    resolveBatchRef: (item: Item) => string | undefined
}) {
    if (items.length === 0) {
        return <div className="p-8 sm:p-12 text-center text-gray-400">Tu inventario está vacío. Agrega productos para comenzar.</div>;
    }

    return (
        <>
            <div className="sm:hidden p-3 space-y-3">
                {items.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                            <h3 className="font-semibold text-gray-900 leading-tight">{item.productName}</h3>
                            <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-md text-xs font-semibold shrink-0">
                                Stock: {item.quantity}
                            </span>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                            <div>
                                <p className="text-gray-400 text-xs">Costo Unit.</p>
                                <p className="font-medium text-gray-900">${item.purchasePrice.toLocaleString()}</p>
                            </div>
                            <div>
                                <p className="text-gray-400 text-xs">Reventa Unit.</p>
                                <p className="font-medium text-gray-900">
                                    {item.salePrice ? `$${item.salePrice.toLocaleString()}` : '-'}
                                </p>
                            </div>
                            <div>
                                <p className="text-gray-400 text-xs">Valor Total</p>
                                <p className="font-medium text-gray-900">${(item.purchasePrice * item.quantity).toLocaleString()}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-gray-400 text-xs">Fecha Ingreso</p>
                                <p className="font-medium text-gray-700">{new Date(item.date).toLocaleDateString()}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-gray-400 text-xs">Estado</p>
                                <p className="font-medium text-gray-700">{conditionLabelMap[item.condition || 'nuevo']}</p>
                            </div>
                            <div className="col-span-2">
                                <p className="text-gray-400 text-xs">Tanda</p>
                                <p className="font-medium text-gray-700">{getBatchLabel(resolveBatchRef(item))}</p>
                            </div>
                        </div>
                        <div className="mt-4 space-y-2">
                            <button
                                onClick={() => onSell(item)}
                                className="w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold flex items-center justify-center gap-2"
                            >
                                <DollarSign className="w-4 h-4" />
                                Vender
                            </button>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => onEdit(item)}
                                    className="h-10 rounded-xl border border-blue-100 bg-blue-50 text-blue-700 text-sm font-medium flex items-center justify-center gap-2"
                                >
                                    <Edit2 className="w-4 h-4" />
                                    Editar
                                </button>
                                <button
                                    onClick={() => onDelete(item.id)}
                                    className="h-10 rounded-xl border border-rose-100 bg-rose-50 text-rose-700 text-sm font-medium flex items-center justify-center gap-2"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Eliminar
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-600">
                    <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs tracking-wider">
                        <tr>
                            <th className="px-6 py-4">Producto</th>
                            <th className="px-6 py-4 text-center">Stock</th>
                            <th className="px-6 py-4 text-right">Costo Unit.</th>
                            <th className="px-6 py-4 text-right">Reventa Unit.</th>
                            <th className="px-6 py-4 text-right">Valor Total</th>
                            <th className="px-6 py-4 text-center">Estado</th>
                            <th className="px-6 py-4 text-center">Tanda</th>
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
                                <td className="px-6 py-4 text-right font-mono text-gray-700">
                                    {item.salePrice ? `$${item.salePrice.toLocaleString()}` : '-'}
                                </td>
                                <td className="px-6 py-4 text-right font-mono font-medium text-gray-900">${(item.purchasePrice * item.quantity).toLocaleString()}</td>
                                <td className="px-6 py-4 text-center text-xs font-semibold text-gray-700">
                                    {conditionLabelMap[item.condition || 'nuevo']}
                                </td>
                                <td className="px-6 py-4 text-center text-xs font-semibold text-gray-700">
                                    {getBatchLabel(resolveBatchRef(item))}
                                </td>
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
        </>
    );
}

function ProductForm({ formData, setFormData, onSubmit, onCancel, isEditing, editingItemStatus }: {
    formData: Partial<Item>,
    setFormData: React.Dispatch<React.SetStateAction<Partial<Item>>>,
    onSubmit: (e: React.FormEvent) => void,
    onCancel: () => void,
    isEditing: boolean,
    editingItemStatus?: ItemStatus
}) {
    const [url, setUrl] = useState('');
    const [isDetectingFromUrl, setIsDetectingFromUrl] = useState(false);
    const [isDetectingFromImage, setIsDetectingFromImage] = useState(false);
    const [autoFillMessage, setAutoFillMessage] = useState<string | null>(null);
    const [detectedSummary, setDetectedSummary] = useState<string | null>(null);
    const [purchasePriceInput, setPurchasePriceInput] = useState('');
    const [salePriceInput, setSalePriceInput] = useState('');

    type TesseractResult = {
        data?: {
            text?: string;
        };
    };

    type TesseractLike = {
        recognize: (image: File, langs?: string) => Promise<TesseractResult>;
    };

    const getTesseract = async (): Promise<TesseractLike> => {
        if ((window as typeof window & { Tesseract?: TesseractLike }).Tesseract) {
            return (window as typeof window & { Tesseract?: TesseractLike }).Tesseract as TesseractLike;
        }

        await new Promise<void>((resolve, reject) => {
            const scriptId = 'tesseract-cdn-script';
            const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

            if (existing) {
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error('No se pudo cargar OCR.')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.id = scriptId;
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('No se pudo cargar OCR.'));
            document.body.appendChild(script);
        });

        const loaded = (window as typeof window & { Tesseract?: TesseractLike }).Tesseract;
        if (!loaded) throw new Error('OCR no disponible.');
        return loaded;
    };

    const formatMoney = (value?: number) => {
        const numeric = Number(value || 0);
        if (!numeric) return '';
        return new Intl.NumberFormat('es-AR').format(Math.round(numeric));
    };

    const parseMoneyInput = (raw: string): number => {
        const digits = raw.replace(/[^\d]/g, '');
        if (!digits) return 0;
        return Number(digits);
    };

    const parsePriceValue = (raw: string): number => {
        const value = parseMoneyInput(raw);
        return Number.isFinite(value) ? value : 0;
    };

    useEffect(() => {
        setPurchasePriceInput(formatMoney(formData.purchasePrice));
    }, [formData.purchasePrice]);

    useEffect(() => {
        setSalePriceInput(formatMoney(formData.salePrice));
    }, [formData.salePrice]);

    const parseLikelyPrice = (text: string): number | null => {
        // Prioridad: precios marcados con ARS (como en la captura del usuario)
        const arsRegex = /\b(?:ars|ar\$)\s*\$?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|\d{2,9})\b/gi;
        const arsMatches = [...text.matchAll(arsRegex)];
        if (arsMatches.length > 0) {
            const arsValue = parsePriceValue(arsMatches[0][1]);
            if (Number.isFinite(arsValue) && arsValue >= 1 && arsValue <= 50000000) {
                return arsValue;
            }
        }

        const priceRegex = /(?:us\$|\$|mxn|clp|cop|pen|s\/)?\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})|\d{2,9})/gi;
        const candidates: number[] = [];
        let match: RegExpExecArray | null;

        while ((match = priceRegex.exec(text)) !== null) {
            const value = parsePriceValue(match[1]);
            if (Number.isFinite(value) && value >= 1 && value <= 50000000) {
                candidates.push(value);
            }
        }

        if (candidates.length === 0) return null;
        return Math.max(...candidates);
    };

    const parseLikelyQuantity = (text: string): number | null => {
        const quantityPatterns = [
            /\bx\s*(\d{1,4})\b/gi,            // x3, x 3
            /\b(\d{1,4})\s*(?:piezas?|uds?|unidades?)\b/gi // 4 piezas, 2 uds
        ];

        for (const pattern of quantityPatterns) {
            const matches = [...text.matchAll(pattern)];
            if (matches.length > 0) {
                const value = Number(matches[matches.length - 1][1]);
                if (Number.isFinite(value) && value >= 1 && value <= 10000) {
                    return value;
                }
            }
        }

        return null;
    };

    const cleanProductName = (value: string): string => {
        let cleaned = value
            .replace(/\[[^\]]*]/g, ' ')
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\b(?:ars|ar\$)\b.*$/i, ' ')
            .replace(/\bx\s*\d+\b/gi, ' ')
            .replace(/\s{2,}/g, ' ')
            .replace(/\.{2,}$/, '')
            .trim();

        cleaned = cleaned.replace(/^juego\s+de\s+\d+\s+/i, '');
        cleaned = cleaned.replace(/\b(em|en|de)\s*$/i, '').trim();

        const keywordMatch = cleaned.match(/\b(bolsa|bolsas|zapatilla|zapatillas|remera|remeras|pantal[oó]n|pantalones|campera|camperas|auricular|auriculares|funda|fundas|cable|cables)\b/i);
        if (keywordMatch?.index !== undefined && keywordMatch.index > 0) {
            cleaned = cleaned.slice(keywordMatch.index);
        }

        return cleaned
            .replace(/\w\S*/g, (w) => w.replace(/^\w/, (c) => c.toUpperCase()))
            .trim();
    };

    const parseLikelyName = (text: string): string | null => {
        const lines = text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);

        // Regla principal: si hay línea con ARS, el nombre sale del texto previo al precio.
        const arsLineIndex = lines.findIndex((line) => /\b(?:ars|ar\$)\b/i.test(line));
        if (arsLineIndex !== -1) {
            const lineWithArs = lines[arsLineIndex];
            const titleBeforePrice = lineWithArs
                .replace(/\b(?:ars|ar\$)\s*\$?\s*\d[\d.,]*/i, '')
                .trim();
            const cleaned = cleanProductName(titleBeforePrice);
            if (cleaned.length >= 2) return cleaned;

            // Cuando OCR separa el título y el precio en líneas distintas.
            const previousLine = lines[arsLineIndex - 1];
            if (previousLine) {
                const prevCleaned = cleanProductName(previousLine);
                if (prevCleaned.length >= 2) return prevCleaned;
            }
        }

        const ignoredWords = ['mercadolibre', 'temu', 'envio', 'cuotas', 'pagar', 'total', 'cantidad', 'pedido'];

        const keywordLine = lines.find((line) => /\b(bolsa|bolsas|zapatilla|zapatillas|remera|remeras|pantal[oó]n|pantalones|campera|camperas|auricular|auriculares|funda|fundas|cable|cables)\b/i.test(line));
        if (keywordLine) {
            const cleanedKeyword = cleanProductName(keywordLine);
            if (cleanedKeyword.length >= 3) return cleanedKeyword;
        }

        const candidate = lines.find((line) => {
            const lower = line.toLowerCase();
            const looksLikePrice = /\b(?:ars|ar\$|us\$|\$)\s*\d[\d.,]*/i.test(line);
            const hasLetters = /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(line);
            const mostlyNumbers = line.replace(/[^\d]/g, '').length > line.length * 0.5;
            const ignored = ignoredWords.some((w) => lower.includes(w));
            return hasLetters && !looksLikePrice && !mostlyNumbers && !ignored && line.length >= 4 && line.length <= 110;
        });

        if (!candidate) return null;
        const cleaned = cleanProductName(candidate);
        return cleaned || null;
    };

    const handleUrlBlur = async () => {
        if (!url) return;
        setIsDetectingFromUrl(true);
        setAutoFillMessage(null);
        setDetectedSummary(null);

        let extractedName = '';
        let extractedPrice: number | null = null;
        let extractedQuantity: number | null = null;

        try {
            const urlObj = new URL(url);
            if (urlObj.hostname.includes('mercadolibre')) {
                const parts = urlObj.pathname.split('-');
                const idIndex = parts.findIndex(p => p.startsWith('MLA') || p.startsWith('MCO') || p.startsWith('MLM'));
                if (idIndex !== -1 && idIndex + 1 < parts.length) {
                    const titleParts = parts.slice(idIndex + 1);
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

                const mlId = url.match(/ML[A-Z]-?\d+/i)?.[0]?.replace('-', '');
                if (mlId) {
                    const response = await fetch(`https://api.mercadolibre.com/items/${mlId}`);
                    if (response.ok) {
                        const data = await response.json() as { title?: string; price?: number };
                        if (data.title) extractedName = data.title;
                        if (typeof data.price === 'number') extractedPrice = data.price;
                    }
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

            const urlPrice = parseLikelyPrice(url);
            if (urlPrice && !extractedPrice) extractedPrice = urlPrice;
            const urlQuantity = parseLikelyQuantity(url);
            if (urlQuantity) extractedQuantity = urlQuantity;

            if (extractedName || extractedPrice || extractedQuantity) {
                const normalizedName = extractedName
                    ? decodeURIComponent(extractedName).replace(/\w\S*/g, (w) => (w.replace(/^\w/, (c) => c.toUpperCase())))
                    : undefined;
                const unitCost = extractedPrice && extractedQuantity && extractedQuantity > 1
                    ? extractedPrice / extractedQuantity
                    : extractedPrice;

                setFormData(prev => ({
                    ...prev,
                    productName: normalizedName || prev.productName,
                    purchasePrice: unitCost ?? prev.purchasePrice,
                    quantity: extractedQuantity ?? prev.quantity
                }));

                setAutoFillMessage('Autocompletado desde link: datos detectados.');
                setDetectedSummary(
                    `Detectado: ${normalizedName || formData.productName || 'Sin nombre'}`
                    + `${extractedPrice ? ` | Total ARS ${Math.round(extractedPrice).toLocaleString('es-AR')}` : ''}`
                    + `${unitCost ? ` | Costo unitario ARS ${Math.round(unitCost).toLocaleString('es-AR')}` : ''}`
                    + `${extractedQuantity ? ` | Cantidad ${extractedQuantity}` : ''}`
                );
            } else {
                setAutoFillMessage('No pude detectar datos claros en ese link.');
            }
        } catch (e) {
            console.error("Error parsing URL", e);
            setAutoFillMessage('No se pudo leer ese link.');
        } finally {
            setIsDetectingFromUrl(false);
        }
    };

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsDetectingFromImage(true);
        setAutoFillMessage(null);
        setDetectedSummary(null);

        try {
            const tesseract = await getTesseract();
            const result = await tesseract.recognize(file, 'spa+eng');
            const text = result.data?.text || '';

            const detectedName = parseLikelyName(text);
            const detectedPrice = parseLikelyPrice(text);
            const detectedQuantity = parseLikelyQuantity(text);
            const unitCost = detectedPrice;

            if (detectedName || detectedPrice || detectedQuantity) {
                setFormData(prev => ({
                    ...prev,
                    productName: detectedName || prev.productName,
                    purchasePrice: unitCost ?? prev.purchasePrice,
                    quantity: detectedQuantity ?? prev.quantity
                }));
                setAutoFillMessage('Autocompletado desde imagen: datos de compra detectados.');
                setDetectedSummary(
                    `Detectado: ${detectedName || formData.productName || 'Sin nombre'}`
                    + `${detectedPrice ? ` | Precio unitario ARS ${Math.round(detectedPrice).toLocaleString('es-AR')}` : ''}`
                    + `${detectedQuantity ? ` | Cantidad ${detectedQuantity}` : ''}`
                );
            } else {
                setAutoFillMessage('No pude detectar nombre/costo/cantidad en la captura.');
            }
        } catch (err) {
            console.error('OCR failed', err);
            setAutoFillMessage('Error al procesar la captura. Intenta con otra imagen más nítida.');
        } finally {
            setIsDetectingFromImage(false);
            e.target.value = '';
        }
    };

    const getSubmitLabel = () => {
        if (!isEditing) {
            return formData.status === 'sold' ? 'Registrar Venta' : 'Guardar en Stock';
        }

        if (editingItemStatus === 'sold' && formData.status === 'in_stock') {
            return 'Volver al Stock';
        }

        if (editingItemStatus === 'in_stock' && formData.status === 'sold') {
            return 'Vender y Descontar';
        }

        if (formData.status === 'sold') {
            return 'Actualizar Venta';
        }

        return 'Actualizar Stock';
    };

    return (
        <form onSubmit={onSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-5">
            {/* Context Toggle */}
            <div className="flex bg-gray-100 p-1 rounded-lg mb-2 sm:mb-4">
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
                <div className="bg-blue-50/50 p-3 rounded-xl border border-blue-100 mb-1 sm:mb-2 space-y-3">
                    <div>
                        <label className="block text-[10px] font-bold text-blue-700 mb-1 uppercase tracking-wider">Auto-completar desde link</label>
                        <input
                            type="url"
                            placeholder="Pega link de compra (ej: MercadoLibre)"
                            className="w-full px-3 py-2 text-sm rounded-lg border border-blue-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all bg-white"
                            value={url}
                            onChange={e => setUrl(e.target.value)}
                            onBlur={handleUrlBlur}
                        />
                    </div>

                    <div>
                        <label className="block text-[10px] font-bold text-blue-700 mb-1 uppercase tracking-wider">O subir captura de compra</label>
                        <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={handleImageUpload}
                            className="w-full text-xs sm:text-sm text-gray-700 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-medium hover:file:bg-blue-700"
                        />
                    </div>

                    {(isDetectingFromUrl || isDetectingFromImage) && (
                        <p className="text-xs text-blue-700 font-medium">Analizando información...</p>
                    )}

                    {autoFillMessage && (
                        <p className="text-xs text-blue-900">{autoFillMessage}</p>
                    )}
                    {detectedSummary && (
                        <p className="text-xs font-semibold text-blue-900">{detectedSummary}</p>
                    )}

                    <p className="text-[11px] text-blue-700/80">
                        El precio de venta lo defines tú manualmente.
                    </p>
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Costo ($)</label>
                    <input
                        type="text"
                        inputMode="numeric"
                        required
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white"
                        placeholder="Ej: 14.092"
                        value={purchasePriceInput}
                        onChange={(e) => {
                            const value = parseMoneyInput(e.target.value);
                            setPurchasePriceInput(formatMoney(value));
                            setFormData({ ...formData, purchasePrice: value });
                        }}
                    />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        {formData.status === 'sold' ? 'Precio Venta ($)' : 'Precio Objetivo ($)'}
                    </label>
                    <input
                        type="text"
                        inputMode="numeric"
                        className={`w-full px-4 py-2 rounded-xl border border-gray-200 outline-none transition-all bg-gray-50 focus:bg-white ${formData.status === 'sold' ? 'focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-bold text-emerald-700' : 'focus:border-black focus:ring-1 focus:ring-black'}`}
                        placeholder="Ej: 21.900"
                        value={salePriceInput}
                        onChange={(e) => {
                            const value = parseMoneyInput(e.target.value);
                            setSalePriceInput(formatMoney(value));
                            setFormData({ ...formData, salePrice: value });
                        }}
                    />
                    {isEditing && editingItemStatus === 'in_stock' && formData.status === 'sold' && (
                        <p className="text-xs text-gray-500 mt-1">Precio por unidad. Puedes editarlo antes de confirmar la venta.</p>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Estado</label>
                    <select
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white text-gray-700"
                        value={(formData.condition as ItemCondition) || 'nuevo'}
                        onChange={e => setFormData({ ...formData, condition: e.target.value as ItemCondition })}
                    >
                        <option value="nuevo">Nuevo</option>
                        <option value="semi_uso">Semi uso</option>
                        <option value="usado">Usado</option>
                    </select>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <div>
                    <div className="stock-default-note h-full rounded-xl border border-dashed border-gray-200 bg-gray-50/60 flex items-center justify-center px-4 py-3 text-xs text-gray-500">
                        El estado por defecto es <strong className="ml-1 text-gray-700">Nuevo</strong>.
                    </div>
                </div>
            </div>

            <div className="pt-3 sm:pt-4 flex flex-col-reverse sm:flex-row gap-3">
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
                    {getSubmitLabel()}
                </button>
            </div>
        </form>
    );
}

function BulkPricingBoard({
    totalPaid,
    setTotalPaid,
    batchItems,
    setBatchItems,
    inventoryItems,
    onInventoryRefresh,
    itemBatchMap,
    setItemBatchMap
}: {
    totalPaid: number;
    setTotalPaid: React.Dispatch<React.SetStateAction<number>>;
    batchItems: PricingItem[];
    setBatchItems: React.Dispatch<React.SetStateAction<PricingItem[]>>;
    inventoryItems: Item[];
    onInventoryRefresh: () => Promise<void>;
    itemBatchMap: Record<string, string>;
    setItemBatchMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
    const [newName, setNewName] = useState('');
    const [newQty, setNewQty] = useState('1');
    const [newListedPrice, setNewListedPrice] = useState('');
    const [newSalePrice, setNewSalePrice] = useState('');
    const [newDisposition, setNewDisposition] = useState<'sell' | 'keep'>('sell');
    const [totalPaidInput, setTotalPaidInput] = useState('');
    const [history, setHistory] = useState<BatchRecord[]>([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);

    const formatMoney = (value?: number) => {
        const numeric = Number(value || 0);
        if (!numeric) return '';
        return new Intl.NumberFormat('es-AR').format(Math.round(numeric));
    };

    const parseMoneyInput = (raw: string): number => {
        const digits = raw.replace(/[^\d]/g, '');
        if (!digits) return 0;
        return Number(digits);
    };

    useEffect(() => {
        setTotalPaidInput(formatMoney(totalPaid));
    }, [totalPaid]);

    useEffect(() => {
        const loadHistory = async () => {
            try {
                // Prioritize Supabase batches
                const dbBatches = await itemService.getBatches();

                if (dbBatches && dbBatches.length > 0) {
                    setHistory(dbBatches);
                    // Update local storage as a cache
                    localStorage.setItem('pricing_batch_history_v1', JSON.stringify(dbBatches));
                } else {
                    // Fallback to local storage if DB is empty
                    const raw = localStorage.getItem('pricing_batch_history_v1');
                    if (raw) {
                        const parsed = JSON.parse(raw) as BatchRecord[];
                        if (Array.isArray(parsed)) setHistory(parsed);
                    }
                }
            } catch (error) {
                console.error('Error loading history from Supabase, trying local', error);
                const raw = localStorage.getItem('pricing_batch_history_v1');
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed)) setHistory(parsed);
                    } catch (e) { }
                }
            }
        };
        loadHistory();
    }, []);

    const safeMoney = (value: number) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? Math.round(numeric) : 0;
    };

    const cloneItemsForTable = (items: PricingItem[]) => {
        return items.map((item) => ({
            ...item,
            id: crypto.randomUUID()
        }));
    };

    const selectedRecord = history.find((record) => record.id === selectedHistoryId) || null;
    const selectedRecordItems: PricingItem[] = selectedRecord
        ? ((selectedRecord.items && selectedRecord.items.length > 0)
            ? selectedRecord.items
            : inventoryItems
                .filter((item) => (item.batchRef || itemBatchMap[item.id]) === selectedRecord.batchCode)
                .map((item) => ({
                    id: item.id,
                    productName: item.productName,
                    quantity: item.quantity,
                    listedUnitPrice: item.purchasePrice,
                    unitSalePrice: item.salePrice || item.purchasePrice,
                    condition: item.condition,
                    disposition: 'sell' as const
                })))
        : [];

    const deleteBatchRecord = async (recordId: string) => {
        const target = history.find((record) => record.id === recordId);
        if (!target) return;

        const ok = confirm(`¿Eliminar la tanda ${target.batchCode}? Se borrará también del inventario todo producto vinculado a esta tanda.`);
        if (!ok) return;

        try {
            const relatedItems = inventoryItems.filter((item) => (item.batchRef || itemBatchMap[item.id]) === target.batchCode);
            for (const item of relatedItems) {
                await itemService.deleteItem(item.id);
            }

            // Delete from Supabase
            await itemService.deleteBatch(recordId);

            const nextHistory = history.filter((record) => record.id !== recordId);
            setHistory(nextHistory);
            localStorage.setItem('pricing_batch_history_v1', JSON.stringify(nextHistory));
            if (selectedHistoryId === recordId) {
                setSelectedHistoryId(null);
            }
            setItemBatchMap((prev) => {
                const next = { ...prev };
                for (const item of relatedItems) delete next[item.id];
                return next;
            });

            await onInventoryRefresh();
            alert(`Tanda ${target.batchCode} eliminada.`);
        } catch (error) {
            console.error('Error deleting batch', error);
            alert('Hubo un error al eliminar la tanda.');
        }
    };

    const normalizedItems = batchItems.map((item) => ({ ...item, disposition: item.disposition || 'sell' }));
    const listedSubtotal = normalizedItems.reduce((acc, item) => acc + (item.listedUnitPrice * item.quantity), 0);
    const allocationFactor = listedSubtotal > 0 ? totalPaid / listedSubtotal : 1;
    const totalSellRevenue = normalizedItems
        .filter((item) => item.disposition === 'sell')
        .reduce((acc, item) => acc + (item.unitSalePrice * item.quantity), 0);
    const retainedValue = normalizedItems
        .filter((item) => item.disposition === 'keep')
        .reduce((acc, item) => acc + ((item.listedUnitPrice * allocationFactor) * item.quantity), 0);
    const sellCostAdjusted = normalizedItems
        .filter((item) => item.disposition === 'sell')
        .reduce((acc, item) => acc + ((item.listedUnitPrice * allocationFactor) * item.quantity), 0);
    const expectedProfit = totalSellRevenue - sellCostAdjusted;
    const effectiveCostToRecover = Math.max(totalPaid - retainedValue, 0);
    const totalEconomicValue = expectedProfit + retainedValue;

    const addItem = () => {
        const quantity = Math.max(1, Math.floor(Number(newQty) || 1));
        const listedPrice = parseMoneyInput(newListedPrice);
        const salePrice = parseMoneyInput(newSalePrice);

        if (!newName.trim() || listedPrice <= 0) {
            alert('Completa nombre y precio de lista unitario.');
            return;
        }
        if (newDisposition === 'sell' && salePrice <= 0) {
            alert('Si es para vender, completa la venta unitaria.');
            return;
        }

        setBatchItems((prev) => [
            ...prev,
            {
                id: crypto.randomUUID(),
                productName: newName.trim(),
                quantity,
                listedUnitPrice: listedPrice,
                unitSalePrice: newDisposition === 'sell' ? salePrice : 0,
                condition: 'nuevo',
                disposition: newDisposition
            }
        ]);

        setNewName('');
        setNewQty('1');
        setNewListedPrice('');
        setNewSalePrice('');
        setNewDisposition('sell');
    };

    const sendBatchToStock = async () => {
        if (normalizedItems.length === 0) {
            alert('Primero agrega productos a la tanda.');
            return;
        }

        try {
            const itemsToSell = normalizedItems.filter((item) => item.disposition === 'sell');
            const batchIndex = history.length + 1;
            const batchCode = `T-${batchIndex.toString().padStart(3, '0')}`;
            const batchType: BatchRecord['batchType'] =
                itemsToSell.length === 0 ? 'retenido' : (itemsToSell.length === normalizedItems.length ? 'venta' : 'mixta');

            for (const item of itemsToSell) {
                const adjustedUnitCost = Math.round(item.listedUnitPrice * allocationFactor);
                const nowIso = new Date().toISOString();

                const existingStock = inventoryItems.find((stockItem) =>
                    stockItem.status === 'in_stock' &&
                    stockItem.productName === item.productName &&
                    stockItem.condition === item.condition &&
                    Math.round(stockItem.purchasePrice) === adjustedUnitCost &&
                    (stockItem.batchRef || itemBatchMap[stockItem.id]) === batchCode
                );

                if (existingStock) {
                    await itemService.updateItem(existingStock.id, {
                        quantity: existingStock.quantity + item.quantity,
                        salePrice: item.unitSalePrice,
                        condition: item.condition,
                        batchRef: batchCode
                    });
                    setItemBatchMap((prev) => ({ ...prev, [existingStock.id]: batchCode }));
                } else {
                    const created = await itemService.createItem({
                        productName: item.productName,
                        purchasePrice: adjustedUnitCost,
                        salePrice: item.unitSalePrice,
                        quantity: item.quantity,
                        date: nowIso,
                        status: 'in_stock',
                        condition: item.condition,
                        batchRef: batchCode
                    });
                    setItemBatchMap((prev) => ({ ...prev, [created.id]: batchCode }));
                }
            }

            const record: Omit<BatchRecord, 'id'> = {
                batchCode,
                batchType,
                createdAt: new Date().toISOString(),
                totalPaid,
                totalSellRevenue,
                cashProfit: expectedProfit,
                retainedValue,
                itemsCount: normalizedItems.length,
                items: normalizedItems.map((item) => ({ ...item }))
            };

            // Save to Supabase
            const savedBatch = await itemService.createBatch(record);

            const nextHistory = [savedBatch, ...history].slice(0, 50);
            setHistory(nextHistory);
            localStorage.setItem('pricing_batch_history_v1', JSON.stringify(nextHistory));

            setBatchItems([]);
            await onInventoryRefresh();
            alert('Tanda procesada: stock actualizado y resultado registrado.');
        } catch (error) {
            console.error('Error sending batch to stock', error);
            alert('Hubo un error al procesar la tanda.');
        }
    };

    return (
        <div className="space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6">
                <h2 className="text-lg sm:text-xl font-bold text-gray-800">Pedido por Tanda (descuento global)</h2>
                <p className="text-sm text-gray-500 mt-1">Cada producto puede ser para vender o para quedártelo. El margen se calcula automáticamente.</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                    <div>
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Total pagado del pedido</label>
                        <input
                            type="text"
                            inputMode="numeric"
                            value={totalPaidInput}
                            onChange={(e) => {
                                const value = parseMoneyInput(e.target.value);
                                setTotalPaidInput(formatMoney(value));
                                setTotalPaid(value);
                            }}
                            placeholder="Ej: 200.000"
                            className="w-full px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                        />
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2">
                        <p className="text-xs text-gray-500">Subtotal precios de lista</p>
                        <p className="font-semibold text-gray-900">${listedSubtotal.toLocaleString('es-AR')}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2">
                        <p className="text-xs text-gray-500">Factor de ajuste</p>
                        <p className="font-semibold text-gray-900">{allocationFactor.toFixed(4)}x</p>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6">
                <h3 className="text-base font-bold text-gray-800 mb-3">Agregar producto al pedido</h3>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Nombre del producto"
                        className="md:col-span-2 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                    />
                    <input
                        type="number"
                        min="1"
                        value={newQty}
                        onChange={(e) => setNewQty(e.target.value)}
                        placeholder="Cantidad"
                        className="px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                    />
                    <input
                        type="text"
                        inputMode="numeric"
                        value={newListedPrice}
                        onChange={(e) => {
                            const value = parseMoneyInput(e.target.value);
                            setNewListedPrice(formatMoney(value));
                        }}
                        placeholder="Precio lista unit."
                        className="px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                    />
                    <select
                        value={newDisposition}
                        onChange={(e) => setNewDisposition(e.target.value as 'sell' | 'keep')}
                        className="px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                    >
                        <option value="sell">Para vender</option>
                        <option value="keep">Me lo quedo</option>
                    </select>
                    <input
                        type="text"
                        inputMode="numeric"
                        value={newSalePrice}
                        onChange={(e) => {
                            const value = parseMoneyInput(e.target.value);
                            setNewSalePrice(formatMoney(value));
                        }}
                        placeholder={newDisposition === 'keep' ? 'No aplica' : 'Venta unit.'}
                        disabled={newDisposition === 'keep'}
                        className="px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none disabled:opacity-50"
                    />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                    <button
                        onClick={addItem}
                        className="bg-black text-white px-4 py-2 rounded-xl text-sm font-medium"
                    >
                        Agregar a la tanda
                    </button>
                    <button
                        onClick={sendBatchToStock}
                        className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium"
                    >
                        Pasar tanda a stock
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
                <table className="w-full text-sm text-gray-700">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                        <tr>
                            <th className="px-4 py-3 text-left">Producto</th>
                            <th className="px-4 py-3 text-center">Cant.</th>
                            <th className="px-4 py-3 text-right">Lista Unit.</th>
                            <th className="px-4 py-3 text-right">Costo Ajustado Unit.</th>
                            <th className="px-4 py-3 text-center">Destino</th>
                            <th className="px-4 py-3 text-right">Venta Unit.</th>
                            <th className="px-4 py-3 text-center">Margen %</th>
                            <th className="px-4 py-3 text-right">Ganancia Total</th>
                            <th className="px-4 py-3 text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {normalizedItems.map((item) => {
                            const adjustedUnitCost = item.listedUnitPrice * allocationFactor;
                            const marginPercent = adjustedUnitCost > 0
                                ? ((item.unitSalePrice - adjustedUnitCost) / adjustedUnitCost) * 100
                                : 0;
                            const totalProfit = item.disposition === 'sell'
                                ? (item.unitSalePrice - adjustedUnitCost) * item.quantity
                                : 0;

                            return (
                                <tr key={item.id}>
                                    <td className="px-4 py-3 font-medium text-gray-900">{item.productName}</td>
                                    <td className="px-4 py-3 text-center">{item.quantity}</td>
                                    <td className="px-4 py-3 text-right">${Math.round(item.listedUnitPrice).toLocaleString('es-AR')}</td>
                                    <td className="px-4 py-3 text-right">${Math.round(adjustedUnitCost).toLocaleString('es-AR')}</td>
                                    <td className="px-4 py-3 text-center">
                                        <select
                                            value={item.disposition}
                                            onChange={(e) => {
                                                const disposition = e.target.value as 'sell' | 'keep';
                                                setBatchItems((prev) => prev.map((p) => p.id === item.id ? { ...p, disposition } : p));
                                            }}
                                            className="px-2 py-1 rounded-lg border border-gray-200 bg-gray-50 text-xs"
                                        >
                                            <option value="sell">Vender</option>
                                            <option value="keep">Me lo quedo</option>
                                        </select>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={formatMoney(item.unitSalePrice)}
                                            onChange={(e) => {
                                                const unitSalePrice = parseMoneyInput(e.target.value);
                                                setBatchItems((prev) => prev.map((p) => p.id === item.id
                                                    ? { ...p, unitSalePrice }
                                                    : p));
                                            }}
                                            disabled={item.disposition === 'keep'}
                                            className="w-28 px-2 py-1 rounded-lg border border-gray-200 bg-gray-50 text-right disabled:opacity-50"
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-center font-semibold text-gray-700">
                                        {item.disposition === 'keep' ? '-' : (Number.isFinite(marginPercent) ? `${marginPercent.toFixed(1)}%` : '0%')}
                                    </td>
                                    <td className={`px-4 py-3 text-right font-semibold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {item.disposition === 'keep'
                                            ? `Retenido: $${Math.round(adjustedUnitCost * item.quantity).toLocaleString('es-AR')}`
                                            : `$${Math.round(totalProfit).toLocaleString('es-AR')}`}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button
                                            onClick={() => setBatchItems((prev) => prev.filter((p) => p.id !== item.id))}
                                            className="text-rose-600 hover:text-rose-700"
                                        >
                                            Eliminar
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-xs text-gray-500">Total invertido</p>
                    <p className="text-lg font-bold text-gray-900">${Math.round(totalPaid).toLocaleString('es-AR')}</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-xs text-gray-500">Costo a recuperar con ventas</p>
                    <p className="text-lg font-bold text-gray-900">${Math.round(effectiveCostToRecover).toLocaleString('es-AR')}</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-xs text-gray-500">Ganancia monetaria esperada</p>
                    <p className={`text-lg font-bold ${expectedProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        ${Math.round(expectedProfit).toLocaleString('es-AR')}
                    </p>
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-xs text-gray-500">Valor de productos que te quedas</p>
                    <p className="text-lg font-bold text-blue-700">${Math.round(retainedValue).toLocaleString('es-AR')}</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-xs text-gray-500">Resultado económico total (cash + retenido)</p>
                    <p className={`text-lg font-bold ${totalEconomicValue >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        ${Math.round(totalEconomicValue).toLocaleString('es-AR')}
                    </p>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6">
                <h3 className="text-base font-bold text-gray-800 mb-3">Historial de Tandas</h3>
                {history.length === 0 ? (
                    <p className="text-sm text-gray-500">Sin registros todavía.</p>
                ) : (
                    <div className="space-y-2">
                        {history.slice(0, 8).map((record) => (
                            <div
                                key={record.id}
                                className={`w-full rounded-xl border px-4 py-3 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 transition-colors ${selectedHistoryId === record.id ? 'border-blue-300 bg-blue-50/40' : 'border-gray-200 bg-gray-50 hover:bg-gray-100/70'}`}
                            >
                                <button
                                    type="button"
                                    onClick={() => setSelectedHistoryId((prev) => prev === record.id ? null : record.id)}
                                    className="flex-1 text-left"
                                >
                                    <div className="text-gray-700">
                                        <p className="font-semibold">{record.batchCode} ({record.batchType}) - {new Date(record.createdAt).toLocaleDateString('es-AR')} - {record.itemsCount} productos</p>
                                        <p className="text-xs text-gray-500">Invertido: ${safeMoney(record.totalPaid).toLocaleString('es-AR')} | Venta esperada: ${safeMoney(record.totalSellRevenue).toLocaleString('es-AR')} | Retenido: ${safeMoney(record.retainedValue).toLocaleString('es-AR')}</p>
                                    </div>
                                </button>
                                <div className="flex items-center gap-3">
                                    <p className={`font-bold ${record.cashProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        ${safeMoney(record.cashProfit).toLocaleString('es-AR')}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => void deleteBatchRecord(record.id)}
                                        className="text-xs px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50"
                                    >
                                        Eliminar
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {selectedRecord && (
                <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                        <div>
                            <h4 className="text-base font-bold text-gray-800">Detalle del pedido</h4>
                            <p className="text-xs text-gray-500">{selectedRecord.batchCode} ({selectedRecord.batchType}) - {new Date(selectedRecord.createdAt).toLocaleString('es-AR')}</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setTotalPaid(selectedRecord.totalPaid);
                                    setBatchItems(cloneItemsForTable(selectedRecordItems));
                                }}
                                disabled={selectedRecordItems.length === 0}
                                className="px-3 py-2 rounded-lg bg-black text-white text-xs font-medium"
                            >
                                Cargar para editar
                            </button>
                            <button
                                type="button"
                                onClick={() => setBatchItems((prev) => [...prev, ...cloneItemsForTable(selectedRecordItems)])}
                                disabled={selectedRecordItems.length === 0}
                                className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-medium"
                            >
                                Agregar a tabla actual
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-gray-700">
                            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                                <tr>
                                    <th className="px-3 py-2 text-left">Producto</th>
                                    <th className="px-3 py-2 text-center">Cant.</th>
                                    <th className="px-3 py-2 text-right">Lista Unit.</th>
                                    <th className="px-3 py-2 text-right">Venta Unit.</th>
                                    <th className="px-3 py-2 text-center">Destino</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {selectedRecordItems.map((item) => (
                                    <tr key={item.id}>
                                        <td className="px-3 py-2 font-medium text-gray-900">{item.productName}</td>
                                        <td className="px-3 py-2 text-center">{item.quantity}</td>
                                        <td className="px-3 py-2 text-right">${safeMoney(item.listedUnitPrice).toLocaleString('es-AR')}</td>
                                        <td className="px-3 py-2 text-right">
                                            {item.disposition === 'sell' ? `$${safeMoney(item.unitSalePrice).toLocaleString('es-AR')}` : '-'}
                                        </td>
                                        <td className="px-3 py-2 text-center text-xs font-semibold text-gray-700">
                                            {item.disposition === 'sell' ? 'Vender' : 'Me lo quedo'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {selectedRecordItems.length === 0 && (
                        <p className="text-xs text-amber-600 mt-3">
                            No hay detalle guardado para esta tanda (registro antiguo sin productos vinculados).
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

function MetricCard({ title, value, icon, trend, trendColor, bgColor }: { title: string, value: string, icon: React.ReactNode, trend?: string, trendColor?: string, bgColor: string }) {
    return (
        <div className={`${bgColor} p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md`}>
            <div className="flex justify-between items-start mb-3 sm:mb-4 gap-2">
                <div className="p-2.5 sm:p-3 bg-gray-50 rounded-xl">
                    {icon}
                </div>
                {trend && (
                    <span className={`text-xs font-semibold px-2 py-1 rounded-lg bg-opacity-10 ${trendColor?.replace('text-', 'bg-')} ${trendColor}`}>
                        {trend}
                    </span>
                )}
            </div>
            <div>
                <p className="text-gray-500 text-xs sm:text-sm font-medium mb-1">{title}</p>
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight leading-tight">{value}</h3>
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
