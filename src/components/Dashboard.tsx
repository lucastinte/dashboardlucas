import { useState, useEffect } from 'react';
import type { Item, ItemCondition, ItemStatus, ItemType } from '../types';
import { itemService } from '../services/itemService';
import { TOPE, CATEGORIA_ACTUAL } from '../config/monotributo';
import { Plus, Trash2, TrendingUp, DollarSign, Package, ArrowUpRight, ArrowDownRight, Edit2, Box, History as HistoryIcon, Save, Moon, Sun, Layers, Split, Check, ClipboardPaste, X, AlertTriangle, Merge, ChevronDown, ChevronRight, MapPin, User, FileText, Receipt, CheckCircle, XCircle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

type Tab = 'dashboard' | 'inventory' | 'pricing' | 'facturacion';

type PricingItem = {
    id: string;
    productName: string;
    quantity: number;
    listedUnitPrice: number;
    unitSalePrice: number;
    condition: ItemCondition;
    disposition: 'sell' | 'keep';
    category?: string;
};

type BatchStatus = 'en_camino' | 'recibido' | 'completado';

type BatchRecord = {
    id: string;
    batchCode: string;
    batchType: 'venta' | 'mixta' | 'retenido';
    batchStatus: BatchStatus;
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

const reconcileItemBatchMap = (inventoryItems: Item[], history: Array<Partial<BatchRecord>>, currentMap: Record<string, string>) => {
    if (history.length === 0) return null;

    const nextMap = { ...currentMap };
    const usedIds = new Set<string>();
    let changed = false;

    // Items already tagged in DB shouldn't be touched by the map
    const unassigned = inventoryItems.filter((item) => {
        const alreadyTagged = item.batchRef || nextMap[item.id];
        return !alreadyTagged;
    });

    // Sort history chronologically (Oldest first) to match FIFO
    // This ensures that older items are matched to older batches first.
    const sortedHistory = [...history]
        .filter((record) => typeof record?.batchCode === 'string' && record.batchCode)
        .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

    for (const record of sortedHistory) {
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
            // Find potential matches in unassigned items
            const candidates = unassigned
                .filter((item) => !usedIds.has(item.id))
                .filter((item) => normalizeText(item.productName) === normalizeText(recordItem.productName))
                .filter((item) => (item.condition || 'nuevo') === recordItem.condition);

            if (candidates.length === 0) continue;

            const bestMatch = [...candidates].sort((a, b) => {
                // Priority to price match
                const aSaleMatch = Math.round(a.salePrice || 0) === Math.round(recordItem.unitSalePrice || 0) ? 1 : 0;
                const bSaleMatch = Math.round(b.salePrice || 0) === Math.round(recordItem.unitSalePrice || 0) ? 1 : 0;
                if (aSaleMatch !== bSaleMatch) return bSaleMatch - aSaleMatch;

                // Then quantity match
                const aQtyDistance = Math.abs((a.quantity || 0) - recordItem.quantity);
                const bQtyDistance = Math.abs((b.quantity || 0) - recordItem.quantity);
                if (aQtyDistance !== bQtyDistance) return aQtyDistance - bQtyDistance;

                // Then closest date
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
    const [batchHistory, setBatchHistory] = useState<BatchRecord[]>([]);
    const getItemBatchRef = (item: Item) => item.batchRef || itemBatchMap[item.id];

    // Form State
    const [formData, setFormData] = useState<Partial<Item>>({
        productName: '',
        purchasePrice: 0,
        salePrice: 0,
        quantity: 1,
        status: 'in_stock',
        condition: 'nuevo',
        itemType: 'resale',
        date: new Date().toISOString().split('T')[0],
        location: '',
        estimatedSalePrice: 0,
        imageUrl: ''
    });

    useEffect(() => {
        loadItems();
    }, []);


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
            const raw = localStorage.getItem('item_batch_map_v2');
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
        localStorage.setItem('item_batch_map_v2', JSON.stringify(itemBatchMap));
    }, [itemBatchMap]);

    useEffect(() => {
        const loadHistory = async () => {
            try {
                const dbBatches = await itemService.getBatches();
                if (dbBatches && dbBatches.length > 0) {
                    setBatchHistory(dbBatches);
                    localStorage.setItem('pricing_batch_history_v1', JSON.stringify(dbBatches));
                } else {
                    const raw = localStorage.getItem('pricing_batch_history_v1');
                    if (raw) {
                        const parsed = JSON.parse(raw) as BatchRecord[];
                        if (Array.isArray(parsed)) setBatchHistory(parsed);
                    }
                }
            } catch (error) {
                console.error('Error loading history', error);
                const raw = localStorage.getItem('pricing_batch_history_v1');
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed)) setBatchHistory(parsed);
                    } catch (e) { }
                }
            }
        };
        loadHistory();
    }, []);

    useEffect(() => {
        setItemBatchMap((prev) => {
            const reconciled = reconcileItemBatchMap(items, batchHistory, prev);
            return reconciled || prev;
        });
    }, [items, batchHistory]);

    useEffect(() => {
        const root = document.documentElement;
        root.classList.toggle('dark', theme === 'dark');
        root.style.colorScheme = theme;
        localStorage.setItem('dashboard_theme', theme);
    }, [theme]);


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
                                itemType: (item.itemType as ItemType) || 'resale',
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

            // Auto-merge identical in-stock items
            let mergedAny = false;
            const stockMergeMap = new Map<string, Item[]>();
            for (const item of finalItems) {
                if (item.status !== 'in_stock') continue;
                const bRef = item.batchRef || '';
                const key = `${item.productName.toLowerCase().trim()}|${item.purchasePrice}|${item.salePrice || 0}|${item.condition}|${bRef}|${item.location || ''}`;
                if (stockMergeMap.has(key)) {
                    stockMergeMap.get(key)!.push(item);
                } else {
                    stockMergeMap.set(key, [item]);
                }
            }

            for (const group of stockMergeMap.values()) {
                if (group.length > 1) {
                    try {
                        const mainItem = group[0];
                        const totalQty = group.reduce((acc, i) => acc + i.quantity, 0);
                        await itemService.updateItem(mainItem.id, { quantity: totalQty });
                        for (let i = 1; i < group.length; i++) {
                            await itemService.deleteItem(group[i].id);
                        }
                        mergedAny = true;
                    } catch (e) { console.error('Error auto-merging', e); }
                }
            }
            if (mergedAny) {
                finalItems = await itemService.getItems();
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
            // If date-only string (YYYY-MM-DD), treat as local midnight to avoid timezone shift
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                const [y, m, d] = dateStr.split('-').map(Number);
                return new Date(y, m - 1, d, 12, 0, 0).toISOString();
            }
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
                        itemType: editingItem.itemType || 'resale',
                        batchRef: getItemBatchRef(editingItem),
                        location: formData.location || editingItem.location,
                        estimatedSalePrice: editingItem.estimatedSalePrice,
                        imageUrl: formData.imageUrl || editingItem.imageUrl,
                        saleDate: formDateISO
                    });

                    const remaining = editingItem.quantity - quantity;
                    if (remaining > 0) {
                        await itemService.updateItem(editingItem.id, { quantity: remaining });
                    } else {
                        await itemService.deleteItem(editingItem.id);
                    }

                    // AUTO-DISCOUNT FROM BATCH HISTORY
                    const batchRef = getItemBatchRef(editingItem);
                    if (batchRef) {
                        const batch = batchHistory.find(b => b.batchCode === batchRef);
                        if (batch) {
                            try {
                                const updatedItems = batch.items.map(item => {
                                    if (normalizeText(item.productName) === normalizeText(editingItem.productName) &&
                                        (item.condition || 'nuevo') === (editingItem.condition || 'nuevo')) {
                                        return { ...item, quantity: Math.max(0, item.quantity - quantity) };
                                    }
                                    return item;
                                }).filter(item => item.quantity > 0);

                                await itemService.updateBatch(batch.id, {
                                    items: updatedItems,
                                    itemsCount: updatedItems.reduce((acc, i) => acc + i.quantity, 0)
                                });
                                // Refresh history state
                                const dbBatches = await itemService.getBatches();
                                setBatchHistory(dbBatches);
                            } catch (e) {
                                console.error("Error auto-discounting from batch", e);
                            }
                        }
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
                        getItemBatchRef(i) === getItemBatchRef(editingItem)
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

                const itemType = (formData.itemType as ItemType) || editingItem.itemType || 'resale';
                const resolvedBatchRef = formData.batchRef !== undefined ? (formData.batchRef || undefined) : getItemBatchRef(editingItem);
                const updates: Partial<Item> = {
                    productName: formData.productName ?? editingItem.productName,
                    purchasePrice: itemType === 'personal' ? 0 : (Number(formData.purchasePrice) || editingItem.purchasePrice),
                    salePrice: formData.salePrice !== undefined ? Number(formData.salePrice) || 0 : editingItem.salePrice,
                    quantity,
                    date: formDateISO,
                    saleDate,
                    status,
                    condition,
                    itemType,
                    batchRef: resolvedBatchRef,
                    location: formData.location ?? editingItem.location,
                    estimatedSalePrice: formData.estimatedSalePrice ?? editingItem.estimatedSalePrice,
                    publishUrls: formData.publishUrls ?? editingItem.publishUrls,
                    imageUrl: formData.imageUrl ?? editingItem.imageUrl
                };

                // Optimistic UI update
                const updatedItem = { ...editingItem, ...updates } as Item;
                setItems(items.map(i => i.id === editingItem.id ? updatedItem : i));

                // DB Update
                const savedItem = await itemService.updateItem(editingItem.id, updates);

                // Sync state with DB response to detect if columns were dropped by fallback
                setItems(prev => prev.map(i => i.id === editingItem.id ? savedItem : i));

                // Sync name AND price changes to batch record
                const oldName = editingItem.productName;
                const newName = updates.productName || oldName;
                const oldSalePrice = editingItem.salePrice || 0;
                const newSalePrice = updates.salePrice || 0;
                const nameChanged = normalizeText(newName) !== normalizeText(oldName);
                const priceChanged = newSalePrice !== oldSalePrice && newSalePrice > 0;

                if (nameChanged || priceChanged) {
                    const batchRef = getItemBatchRef(editingItem);
                    if (batchRef) {
                        const batch = batchHistory.find(b => b.batchCode === batchRef);
                        if (batch) {
                            try {
                                const updatedBatchItems = batch.items.map(bi => {
                                    if (normalizeText(bi.productName) === normalizeText(oldName) &&
                                        (bi.condition || 'nuevo') === (editingItem.condition || 'nuevo')) {
                                        const upd = { ...bi };
                                        if (nameChanged) upd.productName = newName;
                                        if (priceChanged && bi.disposition === 'sell') upd.unitSalePrice = newSalePrice;
                                        return upd;
                                    }
                                    return bi;
                                });
                                await itemService.updateBatch(batch.id, { items: updatedBatchItems });
                                const dbBatches = await itemService.getBatches();
                                setBatchHistory(dbBatches);
                            } catch (e) {
                                console.error("Error syncing to batch", e);
                            }
                        }
                    }
                    // Also sync other items with same name + batch (e.g. sold copies)
                    if (nameChanged) {
                        const batchRef2 = getItemBatchRef(editingItem);
                        const otherItems = items.filter(i =>
                            i.id !== editingItem.id &&
                            normalizeText(i.productName) === normalizeText(oldName) &&
                            (i.batchRef || itemBatchMap[i.id]) === batchRef2
                        );
                        for (const other of otherItems) {
                            try {
                                await itemService.updateItem(other.id, { productName: newName });
                            } catch (e) {
                                console.error("Error syncing name to related item", e);
                            }
                        }
                        if (otherItems.length > 0) {
                            setItems(prev => prev.map(i =>
                                otherItems.some(o => o.id === i.id)
                                    ? { ...i, productName: newName }
                                    : i
                            ));
                        }
                    }
                    // Sync price to other in_stock items with same product in same batch
                    if (priceChanged) {
                        const batchRef2 = getItemBatchRef(editingItem);
                        const otherStockItems = items.filter(i =>
                            i.id !== editingItem.id &&
                            i.status === 'in_stock' &&
                            normalizeText(i.productName) === normalizeText(oldName) &&
                            (i.batchRef || itemBatchMap[i.id]) === batchRef2
                        );
                        for (const other of otherStockItems) {
                            try {
                                await itemService.updateItem(other.id, { salePrice: newSalePrice });
                            } catch (e) {
                                console.error("Error syncing price to related item", e);
                            }
                        }
                        if (otherStockItems.length > 0) {
                            setItems(prev => prev.map(i =>
                                otherStockItems.some(o => o.id === i.id)
                                    ? { ...i, salePrice: newSalePrice }
                                    : i
                            ));
                        }
                    }
                }

                setEditingItem(null);
            } else {
                // Create new item
                const newItemType = (formData.itemType as ItemType) || 'resale';
                const newItemData = {
                    productName: formData.productName || 'Producto sin nombre',
                    purchasePrice: newItemType === 'personal' ? 0 : (Number(formData.purchasePrice) || 0),
                    salePrice: Number(formData.salePrice) || 0,
                    quantity: Number(formData.quantity) || 1,
                    date: formData.date ? getISODate(formData.date) : new Date().toISOString(),
                    status: formData.status as ItemStatus,
                    condition: (formData.condition as ItemCondition) || 'nuevo',
                    itemType: newItemType,
                    location: formData.location || '',
                    estimatedSalePrice: formData.estimatedSalePrice || 0,
                    publishUrls: formData.publishUrls || '',
                    imageUrl: formData.imageUrl || '',
                    saleDate: formData.status === 'sold' ? (formData.date ? getISODate(formData.date) : new Date().toISOString()) : undefined
                };

                // Optimistic UI update (temporary ID)
                const tempId = crypto.randomUUID();
                const tempItem = { id: tempId, ...newItemData } as Item;
                setItems([tempItem, ...items]);

                // Create real item in DB
                const savedItem = await itemService.createItem(newItemData);

                // Replace temp item with real one from server
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

    const handleToggleFacturado = async (id: string, value: boolean) => {
        try {
            setItems(prev => prev.map(i => i.id === id ? { ...i, facturado: value } : i));
            await itemService.updateItem(id, { facturado: value });
        } catch (err) {
            console.error('Error updating facturado:', err);
            loadItems();
        }
    };

    const handleSplitItem = async (item: Item) => {
        if (item.quantity <= 1) return;
        if (confirm(`¿Separar 1 unidad de "${item.productName}" para mover a otra ubicación?`)) {
            try {
                // Optimistic UI updates
                const tempId = crypto.randomUUID();
                const newItem = { ...item, id: tempId, quantity: 1, location: '' };
                const updatedItem = { ...item, quantity: item.quantity - 1 };

                // First, update the visual array: replace the old item with the reduced one, and add the new one.
                setItems(prev => prev.map(i => i.id === item.id ? updatedItem : i).concat(newItem as Item));

                // 1. Update the original item in the DB
                await itemService.updateItem(item.id, { quantity: updatedItem.quantity });

                // 2. Extract parent batchRef to prevent orphaning
                const bRef = getItemBatchRef(item);

                // 3. Create the new separated item in the DB
                const created = await itemService.createItem({
                    productName: item.productName,
                    purchasePrice: item.purchasePrice,
                    salePrice: item.salePrice,
                    quantity: 1,
                    date: item.date,
                    status: item.status,
                    condition: item.condition,
                    itemType: item.itemType || 'resale',
                    batchRef: bRef,
                    location: '',
                    estimatedSalePrice: item.estimatedSalePrice,
                    publishUrls: item.publishUrls,
                    imageUrl: item.imageUrl
                });

                // 4. Update the memory map so it renders properly right away in grouped views
                if (bRef) {
                    setItemBatchMap(prev => {
                        const next = { ...prev, [created.id]: bRef };
                        localStorage.setItem('item_batch_map_v2', JSON.stringify(next));
                        return next;
                    });
                }

                // Replace the temporary optimistic new item with the real one from DB
                setItems(prev => prev.map(i => i.id === tempId ? created : i));

                // Open the modal to edit the newly separated item
                setEditingItem(created);
                setFormData({
                    ...created,
                    status: 'in_stock',
                    date: created.date.split('T')[0]
                });
                setIsModalOpen(true);
            } catch (err) {
                console.error('Error splitting:', err);
                alert('Error al separar la unidad.');
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
            location: item.location || '',
            estimatedSalePrice: item.estimatedSalePrice || 0,
            publishUrls: item.publishUrls || '',
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
            itemType: 'resale',
            date: new Date().toISOString().split('T')[0],
            location: '',
            estimatedSalePrice: 0,
            publishUrls: '',
            imageUrl: ''
        });
        setEditingItem(null);
    };

    const openNewModal = (initialStatus: ItemStatus = 'in_stock') => {
        resetForm();
        setFormData(prev => ({ ...prev, status: initialStatus }));
        setIsModalOpen(true);
    };

    // Metrics Calculations
    const stockItems = items.filter(i => i.status === 'in_stock').sort((a, b) => (a.productName || '').localeCompare(b.productName || ''));
    const soldItems = items.filter(i => i.status === 'sold').sort((a, b) => {
        const dateA = new Date(a.saleDate || a.date || 0).getTime();
        const dateB = new Date(b.saleDate || b.date || 0).getTime();
        return dateB - dateA;
    });
    const soldBatchRefs = Array.from(new Set(soldItems.map(getItemBatchRef).filter(Boolean)));
    const soldDirectCount = soldItems.filter(i => !getItemBatchRef(i)).length;

    const soldResale = soldItems.filter(i => i.itemType !== 'personal');
    const soldPersonal = soldItems.filter(i => i.itemType === 'personal');

    const totalSales = soldItems.reduce((acc, item) => acc + ((item.salePrice || 0) * item.quantity), 0);
    const totalCostSold = soldResale.reduce((acc, item) => acc + (item.purchasePrice * item.quantity), 0);
    const resaleRevenue = soldResale.reduce((acc, item) => acc + ((item.salePrice || 0) * item.quantity), 0);
    const totalProfit = resaleRevenue - totalCostSold;
    const personalIncome = soldPersonal.reduce((acc, item) => acc + ((item.salePrice || 0) * item.quantity), 0);
    const totalUnitsSold = soldItems.reduce((acc, item) => acc + item.quantity, 0);
    const profitMargin = resaleRevenue > 0 ? (totalProfit / resaleRevenue) * 100 : 0;

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
                        <div className="grid grid-cols-4 bg-white p-1 rounded-xl shadow-sm border border-gray-200">
                            <button
                                onClick={() => setActiveTab('dashboard')}
                                className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <TrendingUp className="w-4 h-4" />
                                    <span className="hidden sm:inline">Resumen</span>
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('inventory')}
                                className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'inventory' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <Box className="w-4 h-4" />
                                    <span className="hidden sm:inline">Inventario ({stockItems.length})</span>
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('pricing')}
                                className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'pricing' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <DollarSign className="w-4 h-4" />
                                    <span className="hidden sm:inline">Pedidos</span>
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('facturacion')}
                                className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'facturacion' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                                <div className="flex items-center justify-center gap-2">
                                    <Receipt className="w-4 h-4" />
                                    <span className="hidden sm:inline">ARCA</span>
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

                        {/* Metrics Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
                            <MetricCard
                                title="Ganancia Reventa"
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
                                trend={personalIncome > 0 ? `$${personalIncome.toLocaleString()} propios` : undefined}
                                trendColor="text-violet-600"
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
                                    <HistoryIcon className="w-5 h-5 text-gray-500" />
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
                            <SalesTable items={soldItems} onEdit={startEdit} onDelete={handleDeleteItem} resolveBatchRef={getItemBatchRef} onToggleFacturado={handleToggleFacturado} />
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
                            <InventoryTable items={stockItems} allItems={items} batchHistory={batchHistory} onEdit={startEdit} onDelete={handleDeleteItem} resolveBatchRef={getItemBatchRef} onSplit={handleSplitItem} onSell={(item) => {
                                const resolvedBatchRef = getItemBatchRef(item);
                                setEditingItem({ ...item, batchRef: resolvedBatchRef });
                                setFormData({
                                    ...item,
                                    status: 'sold',
                                    quantity: 1,
                                    salePrice: item.salePrice || item.purchasePrice,
                                    condition: item.condition || 'nuevo',
                                    batchRef: resolvedBatchRef,
                                    location: item.location || '',
                                    estimatedSalePrice: item.estimatedSalePrice || 0,
                                    date: new Date().toISOString().split('T')[0]
                                });
                                setIsModalOpen(true);
                            }} />
                        </div>
                    </div>
                ) : activeTab === 'pricing' ? (
                    <BulkPricingBoard
                        totalPaid={batchTotalPaid}
                        setTotalPaid={setBatchTotalPaid}
                        batchItems={batchItems}
                        setBatchItems={setBatchItems}
                        inventoryItems={items}
                        onInventoryRefresh={loadItems}
                        itemBatchMap={itemBatchMap}
                        setItemBatchMap={setItemBatchMap}
                        batchHistory={batchHistory}
                        setBatchHistory={setBatchHistory}
                    />
                ) : (
                    <FacturacionTab
                        items={soldItems}
                        onToggleFacturado={handleToggleFacturado}
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
                            suggestedNames={Array.from(new Set(items.map(i => i.productName))).filter(Boolean).sort()}
                            suggestedLocations={Array.from(new Set(items.map(i => i.location))).filter(Boolean).sort() as string[]}
                            batchCodes={batchHistory.map(b => b.batchCode)}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

// Subcomponents

// Facturación Tab - Control de facturación ARCA separado del dashboard de ganancias
function FacturacionTab({ items, onToggleFacturado }: {
    items: Item[],
    onToggleFacturado: (id: string, value: boolean) => void
}) {
    const now = new Date();
    const [selectedMonth, setSelectedMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);

    const fmtMoney = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');

    // Cutoff: solo contar ventas desde 18/04/2026 en adelante
    const FACTURACION_CUTOFF = new Date('2026-04-18T00:00:00');
    const afterCutoff = (dateStr?: string) => {
        if (!dateStr) return false;
        return new Date(dateStr) >= FACTURACION_CUTOFF;
    };

    // All facturated items (solo desde la fecha de corte)
    const facturados = items.filter(i => i.facturado && afterCutoff(i.saleDate));

    // Parse selected month
    const [selYear, selMonth] = selectedMonth.split('-').map(Number);

    // Items facturados with saleDate in selected month
    const facturadosMes = facturados.filter(i => {
        if (!i.saleDate) return false;
        const d = new Date(i.saleDate);
        return d.getFullYear() === selYear && d.getMonth() + 1 === selMonth;
    });

    // Total del mes
    const totalMes = facturadosMes.reduce((acc, i) => acc + ((i.salePrice || 0) * i.quantity), 0);

    // Total del año (based on selYear)
    const facturadosAnio = facturados.filter(i => {
        if (!i.saleDate) return false;
        return new Date(i.saleDate).getFullYear() === selYear;
    });
    const totalAnio = facturadosAnio.reduce((acc, i) => acc + ((i.salePrice || 0) * i.quantity), 0);

    // Rolling 12 meses
    const hace12Meses = new Date(now);
    hace12Meses.setDate(hace12Meses.getDate() - 365);
    const facturadosRolling = facturados.filter(i => {
        if (!i.saleDate) return false;
        const d = new Date(i.saleDate);
        return d >= hace12Meses && d <= now;
    });
    const totalRolling = facturadosRolling.reduce((acc, i) => acc + ((i.salePrice || 0) * i.quantity), 0);
    const porcentajeRolling = TOPE.anual > 0 ? (totalRolling / TOPE.anual) * 100 : 0;

    // Progress bar color & message
    const getProgressColor = (pct: number) => {
        if (pct >= 100) return '#ef4444';
        if (pct >= 85) return '#f97316';
        if (pct >= 70) return '#f59e0b';
        return '#10b981';
    };
    const getProgressMessage = (pct: number) => {
        if (pct >= 100) return { icon: '\u{1F6A8}', text: `Excediste el tope categoria ${CATEGORIA_ACTUAL}`, color: 'bg-red-50 text-red-700' };
        if (pct >= 85) return { icon: '\u26A0\uFE0F', text: `Considera pasar a categoria B`, color: 'bg-orange-50 text-orange-700' };
        if (pct >= 70) return { icon: '\u26A0\uFE0F', text: `Acercandote al tope categoria ${CATEGORIA_ACTUAL}`, color: 'bg-amber-50 text-amber-700' };
        return null;
    };
    const progressMsg = getProgressMessage(porcentajeRolling);

    // Monthly totals for the year (for bar chart)
    const monthlyTotals = Array.from({ length: 12 }, (_, m) => {
        const monthItems = facturados.filter(i => {
            if (!i.saleDate) return false;
            const d = new Date(i.saleDate);
            return d.getFullYear() === selYear && d.getMonth() === m;
        });
        return {
            month: m,
            label: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][m],
            total: monthItems.reduce((acc, i) => acc + ((i.salePrice || 0) * i.quantity), 0),
            count: monthItems.length
        };
    });

    // Available months for selector (from items)
    const availableMonths = Array.from(new Set(facturados.map(i => {
        if (!i.saleDate) return null;
        const d = new Date(i.saleDate);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }).filter(Boolean) as string[])).sort().reverse();

    // Ensure current month is always in options
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (!availableMonths.includes(currentMonthKey)) {
        availableMonths.unshift(currentMonthKey);
    }
    if (!availableMonths.includes(selectedMonth)) {
        availableMonths.push(selectedMonth);
        availableMonths.sort().reverse();
    }

    const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    // barMax must account for reference lines
    const barMax = Math.max(...monthlyTotals.map(m => m.total), TOPE.mensualTope * 1.15, 1);

    // Reference line positions as percentages
    const lineTopePercent = (TOPE.mensualTope / barMax) * 100;
    const lineSeguroPercent = (TOPE.mensualSeguro / barMax) * 100;

    return (
        <div className="space-y-5 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                    <div>
                        <h2 className="text-lg sm:text-xl font-bold text-gray-800 flex items-center gap-2">
                            <Receipt className="w-5 h-5 text-blue-600" />
                            Control de Facturacion ARCA
                        </h2>
                        <p className="text-gray-500 text-sm mt-1">Seguimiento de ventas facturadas — separado de ganancias e inventario.</p>
                    </div>
                    <select
                        value={selectedMonth}
                        onChange={e => setSelectedMonth(e.target.value)}
                        className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        {availableMonths.map(m => {
                            const [y, mo] = m.split('-').map(Number);
                            return <option key={m} value={m}>{monthNames[mo - 1]} {y}</option>;
                        })}
                    </select>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                    <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Facturado este mes</p>
                    <p className="text-2xl font-bold text-gray-900 mt-2">{fmtMoney(totalMes)}</p>
                    <p className="text-sm text-gray-500 mt-1">{facturadosMes.length} {facturadosMes.length === 1 ? 'venta' : 'ventas'}</p>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                    <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Facturado en {selYear}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-2">{fmtMoney(totalAnio)}</p>
                    <p className="text-sm text-gray-500 mt-1">{facturadosAnio.length} ventas facturadas</p>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                    <div className="flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                        <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Rolling 12 meses</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 mt-2">{fmtMoney(totalRolling)}</p>
                    <p className="text-sm text-gray-500 mt-1">{facturadosRolling.length} ventas — ultimos 365 dias</p>
                </div>
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                    <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">Tope anual cat. {CATEGORIA_ACTUAL}</p>
                    <p className="text-2xl font-bold text-gray-900 mt-2">{fmtMoney(TOPE.anual)}</p>
                    <p className="text-sm text-gray-500 mt-1">{fmtMoney(TOPE.anual - totalRolling)} restante</p>
                </div>
            </div>

            {/* Progress bar — rolling 12 meses */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex justify-between items-center mb-3">
                    <p className="text-sm font-semibold text-gray-700">Progreso rolling 12 meses vs tope cat. {CATEGORIA_ACTUAL}</p>
                    <p className="text-sm font-bold" style={{ color: getProgressColor(porcentajeRolling) }}>
                        {porcentajeRolling.toFixed(1)}%
                    </p>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                            width: `${Math.min(porcentajeRolling, 100)}%`,
                            backgroundColor: getProgressColor(porcentajeRolling)
                        }}
                    />
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-400">
                    <span>{fmtMoney(totalRolling)} facturado</span>
                    <span>{fmtMoney(Math.max(TOPE.anual - totalRolling, 0))} restante</span>
                </div>
                {progressMsg && (
                    <div className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${progressMsg.color}`}>
                        <span>{progressMsg.icon}</span>
                        <span>{progressMsg.text}</span>
                    </div>
                )}
            </div>

            {/* Monthly bar chart with reference lines */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
                <p className="text-sm font-semibold text-gray-700 mb-4">Facturado por mes — {selYear}</p>
                <div className="relative">
                    {/* Reference lines */}
                    <div
                        className="absolute left-0 right-0 border-t-2 border-dashed border-gray-300 z-10 pointer-events-none"
                        style={{ bottom: `${lineTopePercent}%` }}
                    >
                        <span className="absolute right-0 -top-4 text-[9px] text-gray-400 font-medium bg-white px-1">
                            {fmtMoney(TOPE.mensualTope)} tope
                        </span>
                    </div>
                    <div
                        className="absolute left-0 right-0 border-t-2 border-dashed border-emerald-400 z-10 pointer-events-none"
                        style={{ bottom: `${lineSeguroPercent}%` }}
                    >
                        <span className="absolute right-0 -top-4 text-[9px] text-emerald-500 font-medium bg-white px-1">
                            {fmtMoney(TOPE.mensualSeguro)} holgado
                        </span>
                    </div>
                    <div className="flex items-end gap-1 sm:gap-2 h-44">
                        {monthlyTotals.map(m => {
                            const barColor = m.total > TOPE.mensualTope
                                ? 'bg-red-500'
                                : m.total > TOPE.mensualSeguro
                                    ? 'bg-amber-400'
                                    : m.month === selMonth - 1
                                        ? 'bg-blue-600'
                                        : m.total > 0
                                            ? 'bg-blue-200 hover:bg-blue-300'
                                            : 'bg-gray-100';
                            return (
                                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                                    <span className="text-[10px] text-gray-500 font-medium">
                                        {m.total > 0 ? `$${(m.total / 1000).toFixed(0)}k` : ''}
                                    </span>
                                    <div
                                        className={`w-full rounded-t-md transition-all duration-500 cursor-pointer ${barColor}`}
                                        style={{ height: `${Math.max((m.total / barMax) * 100, m.total > 0 ? 4 : 1)}%` }}
                                        title={`${monthNames[m.month]}: ${fmtMoney(m.total)} (${m.count} ventas)`}
                                        onClick={() => setSelectedMonth(`${selYear}-${String(m.month + 1).padStart(2, '0')}`)}
                                    />
                                    <span className={`text-[10px] font-medium ${m.month === selMonth - 1 ? 'text-blue-600' : 'text-gray-400'}`}>
                                        {m.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
                {/* Sugerencia de tope mensual */}
                <p className="mt-4 text-xs text-gray-400 text-center">
                    Para mantenerte holgado en cat. {CATEGORIA_ACTUAL}, no factures mas de <span className="font-semibold text-gray-600">{fmtMoney(TOPE.mensualSeguro)}/mes</span> (tope anual / 12 x 0.85).
                </p>
            </div>

            {/* Table of facturados del mes */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-4 sm:p-6 border-b border-gray-100 flex justify-between items-center">
                    <h3 className="font-bold text-gray-800">
                        Facturadas — {monthNames[selMonth - 1]} {selYear}
                    </h3>
                    <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-lg font-medium">
                        {facturadosMes.length} {facturadosMes.length === 1 ? 'venta' : 'ventas'}
                    </span>
                </div>
                {facturadosMes.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">
                        <Receipt className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No hay ventas facturadas en este mes.</p>
                    </div>
                ) : (
                    <>
                        {/* Mobile cards */}
                        <div className="sm:hidden p-3 space-y-3">
                            {facturadosMes.map(item => (
                                <div key={item.id} className="rounded-xl border border-gray-200 p-4">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="font-semibold text-gray-900">{item.productName}</p>
                                            <p className="text-xs text-gray-500 mt-0.5">{item.saleDate ? formatDateDDMMAAAA(item.saleDate) : '-'}</p>
                                        </div>
                                        <p className="font-bold text-gray-900">{fmtMoney((item.salePrice || 0) * item.quantity)}</p>
                                    </div>
                                    <div className="mt-2 flex justify-between items-center text-sm">
                                        <span className="text-gray-500">x{item.quantity} a {fmtMoney(item.salePrice || 0)}</span>
                                        <button
                                            onClick={() => onToggleFacturado(item.id, false)}
                                            className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                                        >
                                            <XCircle className="w-3 h-3" />
                                            Desmarcar
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {/* Desktop table */}
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-left text-sm text-gray-600">
                                <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs tracking-wider">
                                    <tr>
                                        <th className="px-6 py-3">Producto</th>
                                        <th className="px-6 py-3 text-center">Cant.</th>
                                        <th className="px-6 py-3 text-right">Precio Unit.</th>
                                        <th className="px-6 py-3 text-right">Total</th>
                                        <th className="px-6 py-3 text-center">Fecha</th>
                                        <th className="px-6 py-3 text-center">Estado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {facturadosMes.map(item => (
                                        <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="px-6 py-4 font-medium text-gray-900">{item.productName}</td>
                                            <td className="px-6 py-4 text-center">
                                                <span className="bg-gray-100 text-gray-700 px-2 py-0.5 rounded text-xs font-semibold">{item.quantity}</span>
                                            </td>
                                            <td className="px-6 py-4 text-right font-mono">{fmtMoney(item.salePrice || 0)}</td>
                                            <td className="px-6 py-4 text-right font-mono font-bold text-gray-900">{fmtMoney((item.salePrice || 0) * item.quantity)}</td>
                                            <td className="px-6 py-4 text-center text-xs text-gray-500">{item.saleDate ? formatDateDDMMAAAA(item.saleDate) : '-'}</td>
                                            <td className="px-6 py-4 text-center">
                                                <button
                                                    onClick={() => onToggleFacturado(item.id, false)}
                                                    className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded transition-colors inline-flex items-center gap-1"
                                                    title="Desmarcar facturacion"
                                                >
                                                    <XCircle className="w-3 h-3" />
                                                    Desmarcar
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-gray-50 font-bold text-gray-900">
                                        <td className="px-6 py-3" colSpan={3}>Total del mes</td>
                                        <td className="px-6 py-3 text-right font-mono">{fmtMoney(totalMes)}</td>
                                        <td colSpan={2}></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </>
                )}
            </div>

            {/* Ventas sin facturar */}
            {(() => {
                const sinFacturar = items.filter(i => !i.facturado && i.saleDate && afterCutoff(i.saleDate));
                if (sinFacturar.length === 0) return null;
                return (
                    <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
                        <div className="p-4 sm:p-6 border-b border-amber-100 bg-amber-50/50">
                            <h3 className="font-bold text-amber-800 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />
                                Ventas sin facturar ({sinFacturar.length})
                            </h3>
                            <p className="text-sm text-amber-600 mt-1">Estas ventas aun no fueron marcadas como facturadas.</p>
                        </div>
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-left text-sm text-gray-600">
                                <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs tracking-wider">
                                    <tr>
                                        <th className="px-6 py-3">Producto</th>
                                        <th className="px-6 py-3 text-center">Cant.</th>
                                        <th className="px-6 py-3 text-right">Precio Unit.</th>
                                        <th className="px-6 py-3 text-right">Total</th>
                                        <th className="px-6 py-3 text-center">Fecha Venta</th>
                                        <th className="px-6 py-3 text-center">Accion</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {sinFacturar.slice(0, 20).map(item => (
                                        <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                                            <td className="px-6 py-3 font-medium text-gray-900">{item.productName}</td>
                                            <td className="px-6 py-3 text-center text-xs">{item.quantity}</td>
                                            <td className="px-6 py-3 text-right font-mono text-xs">{fmtMoney(item.salePrice || 0)}</td>
                                            <td className="px-6 py-3 text-right font-mono font-medium">{fmtMoney((item.salePrice || 0) * item.quantity)}</td>
                                            <td className="px-6 py-3 text-center text-xs text-gray-500">{item.saleDate ? formatDateDDMMAAAA(item.saleDate) : '-'}</td>
                                            <td className="px-6 py-3 text-center">
                                                <button
                                                    onClick={() => onToggleFacturado(item.id, true)}
                                                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1 rounded transition-colors inline-flex items-center gap-1"
                                                >
                                                    <CheckCircle className="w-3 h-3" />
                                                    Marcar facturada
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div className="sm:hidden p-3 space-y-2">
                            {sinFacturar.slice(0, 20).map(item => (
                                <div key={item.id} className="flex justify-between items-center rounded-lg border border-gray-200 p-3">
                                    <div>
                                        <p className="font-medium text-gray-900 text-sm">{item.productName}</p>
                                        <p className="text-xs text-gray-500">{fmtMoney((item.salePrice || 0) * item.quantity)} — {item.saleDate ? formatDateDDMMAAAA(item.saleDate) : ''}</p>
                                    </div>
                                    <button
                                        onClick={() => onToggleFacturado(item.id, true)}
                                        className="bg-blue-600 text-white text-xs px-2 py-1 rounded flex-shrink-0"
                                    >
                                        Facturar
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

// Helper: format date to DD/MM/AAAA with zero-padded day/month
function formatDateDDMMAAAA(dateStr: string): string {
    const d = new Date(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

// Facturar ARCA Modal
function FacturarModal({ item, onClose, onFacturado }: { item: Item; onClose: () => void; onFacturado?: (id: string) => void }) {
    const [producto, setProducto] = useState(item.productName);
    const [cantidad, setCantidad] = useState(item.quantity);
    const [precio, setPrecio] = useState(item.salePrice || 0);
    const [fecha, setFecha] = useState(() => {
        if (!item.saleDate) return '';
        const d = new Date(item.saleDate);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const [formaPago, setFormaPago] = useState('transferencia');

    const formasPago = [
        { label: 'Contado', value: 'contado' },
        { label: 'Tarjeta de Débito', value: 'tarjeta_debito' },
        { label: 'Tarjeta de Crédito', value: 'tarjeta_credito' },
        { label: 'Cuenta Corriente', value: 'cuenta_corriente' },
        { label: 'Cheque', value: 'cheque' },
        { label: 'Transferencia Bancaria', value: 'transferencia' },
        { label: 'Otra', value: 'otra' },
        { label: 'Otros medios de pago electrónico', value: 'electronico' },
    ];

    const handleFacturar = () => {
        const [y, m, d] = fecha.split('-');
        const fechaFormatted = `${d}/${m}/${y}`;
        const ventaObj = {
            fecha: fechaFormatted,
            producto,
            cantidad,
            precio: Math.round(precio),
            formaPago,
        };
        const base64 = btoa(JSON.stringify(ventaObj));
        const url = `https://fe.afip.gob.ar/rcel/jsp/index_bis.jsp?venta=${encodeURIComponent(base64)}`;
        window.open(url, '_blank');
        onFacturado?.(item.id);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md ring-1 ring-white/10" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-gray-700/50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-blue-600/20 flex items-center justify-center">
                            <FileText className="w-5 h-5 text-blue-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Facturar en ARCA</h2>
                            <p className="text-sm text-gray-400">Verificá los datos antes de facturar</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="h-8 w-8 rounded-full bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700 flex items-center justify-center transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Producto</label>
                        <input
                            type="text"
                            value={producto}
                            onChange={e => setProducto(e.target.value)}
                            className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">Cantidad</label>
                            <input
                                type="number"
                                min={1}
                                value={cantidad}
                                onChange={e => setCantidad(Number(e.target.value))}
                                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1.5">Precio unitario</label>
                            <input
                                type="number"
                                min={0}
                                value={precio}
                                onChange={e => setPrecio(Number(e.target.value))}
                                className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Fecha</label>
                        <input
                            type="date"
                            value={fecha}
                            onChange={e => setFecha(e.target.value)}
                            className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all [color-scheme:dark]"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1.5">Forma de pago</label>
                        <select
                            value={formaPago}
                            onChange={e => setFormaPago(e.target.value)}
                            className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all appearance-none"
                        >
                            {formasPago.map(fp => (
                                <option key={fp.value} value={fp.value}>{fp.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/50">
                        <p className="text-xs text-gray-400">
                            Total: <span className="text-white font-semibold text-sm">${(cantidad * Math.round(precio)).toLocaleString()}</span>
                        </p>
                    </div>
                </div>
                <div className="p-6 border-t border-gray-700/50 flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2.5 bg-gray-800 text-gray-300 rounded-xl hover:bg-gray-700 transition-colors font-medium text-sm"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleFacturar}
                        className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium text-sm flex items-center justify-center gap-2"
                    >
                        <FileText className="w-4 h-4" />
                        Facturar en ARCA
                    </button>
                </div>
            </div>
        </div>
    );
}

function SalesTable({ items, onEdit, onDelete, resolveBatchRef, onToggleFacturado }: {
    items: Item[],
    onEdit: (i: Item) => void,
    onDelete: (id: string) => void,
    resolveBatchRef: (item: Item) => string | undefined,
    onToggleFacturado: (id: string, value: boolean) => void
}) {
    const [facturarItem, setFacturarItem] = useState<Item | null>(null);
    const FACTURACION_CUTOFF = new Date('2026-04-18T00:00:00');
    const canFacturar = (item: Item) => item.saleDate && new Date(item.saleDate) >= FACTURACION_CUTOFF;

    if (items.length === 0) {
        return <div className="p-8 sm:p-12 text-center text-gray-400">No hay ventas registradas aún.</div>;
    }

    return (
        <>
            {facturarItem && <FacturarModal item={facturarItem} onClose={() => setFacturarItem(null)} onFacturado={(id) => onToggleFacturado(id, true)} />}
            <div className="sm:hidden p-3 space-y-3">
                {items.map((item) => {
                    const profit = ((item.salePrice || 0) * item.quantity) - (item.purchasePrice * item.quantity);
                    const isPositive = profit >= 0;

                    return (
                        <div key={item.id} className={`rounded-2xl border p-4 shadow-sm ${item.itemType === 'personal' ? 'border-violet-200 bg-violet-50/30' : 'border-gray-200 bg-white'}`}>
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    {item.imageUrl && (
                                        <div className="w-10 h-10 rounded-lg overflow-hidden border border-gray-100 flex-shrink-0">
                                            <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                                        </div>
                                    )}
                                    <div>
                                        <h3 className="font-semibold text-gray-900 leading-tight">{item.productName}</h3>
                                        {item.itemType === 'personal' && <span className="text-[10px] font-bold bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded mt-0.5 inline-block">PROPIO</span>}
                                    </div>
                                </div>
                                <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-md text-xs font-semibold shrink-0">
                                    x{item.quantity}
                                </span>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                                {item.itemType !== 'personal' && (
                                    <div>
                                        <p className="text-gray-400 text-xs">Compra</p>
                                        <p className="font-medium text-gray-700">${item.purchasePrice.toLocaleString()}</p>
                                    </div>
                                )}
                                <div>
                                    <p className="text-gray-400 text-xs">Venta</p>
                                    <p className="font-medium text-gray-900">${item.salePrice?.toLocaleString()}</p>
                                </div>
                                <div>
                                    <p className="text-gray-400 text-xs">{item.itemType === 'personal' ? 'Ingreso' : 'Ganancia'}</p>
                                    {item.itemType === 'personal' ? (
                                        <p className="font-bold text-violet-600">${((item.salePrice || 0) * item.quantity).toLocaleString()}</p>
                                    ) : (
                                        <p className={`font-bold flex items-center gap-1 ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                            ${Math.abs(profit).toLocaleString()}
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <p className="text-gray-400 text-xs">Fecha</p>
                                    <p className="font-medium text-gray-700">{item.saleDate ? formatDateDDMMAAAA(item.saleDate) : '-'}</p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-gray-400 text-xs">Estado</p>
                                    <p className="font-medium text-gray-700">{conditionLabelMap[item.condition || 'nuevo']}</p>
                                </div>
                                <div className="col-span-1">
                                    <p className="text-gray-400 text-xs">Ubicación</p>
                                    <p className="font-medium text-gray-700">{item.location || '-'}</p>
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
                                {item.facturado ? (
                                    <button
                                        onClick={() => onToggleFacturado(item.id, false)}
                                        className="flex-1 h-10 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                                    >
                                        <CheckCircle className="w-4 h-4" />
                                        Facturada
                                    </button>
                                ) : canFacturar(item) ? (
                                    <button
                                        onClick={() => setFacturarItem(item)}
                                        className="flex-1 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                                    >
                                        <FileText className="w-4 h-4" />
                                        Facturar
                                    </button>
                                ) : (
                                    <span className="flex-1 h-10 rounded-xl text-gray-500 text-sm font-medium flex items-center justify-center">—</span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-sm text-gray-600">
                    <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs tracking-wider">
                        <tr>
                            <th className="px-6 py-4 w-12 text-center">Img</th>
                            <th className="px-6 py-4">Producto</th>
                            <th className="px-6 py-4 text-center">Unidades</th>
                            <th className="px-6 py-4 text-right">Compra (Unit)</th>
                            <th className="px-6 py-4 text-right">Venta (Unit)</th>
                            <th className="px-6 py-4 text-right">Ganancia</th>
                            <th className="px-6 py-4 text-center">Estado</th>
                            <th className="px-6 py-4 text-center">Ubicación</th>
                            <th className="px-6 py-4 text-center">Tanda</th>
                            <th className="px-6 py-4 text-center">Fecha Venta</th>
                            <th className="px-6 py-4 text-center">Facturar</th>
                            <th className="px-6 py-4 text-center">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {items.map((item) => {
                            const profit = ((item.salePrice || 0) * item.quantity) - (item.purchasePrice * item.quantity);
                            const isPositive = profit >= 0;
                            return (
                                <tr key={item.id} className={`hover:bg-gray-50/50 transition-colors group ${item.itemType === 'personal' ? 'bg-violet-50/30' : ''}`}>
                                    <td className="px-6 py-4">
                                        {item.imageUrl ? (
                                            <div className="w-10 h-10 rounded-lg overflow-hidden border border-gray-100">
                                                <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                                            </div>
                                        ) : (
                                            <div className={`w-10 h-10 rounded-lg border border-dashed flex items-center justify-center ${item.itemType === 'personal' ? 'bg-violet-50 border-violet-200' : 'bg-gray-50 border-gray-200'}`}>
                                                {item.itemType === 'personal' && <User className="w-4 h-4 text-violet-400" />}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 font-medium text-gray-900">
                                        <div className="flex items-center gap-2">
                                            {item.productName}
                                            {item.itemType === 'personal' && <span className="text-[10px] font-bold bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded">PROPIO</span>}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-md text-xs font-semibold">{item.quantity}</span>
                                    </td>
                                    <td className="px-6 py-4 text-right font-mono text-gray-500">{item.itemType === 'personal' ? <span className="text-violet-400">-</span> : `$${item.purchasePrice.toLocaleString()}`}</td>
                                    <td className="px-6 py-4 text-right font-mono font-medium text-gray-900">${item.salePrice?.toLocaleString()}</td>
                                    <td className={`px-6 py-4 text-right font-bold w-32 ${item.itemType === 'personal' ? 'text-violet-600' : isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {item.itemType === 'personal' ? (
                                            <div className="flex items-center justify-end gap-1">
                                                ${((item.salePrice || 0) * item.quantity).toLocaleString()}
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-end gap-1">
                                                {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                                ${Math.abs(profit).toLocaleString()}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-center text-xs font-semibold text-gray-700">
                                        {conditionLabelMap[item.condition || 'nuevo']}
                                    </td>
                                    <td className="px-6 py-4 text-center text-xs text-gray-600 font-medium">
                                        {item.location || '-'}
                                    </td>
                                    <td className="px-6 py-4 text-center text-xs text-gray-600 font-medium">
                                        {resolveBatchRef(item) || 'Directa'}
                                    </td>
                                    <td className="px-6 py-4 text-center text-gray-400 text-xs">
                                        {item.saleDate ? formatDateDDMMAAAA(item.saleDate) : '-'}
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        {item.facturado ? (
                                            <button
                                                onClick={() => onToggleFacturado(item.id, false)}
                                                className="bg-green-600 hover:bg-green-700 text-white text-xs px-2 py-1 rounded transition-colors inline-flex items-center gap-1"
                                                title="Click para desmarcar facturacion"
                                            >
                                                <CheckCircle className="w-3 h-3" />
                                                Facturada
                                            </button>
                                        ) : canFacturar(item) ? (
                                            <button
                                                onClick={() => setFacturarItem(item)}
                                                className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1 rounded transition-colors inline-flex items-center gap-1"
                                            >
                                                <FileText className="w-3 h-3" />
                                                Facturar
                                            </button>
                                        ) : (
                                            <span className="text-gray-500 text-xs">—</span>
                                        )}
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

function InventoryTable({ items, allItems, onEdit, onDelete, onSell, resolveBatchRef, onSplit, batchHistory }: {
    items: Item[],
    allItems: Item[],
    onEdit: (i: Item) => void,
    onDelete: (id: string) => void,
    onSell: (i: Item) => void,
    resolveBatchRef: (item: Item) => string | undefined,
    onSplit: (i: Item) => void,
    batchHistory: BatchRecord[]
}) {
    type ViewMode = 'products' | 'locations';
    const [viewMode, setViewMode] = useState<ViewMode>('products');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    // Compute effective batch status for a set of batch codes
    const getBatchStatus = (batchCodes: string[]): { label: string; color: string } | null => {
        if (batchCodes.length === 0) return null;
        // Check each batch and pick the most relevant status
        const statuses = batchCodes.map(code => {
            const batch = batchHistory.find(b => b.batchCode === code);
            if (!batch) return null;
            // Check if ALL sell-disposition items from this batch are sold
            const batchItems = allItems.filter(i => (i.batchRef || '') === code || resolveBatchRef(i) === code);
            const sellItems = batchItems.filter(i => i.itemType !== 'personal');
            const allSold = sellItems.length > 0 && sellItems.every(i => i.status === 'sold');
            if (allSold) return 'completado' as BatchStatus;
            return batch.batchStatus;
        }).filter(Boolean) as BatchStatus[];
        if (statuses.length === 0) return null;
        // Priority: en_camino > recibido > completado (show most urgent)
        if (statuses.includes('en_camino')) return { label: 'En camino', color: 'bg-yellow-100 text-yellow-700' };
        if (statuses.includes('recibido')) return { label: 'Retirado', color: 'bg-blue-100 text-blue-700' };
        if (statuses.every(s => s === 'completado')) return { label: 'Completado', color: 'bg-emerald-100 text-emerald-700' };
        return null;
    };

    if (items.length === 0) {
        return <div className="p-8 sm:p-12 text-center text-gray-400">Tu inventario está vacío. Agrega productos para comenzar.</div>;
    }

    // --- Product groups: group by normalized name ---
    type ProductGroup = {
        key: string;
        name: string;
        imageUrl?: string;
        totalQty: number;
        avgCost: number;
        totalValue: number;
        locations: { loc: string; qty: number }[];
        batches: string[];
        children: Item[];
        isPersonal: boolean;
    };

    const productGroups: ProductGroup[] = (() => {
        const map = new Map<string, ProductGroup>();
        items.forEach(item => {
            const normName = normalizeText(item.productName);
            let grp = map.get(normName);
            if (!grp) {
                grp = { key: normName, name: item.productName, imageUrl: item.imageUrl, totalQty: 0, avgCost: 0, totalValue: 0, locations: [], batches: [], children: [], isPersonal: false };
                map.set(normName, grp);
            }
            grp.children.push(item);
            grp.totalQty += item.quantity;
            grp.totalValue += item.purchasePrice * item.quantity;
            if (!grp.imageUrl && item.imageUrl) grp.imageUrl = item.imageUrl;
            const loc = item.location || 'Sin ubicación';
            const existingLoc = grp.locations.find(l => normalizeText(l.loc) === normalizeText(loc));
            if (existingLoc) existingLoc.qty += item.quantity;
            else grp.locations.push({ loc, qty: item.quantity });
            const bRef = resolveBatchRef(item);
            if (bRef && !grp.batches.includes(bRef)) grp.batches.push(bRef);
        });
        for (const grp of map.values()) {
            grp.avgCost = grp.totalQty > 0 ? Math.round(grp.totalValue / grp.totalQty) : 0;
            grp.isPersonal = grp.children.every(c => c.itemType === 'personal');
        }
        return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    })();

    // --- Location groups ---
    type LocationGroup = {
        key: string;
        location: string;
        totalQty: number;
        totalValue: number;
        products: { name: string; qty: number; avgCost: number; items: Item[] }[];
    };

    const locationGroups: LocationGroup[] = (() => {
        const map = new Map<string, LocationGroup>();
        items.forEach(item => {
            const loc = item.location || 'Sin ubicación';
            const locKey = normalizeText(loc);
            let grp = map.get(locKey);
            if (!grp) {
                grp = { key: locKey, location: loc, totalQty: 0, totalValue: 0, products: [] };
                map.set(locKey, grp);
            }
            grp.totalQty += item.quantity;
            grp.totalValue += item.purchasePrice * item.quantity;
            const normName = normalizeText(item.productName);
            let prod = grp.products.find(p => normalizeText(p.name) === normName);
            if (!prod) {
                prod = { name: item.productName, qty: 0, avgCost: 0, items: [] };
                grp.products.push(prod);
            }
            prod.qty += item.quantity;
            prod.items.push(item);
        });
        for (const grp of map.values()) {
            for (const prod of grp.products) {
                const totalCost = prod.items.reduce((a, i) => a + i.purchasePrice * i.quantity, 0);
                prod.avgCost = prod.qty > 0 ? Math.round(totalCost / prod.qty) : 0;
            }
            grp.products.sort((a, b) => a.name.localeCompare(b.name));
        }
        return Array.from(map.values()).sort((a, b) => a.location.localeCompare(b.location));
    })();

    return (
        <>
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-gray-500">
                    {productGroups.length} productos · {items.reduce((a, i) => a + i.quantity, 0)} unidades · ${items.filter(i => i.itemType !== 'personal').reduce((a, i) => a + i.purchasePrice * i.quantity, 0).toLocaleString('es-AR')} invertido
                    {items.some(i => i.itemType === 'personal') && <span className="text-violet-500 ml-1">· {items.filter(i => i.itemType === 'personal').reduce((a, i) => a + i.quantity, 0)} propios</span>}
                </p>
                <div className="flex gap-1.5">
                    <button
                        onClick={() => { setViewMode('products'); setExpandedGroups(new Set()); }}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${viewMode === 'products' ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                    >
                        <Layers className="w-3.5 h-3.5" />
                        Por Producto
                    </button>
                    <button
                        onClick={() => { setViewMode('locations'); setExpandedGroups(new Set()); }}
                        className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${viewMode === 'locations' ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                    >
                        <MapPin className="w-3.5 h-3.5" />
                        Por Ubicación
                    </button>
                </div>
            </div>

            {/* ===== MOBILE VIEW ===== */}
            <div className="sm:hidden p-3 space-y-3">
                {viewMode === 'products' ? productGroups.map((grp) => (
                    <div key={grp.key} className={`rounded-2xl border shadow-sm overflow-hidden ${grp.isPersonal ? 'border-violet-200 bg-violet-50/30' : 'border-gray-200 bg-white'}`}>
                        <button type="button" onClick={() => toggleGroup(grp.key)} className="w-full p-4 text-left">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3">
                                    {grp.imageUrl ? (
                                        <div className="w-10 h-10 rounded-lg overflow-hidden border border-gray-100 flex-shrink-0">
                                            <img src={grp.imageUrl} alt="" className="w-full h-full object-cover" />
                                        </div>
                                    ) : (
                                        <div className={`w-10 h-10 rounded-lg border border-dashed flex-shrink-0 flex items-center justify-center ${grp.isPersonal ? 'bg-violet-50 border-violet-200' : 'bg-gray-50 border-gray-200'}`}>
                                            {grp.isPersonal && <User className="w-4 h-4 text-violet-400" />}
                                        </div>
                                    )}
                                    <div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="font-semibold text-gray-900 leading-tight">{grp.name}</h3>
                                            {grp.isPersonal && <span className="text-[10px] font-bold bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded">PROPIO</span>}
                                            {(() => {
                                                const status = getBatchStatus(grp.batches);
                                                if (!status) return null;
                                                return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>;
                                            })()}
                                        </div>
                                        <p className="text-xs text-gray-400 mt-0.5">
                                            {grp.locations.map(l => `${l.loc} (${l.qty})`).join(' · ')}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <span className={`px-2 py-1 rounded-md text-xs font-semibold text-white ${grp.isPersonal ? 'bg-violet-500' : 'bg-blue-600'}`}>{grp.totalQty}</span>
                                    {expandedGroups.has(grp.key) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                                </div>
                            </div>
                            <div className="mt-2 flex gap-4 text-xs text-gray-500">
                                {!grp.isPersonal && <span>Prom: ${grp.avgCost.toLocaleString('es-AR')}/u</span>}
                                {!grp.isPersonal && <span>Total: ${grp.totalValue.toLocaleString('es-AR')}</span>}
                                {grp.isPersonal && <span className="text-violet-500">Solo ingreso (sin costo)</span>}
                                <span>{grp.batches.map(b => getBatchLabel(b)).join(', ') || 'Directa'}</span>
                            </div>
                        </button>
                        {expandedGroups.has(grp.key) && (
                            <div className="border-t border-gray-100 bg-gray-50/50 p-3 space-y-2">
                                {grp.children.map(item => (
                                    <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-3">
                                        <div className="flex justify-between items-center text-sm">
                                            <div>
                                                <span className="text-gray-700 font-medium">{getBatchLabel(resolveBatchRef(item))}</span>
                                                <span className="text-gray-400 mx-2">·</span>
                                                <span className="text-gray-500">{item.location || 'Sin ubicación'}</span>
                                            </div>
                                            <span className="text-xs font-semibold text-gray-600">×{item.quantity}</span>
                                        </div>
                                        <div className="flex gap-4 text-xs text-gray-500 mt-1">
                                            <span>Costo: ${item.purchasePrice.toLocaleString('es-AR')}/u</span>
                                            <span>{conditionLabelMap[item.condition || 'nuevo']}</span>
                                        </div>
                                        <div className="flex gap-2 mt-2">
                                            <button onClick={() => onSell(item)} className="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md">Vender</button>
                                            <button onClick={() => onEdit(item)} className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded-md">Editar</button>
                                            {item.quantity > 1 && <button onClick={() => onSplit(item)} className="text-[10px] font-bold bg-amber-50 text-amber-700 px-2 py-1 rounded-md">Separar</button>}
                                            <button onClick={() => onDelete(item.id)} className="text-[10px] font-bold bg-rose-50 text-rose-700 px-2 py-1 rounded-md">Eliminar</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )) : locationGroups.map((grp) => (
                    <div key={grp.key} className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                        <button type="button" onClick={() => toggleGroup(grp.key)} className="w-full p-4 text-left">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <MapPin className="w-4 h-4 text-blue-500" />
                                    <h3 className="font-semibold text-gray-900">{grp.location}</h3>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="bg-blue-600 text-white px-2 py-1 rounded-md text-xs font-semibold">{grp.totalQty}</span>
                                    {expandedGroups.has(grp.key) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                                </div>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">{grp.products.length} productos · ${grp.totalValue.toLocaleString('es-AR')}</p>
                        </button>
                        {expandedGroups.has(grp.key) && (
                            <div className="border-t border-gray-100 bg-gray-50/50 p-3 space-y-2">
                                {grp.products.map((prod) => (
                                    <div key={prod.name} className="bg-white rounded-xl border border-gray-100 p-3">
                                        <div className="flex justify-between items-center text-sm">
                                            <span className="font-medium text-gray-900">{prod.name}</span>
                                            <span className="text-xs font-semibold text-gray-600">×{prod.qty}</span>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Costo prom: ${prod.avgCost.toLocaleString('es-AR')}/u</p>
                                        <div className="flex gap-2 mt-2 flex-wrap">
                                            {prod.items.map(item => (
                                                <div key={item.id} className="flex gap-1">
                                                    <button onClick={() => onSell(item)} className="text-[10px] font-bold bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md">Vender</button>
                                                    <button onClick={() => onEdit(item)} className="text-[10px] font-bold bg-blue-50 text-blue-700 px-2 py-1 rounded-md">Editar</button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* ===== DESKTOP VIEW ===== */}
            <div className="hidden sm:block overflow-x-auto">
                {viewMode === 'products' ? (
                    <table className="w-full text-left text-sm text-gray-600">
                        <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs tracking-wider">
                            <tr>
                                <th className="px-4 py-3 w-8"></th>
                                <th className="px-4 py-3 w-10">Img</th>
                                <th className="px-4 py-3">Producto</th>
                                <th className="px-4 py-3 text-center">Stock</th>
                                <th className="px-4 py-3 text-right">Costo Prom.</th>
                                <th className="px-4 py-3 text-right">Valor Total</th>
                                <th className="px-4 py-3 text-center">Ubicaciones</th>
                                <th className="px-4 py-3 text-center">Tandas</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {productGroups.map((grp) => (
                                <>{/* Fragment key on first tr */}
                                    <tr
                                        key={grp.key}
                                        onClick={() => toggleGroup(grp.key)}
                                        className={`hover:bg-gray-50/50 transition-colors cursor-pointer group ${grp.isPersonal ? 'bg-violet-50/40' : ''}`}
                                    >
                                        <td className="px-4 py-3 text-gray-400">
                                            {expandedGroups.has(grp.key) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </td>
                                        <td className="px-4 py-3">
                                            {grp.imageUrl ? (
                                                <div className="w-9 h-9 rounded-lg overflow-hidden border border-gray-100">
                                                    <img src={grp.imageUrl} alt="" className="w-full h-full object-cover" />
                                                </div>
                                            ) : (
                                                <div className={`w-9 h-9 rounded-lg border border-dashed flex items-center justify-center ${grp.isPersonal ? 'bg-violet-50 border-violet-200' : 'bg-gray-50 border-gray-200'}`}>
                                                    {grp.isPersonal && <User className="w-3.5 h-3.5 text-violet-400" />}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 font-medium text-gray-900">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                {grp.name}
                                                {grp.isPersonal && <span className="text-[10px] font-bold bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded">PROPIO</span>}
                                                {(() => {
                                                    const status = getBatchStatus(grp.batches);
                                                    if (!status) return null;
                                                    return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>;
                                                })()}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={`px-2 py-1 rounded-md text-xs font-semibold text-white ${grp.isPersonal ? 'bg-violet-500' : 'bg-blue-600'}`}>{grp.totalQty}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono">{grp.isPersonal ? <span className="text-violet-400 text-xs">-</span> : `$${grp.avgCost.toLocaleString('es-AR')}`}</td>
                                        <td className="px-4 py-3 text-right font-mono font-medium text-gray-900">{grp.isPersonal ? <span className="text-violet-400 text-xs">-</span> : `$${grp.totalValue.toLocaleString('es-AR')}`}</td>
                                        <td className="px-4 py-3 text-center">
                                            <div className="flex flex-wrap justify-center gap-1">
                                                {grp.locations.map(l => (
                                                    <span key={l.loc} className="text-[10px] font-medium bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                                                        {l.loc} ({l.qty})
                                                    </span>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-center text-xs text-gray-500">
                                            {grp.batches.map(b => getBatchLabel(b)).join(', ') || 'Directa'}
                                        </td>
                                    </tr>
                                    {expandedGroups.has(grp.key) && grp.children.map(item => (
                                        <tr key={item.id} className="bg-blue-50/30 border-l-2 border-blue-200">
                                            <td className="px-4 py-2"></td>
                                            <td className="px-4 py-2"></td>
                                            <td className="px-4 py-2 text-gray-600 text-xs">
                                                <span className="font-medium">{getBatchLabel(resolveBatchRef(item))}</span>
                                                <span className="text-gray-400 mx-1">·</span>
                                                <span>{conditionLabelMap[item.condition || 'nuevo']}</span>
                                                <span className="text-gray-400 mx-1">·</span>
                                                <span>{new Date(item.date).toLocaleDateString('es-AR')}</span>
                                            </td>
                                            <td className="px-4 py-2 text-center text-xs font-semibold">{item.quantity}</td>
                                            <td className="px-4 py-2 text-right font-mono text-xs">${item.purchasePrice.toLocaleString('es-AR')}</td>
                                            <td className="px-4 py-2 text-right font-mono text-xs">
                                                ${(item.purchasePrice * item.quantity).toLocaleString('es-AR')}
                                                {item.salePrice ? <span className="block text-emerald-600">Venta: ${item.salePrice.toLocaleString('es-AR')}/u</span> : null}
                                            </td>
                                            <td className="px-4 py-2 text-center text-xs">{item.location || '-'}</td>
                                            <td className="px-4 py-2 text-center">
                                                <div className="flex justify-center items-center gap-1">
                                                    <button onClick={(e) => { e.stopPropagation(); onSell(item); }}
                                                        className="bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 rounded text-[10px] font-bold flex items-center gap-0.5">
                                                        <DollarSign className="w-3 h-3" /> Vender
                                                    </button>
                                                    <button onClick={(e) => { e.stopPropagation(); onEdit(item); }}
                                                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-all" title="Editar">
                                                        <Edit2 className="w-3.5 h-3.5" />
                                                    </button>
                                                    {item.quantity > 1 && (
                                                        <button onClick={(e) => { e.stopPropagation(); onSplit(item); }}
                                                            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-all" title="Separar">
                                                            <Split className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                    <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                                                        className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-all" title="Eliminar">
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <table className="w-full text-left text-sm text-gray-600">
                        <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs tracking-wider">
                            <tr>
                                <th className="px-4 py-3 w-8"></th>
                                <th className="px-4 py-3">Ubicación</th>
                                <th className="px-4 py-3 text-center">Productos</th>
                                <th className="px-4 py-3 text-center">Unidades</th>
                                <th className="px-4 py-3 text-right">Valor Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {locationGroups.map((grp) => (
                                <>{/* Fragment key on first tr */}
                                    <tr
                                        key={grp.key}
                                        onClick={() => toggleGroup(grp.key)}
                                        className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                                    >
                                        <td className="px-4 py-3 text-gray-400">
                                            {expandedGroups.has(grp.key) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </td>
                                        <td className="px-4 py-3 font-medium text-gray-900 flex items-center gap-2">
                                            <MapPin className="w-4 h-4 text-blue-500" />
                                            {grp.location}
                                        </td>
                                        <td className="px-4 py-3 text-center text-xs font-semibold">{grp.products.length}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className="bg-blue-600 text-white px-2 py-1 rounded-md text-xs font-semibold">{grp.totalQty}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono font-medium text-gray-900">${grp.totalValue.toLocaleString('es-AR')}</td>
                                    </tr>
                                    {expandedGroups.has(grp.key) && grp.products.map(prod => (
                                        <tr key={prod.name} className="bg-blue-50/30 border-l-2 border-blue-200">
                                            <td className="px-4 py-2"></td>
                                            <td className="px-4 py-2 text-gray-700 font-medium text-xs">{prod.name}</td>
                                            <td className="px-4 py-2 text-center text-xs text-gray-400">
                                                prom: ${prod.avgCost.toLocaleString('es-AR')}/u
                                            </td>
                                            <td className="px-4 py-2 text-center text-xs font-semibold">{prod.qty}</td>
                                            <td className="px-4 py-2 text-right">
                                                <div className="flex justify-end items-center gap-1">
                                                    {prod.items.map(item => (
                                                        <div key={item.id} className="flex gap-0.5">
                                                            <button onClick={(e) => { e.stopPropagation(); onSell(item); }}
                                                                className="bg-emerald-600 hover:bg-emerald-700 text-white px-1.5 py-0.5 rounded text-[10px] font-bold">Vender</button>
                                                            <button onClick={(e) => { e.stopPropagation(); onEdit(item); }}
                                                                className="p-1 text-gray-400 hover:text-blue-600 rounded" title="Editar">
                                                                <Edit2 className="w-3 h-3" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </>
    );
}

function ProductForm({ formData, setFormData, onSubmit, onCancel, isEditing, editingItemStatus, suggestedNames = [], suggestedLocations = [], batchCodes = [] }: {
    formData: Partial<Item>,
    setFormData: React.Dispatch<React.SetStateAction<Partial<Item>>>,
    onSubmit: (e: React.FormEvent) => void,
    onCancel: () => void,
    isEditing: boolean,
    editingItemStatus?: ItemStatus,
    suggestedNames?: string[],
    suggestedLocations?: string[],
    batchCodes?: string[]
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

            {/* Personal/Resale Toggle */}
            <button
                type="button"
                onClick={() => {
                    const next = formData.itemType === 'personal' ? 'resale' : 'personal';
                    setFormData({ ...formData, itemType: next as ItemType, purchasePrice: next === 'personal' ? 0 : formData.purchasePrice });
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-all ${formData.itemType === 'personal' ? 'bg-violet-50 border-violet-300 text-violet-700' : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'}`}
            >
                <User className="w-4 h-4" />
                {formData.itemType === 'personal' ? 'Producto propio (solo ingreso, sin costo)' : 'Marcar como producto propio'}
            </button>

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
                    list="product-names"
                    required
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white"
                    value={formData.productName}
                    onChange={e => setFormData({ ...formData, productName: e.target.value })}
                />
                <datalist id="product-names">
                    {suggestedNames.map(name => <option key={name} value={name} />)}
                </datalist>
            </div>

            <div className={`grid grid-cols-1 ${formData.itemType === 'personal' ? '' : 'sm:grid-cols-2'} gap-4`}>
                {formData.itemType !== 'personal' && (
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
                )}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        Precio Venta ($)
                    </label>
                    <input
                        type="text"
                        inputMode="numeric"
                        className={`w-full px-4 py-2 rounded-xl border border-gray-200 outline-none transition-all bg-gray-50 focus:bg-white ${formData.status === 'sold' || formData.itemType === 'personal' ? 'focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-bold text-emerald-700' : 'focus:border-black focus:ring-1 focus:ring-black'}`}
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ubicación</label>
                    <input
                        type="text"
                        list="product-locations"
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white text-gray-700"
                        placeholder="Ej: Jujuy, Depósito 1"
                        value={formData.location || ''}
                        onChange={e => setFormData({ ...formData, location: e.target.value })}
                    />
                    <datalist id="product-locations">
                        {suggestedLocations.map(loc => <option key={loc} value={loc} />)}
                    </datalist>
                </div>
            </div>

            {isEditing && batchCodes.length > 0 && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Tanda</label>
                    <select
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white text-gray-700"
                        value={formData.batchRef || ''}
                        onChange={e => setFormData({ ...formData, batchRef: e.target.value || undefined })}
                    >
                        <option value="">Sin tanda (Directa)</option>
                        {batchCodes.map(code => <option key={code} value={code}>{code}</option>)}
                    </select>
                </div>
            )}

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Imagen de referencia (URL)</label>
                <div className="flex gap-3 items-start">
                    <input
                        type="url"
                        className="flex-1 px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white text-gray-700 text-sm"
                        placeholder="Pega el link de una imagen (Google Photos, Link web, etc.)"
                        value={formData.imageUrl || ''}
                        onChange={e => setFormData({ ...formData, imageUrl: e.target.value })}
                    />
                    {formData.imageUrl && (
                        <div className="w-12 h-12 rounded-lg border border-gray-200 overflow-hidden shrink-0 bg-white">
                            <img src={formData.imageUrl} alt="Vista previa" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.src = 'https://placehold.co/100x100?text=Error')} />
                        </div>
                    )}
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
    setItemBatchMap,
    batchHistory,
    setBatchHistory
}: {
    totalPaid: number;
    setTotalPaid: React.Dispatch<React.SetStateAction<number>>;
    batchItems: PricingItem[];
    setBatchItems: React.Dispatch<React.SetStateAction<PricingItem[]>>;
    inventoryItems: Item[];
    onInventoryRefresh: () => Promise<void>;
    itemBatchMap: Record<string, string>;
    setItemBatchMap: React.Dispatch<React.SetStateAction<Record<string, string>>>;
    batchHistory: BatchRecord[];
    setBatchHistory: React.Dispatch<React.SetStateAction<BatchRecord[]>>;
}) {
    const [newName, setNewName] = useState('');
    const [newQty, setNewQty] = useState('1');
    const [newListedPrice, setNewListedPrice] = useState('');
    const [newSalePrice, setNewSalePrice] = useState('');
    const [newDisposition, setNewDisposition] = useState<'sell' | 'keep'>('sell');
    const [newCategory, setNewCategory] = useState('');
    const [totalPaidInput, setTotalPaidInput] = useState('');
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
    const [batchDefaultLocation, setBatchDefaultLocation] = useState('');
    const [bulkLocationInput, setBulkLocationInput] = useState('');
    const [isUpdatingBulk, setIsUpdatingBulk] = useState(false);
    const [isProcessingReturn, setIsProcessingReturn] = useState(false);
    const [editingSaleItemId, setEditingSaleItemId] = useState<string | null>(null);
    const [editingSalePrice, setEditingSalePrice] = useState('');
    const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
    const [importCharges, setImportCharges] = useState(0);
    const [importChargesInput, setImportChargesInput] = useState('');
    const [creditAmount, setCreditAmount] = useState(0);
    const [creditInput, setCreditInput] = useState('');
    const [creditMode, setCreditMode] = useState<'already_applied' | 'manual'>('already_applied');

    // Import JSON modal state
    const [showImportModal, setShowImportModal] = useState(false);
    const [importJsonText, setImportJsonText] = useState('');
    const [importPreview, setImportPreview] = useState<{
        productos: Array<{
            producto: string; precio_unit_final: number; cantidad: number; merged: boolean;
            existsInBatch: boolean; batchQty: number;
            historyMatch: { totalSold: number; lastSalePrice: number; avgSalePrice: number; inStock: number } | null;
        }>;
        total_pagado: number;
        credito: number;
        cargo_importacion: number;
    } | null>(null);
    const [importError, setImportError] = useState('');
    const [importCreditMode, setImportCreditMode] = useState<'already_applied' | 'manual'>('already_applied');

    // When editing a batch, check which items have sold copies in inventory (cannot be removed)
    const editingBatch = batchHistory.find(b => b.id === editingBatchId) || null;
    const getSoldQtyForBatchItem = (pItem: PricingItem): number => {
        if (!editingBatch) return 0;
        return inventoryItems.filter(inv =>
            inv.status === 'sold' &&
            normalizeText(inv.productName) === normalizeText(pItem.productName) &&
            (inv.batchRef || itemBatchMap[inv.id]) === editingBatch.batchCode &&
            (inv.condition || 'nuevo') === (pItem.condition || 'nuevo')
        ).reduce((a, i) => a + i.quantity, 0);
    };

    const handleReturnFromBatch = async (batch: BatchRecord, pricingItem: PricingItem) => {
        const qtyToReturn = pricingItem.quantity;
        
        // Calculate original unit cost (approximate based on allocation)
        
        // Use listed price ratio for better approximation if possible
        const totalListed = (Array.isArray(batch.items) ? batch.items : []).reduce((acc, i) => acc + (i.listedUnitPrice * i.quantity), 0);
        const allocationFactor = totalListed > 0 ? batch.totalPaid / totalListed : 1;
        const estimatedUnitCost = Math.round(pricingItem.listedUnitPrice * allocationFactor);

        // Making it "directo": Only one confirmation with the estimated refund.
        const confirmTotal = confirm(`¿Confirmar DEVOLUCIÓN TOTAL de "${pricingItem.productName}" (${qtyToReturn} unidades)?\n\nSe descontarán de la tanda y del inventario.\nReembolso estimado: $${(qtyToReturn * estimatedUnitCost).toLocaleString('es-AR')}`);
        if (!confirmTotal) return;

        const refundPerUnit = estimatedUnitCost;

        setIsProcessingReturn(true);
        try {
            // 1. Update the inventory items (only in_stock items from this batch)
            const matchingItems = inventoryItems.filter(i =>
                i.status === 'in_stock' &&
                (i.batchRef || itemBatchMap[i.id]) === batch.batchCode &&
                normalizeText(i.productName) === normalizeText(pricingItem.productName) &&
                (i.condition || 'nuevo') === pricingItem.condition
            );

            let remainingToReturn = qtyToReturn;
            for (const item of matchingItems) {
                if (remainingToReturn <= 0) break;
                const reduceBy = Math.min(item.quantity, remainingToReturn);
                if (item.quantity > reduceBy) {
                    await itemService.updateItem(item.id, { quantity: item.quantity - reduceBy });
                } else {
                    await itemService.deleteItem(item.id);
                }
                remainingToReturn -= reduceBy;
            }

            // 2. Update the batch record
            const updatedItems = batch.items.map(item => {
                if (item.productName === pricingItem.productName && item.condition === pricingItem.condition) {
                    return { ...item, quantity: item.quantity - qtyToReturn };
                }
                return item;
            }).filter(item => item.quantity > 0);

            const totalPaidReduction = qtyToReturn * refundPerUnit;
            const newTotalPaid = Math.max(0, batch.totalPaid - totalPaidReduction);

            // Recalculate metrics for the batch
            const newListedSubtotal = updatedItems.reduce((acc, item) => acc + (item.listedUnitPrice * item.quantity), 0);
            const newAllocationFactor = newListedSubtotal > 0 ? newTotalPaid / newListedSubtotal : 1;
            const newTotalSellRevenue = updatedItems
                .filter((item) => item.disposition === 'sell')
                .reduce((acc, item) => acc + (item.unitSalePrice * item.quantity), 0);
            const newRetainedValue = updatedItems
                .filter((item) => item.disposition === 'keep')
                .reduce((acc, item) => acc + ((item.listedUnitPrice * newAllocationFactor) * item.quantity), 0);
            const newSellCostAdjusted = updatedItems
                .filter((item) => item.disposition === 'sell')
                .reduce((acc, item) => acc + ((item.listedUnitPrice * newAllocationFactor) * item.quantity), 0);
            const newExpectedProfit = newTotalSellRevenue - newSellCostAdjusted;

            await itemService.updateBatch(batch.id, {
                items: updatedItems,
                itemsCount: updatedItems.reduce((acc, i) => acc + i.quantity, 0),
                totalPaid: newTotalPaid,
                totalSellRevenue: newTotalSellRevenue,
                cashProfit: newExpectedProfit,
                retainedValue: newRetainedValue
            });

            // 3. Refresh state
            await onInventoryRefresh();
            const dbBatches = await itemService.getBatches();
            setBatchHistory(dbBatches);
            localStorage.setItem('pricing_batch_history_v1', JSON.stringify(dbBatches));

            alert('Devolución procesada con éxito.');
        } catch (error) {
            console.error('Error processing return', error);
            alert('Hubo un error al procesar la devolución.');
        } finally {
            setIsProcessingReturn(false);
        }
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

    useEffect(() => {
        setTotalPaidInput(formatMoney(totalPaid));
    }, [totalPaid]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem('pricing_batch_extras_v1');
            if (!raw) return;
            const parsed = JSON.parse(raw) as { importCharges?: number; creditAmount?: number; creditMode?: string };
            const ic = Number(parsed.importCharges || 0);
            const ca = Number(parsed.creditAmount || 0);
            setImportCharges(ic);
            setImportChargesInput(ic > 0 ? new Intl.NumberFormat('es-AR').format(ic) : '');
            setCreditAmount(ca);
            setCreditInput(ca > 0 ? new Intl.NumberFormat('es-AR').format(ca) : '');
            setCreditMode(parsed.creditMode === 'manual' ? 'manual' : 'already_applied');
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        localStorage.setItem('pricing_batch_extras_v1', JSON.stringify({ importCharges, creditAmount, creditMode }));
    }, [importCharges, creditAmount, creditMode]);

    useEffect(() => {
        const loadHistory = async () => {
            try {
                // Prioritize Supabase batches
                const dbBatches = await itemService.getBatches();

                if (dbBatches && dbBatches.length > 0) {
                    setBatchHistory(dbBatches);
                    // Update local storage as a cache
                    localStorage.setItem('pricing_batch_history_v1', JSON.stringify(dbBatches));
                } else {
                    // Fallback to local storage if DB is empty
                    const raw = localStorage.getItem('pricing_batch_history_v1');
                    if (raw) {
                        const parsed = JSON.parse(raw) as BatchRecord[];
                        if (Array.isArray(parsed)) setBatchHistory(parsed);
                    }
                }
            } catch (error) {
                console.error('Error loading history from Supabase, trying local', error);
                const raw = localStorage.getItem('pricing_batch_history_v1');
                if (raw) {
                    try {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed)) setBatchHistory(parsed);
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

    const selectedRecord = batchHistory.find((record) => record.id === selectedHistoryId) || null;
    const selectedRecordItems: PricingItem[] = (() => {
        if (!selectedRecord) return [];
        const storedItems = selectedRecord.items && selectedRecord.items.length > 0 ? selectedRecord.items : [];
        if (storedItems.length === 0) {
            // No stored items — reconstruct from inventory
            return inventoryItems
                .filter((item) => (item.batchRef || itemBatchMap[item.id]) === selectedRecord.batchCode)
                .map((item) => ({
                    id: item.id,
                    productName: item.productName,
                    quantity: item.quantity,
                    listedUnitPrice: item.purchasePrice,
                    unitSalePrice: item.salePrice || item.purchasePrice,
                    condition: item.condition,
                    disposition: 'sell' as const
                }));
        }
        // Merge stored items with sold inventory items missing from the stored list
        const batchInv = inventoryItems.filter(i =>
            (i.batchRef || itemBatchMap[i.id]) === selectedRecord.batchCode
        );
        const missingItems: PricingItem[] = [];
        for (const inv of batchInv) {
            const alreadyInStored = storedItems.some(si =>
                normalizeText(si.productName) === normalizeText(inv.productName) &&
                (si.condition || 'nuevo') === (inv.condition || 'nuevo')
            );
            if (!alreadyInStored) {
                // Check if we already added this product+condition to missingItems
                const existing = missingItems.find(m =>
                    normalizeText(m.productName) === normalizeText(inv.productName) &&
                    (m.condition || 'nuevo') === (inv.condition || 'nuevo')
                );
                if (existing) {
                    existing.quantity += inv.quantity;
                } else {
                    missingItems.push({
                        id: crypto.randomUUID(),
                        productName: inv.productName,
                        quantity: inv.quantity,
                        listedUnitPrice: inv.purchasePrice,
                        unitSalePrice: inv.salePrice || inv.purchasePrice,
                        condition: inv.condition,
                        disposition: inv.itemType === 'personal' ? 'keep' : 'sell'
                    });
                }
            }
        }
        return [...storedItems, ...missingItems];
    })();

    const deleteBatchRecord = async (recordId: string) => {
        const target = batchHistory.find((record) => record.id === recordId);
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

            const nextHistory = batchHistory.filter((record) => record.id !== recordId);
            setBatchHistory(nextHistory);
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
    // Si el crédito lo pone el usuario (manual), se descuenta del total real; si ya fue aplicado por Temu, no cambia nada.
    const effectiveTotalPaid = creditMode === 'manual' ? totalPaid + creditAmount : totalPaid;
    const allocationFactor = listedSubtotal > 0 ? effectiveTotalPaid / listedSubtotal : 1;
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
    const effectiveCostToRecover = Math.max(effectiveTotalPaid - retainedValue, 0);
    const totalEconomicValue = expectedProfit + retainedValue;

    const normalizeName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

    const parseImportJson = () => {
        setImportError('');
        setImportPreview(null);
        try {
            const parsed = JSON.parse(importJsonText.trim());
            const rawProducts = parsed.productos || parsed.items || parsed.products;
            if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
                setImportError('El JSON no tiene un array de productos válido.');
                return;
            }
            // Parse and deduplicate products within the JSON
            const mergedMap = new Map<string, { producto: string; precio_unit_final: number; cantidad: number; merged: boolean }>();
            for (const p of rawProducts) {
                const nombre = p.producto || p.nombre || p.name || p.productName || '';
                const precio = Number(p.precio_unit_final || p.precioUnitFinal || p.precio || p.price || 0);
                const cantidad = Number(p.cantidad || p.quantity || p.qty || 0);

                if (!nombre || typeof nombre !== 'string') {
                    setImportError('Cada producto debe tener un nombre (producto, nombre, name).');
                    return;
                }
                if (precio <= 0) {
                    setImportError(`Precio inválido para "${nombre}".`);
                    return;
                }
                if (cantidad < 1) {
                    setImportError(`Cantidad inválida para "${nombre}".`);
                    return;
                }

                const key = normalizeName(nombre);
                const existing = mergedMap.get(key);
                if (existing) {
                    existing.cantidad += cantidad;
                    existing.merged = true;
                } else {
                    mergedMap.set(key, { producto: nombre, precio_unit_final: precio, cantidad, merged: false });
                }
            }

            // Check against current batch and inventory history
            const productos = Array.from(mergedMap.values()).map((p) => {
                const batchMatch = batchItems.find((b) => normalizeName(b.productName) === normalizeName(p.producto));
                const key = normalizeName(p.producto);
                const historyItems = inventoryItems.filter((it: Item) => normalizeName(it.productName) === key);
                let historyMatch: { totalSold: number; lastSalePrice: number; avgSalePrice: number; inStock: number } | null = null;
                if (historyItems.length > 0) {
                    const sold = historyItems.filter((it: Item) => it.status === 'sold' && it.salePrice);
                    const inStock = historyItems.filter((it: Item) => it.status === 'in_stock').reduce((s: number, it: Item) => s + it.quantity, 0);
                    const totalSold = sold.reduce((s: number, it: Item) => s + it.quantity, 0);
                    const lastSold = sold.sort((a: Item, b: Item) => (b.saleDate || '').localeCompare(a.saleDate || ''))[0];
                    const avgSalePrice = totalSold > 0 ? sold.reduce((s: number, it: Item) => s + (it.salePrice || 0) * it.quantity, 0) / totalSold : 0;
                    historyMatch = {
                        totalSold,
                        lastSalePrice: lastSold?.salePrice || 0,
                        avgSalePrice,
                        inStock,
                    };
                }
                return {
                    ...p,
                    existsInBatch: !!batchMatch,
                    batchQty: batchMatch?.quantity || 0,
                    historyMatch,
                };
            });

            const pedido = parsed.pedido || parsed;
            const totalPagado = Math.abs(Number(pedido.total_pagado || pedido.totalPagado || pedido.total || 0));
            const credito = Math.abs(Number(pedido.credito || pedido.credit || 0));
            const cargoImportacion = Math.abs(Number(pedido.cargo_importacion || pedido.cargoImportacion || pedido.importCharges || 0));

            setImportPreview({ productos, total_pagado: totalPagado, credito, cargo_importacion: cargoImportacion });
        } catch {
            setImportError('JSON inválido. Revisá que esté bien formateado.');
        }
    };

    const confirmImport = () => {
        if (!importPreview) return;

        setBatchItems((prev) => {
            const updated = [...prev];
            const toAdd: PricingItem[] = [];

            for (const p of importPreview.productos) {
                const existingIdx = updated.findIndex((b) => normalizeName(b.productName) === normalizeName(p.producto));
                if (existingIdx !== -1) {
                    // Merge: sum quantity into existing batch item
                    updated[existingIdx] = { ...updated[existingIdx], quantity: updated[existingIdx].quantity + p.cantidad };
                } else {
                    toAdd.push({
                        id: crypto.randomUUID(),
                        productName: p.producto,
                        quantity: p.cantidad,
                        listedUnitPrice: p.precio_unit_final,
                        unitSalePrice: 0,
                        condition: 'nuevo' as ItemCondition,
                        disposition: 'sell' as const,
                    });
                }
            }

            return [...updated, ...toAdd];
        });

        // Siempre poner el total tal cual viene del JSON
        // El modo de crédito se encarga de sumar o no en effectiveTotalPaid
        setTotalPaid(importPreview.total_pagado);
        setTotalPaidInput(new Intl.NumberFormat('es-AR').format(importPreview.total_pagado));
        setCreditMode(importCreditMode);

        if (importPreview.cargo_importacion > 0) {
            setImportCharges(importPreview.cargo_importacion);
            setImportChargesInput(new Intl.NumberFormat('es-AR').format(importPreview.cargo_importacion));
        }
        if (importPreview.credito > 0) {
            setCreditAmount(importPreview.credito);
            setCreditInput(new Intl.NumberFormat('es-AR').format(importPreview.credito));
        }

        // Reset modal
        setShowImportModal(false);
        setImportJsonText('');
        setImportPreview(null);
        setImportError('');
        setImportCreditMode('already_applied');
    };

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
                disposition: newDisposition,
                category: newCategory.trim() || undefined
            }
        ]);

        setNewName('');
        setNewQty('1');
        setNewListedPrice('');
        setNewSalePrice('');
        setNewDisposition('sell');
        setNewCategory('');
    };

    const sendBatchToStock = async () => {
        if (normalizedItems.length === 0) {
            alert('Primero agrega productos a la tanda.');
            return;
        }

        try {
            const rawItemsToSell = normalizedItems.filter((item) => item.disposition === 'sell');
            const itemsToSell: PricingItem[] = [];
            for (const item of rawItemsToSell) {
                const existing = itemsToSell.find(i =>
                    i.productName === item.productName &&
                    i.condition === item.condition &&
                    i.listedUnitPrice === item.listedUnitPrice &&
                    i.unitSalePrice === item.unitSalePrice
                );
                if (existing) {
                    existing.quantity += item.quantity;
                } else {
                    itemsToSell.push({ ...item });
                }
            }

            const lastBatchCode = batchHistory.length > 0
                ? batchHistory.map(h => parseInt(h.batchCode.split('-')[1]) || 0).reduce((a, b) => Math.max(a, b), 0)
                : 0;
            const batchIndex = lastBatchCode + 1;
            const batchCode = `T-${batchIndex.toString().padStart(3, '0')}`;
            const batchType: BatchRecord['batchType'] =
                rawItemsToSell.length === 0 ? 'retenido' : (rawItemsToSell.length === normalizedItems.length ? 'venta' : 'mixta');

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
                        batchRef: batchCode,
                        location: batchDefaultLocation || existingStock.location
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
                        itemType: 'resale',
                        batchRef: batchCode,
                        location: batchDefaultLocation,
                        category: item.category
                    });
                    setItemBatchMap((prev) => ({ ...prev, [created.id]: batchCode }));
                }
            }

            // Create personal inventory items for "keep" products
            const rawItemsToKeep = normalizedItems.filter((item) => item.disposition === 'keep');
            const itemsToKeep: PricingItem[] = [];
            for (const item of rawItemsToKeep) {
                const existing = itemsToKeep.find(i =>
                    i.productName === item.productName &&
                    i.condition === item.condition
                );
                if (existing) {
                    existing.quantity += item.quantity;
                } else {
                    itemsToKeep.push({ ...item });
                }
            }
            for (const item of itemsToKeep) {
                const nowIso = new Date().toISOString();
                const created = await itemService.createItem({
                    productName: item.productName,
                    purchasePrice: 0,
                    quantity: item.quantity,
                    date: nowIso,
                    status: 'in_stock',
                    condition: item.condition,
                    itemType: 'personal',
                    batchRef: batchCode,
                    location: batchDefaultLocation,
                    category: item.category
                });
                setItemBatchMap((prev) => ({ ...prev, [created.id]: batchCode }));
            }

            const record: Omit<BatchRecord, 'id'> = {
                batchCode,
                batchType,
                batchStatus: 'en_camino',
                createdAt: new Date().toISOString(),
                totalPaid: effectiveTotalPaid,
                totalSellRevenue,
                cashProfit: expectedProfit,
                retainedValue,
                itemsCount: normalizedItems.length,
                items: normalizedItems.map((item) => ({ ...item }))
            };

            // Save to Supabase
            const savedBatch = await itemService.createBatch(record);
            const nextHistory = [savedBatch, ...batchHistory].slice(0, 50);
            setBatchHistory(nextHistory);
            localStorage.setItem('pricing_batch_history_v1', JSON.stringify(nextHistory));

            setBatchItems([]);
            setBatchDefaultLocation('');
            setImportCharges(0);
            setImportChargesInput('');
            setCreditAmount(0);
            setCreditInput('');
            setCreditMode('already_applied');
            setEditingBatchId(null);
            await onInventoryRefresh();
            alert('Tanda procesada: stock actualizado y resultado registrado.');
        } catch (error) {
            console.error('Error sending batch to stock', error);
            alert('Hubo un error al procesar la tanda.');
        }
    };

    const updateExistingBatch = async () => {
        if (!editingBatchId || normalizedItems.length === 0) return;
        const target = batchHistory.find(b => b.id === editingBatchId);
        if (!target) return;

        try {
            const listedSub = normalizedItems.reduce((acc, i) => acc + (i.listedUnitPrice * i.quantity), 0);
            const effTotal = creditMode === 'manual' ? totalPaid + creditAmount : totalPaid;
            const allocFactor = listedSub > 0 ? effTotal / listedSub : 1;
            const sellItems = normalizedItems.filter(i => i.disposition === 'sell');
            const keepItems = normalizedItems.filter(i => i.disposition === 'keep');
            const newSellRevenue = sellItems.reduce((acc, i) => acc + (i.unitSalePrice * i.quantity), 0);
            const newRetainedValue = keepItems.reduce((acc, i) => acc + ((i.listedUnitPrice * allocFactor) * i.quantity), 0);
            const sellCostAdj = sellItems.reduce((acc, i) => acc + ((i.listedUnitPrice * allocFactor) * i.quantity), 0);
            const newProfit = newSellRevenue - sellCostAdj;

            // Sync product name AND price changes to inventory/sales items
            const oldItems = target.items;
            for (const newItem of normalizedItems) {
                const oldItem = oldItems.find(oi => oi.id === newItem.id);
                if (!oldItem) continue;

                const nameChanged = normalizeText(oldItem.productName) !== normalizeText(newItem.productName);
                const priceChanged = newItem.disposition === 'sell' && oldItem.unitSalePrice !== newItem.unitSalePrice;

                if (nameChanged || priceChanged) {
                    // Find matching inventory items (in_stock)
                    const relatedInvItems = inventoryItems.filter(inv =>
                        normalizeText(inv.productName) === normalizeText(oldItem.productName) &&
                        (inv.batchRef || itemBatchMap[inv.id]) === target.batchCode &&
                        (inv.condition || 'nuevo') === (oldItem.condition || 'nuevo')
                    );
                    for (const inv of relatedInvItems) {
                        try {
                            const upd: Partial<Item> = {};
                            if (nameChanged) upd.productName = newItem.productName;
                            if (priceChanged) upd.salePrice = newItem.unitSalePrice;
                            await itemService.updateItem(inv.id, upd);
                        } catch (e) {
                            console.error("Error syncing to inventory item", e);
                        }
                    }
                    // Also sync sold items with same name + batch (name only — sale price is the actual sold price)
                    if (nameChanged) {
                        const soldRelated = inventoryItems.filter(i =>
                            i.status === 'sold' &&
                            normalizeText(i.productName) === normalizeText(oldItem.productName) &&
                            (i.batchRef || itemBatchMap[i.id]) === target.batchCode
                        );
                        for (const sold of soldRelated) {
                            try {
                                await itemService.updateItem(sold.id, { productName: newItem.productName });
                            } catch (e) {
                                console.error("Error syncing name to sold item", e);
                            }
                        }
                    }
                }
            }

            await itemService.updateBatch(editingBatchId, {
                totalPaid: effTotal,
                totalSellRevenue: newSellRevenue,
                cashProfit: newProfit,
                retainedValue: newRetainedValue,
                itemsCount: normalizedItems.length,
                items: normalizedItems.map(i => ({ ...i }))
            });

            setBatchHistory(prev => prev.map(b => b.id === editingBatchId ? {
                ...b,
                totalPaid: effTotal,
                totalSellRevenue: newSellRevenue,
                cashProfit: newProfit,
                retainedValue: newRetainedValue,
                itemsCount: normalizedItems.length,
                items: normalizedItems.map(i => ({ ...i }))
            } : b));

            await onInventoryRefresh();
            setEditingBatchId(null);
            setBatchItems([]);
            alert(`Tanda ${target.batchCode} actualizada correctamente.`);
        } catch (error) {
            console.error('Error updating batch', error);
            alert('Error al actualizar la tanda.');
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
                    <div className="md:col-span-3">
                        <label className="block text-xs font-semibold text-gray-600 mb-1">Ubicación para toda esta tanda (opcional)</label>
                        <input
                            type="text"
                            value={batchDefaultLocation}
                            onChange={(e) => setBatchDefaultLocation(e.target.value)}
                            placeholder="Ej: Jujuy, Depósito 1"
                            className="w-full px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                        />
                    </div>
                </div>

                {/* Desglose de costos adicionales */}
                <div className="mt-4 border-t border-gray-100 pt-4">
                    <p className="text-xs font-semibold text-gray-600 mb-3">Desglose de costos (opcional)</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Cargos por importación</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                value={importChargesInput}
                                onChange={(e) => {
                                    const value = parseMoneyInput(e.target.value);
                                    setImportChargesInput(formatMoney(value));
                                    setImportCharges(value);
                                }}
                                placeholder="Ej: 33.894"
                                className="w-full px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 mb-1">Crédito aplicado</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    value={creditInput}
                                    onChange={(e) => {
                                        const value = parseMoneyInput(e.target.value);
                                        setCreditInput(formatMoney(value));
                                        setCreditAmount(value);
                                    }}
                                    placeholder="Ej: 2.049"
                                    className="flex-1 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                                />
                                <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-medium">
                                    <button
                                        type="button"
                                        onClick={() => setCreditMode('already_applied')}
                                        className={`px-3 py-2 transition-colors ${creditMode === 'already_applied' ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                                        title="El crédito ya fue descontado por Temu en el total pagado"
                                    >
                                        Ya aplicado
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCreditMode('manual')}
                                        className={`px-3 py-2 transition-colors ${creditMode === 'manual' ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                                        title="El crédito lo pagaste vos, se suma al total invertido"
                                    >
                                        Lo pagué yo
                                    </button>
                                </div>
                            </div>
                            {creditMode === 'manual' && creditAmount > 0 && (
                                <p className="text-xs text-blue-600 mt-1">
                                    Costo efectivo: ${Math.round(effectiveTotalPaid).toLocaleString('es-AR')} (${Math.round(totalPaid).toLocaleString('es-AR')} + ${Math.round(creditAmount).toLocaleString('es-AR')} de crédito propio)
                                </p>
                            )}
                            {creditMode === 'already_applied' && creditAmount > 0 && (
                                <p className="text-xs text-gray-400 mt-1">
                                    Crédito informativo — ya restado en el total pagado
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6">
                <h3 className="text-base font-bold text-gray-800 mb-3">Agregar producto al pedido</h3>
                <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Nombre del producto"
                        className="md:col-span-2 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                    />
                    <input
                        type="text"
                        list="category-suggestions"
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        placeholder="Categoría"
                        className="px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                    />
                    <datalist id="category-suggestions">
                        {Array.from(new Set([
                            ...inventoryItems.map((i: Item) => i.category).filter(Boolean),
                            ...batchItems.map(i => i.category).filter(Boolean)
                        ])).map(cat => <option key={cat} value={cat} />)}
                    </datalist>
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
                        onClick={() => setShowImportModal(true)}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
                    >
                        <ClipboardPaste size={16} />
                        Importar JSON
                    </button>
                    {editingBatchId ? (
                        <div className="flex items-center gap-2">
                            <button
                                onClick={updateExistingBatch}
                                className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-medium"
                            >
                                Actualizar tanda ({batchHistory.find(b => b.id === editingBatchId)?.batchCode})
                            </button>
                            <button
                                onClick={() => { setEditingBatchId(null); setBatchItems([]); }}
                                className="bg-gray-200 text-gray-700 px-3 py-2 rounded-xl text-sm font-medium"
                            >
                                Cancelar
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={sendBatchToStock}
                            className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium"
                        >
                            Pasar tanda a stock
                        </button>
                    )}
                </div>
                {editingBatchId && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 text-sm text-blue-700">
                        Editando tanda <strong>{batchHistory.find(b => b.id === editingBatchId)?.batchCode}</strong> — modificá los productos y hacé clic en &quot;Actualizar tanda&quot; para guardar. Los nombres se sincronizan con inventario y ventas.
                    </div>
                )}

                {/* Modal Importar JSON */}
                {showImportModal && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                            <div className="flex items-center justify-between p-4 border-b border-gray-100">
                                <h3 className="text-lg font-bold text-gray-800">Importar pedido desde JSON</h3>
                                <button
                                    onClick={() => { setShowImportModal(false); setImportJsonText(''); setImportPreview(null); setImportError(''); }}
                                    className="p-1 hover:bg-gray-100 rounded-lg"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="p-4 space-y-4">
                                {!importPreview ? (
                                    <>
                                        <p className="text-sm text-gray-500">
                                            Pegá el JSON que te devolvió la IA con los productos del pedido.
                                        </p>
                                        <textarea
                                            value={importJsonText}
                                            onChange={(e) => setImportJsonText(e.target.value)}
                                            placeholder='{"productos": [...], "total_pagado": ..., "credito": ..., "cargo_importacion": ...}'
                                            rows={10}
                                            className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none font-mono text-xs resize-y"
                                        />
                                        {importError && (
                                            <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-xl">
                                                <AlertTriangle size={16} />
                                                {importError}
                                            </div>
                                        )}
                                        <div className="flex justify-end gap-2">
                                            <button
                                                onClick={() => { setShowImportModal(false); setImportJsonText(''); setImportError(''); }}
                                                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                onClick={parseImportJson}
                                                disabled={!importJsonText.trim()}
                                                className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
                                            >
                                                Previsualizar
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-sm text-gray-500">Revisá los datos antes de confirmar:</p>
                                        {importPreview.productos.some((p) => p.merged || p.existsInBatch) && (
                                            <div className="flex items-center gap-2 text-amber-700 text-xs bg-amber-50 px-3 py-2 rounded-xl">
                                                <Merge size={14} />
                                                Algunos productos se fusionarán (se suma la cantidad)
                                            </div>
                                        )}
                                        <div className="rounded-xl border border-gray-200 overflow-hidden">
                                            <table className="w-full text-sm">
                                                <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                                                    <tr>
                                                        <th className="px-3 py-2 text-left">Producto</th>
                                                        <th className="px-3 py-2 text-center">Cant.</th>
                                                        <th className="px-3 py-2 text-right">Precio unit.</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {importPreview.productos.map((p, i) => (
                                                        <tr key={i} className={`border-t border-gray-100 ${p.merged || p.existsInBatch ? 'bg-amber-50' : ''}`}>
                                                            <td className="px-3 py-2">
                                                                <div className="flex flex-wrap items-center gap-1">
                                                                    <span>{p.producto}</span>
                                                                    {p.merged && (
                                                                        <span className="text-[10px] bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded-full font-medium">fusionado</span>
                                                                    )}
                                                                    {p.existsInBatch && (
                                                                        <span className="text-[10px] bg-blue-200 text-blue-800 px-1.5 py-0.5 rounded-full font-medium">+{p.batchQty} en tanda</span>
                                                                    )}
                                                                </div>
                                                                {p.historyMatch && (
                                                                    <div className="flex flex-wrap gap-2 mt-1 text-[10px] text-gray-500">
                                                                        {p.historyMatch.totalSold > 0 && (
                                                                            <span>Vendidos: {p.historyMatch.totalSold} u. a ~${p.historyMatch.avgSalePrice.toLocaleString('es-AR', { maximumFractionDigits: 0 })}</span>
                                                                        )}
                                                                        {p.historyMatch.lastSalePrice > 0 && (
                                                                            <span className="text-green-600 font-medium">Últ. venta: ${p.historyMatch.lastSalePrice.toLocaleString('es-AR')}</span>
                                                                        )}
                                                                        {p.historyMatch.inStock > 0 && (
                                                                            <span className="text-blue-600 font-medium">{p.historyMatch.inStock} en stock</span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-2 text-center">{p.cantidad}</td>
                                                            <td className="px-3 py-2 text-right">${p.precio_unit_final.toLocaleString('es-AR')}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="grid grid-cols-3 gap-3 text-sm">
                                            <div className="bg-gray-50 rounded-xl px-3 py-2">
                                                <p className="text-xs text-gray-500">Total del JSON</p>
                                                <p className="font-semibold">${importPreview.total_pagado.toLocaleString('es-AR')}</p>
                                            </div>
                                            <div className="bg-gray-50 rounded-xl px-3 py-2">
                                                <p className="text-xs text-gray-500">Crédito</p>
                                                <p className="font-semibold">{importPreview.credito > 0 ? `$${importPreview.credito.toLocaleString('es-AR')}` : 'No aplica'}</p>
                                            </div>
                                            <div className="bg-gray-50 rounded-xl px-3 py-2">
                                                <p className="text-xs text-gray-500">Cargo importación</p>
                                                <p className="font-semibold">{importPreview.cargo_importacion > 0 ? `$${importPreview.cargo_importacion.toLocaleString('es-AR')}` : 'No aplica'}</p>
                                            </div>
                                        </div>
                                        {importPreview.credito > 0 && (
                                            <div className="bg-blue-50 rounded-xl px-4 py-3 space-y-2">
                                                <p className="text-sm font-semibold text-gray-700">¿Cómo manejás el crédito?</p>
                                                <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-medium w-fit">
                                                    <button
                                                        type="button"
                                                        onClick={() => setImportCreditMode('already_applied')}
                                                        className={`px-4 py-2 transition-colors ${importCreditMode === 'already_applied' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
                                                    >
                                                        Ya aplicado
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setImportCreditMode('manual')}
                                                        className={`px-4 py-2 transition-colors ${importCreditMode === 'manual' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
                                                    >
                                                        Lo pagué yo
                                                    </button>
                                                </div>
                                                <p className="text-xs text-gray-500">
                                                    {importCreditMode === 'already_applied'
                                                        ? `Costo efectivo: $${importPreview.total_pagado.toLocaleString('es-AR')} (el crédito ya fue restado por Temu)`
                                                        : `Costo efectivo: $${(importPreview.total_pagado + importPreview.credito).toLocaleString('es-AR')} ($${importPreview.total_pagado.toLocaleString('es-AR')} + $${importPreview.credito.toLocaleString('es-AR')} de crédito pagado por vos)`
                                                    }
                                                </p>
                                            </div>
                                        )}
                                        <div className="flex justify-end gap-2">
                                            <button
                                                onClick={() => { setImportPreview(null); setImportError(''); }}
                                                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100"
                                            >
                                                Volver a editar
                                            </button>
                                            <button
                                                onClick={confirmImport}
                                                className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-medium"
                                            >
                                                Confirmar e importar
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
                <table className="w-full text-sm text-gray-700">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                        <tr>
                            <th className="px-4 py-3 text-left">Producto</th>
                            <th className="px-4 py-3 text-left">Categoría</th>
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
                            const importShareUnit = listedSubtotal > 0 && importCharges > 0
                                ? (item.listedUnitPrice / listedSubtotal) * importCharges
                                : 0;
                            const baseCostUnit = adjustedUnitCost - importShareUnit;
                            const marginPercent = adjustedUnitCost > 0
                                ? ((item.unitSalePrice - adjustedUnitCost) / adjustedUnitCost) * 100
                                : 0;
                            const totalProfit = item.disposition === 'sell'
                                ? (item.unitSalePrice - adjustedUnitCost) * item.quantity
                                : 0;

                            const soldQty = getSoldQtyForBatchItem(item);
                            const hasSoldCopies = soldQty > 0;

                            return (
                                <tr key={item.id} className={hasSoldCopies ? 'bg-emerald-50/30' : ''}>
                                    <td className="px-4 py-3 font-medium text-gray-900">
                                        <input
                                            type="text"
                                            value={item.productName}
                                            onChange={(e) => setBatchItems((prev) => prev.map((p) => p.id === item.id ? { ...p, productName: e.target.value } : p))}
                                            className="w-full px-2 py-1 rounded-lg border border-gray-200 bg-gray-50 text-sm outline-none focus:bg-white"
                                        />
                                        {hasSoldCopies && <span className="text-[10px] font-bold text-emerald-600 mt-0.5 block">{soldQty} vendido{soldQty > 1 ? 's' : ''}</span>}
                                    </td>
                                    <td className="px-4 py-3">
                                        <input
                                            type="text"
                                            list="category-suggestions"
                                            value={item.category || ''}
                                            onChange={(e) => setBatchItems((prev) => prev.map((p) => p.id === item.id ? { ...p, category: e.target.value || undefined } : p))}
                                            placeholder="—"
                                            className="w-24 px-2 py-1 rounded-lg border border-gray-200 bg-gray-50 text-xs outline-none"
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-center">{item.quantity}</td>
                                    <td className="px-4 py-3 text-right">${Math.round(item.listedUnitPrice).toLocaleString('es-AR')}</td>
                                    <td className="px-4 py-3 text-right">
                                        <span className="font-semibold">${Math.round(adjustedUnitCost).toLocaleString('es-AR')}</span>
                                        {importCharges > 0 && (
                                            <div className="text-xs text-gray-400 leading-tight mt-0.5">
                                                <span>Base: ${Math.round(baseCostUnit).toLocaleString('es-AR')}</span>
                                                <span className="mx-1">·</span>
                                                <span className="text-amber-600">Import: ${Math.round(importShareUnit).toLocaleString('es-AR')}</span>
                                            </div>
                                        )}
                                    </td>
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
                                        {hasSoldCopies ? (
                                            <span className="text-[10px] text-gray-400" title="No se puede eliminar: tiene ventas registradas">Vendido</span>
                                        ) : (
                                            <button
                                                onClick={() => setBatchItems((prev) => prev.filter((p) => p.id !== item.id))}
                                                className="text-rose-600 hover:text-rose-700"
                                            >
                                                Eliminar
                                            </button>
                                        )}
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
                    <p className="text-lg font-bold text-gray-900">${Math.round(effectiveTotalPaid).toLocaleString('es-AR')}</p>
                    {importCharges > 0 && (
                        <div className="text-xs text-gray-400 mt-1 space-y-0.5">
                            <div>Productos: ${Math.round(effectiveTotalPaid - importCharges).toLocaleString('es-AR')}</div>
                            <div className="text-amber-600">Importación: ${Math.round(importCharges).toLocaleString('es-AR')}</div>
                        </div>
                    )}
                    {creditMode === 'manual' && creditAmount > 0 && (
                        <p className="text-xs text-blue-500 mt-1">Crédito propio descontado: −${Math.round(creditAmount).toLocaleString('es-AR')}</p>
                    )}
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
                {batchHistory.length === 0 ? (
                    <p className="text-sm text-gray-500">Sin registros todavía.</p>
                ) : (
                    <div className="space-y-2">
                        {batchHistory.map((record) => (
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
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-semibold">{record.batchCode} ({record.batchType})</p>
                                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                                record.batchStatus === 'en_camino' ? 'bg-yellow-100 text-yellow-700' :
                                                record.batchStatus === 'recibido' ? 'bg-blue-100 text-blue-700' :
                                                'bg-green-100 text-green-700'
                                            }`}>
                                                {record.batchStatus === 'en_camino' ? 'En camino' : record.batchStatus === 'recibido' ? 'Recibido' : 'Completado'}
                                            </span>
                                            <span className="text-xs text-gray-400">{new Date(record.createdAt).toLocaleDateString('es-AR')} - {record.itemsCount} productos</span>
                                        </div>
                                        <p className="text-xs text-gray-500">Invertido: ${safeMoney(record.totalPaid).toLocaleString('es-AR')} | Venta esperada: ${safeMoney(record.totalSellRevenue).toLocaleString('es-AR')} | Retenido: ${safeMoney(record.retainedValue).toLocaleString('es-AR')}</p>
                                    </div>
                                </button>
                                <div className="flex items-center gap-3">
                                    <div className="flex flex-col items-end gap-1">
                                        <p className={`font-bold ${record.cashProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            Est: ${safeMoney(record.cashProfit).toLocaleString('es-AR')}
                                        </p>
                                        {(() => {
                                            const relatedItems = inventoryItems.filter((i: Item) => (i.batchRef || itemBatchMap[i.id]) === record.batchCode);
                                            const actualProfit = relatedItems.reduce((acc: number, item: Item) => {
                                                if (item.status === 'sold') {
                                                    return acc + ((item.salePrice || 0) - item.purchasePrice) * item.quantity;
                                                }
                                                return acc;
                                            }, 0);
                                            return (
                                                <p className={`text-xs font-bold ${actualProfit >= record.cashProfit ? 'text-emerald-500' : 'text-amber-500'}`}>
                                                    Real: ${Math.round(actualProfit).toLocaleString('es-AR')}
                                                </p>
                                            );
                                        })()}
                                    </div>
                                    <select
                                        value={record.batchStatus || 'completado'}
                                        onChange={async (e) => {
                                            const newStatus = e.target.value as BatchStatus;
                                            try {
                                                await itemService.updateBatch(record.id, { batchStatus: newStatus });
                                                setBatchHistory((prev) => prev.map((b) => b.id === record.id ? { ...b, batchStatus: newStatus } : b));
                                            } catch { alert('Error al cambiar estado.'); }
                                        }}
                                        className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-gray-50"
                                    >
                                        <option value="en_camino">En camino</option>
                                        <option value="recibido">Recibido</option>
                                        <option value="completado">Completado</option>
                                    </select>
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
                        <div className="flex flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    placeholder="Nueva ubicación"
                                    value={bulkLocationInput}
                                    onChange={(e) => setBulkLocationInput(e.target.value)}
                                    className="px-3 py-2 rounded-lg border border-gray-200 text-xs outline-none focus:border-blue-400"
                                />
                                <button
                                    type="button"
                                    disabled={!bulkLocationInput || isUpdatingBulk}
                                    onClick={async () => {
                                        setIsUpdatingBulk(true);
                                        try {
                                            await itemService.updateItemsByBatch(selectedRecord.batchCode, { location: bulkLocationInput });
                                            await onInventoryRefresh();
                                            alert(`Ubicación actualizada a "${bulkLocationInput}" para todos los items de la tanda.`);
                                            setBulkLocationInput('');
                                        } catch (e) {
                                            alert('Error al actualizar ubicación.');
                                        } finally {
                                            setIsUpdatingBulk(false);
                                        }
                                    }}
                                    className="px-3 py-2 rounded-lg bg-blue-600 text-white text-xs font-medium disabled:opacity-50"
                                >
                                    {isUpdatingBulk ? '...' : 'Asignar a todos'}
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    setTotalPaid(selectedRecord.totalPaid);
                                    setBatchItems(cloneItemsForTable(selectedRecordItems));
                                    setEditingBatchId(selectedRecord.id);
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

                    {(() => {
                        const detailTotalListed = selectedRecordItems.reduce((acc, i) => acc + (i.listedUnitPrice * i.quantity), 0);
                        const detailAllocFactor = detailTotalListed > 0 ? selectedRecord.totalPaid / detailTotalListed : 1;

                        // Build a map of actual inventory data per product in this batch
                        const batchInvItems = inventoryItems.filter((inv: Item) =>
                            (inv.batchRef || itemBatchMap[inv.id]) === selectedRecord.batchCode
                        );
                        const getActualData = (pItem: PricingItem) => {
                            const matches = batchInvItems.filter((inv: Item) =>
                                normalizeText(inv.productName) === normalizeText(pItem.productName) &&
                                (inv.condition || 'nuevo') === pItem.condition
                            );
                            const soldItems = matches.filter((inv: Item) => inv.status === 'sold');
                            const inStockItems = matches.filter((inv: Item) => inv.status === 'in_stock');
                            const totalSoldQty = soldItems.reduce((a: number, i: Item) => a + i.quantity, 0);
                            const totalInStockQty = inStockItems.reduce((a: number, i: Item) => a + i.quantity, 0);
                            const totalSoldRevenue = soldItems.reduce((a: number, i: Item) => a + (i.salePrice || 0) * i.quantity, 0);
                            const avgSalePrice = totalSoldQty > 0 ? totalSoldRevenue / totalSoldQty : 0;
                            return { totalSoldQty, totalInStockQty, totalSoldRevenue, avgSalePrice, matches };
                        };

                        let grandTotalCost = 0;
                        let grandTotalRevenue = 0;
                        let grandTotalExpectedRevenue = 0;

                        const rows = selectedRecordItems.map((item) => {
                            const unitCost = Math.round(item.listedUnitPrice * detailAllocFactor);
                            const totalCost = unitCost * item.quantity;
                            const actual = getActualData(item);
                            const expectedRevenue = item.disposition === 'sell' ? item.unitSalePrice * item.quantity : 0;
                            const realProfit = actual.totalSoldRevenue - (unitCost * actual.totalSoldQty);

                            grandTotalCost += totalCost;
                            grandTotalRevenue += actual.totalSoldRevenue;
                            grandTotalExpectedRevenue += expectedRevenue;

                            return { item, unitCost, totalCost, actual, expectedRevenue, realProfit };
                        });

                        const grandTotalProfit = grandTotalRevenue - grandTotalCost;

                        return (
                            <>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-gray-700">
                                        <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-600">
                                            <tr>
                                                <th className="px-3 py-2 text-left">Producto</th>
                                                <th className="px-3 py-2 text-center">Cant.</th>
                                                <th className="px-3 py-2 text-right">Costo Unit.</th>
                                                <th className="px-3 py-2 text-right">Costo Total</th>
                                                <th className="px-3 py-2 text-right">Venta Esperada</th>
                                                <th className="px-3 py-2 text-center">Vendidos</th>
                                                <th className="px-3 py-2 text-right">Venta Real</th>
                                                <th className="px-3 py-2 text-right">Ganancia</th>
                                                <th className="px-3 py-2 text-center">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {rows.map(({ item, unitCost, totalCost, actual, expectedRevenue, realProfit }) => {
                                                const allSold = actual.totalSoldQty >= item.quantity && item.disposition === 'sell';
                                                return (
                                                <tr key={item.id} className={allSold ? 'bg-emerald-50/40' : item.disposition === 'keep' ? 'bg-amber-50/40' : ''}>
                                                    <td className="px-3 py-2">
                                                        <span className="font-medium text-gray-900">{item.productName}</span>
                                                        {item.category && <span className="ml-1.5 text-[10px] text-gray-400">({item.category})</span>}
                                                        {item.disposition === 'keep' && <span className="ml-1.5 text-[10px] font-bold text-amber-600">RETENIDO</span>}
                                                        {allSold && <span className="ml-1.5 text-[10px] font-bold text-emerald-600">VENDIDO</span>}
                                                    </td>
                                                    <td className="px-3 py-2 text-center">{item.quantity}</td>
                                                    <td className="px-3 py-2 text-right text-gray-600">${safeMoney(unitCost).toLocaleString('es-AR')}</td>
                                                    <td className="px-3 py-2 text-right font-medium">${safeMoney(totalCost).toLocaleString('es-AR')}</td>
                                                    <td className="px-3 py-2 text-right text-gray-500">
                                                        {item.disposition === 'sell' ? `$${safeMoney(expectedRevenue).toLocaleString('es-AR')}` : '—'}
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        {actual.totalSoldQty > 0 || actual.totalInStockQty > 0 ? (
                                                            <div>
                                                                <span className={`font-semibold ${allSold ? 'text-emerald-600' : actual.totalSoldQty > 0 ? 'text-emerald-600' : 'text-blue-500'}`}>
                                                                    {actual.totalSoldQty} / {item.quantity}
                                                                </span>
                                                                {actual.totalInStockQty > 0 && (
                                                                    <span className="block text-[10px] text-blue-500">{actual.totalInStockQty} en stock</span>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span className="text-gray-400">—</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 text-right">
                                                        {actual.totalSoldQty > 0 ? (
                                                            <span className="font-semibold text-emerald-700">${safeMoney(actual.totalSoldRevenue).toLocaleString('es-AR')}</span>
                                                        ) : (
                                                            <span className="text-gray-400">—</span>
                                                        )}
                                                        {actual.totalSoldQty > 0 && actual.avgSalePrice > 0 && (
                                                            <span className="block text-[10px] text-gray-400">prom: ${safeMoney(actual.avgSalePrice).toLocaleString('es-AR')}/u</span>
                                                        )}
                                                    </td>
                                                    <td className={`px-3 py-2 text-right font-bold ${actual.totalSoldQty > 0 ? (realProfit >= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-gray-300'}`}>
                                                        {actual.totalSoldQty > 0 ? `$${safeMoney(realProfit).toLocaleString('es-AR')}` : '—'}
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        <div className="flex items-center justify-center gap-1 flex-wrap">
                                                            {actual.totalInStockQty > 0 && editingSaleItemId === item.id ? (
                                                                <div className="flex items-center gap-1">
                                                                    <span className="text-[10px] text-gray-500">$</span>
                                                                    <input
                                                                        type="number"
                                                                        value={editingSalePrice}
                                                                        onChange={(e) => setEditingSalePrice(e.target.value)}
                                                                        className="w-16 px-1 py-0.5 text-xs border rounded"
                                                                        placeholder="Precio"
                                                                        autoFocus
                                                                    />
                                                                    <button
                                                                        type="button"
                                                                        onClick={async () => {
                                                                            const price = Number(editingSalePrice);
                                                                            if (!price || price <= 0) return;
                                                                            try {
                                                                                const stockMatches = actual.matches.filter((inv: Item) => inv.status === 'in_stock');
                                                                                for (const inv of stockMatches) {
                                                                                    await itemService.updateItem(inv.id, {
                                                                                        salePrice: price,
                                                                                        status: 'sold',
                                                                                        saleDate: new Date().toISOString()
                                                                                    });
                                                                                }
                                                                                // Sync price back to batch unitSalePrice
                                                                                if (price !== item.unitSalePrice) {
                                                                                    const updBatchItems = selectedRecord.items.map(bi =>
                                                                                        bi.id === item.id ? { ...bi, unitSalePrice: price } : bi
                                                                                    );
                                                                                    await itemService.updateBatch(selectedRecord.id, { items: updBatchItems });
                                                                                    setBatchHistory(prev => prev.map(b => b.id === selectedRecord.id ? { ...b, items: updBatchItems } : b));
                                                                                }
                                                                                await onInventoryRefresh();
                                                                                setEditingSaleItemId(null);
                                                                                setEditingSalePrice('');
                                                                            } catch { alert('Error al marcar como vendido.'); }
                                                                        }}
                                                                        className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded"
                                                                    >
                                                                        <Check size={12} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => { setEditingSaleItemId(null); setEditingSalePrice(''); }}
                                                                        className="text-[10px] text-gray-400 px-1"
                                                                    >
                                                                        <X size={12} />
                                                                    </button>
                                                                </div>
                                                            ) : actual.totalInStockQty > 0 ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setEditingSaleItemId(item.id);
                                                                        setEditingSalePrice(String(item.unitSalePrice || ''));
                                                                    }}
                                                                    className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md transition-all"
                                                                >
                                                                    Vender
                                                                </button>
                                                            ) : null}
                                                            <button
                                                                type="button"
                                                                disabled={isProcessingReturn}
                                                                onClick={() => handleReturnFromBatch(selectedRecord, item)}
                                                                className="text-[10px] font-bold uppercase tracking-wider text-rose-600 hover:text-rose-700 bg-rose-50 px-2 py-1 rounded-md transition-all disabled:opacity-50"
                                                            >
                                                                {isProcessingReturn ? '...' : 'Devolver'}
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                );
                                            })}
                                        </tbody>
                                        {selectedRecordItems.length > 0 && (
                                            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                                                <tr className="text-xs font-bold uppercase tracking-wider">
                                                    <td className="px-3 py-2.5 text-gray-700" colSpan={3}>Totales</td>
                                                    <td className="px-3 py-2.5 text-right text-gray-900">${safeMoney(grandTotalCost).toLocaleString('es-AR')}</td>
                                                    <td className="px-3 py-2.5 text-right text-gray-500">${safeMoney(grandTotalExpectedRevenue).toLocaleString('es-AR')}</td>
                                                    <td className="px-3 py-2.5 text-center text-emerald-600">
                                                        {rows.reduce((a, r) => a + r.actual.totalSoldQty, 0)} / {selectedRecordItems.reduce((a, i) => a + i.quantity, 0)}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right text-emerald-700">${safeMoney(grandTotalRevenue).toLocaleString('es-AR')}</td>
                                                    <td className={`px-3 py-2.5 text-right font-bold ${grandTotalProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                        ${safeMoney(grandTotalProfit).toLocaleString('es-AR')}
                                                    </td>
                                                    <td />
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                                {selectedRecordItems.length === 0 && (
                                    <p className="text-xs text-amber-600 mt-3">
                                        No hay detalle guardado para esta tanda (registro antiguo sin productos vinculados).
                                    </p>
                                )}
                            </>
                        );
                    })()}
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
