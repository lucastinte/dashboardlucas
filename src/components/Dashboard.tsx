import { Fragment, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Item, ItemCondition, ItemStatus, ItemType, WithdrawalReason, LocationItem } from '../types';
import { itemService } from '../services/itemService';
import { imageService } from '../services/imageService';
import { locationService } from '../services/locationService';
import { TOPE, CATEGORIA_ACTUAL, CATEGORIA_SIGUIENTE, TOPE_SIGUIENTE, categoriaParaMonto } from '../config/monotributo';
import { STORE_CONFIG, productUrl } from '../config/storeConfig';
import { Plus, Minus, Trash2, TrendingUp, DollarSign, Package, ArrowUpRight, ArrowDownRight, Edit2, Box, History as HistoryIcon, Save, Moon, Sun, Layers, Check, ClipboardPaste, X, AlertTriangle, Merge, ChevronDown, ChevronRight, MapPin, User, FileText, Receipt, CheckCircle, XCircle, Upload, Image as ImageIcon, Loader2, Search, Gift, Ban, Truck, Banknote, LogOut, MessageCircle, RotateCcw, Play, MoreHorizontal } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import PlacaModal from './PlacaModal';
import { normalizeText, hasStoreContent, pickStoreFields, findStoreDonor, inheritStoreFields } from '../lib/storeFields';
import { LocationsModal } from './LocationsModal';
import { money, moneyCompact, percent } from '../lib/format';
import { type ArcaFactura, ARCA_PREFILL_EVENT, ARCA_WINDOW_NAME, extractNumeroFactura, modalesFacturaAbiertos, resolveArcaMessage, totalNoCoincide, ultimaVentaFacturada } from '../lib/arcaFactura';

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


const withdrawalLabels: Record<string, { label: string; color: string; bgColor: string }> = {
    regalo: { label: 'REGALO', color: 'text-pink-700 dark:text-pink-200', bgColor: 'bg-pink-100 dark:bg-pink-900/60' },
    uso_personal: { label: 'USO PROPIO', color: 'text-violet-700 dark:text-violet-200', bgColor: 'bg-violet-100 dark:bg-violet-900/60' },
    perdida: { label: 'PÉRDIDA', color: 'text-red-700 dark:text-red-200', bgColor: 'bg-red-100 dark:bg-red-900/60' }
};

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
    const { signOut } = useAuth();
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
    const [storeImagesItem, setStoreImagesItem] = useState<Item | null>(null);
    const [placaItem, setPlacaItem] = useState<Item | null>(null);
    // Factura recibida de ARCA para una venta sin modal abierto: se abre acá
    const [arcaFacturaRecibida, setArcaFacturaRecibida] = useState<{ ventaId: string; factura: ArcaFactura } | null>(null);
    const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
    const toastTimer = useRef<number | undefined>(undefined);
    const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
        window.clearTimeout(toastTimer.current);
        setToast({ text, tone });
        toastTimer.current = window.setTimeout(() => setToast(null), 6000);
    };
    // El listener se registra una sola vez: lee las ventas actuales por ref
    const itemsRef = useRef<Item[]>([]);
    itemsRef.current = items;

    // Número de factura que devuelve el userscript de ARCA por postMessage
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            const action = resolveArcaMessage(event, itemsRef.current, ultimaVentaFacturada.current);
            switch (action.kind) {
                case 'ignorar':
                    return;
                case 'venta-no-encontrada':
                    showToast(`Llegó el número ${action.factura.numero} de ARCA, pero no encontré la venta. Cargalo a mano con "Pegar".`, 'warn');
                    return;
                case 'ya-facturada':
                    showToast(`Número ${action.factura.numero} recibido de ARCA, pero "${action.venta.productName}" ya tiene la factura ${action.venta.nroComprobante}. No se cambió.`, 'warn');
                    return;
                case 'abrir-modal': {
                    const detail = { ...action.factura, ventaId: action.venta.id };
                    if (modalesFacturaAbiertos.has(action.venta.id)) {
                        window.dispatchEvent(new CustomEvent(ARCA_PREFILL_EVENT, { detail }));
                    } else {
                        setArcaFacturaRecibida({ ventaId: action.venta.id, factura: detail });
                    }
                    showToast(`Número ${action.factura.numero} recibido de ARCA`);
                    return;
                }
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, []);
    const [isSaving, setIsSaving] = useState(false);
    const savingRef = useRef(false);
    const [locations, setLocations] = useState<LocationItem[]>([]);
    const [isLocationsModalOpen, setIsLocationsModalOpen] = useState(false);
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

    const loadLocations = async (currentItems: Item[] = items) => {
        try {
            const locs = await locationService.getLocations(currentItems);
            setLocations(locs);
        } catch (e) {
            console.error('Error loading locations', e);
        }
    };

    const handleSaveLocation = async (locData: { id?: string; name: string; phone?: string; address?: string; isDefault?: boolean }) => {
        await locationService.saveLocation(locData);
        await loadLocations();
    };

    const handleDeleteLocation = async (id: string) => {
        await locationService.deleteLocation(id);
        await loadLocations();
    };

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
                        // Quedarse con el registro que tenga datos de tienda y completar
                        // lo que le falte con los demás antes de borrarlos.
                        const mainItem = group.find(hasStoreContent) || group[0];
                        const others = group.filter(i => i.id !== mainItem.id);
                        const totalQty = group.reduce((acc, i) => acc + i.quantity, 0);
                        const storePatch = others.reduce<Partial<Item>>(
                            (acc, o) => ({ ...acc, ...inheritStoreFields({ ...mainItem, ...acc }, o) }), {});
                        await itemService.updateItem(mainItem.id, { quantity: totalQty, ...storePatch });
                        for (const other of others) {
                            await itemService.deleteItem(other.id);
                        }
                        mergedAny = true;
                    } catch (e) { console.error('Error auto-merging', e); }
                }
            }
            if (mergedAny) {
                finalItems = await itemService.getItems();
            }

            // Publicación pareja: si un producto tiene alguna tanda en stock publicada
            // (el dashboard ya lo muestra como publicado), se publican también sus
            // otras tandas en stock. La tienda solo ve las filas con el tilde, así
            // que sin esto no aparecen las otras sedes (p. ej. Abra Pampa).
            const publicados = new Set(
                finalItems
                    .filter(i => i.status === 'in_stock' && i.publicInStore && i.itemType !== 'personal')
                    .map(i => normalizeText(i.productName))
            );
            const sinPublicar = finalItems.filter(i =>
                i.status === 'in_stock' && !i.publicInStore && i.itemType !== 'personal' &&
                publicados.has(normalizeText(i.productName)));
            if (sinPublicar.length > 0) {
                for (const it of sinPublicar) {
                    try {
                        const { publicInStore: _ignored, ...content } = hasStoreContent(it)
                            ? {}
                            : inheritStoreFields(it, findStoreDonor(finalItems, it.productName, it.condition, it.id));
                        await itemService.updateItem(it.id, { ...content, publicInStore: true });
                    } catch (e) { console.error('Error publicando tanda', e); }
                }
                finalItems = await itemService.getItems();
            }

            setItems(finalItems);
            loadLocations(finalItems);
        } catch (err: any) {
            console.error('Error loading items:', err);
            setError('Error al cargar datos. Verifica tu conexión o configuración.');
        } finally {
            setLoading(false);
        }
    };

    const handleSaveItem = async (e: React.FormEvent) => {
        e.preventDefault();
        if (savingRef.current) return; // guard against double-submit
        savingRef.current = true;
        setIsSaving(true);

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

                    const isLastUnits = editingItem.quantity - quantity <= 0;
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
                        saleDate: formDateISO,
                        // Al vender las últimas unidades el registro de stock se borra:
                        // conservar los datos de tienda en la venta (ocultos) para no perderlos
                        ...(isLastUnits ? pickStoreFields(editingItem) : {})
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
                        // La venta se borra: pasar al stock los datos de tienda que le falten
                        await itemService.updateItem(existingStock.id, {
                            quantity: existingStock.quantity + quantity,
                            ...inheritStoreFields(existingStock, editingItem)
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
                    imageUrl: formData.imageUrl ?? editingItem.imageUrl,
                    vendedor: formData.vendedor !== undefined ? (formData.vendedor || undefined) : editingItem.vendedor,
                    cobrado: formData.cobrado !== undefined ? formData.cobrado : editingItem.cobrado
                };

                // Venta que vuelve al inventario: recuperar fotos/video/descripción
                // (propios o del último registro del producto) y volver a publicarla.
                if (editingItem.status === 'sold' && status === 'in_stock') {
                    const donor = hasStoreContent(editingItem)
                        ? editingItem
                        : findStoreDonor(items, updates.productName || editingItem.productName, condition, editingItem.id);
                    Object.assign(updates, inheritStoreFields({ ...editingItem, ...updates }, donor));
                }

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
                const baseNewItem = {
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
                    saleDate: formData.status === 'sold' ? (formData.date ? getISODate(formData.date) : new Date().toISOString()) : undefined,
                    vendedor: formData.vendedor || undefined,
                    cobrado: formData.vendedor ? false : true,
                    batchRef: formData.batchRef || undefined,
                    // Datos de tienda precargados (Volver a publicar / Agregar unidades)
                    ...pickStoreFields(formData),
                    publicInStore: formData.publicInStore || false,
                };
                // Reposición de un producto que ya existió: heredar lo que falte
                // (fotos, video, descripción, publicación) del último registro.
                const inherited = baseNewItem.status === 'in_stock'
                    ? { ...baseNewItem, ...inheritStoreFields(baseNewItem, findStoreDonor(items, baseNewItem.productName, baseNewItem.condition)) }
                    : baseNewItem;
                // Si el producto ya está publicado en la tienda (alguna tanda en stock
                // publicada), la tanda nueva también: si no, en la tienda no aparece
                // esa sede aunque el dashboard muestre el producto como publicado.
                const productoPublicado = inherited.status === 'in_stock' && items.some(i =>
                    i.status === 'in_stock' && i.publicInStore && normalizeText(i.productName) === normalizeText(inherited.productName || ''));
                const newItemData = productoPublicado ? { ...inherited, publicInStore: true } : inherited;

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
        } finally {
            savingRef.current = false;
            setIsSaving(false);
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

    const handleToggleFacturado = async (id: string, value: boolean, nroComprobante?: string) => {
        try {
            const patch: Partial<Item> = { facturado: value };
            // Solo tocamos el nro de comprobante si nos pasan uno (así "Desmarcar" no lo borra)
            if (nroComprobante !== undefined) patch.nroComprobante = nroComprobante.trim() || undefined;
            setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
            await itemService.updateItem(id, patch);
        } catch (err) {
            console.error('Error updating facturado:', err);
            loadItems();
        }
    };

    const handleTogglePublicInStore = async (id: string, value: boolean) => {
        try {
            const targetItem = items.find(i => i.id === id);
            const targetName = targetItem ? normalizeText(targetItem.productName) : null;
            const siblingItems = targetName 
                ? items.filter(i => i.id !== id && normalizeText(i.productName) === targetName && i.status === 'in_stock')
                : [];

            // Al publicar, los registros sin fotos/descripción recuperan los del
            // último registro del mismo producto (p. ej. la venta de la tanda anterior).
            const patchFor = (it: Item): Partial<Item> => {
                if (!value || hasStoreContent(it)) return { publicInStore: value };
                const { publicInStore: _ignored, ...content } = inheritStoreFields(it, findStoreDonor(items, it.productName, it.condition, it.id));
                return { publicInStore: value, ...content };
            };
            const targets = [targetItem, ...siblingItems].filter((i): i is Item => !!i);
            const patches = new Map(targets.map(t => [t.id, patchFor(t)]));

            setItems(prev => prev.map(i => patches.has(i.id) ? { ...i, ...patches.get(i.id) } : i));

            for (const [itemId, patch] of patches) {
                await itemService.updateItem(itemId, patch);
            }
        } catch (err) {
            console.error('Error updating publicInStore:', err);
            loadItems();
        }
    };

    const handleUpdateStoreImages = async (id: string, patch: Partial<Item>) => {
        try {
            const targetItem = items.find(i => i.id === id);
            const targetName = targetItem ? normalizeText(targetItem.productName) : null;
            const siblingItems = targetName 
                ? items.filter(i => i.id !== id && normalizeText(i.productName) === targetName && i.status === 'in_stock')
                : [];

            setItems(prev => prev.map(i => 
                (i.id === id || (targetName && normalizeText(i.productName) === targetName && i.status === 'in_stock'))
                    ? { ...i, ...patch }
                    : i
            ));

            await itemService.updateItem(id, patch);
            for (const sib of siblingItems) {
                await itemService.updateItem(sib.id, patch);
            }
        } catch (err) {
            console.error('Error updating storeImages:', err);
            loadItems();
        }
    };

    const handleClearStoreData = async (target: Item) => {
        if (!confirm(`¿Eliminar todos los datos de tienda de "${target.productName}"?\n\nSe borran: título, descripción, grupo, fotos adicionales y video. Los archivos que ningún otro producto use también se eliminan del servidor para liberar espacio.\n\nLa foto principal y el producto en sí NO se tocan.`)) return;
        try {
            // Archivos candidatos a borrar del Storage (fotos de tienda + video)
            const candidates = [...(target.storeImages || []), target.storeVideoUrl].filter((u): u is string => !!u);
            // Solo borrar los que ningún otro item referencia (las imágenes se dedupican por hash y pueden compartirse)
            const usedElsewhere = (url: string) => items.some(i =>
                i.id !== target.id && (
                    i.imageUrl === url ||
                    (i.storeImages || []).includes(url) ||
                    i.storeVideoUrl === url
                )
            );
            for (const url of candidates) {
                if (!usedElsewhere(url)) {
                    try { await imageService.remove(url); } catch { /* archivo externo o ya borrado */ }
                }
            }
            const patch: Partial<Item> = { storeImages: [], storeVideoUrl: '', description: '', storeTitle: '', storeGroup: '', publicInStore: false };
            setItems(prev => prev.map(i => i.id === target.id ? { ...i, ...patch } : i));
            await itemService.updateItem(target.id, patch);
            setStoreImagesItem(null);
        } catch (err) {
            console.error('Error clearing store data:', err);
            alert('Error al eliminar los datos de tienda.');
            loadItems();
        }
    };

    const handleToggleNoFacturar = async (id: string, value: boolean) => {
        try {
            setItems(prev => prev.map(i => i.id === id ? { ...i, noFacturar: value } : i));
            await itemService.updateItem(id, { noFacturar: value });
        } catch (err) {
            console.error('Error updating noFacturar:', err);
            loadItems();
        }
    };

    const handleUpdateEnvio = async (id: string, envio: { envioAplica: boolean; envioCosto: number; envioMetodo: string; formasPago?: string[]; montoEfectivo?: number; montoTransferencia?: number; montoTarjeta?: number; montoMercadoPago?: number; montoOtro?: number }) => {
        try {
            setItems(prev => prev.map(i => i.id === id ? { ...i, ...envio } : i));
            await itemService.updateItem(id, envio);
        } catch (err) {
            console.error('Error updating envio:', err);
            loadItems();
        }
    };

    const handleToggleCobrado = async (id: string, value: boolean) => {
        try {
            setItems(prev => prev.map(i => i.id === id ? { ...i, cobrado: value } : i));
            await itemService.updateItem(id, { cobrado: value });
        } catch (err) {
            console.error('Error updating cobrado:', err);
            loadItems();
        }
    };

    // Mover unidades a otra ubicación (se toca el lugar en el inventario).
    // Si se mueve el lote entero solo cambia su ubicación; si se mueve una parte,
    // se descuenta del lote y se crea otro igual en el destino, con sus datos de tienda.
    const handleMoveUnits = async (lots: Item[], qty: number, to: string) => {
        const destino = to.trim();
        if (!destino || qty < 1 || savingRef.current) return;
        savingRef.current = true;
        let pendientes = qty;
        try {
            for (const lot of lots) {
                if (pendientes <= 0) break;
                const mover = Math.min(lot.quantity, pendientes);
                if (mover >= lot.quantity) {
                    await itemService.updateItem(lot.id, { location: destino });
                } else {
                    await itemService.updateItem(lot.id, { quantity: lot.quantity - mover });
                    await itemService.createItem({
                        productName: lot.productName,
                        purchasePrice: lot.purchasePrice,
                        salePrice: lot.salePrice,
                        quantity: mover,
                        date: lot.date,
                        status: 'in_stock',
                        condition: lot.condition,
                        itemType: lot.itemType || 'resale',
                        batchRef: getItemBatchRef(lot),
                        location: destino,
                        estimatedSalePrice: lot.estimatedSalePrice,
                        publishUrls: lot.publishUrls,
                        imageUrl: lot.imageUrl,
                        category: lot.category,
                        ...pickStoreFields(lot),
                        publicInStore: lot.publicInStore,
                    });
                }
                pendientes -= mover;
            }
            const movidas = qty - pendientes;
            showToast(`${movidas} ${movidas === 1 ? 'unidad movida' : 'unidades movidas'} a ${destino}`);
        } catch (err) {
            console.error('Error moving units:', err);
            alert('No se pudo mover de ubicación. Intentá de nuevo.');
        } finally {
            savingRef.current = false;
            await loadItems();
        }
    };

    const handleMergeItems = async (itemsToMerge: Item[]) => {
        if (itemsToMerge.length <= 1) return;
        if (savingRef.current) return;

        const first = itemsToMerge[0];
        const totalQty = itemsToMerge.reduce((acc, i) => acc + i.quantity, 0);
        const totalCost = itemsToMerge.reduce((acc, i) => acc + (i.purchasePrice * i.quantity), 0);
        const avgCost = Math.round(totalCost / totalQty);
        const bestSalePrice = itemsToMerge.reduce((max, i) => Math.max(max, i.salePrice || i.estimatedSalePrice || 0), 0);
        const loc = first.location || 'Sin ubicación';

        const confirmMsg = `¿Unificar ${itemsToMerge.length} registros de "${first.productName}" en ${loc}?\n\n` +
            `• Cantidad total: ${totalQty} unidades\n` +
            `• Costo de compra promedio: ${money(avgCost)}\n` +
            (bestSalePrice > 0 ? `• Precio de venta: ${money(bestSalePrice)}\n` : '') +
            `\nSe consolidarán en 1 sola fila limpia y se conservarán fotos y datos de tienda.`;

        if (!window.confirm(confirmMsg)) return;

        savingRef.current = true;
        try {
            const itemWithStoreTitle = itemsToMerge.find(i => i.storeTitle);
            const itemWithDesc = itemsToMerge.find(i => i.description);
            const itemWithImg = itemsToMerge.find(i => i.imageUrl);
            const itemWithStoreImgs = itemsToMerge.find(i => (i.storeImages?.length || 0) > 0);
            const itemWithStoreVideo = itemsToMerge.find(i => i.storeVideoUrl);
            const itemWithGroup = itemsToMerge.find(i => i.storeGroup);
            const itemWithVariant = itemsToMerge.find(i => i.storeVariantName);
            const isPublicInStore = itemsToMerge.some(i => i.publicInStore);
            const resolvedBatchRef = itemsToMerge.map(getItemBatchRef).find(Boolean);

            const updates: Partial<Item> = {
                quantity: totalQty,
                purchasePrice: avgCost,
                salePrice: bestSalePrice || first.salePrice || 0,
                estimatedSalePrice: bestSalePrice || first.estimatedSalePrice || 0,
                storeTitle: itemWithStoreTitle?.storeTitle || first.storeTitle,
                storeGroup: itemWithGroup?.storeGroup || first.storeGroup,
                storeVariantName: itemWithVariant?.storeVariantName || first.storeVariantName,
                description: itemWithDesc?.description || first.description,
                imageUrl: itemWithImg?.imageUrl || first.imageUrl,
                storeImages: itemWithStoreImgs?.storeImages || first.storeImages,
                storeVideoUrl: itemWithStoreVideo?.storeVideoUrl || first.storeVideoUrl,
                publicInStore: isPublicInStore,
                batchRef: resolvedBatchRef
            };

            await itemService.updateItem(first.id, updates);

            for (let i = 1; i < itemsToMerge.length; i++) {
                await itemService.deleteItem(itemsToMerge[i].id);
            }

            await loadItems();
        } catch (err) {
            console.error('Error merging items:', err);
            alert('Error al unificar los registros. Intenta nuevamente.');
            loadItems();
        } finally {
            savingRef.current = false;
        }
    };



    const handleWithdraw = async (item: Item, reason: WithdrawalReason) => {
        try {
            const nowIso = new Date().toISOString().split('T')[0];
            setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'sold' as ItemStatus, salePrice: 0, saleDate: nowIso, withdrawalReason: reason, noFacturar: true } : i));
            await itemService.updateItem(item.id, { status: 'sold', salePrice: 0, saleDate: nowIso, withdrawalReason: reason, noFacturar: true });
        } catch (err) {
            console.error('Error withdrawing item:', err);
            loadItems();
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
        const defaultLoc = locations.find(l => l.isDefault)?.name || (locations[0]?.name || '');
        setFormData({
            productName: '',
            purchasePrice: 0,
            salePrice: 0,
            quantity: 1,
            status: 'in_stock',
            condition: 'nuevo',
            itemType: 'resale',
            date: new Date().toISOString().split('T')[0],
            location: defaultLoc,
            estimatedSalePrice: 0,
            publishUrls: '',
            imageUrl: ''
        });
        setEditingItem(null);
    };

    const handleRepublish = async (soldItem: Item) => {
        const defaultLoc = locations.find(l => l.isDefault)?.name || (locations[0]?.name || '');
        const newItemData = {
            productName: soldItem.productName,
            purchasePrice: soldItem.purchasePrice,
            salePrice: 0,
            quantity: 1,
            date: new Date().toISOString().split('T')[0],
            status: 'in_stock' as ItemStatus,
            condition: soldItem.condition || 'nuevo',
            itemType: soldItem.itemType || 'resale',
            location: soldItem.location || defaultLoc,
            estimatedSalePrice: soldItem.estimatedSalePrice || 0,
            publishUrls: '',
            imageUrl: soldItem.imageUrl || '',
            ...pickStoreFields(soldItem),
            // "Volver a publicar": si la venta tenía datos de tienda, vuelve publicada
            publicInStore: hasStoreContent(soldItem),
        };
        // Open the form pre-filled so the user can adjust before saving
        setEditingItem(null);
        setFormData(newItemData as any);
        setIsModalOpen(true);
    };

    // Ajuste rápido de cantidad desde el badge de STOCK en la tabla de inventario.
    const handleUpdateQuantity = async (id: string, quantity: number) => {
        const qty = Math.max(1, Math.floor(Number(quantity) || 1));
        if (items.find(i => i.id === id)?.quantity === qty) return;
        setItems(prev => prev.map(i => i.id === id ? { ...i, quantity: qty } : i));
        try {
            await itemService.updateItem(id, { quantity: qty });
        } catch (err) {
            console.error('Error updating quantity:', err);
            alert('No se pudo actualizar la cantidad.');
            loadItems();
        }
    };

    // Agregar otra tanda del mismo producto: abre el formulario precargado para
    // que se cargue con otro precio / otra ubicación.
    const handleAddUnits = (anchor: Item) => {
        const defaultLoc = locations.find(l => l.isDefault)?.name || (locations[0]?.name || '');
        setEditingItem(null);
        setFormData({
            productName: anchor.productName,
            purchasePrice: anchor.purchasePrice,
            salePrice: anchor.salePrice || 0,
            quantity: 1,
            date: new Date().toISOString().split('T')[0],
            status: 'in_stock',
            condition: anchor.condition || 'nuevo',
            itemType: anchor.itemType || 'resale',
            location: anchor.location || defaultLoc,
            estimatedSalePrice: anchor.estimatedSalePrice || 0,
            imageUrl: anchor.imageUrl || '',
            ...pickStoreFields(anchor),
            publicInStore: anchor.publicInStore,
            batchRef: getItemBatchRef(anchor),
        });
        setIsModalOpen(true);
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
    // Regalos, uso personal y pérdidas se guardan como "venta" a $0: no son unidades vendidas
    const totalUnitsSold = soldItems.filter(i => !i.withdrawalReason).reduce((acc, item) => acc + item.quantity, 0);
    const totalUnitsWithdrawn = soldItems.filter(i => i.withdrawalReason).reduce((acc, item) => acc + item.quantity, 0);
    const profitMargin = resaleRevenue > 0 ? (totalProfit / resaleRevenue) * 100 : 0;

    // Stock value (potential revenue or sunk cost)
    const totalStockValue = stockItems.reduce((acc, item) => acc + (item.purchasePrice * item.quantity), 0);

    // Cobros pendientes
    const cobrosPendientes = soldItems.filter(i => i.cobrado === false && i.vendedor);
    const totalCobrosPendientes = cobrosPendientes.reduce((acc, i) => acc + ((i.salePrice || 0) * i.quantity), 0);

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
                <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 sm:gap-6">
                    <div className="flex items-start justify-between gap-3 min-w-0">
                        <div className="min-w-0">
                            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-gray-900">Control de Ventas</h1>
                            <p className="text-gray-500 mt-1 sm:mt-2 text-sm sm:text-lg">Gestiona tu stock, ventas y ganancias en un solo lugar.</p>
                        </div>
                        {/* Celular: tema y salir como íconos junto al título (antes ocupaban dos renglones enteros) */}
                        <div className="flex sm:hidden items-center gap-1.5 shrink-0">
                            <button
                                type="button"
                                onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
                                className="h-10 w-10 rounded-xl border border-gray-200 bg-white text-gray-700 active:scale-95 transition-all flex items-center justify-center shadow-sm"
                                aria-label={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
                            >
                                {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                            </button>
                            <button
                                type="button"
                                onClick={signOut}
                                className="h-10 w-10 rounded-xl border border-gray-200 bg-white text-gray-700 active:scale-95 transition-all flex items-center justify-center shadow-sm"
                                aria-label="Cerrar sesión"
                            >
                                <LogOut className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    <div className="w-full md:w-auto flex flex-col sm:flex-row gap-2">
                        <div className="grid grid-cols-4 bg-white p-1 rounded-xl shadow-sm border border-gray-200">
                            <button
                                onClick={() => setActiveTab('dashboard')}
                                aria-current={activeTab === 'dashboard' ? 'page' : undefined}
                                className={`px-1 sm:px-3 py-1.5 sm:py-2.5 rounded-lg text-sm font-medium transition-all active:scale-95 ${activeTab === 'dashboard' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900 active:ring-2 active:ring-gray-300 dark:active:ring-gray-600'}`}
                            >
                                <div className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2">
                                    <TrendingUp className="w-4 h-4" />
                                    <span className="sm:hidden text-[11px] leading-tight">Resumen</span>
                                    <span className="hidden sm:inline">Resumen</span>
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('inventory')}
                                aria-current={activeTab === 'inventory' ? 'page' : undefined}
                                className={`px-1 sm:px-3 py-1.5 sm:py-2.5 rounded-lg text-sm font-medium transition-all active:scale-95 ${activeTab === 'inventory' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900 active:ring-2 active:ring-gray-300 dark:active:ring-gray-600'}`}
                            >
                                <div className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2">
                                    <Box className="w-4 h-4" />
                                    <span className="sm:hidden text-[11px] leading-tight">Inventario</span>
                                    <span className="hidden sm:inline">Inventario ({stockItems.length})</span>
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('pricing')}
                                aria-current={activeTab === 'pricing' ? 'page' : undefined}
                                className={`px-1 sm:px-3 py-1.5 sm:py-2.5 rounded-lg text-sm font-medium transition-all active:scale-95 ${activeTab === 'pricing' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900 active:ring-2 active:ring-gray-300 dark:active:ring-gray-600'}`}
                            >
                                <div className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2">
                                    <DollarSign className="w-4 h-4" />
                                    <span className="sm:hidden text-[11px] leading-tight">Pedidos</span>
                                    <span className="hidden sm:inline">Pedidos</span>
                                </div>
                            </button>
                            <button
                                onClick={() => setActiveTab('facturacion')}
                                aria-current={activeTab === 'facturacion' ? 'page' : undefined}
                                className={`px-1 sm:px-3 py-1.5 sm:py-2.5 rounded-lg text-sm font-medium transition-all active:scale-95 ${activeTab === 'facturacion' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:text-gray-900 active:ring-2 active:ring-gray-300 dark:active:ring-gray-600'}`}
                            >
                                <div className="flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-2">
                                    <Receipt className="w-4 h-4" />
                                    <span className="sm:hidden text-[11px] leading-tight">ARCA</span>
                                    <span className="hidden sm:inline">ARCA</span>
                                </div>
                            </button>
                        </div>

                        <button
                            type="button"
                            onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
                            className="hidden sm:flex h-11 px-4 rounded-xl border border-gray-200 bg-white text-gray-700 hover:text-gray-900 hover:bg-gray-50 active:scale-95 active:brightness-95 transition-all items-center justify-center gap-2 shadow-sm"
                            title={theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
                        >
                            {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                            <span className="text-sm font-medium">{theme === 'light' ? 'Oscuro' : 'Claro'}</span>
                        </button>

                        <button
                            type="button"
                            onClick={signOut}
                            className="hidden sm:flex h-11 px-4 rounded-xl border border-gray-200 bg-white text-gray-700 hover:text-red-600 hover:border-red-200 hover:bg-red-50 active:scale-95 active:brightness-95 transition-all items-center justify-center gap-2 shadow-sm"
                            title="Cerrar sesión"
                        >
                            <LogOut className="w-4 h-4" />
                            <span className="text-sm font-medium">Salir</span>
                        </button>
                    </div>
                </div>

                {/* Main Content Area */}
                {activeTab === 'dashboard' ? (
                    <div className="space-y-5 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">

                        {/* Metrics Grid */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
                            <MetricCard
                                title="Ganancia Reventa"
                                value={money(totalProfit)}
                                icon={<TrendingUp className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />}
                                trend={resaleRevenue > 0 ? `${profitMargin > 0 ? '+' : ''}${percent(profitMargin)} margen` : undefined}
                                trendColor={profitMargin < 0 ? 'rose' : 'emerald'}
                                bgColor="bg-white"
                            />
                            <MetricCard
                                title="Ingresos Totales"
                                value={money(totalSales)}
                                icon={<DollarSign className="w-6 h-6 text-blue-600 dark:text-blue-400" />}
                                trend={personalIncome > 0 ? `${money(personalIncome)} propios` : undefined}
                                trendColor="violet"
                                bgColor="bg-white"
                            />
                            <MetricCard
                                title="Unidades Vendidas"
                                value={totalUnitsSold.toLocaleString('es-AR')}
                                icon={<Package className="w-6 h-6 text-violet-600 dark:text-violet-400" />}
                                trend={totalUnitsWithdrawn > 0 ? `+${totalUnitsWithdrawn} retirada${totalUnitsWithdrawn !== 1 ? 's' : ''}` : undefined}
                                trendColor="gray"
                                bgColor="bg-white"
                            />
                            <MetricCard
                                title="Valor en Stock"
                                value={money(totalStockValue)}
                                icon={<Box className="w-6 h-6 text-orange-600 dark:text-orange-400" />}
                                bgColor="bg-white"
                            />
                        </div>

                        {/* Charts */}
                        <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100">
                            <div className="flex flex-wrap justify-between items-baseline gap-x-3 gap-y-1 mb-4 sm:mb-6">
                                <h2 className="text-lg sm:text-xl font-bold text-gray-800">Tendencia de Ganancias</h2>
                                <p className="text-xs sm:text-sm text-gray-500">
                                    Total del período: <span className="font-bold tabular-nums text-gray-900">{money(totalProfit)}</span>
                                </p>
                            </div>
                            <div className="h-[240px] sm:h-[300px] w-full">
                                <ProfitChart items={soldResale} dark={theme === 'dark'} />
                            </div>
                        </div>

                        {/* Cobros Pendientes */}
                        {cobrosPendientes.length > 0 && (
                            <div className="rounded-2xl shadow-sm border overflow-hidden bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800/50">
                                <div className="p-4 sm:p-6 border-b border-amber-200 dark:border-amber-800/50 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                                            <Banknote className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                                        </div>
                                        <div>
                                            <h2 className="text-lg sm:text-xl font-bold text-gray-800 dark:text-gray-100">Cobros Pendientes</h2>
                                            <p className="text-xs text-amber-700 dark:text-amber-400">{cobrosPendientes.length} venta{cobrosPendientes.length > 1 ? 's' : ''} sin cobrar — Total: <span className="font-bold">{money(totalCobrosPendientes)}</span></p>
                                        </div>
                                    </div>
                                </div>
                                <div className="divide-y divide-amber-100 dark:divide-amber-800/40">
                                    {cobrosPendientes.map(item => (
                                        <div key={item.id} className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                                            <div className="flex items-center gap-3 min-w-0">
                                                {item.imageUrl && (
                                                    <div className="w-8 h-8 rounded-md overflow-hidden border border-amber-200 dark:border-amber-800/50 flex-shrink-0">
                                                        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                                                    </div>
                                                )}
                                                <div className="min-w-0">
                                                    <p className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">{item.productName}</p>
                                                    <p className="text-xs text-amber-700 dark:text-amber-400">
                                                        Vendedor: <span className="font-semibold">{item.vendedor}</span>
                                                        {item.saleDate && <span className="ml-2 text-amber-500 dark:text-amber-500/70">— {new Date(item.saleDate).toLocaleDateString('es-AR')}</span>}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 shrink-0">
                                                <span className="font-bold text-gray-900 dark:text-gray-100 text-sm">{money(((item.salePrice || 0) * item.quantity))}</span>
                                                <button
                                                    onClick={() => handleToggleCobrado(item.id, true)}
                                                    className="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 active:scale-95 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5"
                                                >
                                                    <Check className="w-3.5 h-3.5" />
                                                    Marcar cobrado
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

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
                                    className="w-full sm:w-auto bg-black hover:bg-gray-800 active:bg-gray-700 active:scale-95 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 shadow-sm"
                                >
                                    <Plus className="w-4 h-4" />
                                    Nueva Venta Directa
                                </button>
                            </div>
                            <SalesTable items={soldItems} onEdit={startEdit} onDelete={handleDeleteItem} resolveBatchRef={getItemBatchRef} onToggleFacturado={handleToggleFacturado} onToggleNoFacturar={handleToggleNoFacturar} onUpdateEnvio={handleUpdateEnvio} onToggleCobrado={handleToggleCobrado} onRepublish={handleRepublish} />
                        </div>
                    </div>
                ) : activeTab === 'inventory' ? (
                    <div className="inventory-dark space-y-4 sm:space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* Inventory Header */}
                        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100">
                            <div>
                                <h2 className="text-lg sm:text-xl font-bold text-gray-800">Inventario Actual</h2>
                                <p className="text-gray-500 text-sm">Productos disponibles para la venta y control de stock.</p>
                            </div>
                            <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
                                <button
                                    type="button"
                                    onClick={() => setIsLocationsModalOpen(true)}
                                    className="w-full sm:w-auto bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 px-3 sm:px-4 py-2.5 rounded-xl flex items-center justify-center shadow-sm transition-all font-medium text-sm gap-2"
                                >
                                    <MapPin className="w-4 h-4 text-blue-600" />
                                    <span>Ubicaciones ({locations.length})</span>
                                </button>
                                <button
                                    onClick={() => openNewModal('in_stock')}
                                    className="w-full sm:w-auto whitespace-nowrap text-sm sm:text-base bg-black hover:bg-gray-800 text-white px-3 sm:px-5 py-2.5 rounded-xl flex items-center justify-center shadow-lg transition-all transform hover:scale-[1.02] active:scale-95 font-medium text-sm"
                                >
                                    <Plus className="w-4 h-4 sm:w-5 sm:h-5 mr-1.5 sm:mr-2 shrink-0" />
                                    Agregar<span className="hidden sm:inline">&nbsp;Producto</span>
                                </button>
                            </div>
                        </div>

                        {/* Inventory List */}
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <InventoryTable 
                                items={stockItems} 
                                allItems={items} 
                                batchHistory={batchHistory} 
                                locations={locations}
                                onOpenLocationsModal={() => setIsLocationsModalOpen(true)}
                                onEdit={startEdit} 
                                onDelete={handleDeleteItem} 
                                resolveBatchRef={getItemBatchRef} 
                                onMoveUnits={handleMoveUnits}
                                onWithdraw={handleWithdraw} 
                                onTogglePublicInStore={handleTogglePublicInStore} 
                                onManageImages={setStoreImagesItem} 
                                onMerge={handleMergeItems}
                                onUpdateQuantity={handleUpdateQuantity}
                                onAddUnits={handleAddUnits}
                                onSell={(item) => {
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
                        onToggleNoFacturar={handleToggleNoFacturar}
                        onUpdateEnvio={handleUpdateEnvio}
                    />
                )}
            </div>

            {/* Locations Management Modal */}
            <LocationsModal
                isOpen={isLocationsModalOpen}
                onClose={() => setIsLocationsModalOpen(false)}
                locations={locations}
                onSaveLocation={handleSaveLocation}
                onDeleteLocation={handleDeleteLocation}
                items={items}
            />

            {/* Store Images Modal */}
            {storeImagesItem && (
                <StoreImagesModal
                    item={storeImagesItem}
                    onClose={() => setStoreImagesItem(null)}
                    onSave={async (id, patch) => {
                        await handleUpdateStoreImages(id, patch);
                        setStoreImagesItem(prev => prev ? { ...prev, ...patch } : null);
                    }}
                    onClearAll={() => handleClearStoreData(storeImagesItem)}
                    onGeneratePlaca={() => setPlacaItem(storeImagesItem)}
                />
            )}

            {/* Placa Marketplace Modal — con la versión más reciente del producto
                (foto principal incluida), no la copia guardada al abrir el modal de tienda */}
            {placaItem && (
                <PlacaModal item={items.find(i => i.id === placaItem.id) ?? placaItem} onClose={() => setPlacaItem(null)} />
            )}

            {/* Factura recibida de ARCA cuando el modal de esa venta no estaba abierto */}
            {arcaFacturaRecibida && (() => {
                const venta = items.find(i => i.id === arcaFacturaRecibida.ventaId);
                if (!venta) return null;
                return (
                    <FacturarModal
                        key={`${venta.id}-${arcaFacturaRecibida.factura.numero}`}
                        item={venta}
                        initialStep="confirm"
                        arcaPrefill={arcaFacturaRecibida.factura}
                        onClose={() => setArcaFacturaRecibida(null)}
                        onFacturado={(id, nro) => handleToggleFacturado(id, true, nro)}
                        onUpdateEnvio={handleUpdateEnvio}
                    />
                );
            })()}

            {toast && (
                <div
                    role="status"
                    aria-live="polite"
                    className={`fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm z-[70] rounded-xl px-4 py-3 shadow-2xl text-sm font-medium flex items-start gap-2 ${
                        toast.tone === 'ok' ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-amber-950'
                    }`}
                >
                    {toast.tone === 'ok' ? <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />}
                    <span className="flex-1">{toast.text}</span>
                    <button type="button" onClick={() => setToast(null)} className="shrink-0 opacity-80 hover:opacity-100" aria-label="Cerrar aviso">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

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
                            locations={locations}
                            onOpenLocationsModal={() => setIsLocationsModalOpen(true)}
                            batchCodes={batchHistory.map(b => b.batchCode)}
                            existingImages={Array.from(new Map(items.filter(i => i.imageUrl).map(i => [i.imageUrl!, { url: i.imageUrl!, name: i.productName }])).values())}
                            isSaving={isSaving}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

// Subcomponents

// Facturación Tab - Control de facturación ARCA separado del dashboard de ganancias
function FacturacionTab({ items, onToggleFacturado, onToggleNoFacturar, onUpdateEnvio }: {
    items: Item[],
    onToggleFacturado: (id: string, value: boolean, nroComprobante?: string) => void,
    onToggleNoFacturar: (id: string, value: boolean) => void,
    onUpdateEnvio: (id: string, envio: { envioAplica: boolean; envioCosto: number; envioMetodo: string; formasPago?: string[]; montoEfectivo?: number; montoTransferencia?: number; montoTarjeta?: number; montoMercadoPago?: number; montoOtro?: number }) => void
}) {
    const now = new Date();
    const [selectedMonth, setSelectedMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    const [facturarItem, setFacturarItem] = useState<Item | null>(null);

    const fmtMoney = money;
    const getItemTotal = (i: Item) => ((i.salePrice || 0) * i.quantity) + (i.envioAplica && i.envioCosto ? i.envioCosto : 0);

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
    const totalMes = facturadosMes.reduce((acc, i) => acc + getItemTotal(i), 0);

    // Total del año (based on selYear)
    const facturadosAnio = facturados.filter(i => {
        if (!i.saleDate) return false;
        return new Date(i.saleDate).getFullYear() === selYear;
    });
    const totalAnio = facturadosAnio.reduce((acc, i) => acc + getItemTotal(i), 0);

    // Rolling 12 meses
    const hace12Meses = new Date(now);
    hace12Meses.setDate(hace12Meses.getDate() - 365);
    const facturadosRolling = facturados.filter(i => {
        if (!i.saleDate) return false;
        const d = new Date(i.saleDate);
        return d >= hace12Meses && d <= now;
    });
    const totalRolling = facturadosRolling.reduce((acc, i) => acc + getItemTotal(i), 0);
    const porcentajeRolling = TOPE.anual > 0 ? (totalRolling / TOPE.anual) * 100 : 0;

    // Progress bar color & message
    // < 85%: verde sin alerta \u00B7 85\u2013100%: amarillo \u00B7 > 100%: rojo
    const getProgressColor = (pct: number) => {
        if (pct >= 100) return '#ef4444';
        if (pct >= 85) return '#f59e0b';
        return '#10b981';
    };
    const getProgressMessage = (pct: number) => {
        if (pct >= 100) {
            // A qu\u00E9 categor\u00EDa corresponde el facturado actual (A\u2192B\u2192C\u2192... seg\u00FAn la escala)
            const catCorresponde = categoriaParaMonto(totalRolling);
            const destino = catCorresponde && catCorresponde !== CATEGORIA_ACTUAL
                ? `recategoriz\u00E1 a ${catCorresponde} en ARCA`
                : catCorresponde === null
                    ? 'super\u00E1s la escala cargada (cat. E) \u2014 consult\u00E1 recategorizaci\u00F3n en ARCA'
                    : 'recategoriz\u00E1 en ARCA';
            return { icon: '\u{1F6A8}', text: `Excediste el tope categor\u00EDa ${CATEGORIA_ACTUAL}, ${destino}`, color: 'bg-red-50 text-red-700' };
        }
        if (pct >= 85) return { icon: '\u26A0\uFE0F', text: `Cerca del tope categor\u00EDa ${CATEGORIA_ACTUAL} \u2014 la siguiente es ${CATEGORIA_SIGUIENTE} (${fmtMoney(TOPE_SIGUIENTE.anual)})`, color: 'bg-amber-50 text-amber-700' };
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
            total: monthItems.reduce((acc, i) => acc + getItemTotal(i), 0),
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
    const barMax = Math.max(...monthlyTotals.map(m => m.total), TOPE.mensualTope, 1) * 1.15;

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
                            Control de Facturación ARCA
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
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-white p-3.5 sm:p-5 rounded-2xl shadow-sm border border-gray-100 min-w-0">
                    <p className="text-[10px] sm:text-xs text-gray-400 uppercase tracking-wider font-semibold">Facturado este mes</p>
                    <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-1.5 sm:mt-2 tabular-nums tracking-tight">{fmtMoney(totalMes)}</p>
                    <p className="text-xs sm:text-sm text-gray-500 mt-1">{facturadosMes.length} {facturadosMes.length === 1 ? 'venta' : 'ventas'}</p>
                </div>
                <div className="bg-white p-3.5 sm:p-5 rounded-2xl shadow-sm border border-gray-100 min-w-0">
                    <p className="text-[10px] sm:text-xs text-gray-400 uppercase tracking-wider font-semibold">Facturado en {selYear}</p>
                    <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-1.5 sm:mt-2 tabular-nums tracking-tight">{fmtMoney(totalAnio)}</p>
                    <p className="text-xs sm:text-sm text-gray-500 mt-1">{facturadosAnio.length} {facturadosAnio.length === 1 ? 'venta facturada' : 'ventas facturadas'}</p>
                </div>
                <div className="bg-white p-3.5 sm:p-5 rounded-2xl shadow-sm border border-gray-100 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-blue-600" />
                        <p className="text-[10px] sm:text-xs text-gray-400 uppercase tracking-wider font-semibold">Rolling 12 meses</p>
                    </div>
                    <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-1.5 sm:mt-2 tabular-nums tracking-tight">{fmtMoney(totalRolling)}</p>
                    <p className="text-xs sm:text-sm text-gray-500 mt-1">{facturadosRolling.length} {facturadosRolling.length === 1 ? 'venta' : 'ventas'} — últimos 365 días</p>
                </div>
                <div className="bg-white p-3.5 sm:p-5 rounded-2xl shadow-sm border border-gray-100 min-w-0">
                    <p className="text-[10px] sm:text-xs text-gray-400 uppercase tracking-wider font-semibold">Tope anual cat. {CATEGORIA_ACTUAL}</p>
                    <p className="text-lg sm:text-2xl font-bold text-gray-900 mt-1.5 sm:mt-2 tabular-nums tracking-tight">{fmtMoney(TOPE.anual)}</p>
                    <p className="text-xs sm:text-sm text-gray-500 mt-1">{fmtMoney(Math.max(0, TOPE.anual - totalRolling))} restante</p>
                </div>
            </div>

            {/* Progress bar — rolling 12 meses */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex justify-between items-center gap-3 mb-3">
                    <p className="text-sm font-semibold text-gray-700">Progreso rolling 12 meses vs tope cat. {CATEGORIA_ACTUAL}</p>
                    <p className="text-sm font-bold" style={{ color: getProgressColor(porcentajeRolling) }}>
                        {percent(porcentajeRolling)}
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
                {CATEGORIA_SIGUIENTE !== CATEGORIA_ACTUAL && (
                    <p className="mt-2 text-xs text-gray-400">
                        Referencia: tope cat. {CATEGORIA_SIGUIENTE} (siguiente) — <span className="font-semibold text-gray-500">{fmtMoney(TOPE_SIGUIENTE.anual)}</span>
                    </p>
                )}
                {progressMsg && (
                    <div className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${progressMsg.color}`}>
                        <span>{progressMsg.icon}</span>
                        <span>{progressMsg.text}</span>
                    </div>
                )}
            </div>

            {/* Facturado por mes, con las líneas de tope y de margen holgado.
                El área de dibujo tiene alto fijo y las barras se posicionan dentro en
                porcentaje: con las barras dentro de una columna flex sin alto, el
                porcentaje se resolvía a 0 y no se dibujaba ninguna. */}
            <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-gray-100">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-5">
                    <p className="text-sm font-semibold text-gray-700">Facturado por mes — {selYear}</p>
                    <div className="flex items-center gap-3 text-[10px] sm:text-[11px] text-gray-500">
                        <span className="inline-flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-gray-400 dark:border-slate-500" /> Tope {moneyCompact(TOPE.mensualTope)}</span>
                        <span className="inline-flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-emerald-400" /> Holgado {moneyCompact(TOPE.mensualSeguro)}</span>
                    </div>
                </div>
                <div className="relative h-44">
                    <div className="absolute inset-x-0 border-t-2 border-dashed border-gray-300 dark:border-slate-500 pointer-events-none" style={{ bottom: `${lineTopePercent}%` }} />
                    <div className="absolute inset-x-0 border-t-2 border-dashed border-emerald-400 pointer-events-none" style={{ bottom: `${lineSeguroPercent}%` }} />
                    <div className="absolute inset-0 flex items-end gap-1 sm:gap-2">
                        {monthlyTotals.map(m => {
                            const selected = m.month === selMonth - 1;
                            const barColor = m.total > TOPE.mensualTope
                                ? 'bg-red-500'
                                : m.total > TOPE.mensualSeguro
                                    ? 'bg-amber-400'
                                    : selected
                                        ? 'bg-blue-600'
                                        : 'bg-blue-300 group-hover:bg-blue-400';
                            const h = m.total > 0 ? Math.max((m.total / barMax) * 100, 3) : 0;
                            return (
                                <button
                                    key={m.month}
                                    type="button"
                                    className="group relative flex-1 h-full cursor-pointer"
                                    title={`${monthNames[m.month]}: ${fmtMoney(m.total)} (${m.count} ${m.count === 1 ? 'venta' : 'ventas'})`}
                                    aria-label={`${monthNames[m.month]}: ${fmtMoney(m.total)}, ${m.count} ${m.count === 1 ? 'venta' : 'ventas'}`}
                                    aria-pressed={selected}
                                    onClick={() => setSelectedMonth(`${selYear}-${String(m.month + 1).padStart(2, '0')}`)}
                                >
                                    {m.total > 0 && (
                                        <span
                                            className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] sm:text-[10px] font-semibold tabular-nums ${selected ? 'text-blue-600' : 'text-gray-500'}`}
                                            style={{ bottom: `calc(${h}% + 3px)` }}
                                        >
                                            {moneyCompact(m.total)}
                                        </span>
                                    )}
                                    <span
                                        className={`absolute bottom-0 inset-x-0 transition-all duration-500 ${m.total > 0 ? `rounded-t-md ${barColor}` : 'bg-gray-200 dark:bg-slate-700'}`}
                                        style={{ height: m.total > 0 ? `${h}%` : '2px' }}
                                    />
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="flex gap-1 sm:gap-2 mt-1.5">
                    {monthlyTotals.map(m => (
                        <span key={m.month} className={`flex-1 text-center text-[10px] font-medium ${m.month === selMonth - 1 ? 'text-blue-600 font-bold' : 'text-gray-400'}`}>
                            {m.label}
                        </span>
                    ))}
                </div>
                {/* Sugerencia de tope mensual */}
                <p className="mt-4 text-xs text-gray-400 text-center">
                    Para mantenerte holgado en cat. {CATEGORIA_ACTUAL}, no factures más de <span className="font-semibold text-gray-600">{fmtMoney(TOPE.mensualSeguro)}/mes</span> (tope anual ÷ 12 × 0,85).
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
                                        <p className="font-bold text-gray-900">{fmtMoney(getItemTotal(item))}</p>
                                    </div>
                                    <div className="mt-2 flex justify-between items-center text-sm">
                                        <div className="flex items-center gap-2">
                                            <span className="text-gray-500">x{item.quantity} a {fmtMoney(item.salePrice || 0)}</span>
                                            {item.envioAplica && item.envioCosto ? (
                                                <span className="text-xs text-blue-600 flex items-center gap-0.5" title={item.envioMetodo || 'Envío'}>
                                                    <Truck className="w-3 h-3" /> +{fmtMoney(item.envioCosto)}
                                                </span>
                                            ) : null}
                                        </div>
                                        <button
                                            onClick={() => onToggleFacturado(item.id, false)}
                                            className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1"
                                        >
                                            <XCircle className="w-3 h-3" />
                                            Desmarcar
                                        </button>
                                    </div>
                                    {item.nroComprobante && (
                                        <p className="mt-2 text-xs text-gray-500">
                                            Comprobante: <span className="font-mono text-gray-700">{item.nroComprobante}</span>
                                        </p>
                                    )}
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
                                        <th className="px-6 py-3 text-right">Envío</th>
                                        <th className="px-6 py-3 text-right">Total</th>
                                        <th className="px-6 py-3 text-center">Fecha</th>
                                        <th className="px-6 py-3 text-center">Comprobante</th>
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
                                            <td className="px-6 py-4 text-right font-mono text-xs">
                                                {item.envioAplica && item.envioCosto ? (
                                                    <span className="text-blue-600 cursor-help" title={item.envioMetodo || 'Envío'}>{fmtMoney(item.envioCosto)}</span>
                                                ) : <span className="text-gray-300">-</span>}
                                            </td>
                                            <td className="px-6 py-4 text-right font-mono font-bold text-gray-900">{fmtMoney(getItemTotal(item))}</td>
                                            <td className="px-6 py-4 text-center text-xs text-gray-500">{item.saleDate ? formatDateDDMMAAAA(item.saleDate) : '-'}</td>
                                            <td className="px-6 py-4 text-center font-mono text-xs">
                                                {item.nroComprobante
                                                    ? <span className="text-gray-900">{item.nroComprobante}</span>
                                                    : <span className="text-gray-300">-</span>}
                                            </td>
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
                                        <td className="px-6 py-3" colSpan={4}>Total del mes</td>
                                        <td className="px-6 py-3 text-right font-mono">{fmtMoney(totalMes)}</td>
                                        <td colSpan={3}></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </>
                )}
            </div>

            {facturarItem && <FacturarModal item={facturarItem} onClose={() => setFacturarItem(null)} onFacturado={(id, nro) => onToggleFacturado(id, true, nro)} onUpdateEnvio={onUpdateEnvio} />}

            {/* Ventas sin facturar */}
            {(() => {
                const sinFacturar = items.filter(i => !i.facturado && !i.noFacturar && i.saleDate && afterCutoff(i.saleDate) && (i.itemType === 'personal' || i.condition !== 'usado'));
                if (sinFacturar.length === 0) return null;
                return (
                    <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
                        <div className="p-4 sm:p-6 border-b border-amber-100 bg-amber-50/50">
                            <h3 className="font-bold text-amber-800 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />
                                Ventas sin facturar ({sinFacturar.length})
                            </h3>
                            <p className="text-sm text-amber-600 mt-1">Estas ventas aún no fueron marcadas como facturadas.</p>
                        </div>
                        <div className="hidden sm:block overflow-x-auto">
                            <table className="w-full text-left text-sm text-gray-600">
                                <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs tracking-wider">
                                    <tr>
                                        <th className="px-6 py-3">Producto</th>
                                        <th className="px-6 py-3 text-center">Cant.</th>
                                        <th className="px-6 py-3 text-right">Precio</th>
                                        <th className="px-6 py-3 text-right">Envío</th>
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
                                            <td className="px-6 py-3 text-right font-mono text-xs">
                                                {item.envioAplica && item.envioCosto ? (
                                                    <span className="text-blue-600 cursor-help" title={item.envioMetodo || 'Envío'}>{fmtMoney(item.envioCosto)}</span>
                                                ) : <span className="text-gray-300">-</span>}
                                            </td>
                                            <td className="px-6 py-3 text-right font-mono font-medium">{fmtMoney(getItemTotal(item))}</td>
                                            <td className="px-6 py-3 text-center text-xs text-gray-500">{item.saleDate ? formatDateDDMMAAAA(item.saleDate) : '-'}</td>
                                            <td className="px-6 py-3 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    <button
                                                        onClick={() => setFacturarItem(item)}
                                                        className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-2 py-1 rounded transition-colors inline-flex items-center gap-1"
                                                    >
                                                        <FileText className="w-3 h-3" />
                                                        Facturar
                                                    </button>
                                                    <button
                                                        onClick={() => onToggleNoFacturar(item.id, true)}
                                                        className="text-gray-400 hover:text-red-500 hover:bg-red-50 p-1 rounded transition-colors"
                                                        title="Excluir de facturacion"
                                                    >
                                                        <X className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
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
                                        <p className="text-xs text-gray-500">
                                            {fmtMoney((item.salePrice || 0) * item.quantity)}
                                            {item.envioAplica && item.envioCosto ? <span className="text-blue-600"> +envío {fmtMoney(item.envioCosto)}</span> : null}
                                            {' — '}{item.saleDate ? formatDateDDMMAAAA(item.saleDate) : ''}
                                        </p>
                                    </div>
                                    <div className="flex gap-1 flex-shrink-0">
                                        <button
                                            onClick={() => setFacturarItem(item)}
                                            className="bg-blue-600 text-white text-xs px-2 py-1 rounded"
                                        >
                                            Facturar
                                        </button>
                                        <button
                                            onClick={() => onToggleNoFacturar(item.id, true)}
                                            className="text-gray-400 hover:text-red-500 p-1 rounded"
                                            title="No facturar"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
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
function FacturarModal({ item, onClose, onFacturado, onUpdateEnvio, initialStep = 'form', arcaPrefill }: { item: Item; onClose: () => void; onFacturado?: (id: string, nroComprobante?: string) => void; onUpdateEnvio?: (id: string, envio: { envioAplica: boolean; envioCosto: number; envioMetodo: string; formasPago?: string[]; montoEfectivo?: number; montoTransferencia?: number; montoTarjeta?: number; montoMercadoPago?: number; montoOtro?: number }) => void; initialStep?: 'form' | 'confirm'; arcaPrefill?: ArcaFactura }) {
    const [producto, setProducto] = useState(
        item.itemType === 'personal' ? `${item.productName} usado` : item.productName
    );
    const [cantidad, setCantidad] = useState(item.quantity);
    const [precio, setPrecio] = useState(item.salePrice || 0);
    const [fecha, setFecha] = useState(() => {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const maxPastDate = new Date(today);
        maxPastDate.setDate(today.getDate() - 3);

        let saleDate = today;
        if (item.saleDate) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(item.saleDate)) {
                const [y, m, d] = item.saleDate.split('-').map(Number);
                saleDate = new Date(y, m - 1, d);
            } else {
                const parsed = new Date(item.saleDate);
                if (!isNaN(parsed.getTime())) {
                    saleDate = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
                }
            }
        }

        // ARCA limit: Max 3 days in the past from today
        const targetDate = saleDate < maxPastDate ? maxPastDate : saleDate;

        const yyyy = targetDate.getFullYear();
        const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
        const dd = String(targetDate.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    });

    const isDateAdjusted = (() => {
        if (!item.saleDate) return false;
        let origStr = '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(item.saleDate)) {
            origStr = item.saleDate;
        } else {
            const parsed = new Date(item.saleDate);
            if (!isNaN(parsed.getTime())) {
                const yyyy = parsed.getFullYear();
                const mm = String(parsed.getMonth() + 1).padStart(2, '0');
                const dd = String(parsed.getDate()).padStart(2, '0');
                origStr = `${yyyy}-${mm}-${dd}`;
            }
        }
        return origStr !== '' && origStr < fecha;
    })();
    const [formasPagoSelected, setFormasPagoSelected] = useState<string[]>(item.formasPago || ['transferencia']);
    const [montos, setMontos] = useState<Record<string, number>>({});
    const [envioAplica, setEnvioAplica] = useState(item.envioAplica || false);
    const [envioCosto, setEnvioCosto] = useState(item.envioCosto || 0);
    const [envioMetodo, setEnvioMetodo] = useState(item.envioMetodo || '');
    const [showEnvioWarning, setShowEnvioWarning] = useState(false);
    const [step, setStep] = useState<'form' | 'confirm'>(initialStep);
    const [nroComprobante, setNroComprobante] = useState(arcaPrefill?.numero || item.nroComprobante || '');
    // Datos que devolvió ARCA (número, CAE, total) — se muestran, no se guardan solos
    const [arcaData, setArcaData] = useState<ArcaFactura | null>(arcaPrefill ?? null);
    const [pegarError, setPegarError] = useState<string | null>(null);
    const guardarRef = useRef<HTMLButtonElement>(null);

    // Registrarse como modal abierto para esta venta y recibir el número de ARCA
    // si llega mientras está abierto (el listener vive en el Dashboard).
    useEffect(() => {
        modalesFacturaAbiertos.add(item.id);
        const onArca = (e: Event) => {
            const detail = (e as CustomEvent<ArcaFactura & { ventaId: string }>).detail;
            if (detail?.ventaId !== item.id) return;
            setArcaData(detail);
            setNroComprobante(detail.numero);
            setPegarError(null);
            setStep('confirm');
        };
        window.addEventListener(ARCA_PREFILL_EVENT, onArca);
        return () => {
            modalesFacturaAbiertos.delete(item.id);
            window.removeEventListener(ARCA_PREFILL_EVENT, onArca);
        };
    }, [item.id]);

    // Con el número ya escrito, el foco va a "Guardar": confirmar es un Enter
    useEffect(() => {
        if (step === 'confirm' && arcaData) guardarRef.current?.focus();
    }, [step, arcaData]);

    const handlePegar = async () => {
        setPegarError(null);
        try {
            const numero = extractNumeroFactura(await navigator.clipboard.readText());
            if (numero) setNroComprobante(numero);
            else setPegarError('No encontré un número de factura en el portapapeles');
        } catch {
            setPegarError('No pude leer el portapapeles. Permití el acceso o pegalo con Ctrl+V / ⌘V');
        }
    };

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

    const metodosEnvio = [
        'Uber Flash',
        'Mensajería local',
        'Correo Andreani',
        'Correo OCA',
        'Vía Cargo',
        'Otro',
    ];

    const totalProducto = cantidad * Math.round(precio);
    const totalConEnvio = totalProducto + (envioAplica ? Math.round(envioCosto) : 0);

    const sumaMontos = Object.values(montos).reduce((a, b) => a + b, 0);
    const multiPago = formasPagoSelected.length > 1;

    const toggleFormaPago = (value: string) => {
        setFormasPagoSelected(prev => {
            if (prev.includes(value)) {
                if (prev.length === 1) return prev;
                setMontos(m => { const next = { ...m }; delete next[value]; return next; });
                return prev.filter(v => v !== value);
            }
            return [...prev, value];
        });
    };

    const mapMontosToDb = () => {
        let efectivo = 0, transferencia = 0, tarjeta = 0, mercadoPago = 0, otro = 0;
        for (const [key, val] of Object.entries(montos)) {
            switch (key) {
                case 'contado': efectivo += val; break;
                case 'transferencia': transferencia += val; break;
                case 'tarjeta_debito': case 'tarjeta_credito': tarjeta += val; break;
                case 'electronico': mercadoPago += val; break;
                default: otro += val; break;
            }
        }
        return { montoEfectivo: efectivo, montoTransferencia: transferencia, montoTarjeta: tarjeta, montoMercadoPago: mercadoPago, montoOtro: otro };
    };

    const handleFacturar = () => {
        if (formasPagoSelected.length === 0) {
            alert('Seleccioná al menos una forma de pago');
            return;
        }
        if (envioAplica && envioCosto <= 0) {
            alert('El costo de envío debe ser mayor a $0');
            return;
        }
        if (envioAplica && envioCosto > precio * cantidad) {
            if (!showEnvioWarning) {
                setShowEnvioWarning(true);
                return;
            }
        }

        const [y, m, d] = fecha.split('-');
        const fechaFormatted = `${d}/${m}/${y}`;
        const ventaObj: any = {
            // El userscript de ARCA lo devuelve con el número de factura generado
            ventaId: item.id,
            fecha: fechaFormatted,
            producto,
            cantidad,
            precio: Math.round(precio),
            formasPago: formasPagoSelected,
            tipo: 'producto',
        };
        if (envioAplica && envioCosto > 0) {
            ventaObj.envio = {
                metodo: envioMetodo || 'Envío',
                costo: Math.round(envioCosto),
            };
        }
        const base64 = btoa(JSON.stringify(ventaObj));
        const url = `https://fe.afip.gob.ar/rcel/jsp/index_bis.jsp?venta=${encodeURIComponent(base64)}`;
        // Sin noopener/noreferrer: el userscript de ARCA responde por window.opener
        ultimaVentaFacturada.current = item.id;
        window.open(url, ARCA_WINDOW_NAME);

        const pagoDb = multiPago ? mapMontosToDb() : {};
        onUpdateEnvio?.(item.id, { envioAplica, envioCosto: Math.round(envioCosto), envioMetodo, formasPago: formasPagoSelected, ...pagoDb });
        setStep('confirm');
    };

    const handleConfirmFacturado = () => {
        onFacturado?.(item.id, nroComprobante);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={step === 'form' ? onClose : undefined}>
            <div className="bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md ring-1 ring-white/10 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                {step === 'form' ? (
                    <>
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
                                {isDateAdjusted && (
                                    <p className="text-xs text-amber-400 mt-1.5 flex items-center gap-1.5 bg-amber-950/40 border border-amber-800/40 p-2 rounded-lg">
                                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                                        <span>Fecha ajustada automáticamente a 3 días atrás (máximo permitido por ARCA para ventas anteriores).</span>
                                    </p>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">Forma de pago</label>
                                <div className="border border-gray-700/50 rounded-xl p-3 space-y-1.5 max-h-52 overflow-y-auto">
                                    {formasPago.map(fp => {
                                        const checked = formasPagoSelected.includes(fp.value);
                                        return (
                                            <div key={fp.value} className="flex items-center gap-2">
                                                <div
                                                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all cursor-pointer flex-shrink-0 ${checked ? 'bg-blue-600 border-blue-600' : 'border-gray-600 bg-gray-800 hover:border-gray-500'}`}
                                                    onClick={() => toggleFormaPago(fp.value)}
                                                >
                                                    {checked && <Check className="w-3.5 h-3.5 text-white" />}
                                                </div>
                                                <span
                                                    className={`text-sm flex-1 cursor-pointer select-none ${checked ? 'text-white' : 'text-gray-400'}`}
                                                    onClick={() => toggleFormaPago(fp.value)}
                                                >
                                                    {fp.label}
                                                </span>
                                                {multiPago && checked && (
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-xs text-gray-500">$</span>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            value={montos[fp.value] || ''}
                                                            onChange={e => setMontos(prev => ({ ...prev, [fp.value]: Number(e.target.value) }))}
                                                            className="w-24 px-2 py-1 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm text-right focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                                                            placeholder="0"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                {multiPago && (
                                    <div className={`mt-2 rounded-lg p-2 flex items-center gap-2 text-xs ${
                                        sumaMontos === totalConEnvio
                                            ? 'bg-emerald-900/30 border border-emerald-700/50 text-emerald-300'
                                            : sumaMontos > 0
                                                ? 'bg-amber-900/30 border border-amber-700/50 text-amber-300'
                                                : 'bg-gray-800/50 border border-gray-700/50 text-gray-400'
                                    }`}>
                                        {sumaMontos === totalConEnvio ? (
                                            <><CheckCircle className="w-3.5 h-3.5 flex-shrink-0" /> Montos verificados: {money(sumaMontos)}</>
                                        ) : sumaMontos > 0 ? (
                                            <><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> Suma {money(sumaMontos)} ≠ Total {money(totalConEnvio)}</>
                                        ) : (
                                            <span>Ingresá los montos por forma de pago (total: {money(totalConEnvio)})</span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Envío Section */}
                            <div className="border border-gray-700/50 rounded-xl p-4 space-y-3">
                                <label className="flex items-center gap-3 cursor-pointer select-none">
                                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${envioAplica ? 'bg-blue-600 border-blue-600' : 'border-gray-600 bg-gray-800'}`}
                                        onClick={() => { setEnvioAplica(!envioAplica); setShowEnvioWarning(false); }}>
                                        {envioAplica && <Check className="w-3.5 h-3.5 text-white" />}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Truck className="w-4 h-4 text-gray-400" />
                                        <span className="text-sm font-medium text-gray-300">Incluye envío</span>
                                    </div>
                                </label>
                                {envioAplica && (
                                    <div className="space-y-3 pt-1">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-400 mb-1">Método de envío</label>
                                            <select
                                                value={envioMetodo}
                                                onChange={e => setEnvioMetodo(e.target.value)}
                                                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all appearance-none"
                                            >
                                                <option value="">Sin especificar</option>
                                                {metodosEnvio.map(m => (
                                                    <option key={m} value={m}>{m}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-400 mb-1">Costo del envío</label>
                                            <input
                                                type="number"
                                                min={0}
                                                value={envioCosto}
                                                onChange={e => { setEnvioCosto(Number(e.target.value)); setShowEnvioWarning(false); }}
                                                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                                placeholder="$0"
                                            />
                                        </div>
                                        {showEnvioWarning && (
                                            <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg p-2.5 flex items-start gap-2">
                                                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                                                <p className="text-xs text-amber-300">El envío supera al precio del producto. Hacé click en "Facturar" de nuevo para confirmar.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/50 space-y-1">
                                <div className="flex justify-between text-xs text-gray-400">
                                    <span>Producto ({cantidad} x {money(Math.round(precio))})</span>
                                    <span className="text-gray-300">{money(totalProducto)}</span>
                                </div>
                                {envioAplica && envioCosto > 0 && (
                                    <div className="flex justify-between text-xs text-gray-400">
                                        <span className="flex items-center gap-1"><Truck className="w-3 h-3" /> Envío{envioMetodo ? ` (${envioMetodo})` : ''}</span>
                                        <span className="text-gray-300">{money(Math.round(envioCosto))}</span>
                                    </div>
                                )}
                                <div className="flex justify-between pt-1 border-t border-gray-700/50">
                                    <span className="text-xs text-gray-400">Total a facturar</span>
                                    <span className="text-white font-semibold text-sm">{money(totalConEnvio)}</span>
                                </div>
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
                    </>
                ) : (
                    <>
                        <div className="p-6 border-b border-gray-700/50 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-xl bg-amber-600/20 flex items-center justify-center">
                                    <AlertTriangle className="w-5 h-5 text-amber-400" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-white">Confirmar facturación</h2>
                                    <p className="text-sm text-gray-400">¿Se completó correctamente en ARCA?</p>
                                </div>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                                <p className="text-sm text-gray-300 font-medium">{producto}</p>
                                <p className="text-xs text-gray-500 mt-1">
                                    {cantidad} x {money(Math.round(precio))}
                                    {envioAplica && envioCosto > 0 ? ` + envío ${money(Math.round(envioCosto))}` : ''}
                                    {' = '}<span className="text-white font-semibold">{money(totalConEnvio)}</span>
                                </p>
                            </div>
                            {arcaData && (
                                <div className="rounded-xl p-3 bg-emerald-950/40 border border-emerald-800/50 text-xs text-emerald-300 space-y-0.5">
                                    <p className="flex items-center gap-1.5 font-semibold"><CheckCircle className="w-3.5 h-3.5 flex-shrink-0" /> Número recibido de ARCA — revisalo y guardá</p>
                                    {arcaData.cae && <p className="text-emerald-400/80">CAE: <span className="font-mono">{arcaData.cae}</span></p>}
                                    {arcaData.archivo && <p className="text-emerald-400/80 truncate">PDF: <span className="font-mono">{arcaData.archivo}</span></p>}
                                </div>
                            )}
                            {arcaData && totalNoCoincide(arcaData.total, totalConEnvio) && (
                                <div className="rounded-xl p-3 bg-amber-950/40 border border-amber-700/50 flex items-start gap-2">
                                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                                    <p className="text-xs text-amber-300">
                                        El total de la factura en ARCA ({money(Math.round(arcaData.total ?? 0))}) no coincide con el de la venta ({money(totalConEnvio)}). Revisá antes de guardar.
                                    </p>
                                </div>
                            )}
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-1.5">N° de comprobante</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={nroComprobante}
                                        onChange={e => { setNroComprobante(e.target.value); setPegarError(null); }}
                                        placeholder="00001-00000106"
                                        autoFocus={!arcaData}
                                        className="flex-1 min-w-0 px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                                    />
                                    <button
                                        type="button"
                                        onClick={handlePegar}
                                        className="shrink-0 px-3 py-2.5 bg-gray-800 border border-gray-700 text-gray-300 rounded-xl hover:bg-gray-700 hover:text-white transition-colors text-sm font-medium flex items-center gap-1.5"
                                        title="Pegar el número de factura copiado (busca el formato 00001-00000106)"
                                    >
                                        <ClipboardPaste className="w-4 h-4" />
                                        Pegar
                                    </button>
                                </div>
                                {pegarError && <p className="text-xs text-amber-400 mt-1.5">{pegarError}</p>}
                                <p className="text-xs text-gray-500 mt-1.5">
                                    {arcaData
                                        ? 'Llegó solo desde ARCA. Si no coincide con el PDF, corregilo antes de guardar.'
                                        : 'Llega solo desde ARCA al emitir la factura. Si no llega, copialo del PDF y tocá Pegar.'}
                                </p>
                            </div>
                            <p className="text-sm text-gray-400 text-center">
                                Si la facturación fue exitosa, marcala como facturada. Si hubo algún problema, podés cerrar sin marcar.
                            </p>
                        </div>
                        <div className="p-6 border-t border-gray-700/50 flex gap-3">
                            <button
                                onClick={onClose}
                                className="flex-1 px-4 py-2.5 bg-gray-800 text-gray-300 rounded-xl hover:bg-gray-700 transition-colors font-medium text-sm flex items-center justify-center gap-2"
                            >
                                <XCircle className="w-4 h-4" />
                                No se facturó
                            </button>
                            <button
                                ref={guardarRef}
                                onClick={handleConfirmFacturado}
                                className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors font-medium text-sm flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-gray-900"
                            >
                                <CheckCircle className="w-4 h-4" />
                                Sí, facturada
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function SalesTable({ items, onEdit, onDelete, resolveBatchRef, onToggleFacturado, onToggleNoFacturar, onUpdateEnvio, onToggleCobrado, onRepublish }: {
    items: Item[],
    onEdit: (i: Item) => void,
    onDelete: (id: string) => void,
    resolveBatchRef: (item: Item) => string | undefined,
    onToggleFacturado: (id: string, value: boolean, nroComprobante?: string) => void,
    onToggleNoFacturar: (id: string, value: boolean) => void,
    onUpdateEnvio: (id: string, envio: { envioAplica: boolean; envioCosto: number; envioMetodo: string; formasPago?: string[]; montoEfectivo?: number; montoTransferencia?: number; montoTarjeta?: number; montoMercadoPago?: number; montoOtro?: number }) => void,
    onToggleCobrado: (id: string, value: boolean) => void,
    onRepublish: (item: Item) => void
}) {
    const [facturarItem, setFacturarItem] = useState<Item | null>(null);
    const FACTURACION_CUTOFF = new Date('2026-04-18T00:00:00');
    const canFacturar = (item: Item) => item.saleDate && new Date(item.saleDate) >= FACTURACION_CUTOFF && (item.itemType === 'personal' || item.condition !== 'usado');

    if (items.length === 0) {
        return <div className="p-8 sm:p-12 text-center text-gray-400">No hay ventas registradas aún.</div>;
    }

    return (
        <>
            {facturarItem && <FacturarModal item={facturarItem} onClose={() => setFacturarItem(null)} onFacturado={(id, nro) => onToggleFacturado(id, true, nro)} onUpdateEnvio={onUpdateEnvio} />}
            {/* Celular: tarjeta compacta — datos en una línea, importes en una franja y acciones en una fila */}
            <div className="sm:hidden p-3 space-y-2.5">
                {items.map((item) => {
                    const isPersonal = item.itemType === 'personal';
                    const total = (item.salePrice || 0) * item.quantity;
                    const profit = total - (item.purchasePrice * item.quantity);
                    const isPositive = profit >= 0;
                    const unitHint = item.quantity > 1 ? ' c/u' : '';
                    const iconBtn = 'h-10 w-10 shrink-0 rounded-xl border flex items-center justify-center transition-all active:scale-95 active:brightness-95';
                    const meta = [
                        item.saleDate ? formatDateDDMMAAAA(item.saleDate) : null,
                        resolveBatchRef(item) || 'Venta directa',
                        conditionLabelMap[item.condition || 'nuevo'],
                        item.location || null,
                    ].filter(Boolean).join(' · ');

                    return (
                        <div key={item.id} className={`rounded-2xl border p-3.5 shadow-sm ${isPersonal ? 'border-violet-200 bg-violet-50/30 dark:border-violet-800/50 dark:bg-violet-950/25' : 'border-gray-200 bg-white'}`}>
                            <div className="flex items-start gap-3">
                                {item.imageUrl && (
                                    <div className="w-11 h-11 rounded-lg overflow-hidden border border-gray-100 flex-shrink-0">
                                        <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <h3 className="font-semibold text-gray-900 leading-snug text-[15px] line-clamp-2">{item.productName}</h3>
                                    <p className="text-xs text-gray-500 mt-0.5">{meta}</p>
                                    {(isPersonal || item.withdrawalReason) && (
                                        <div className="flex gap-1 flex-wrap mt-1">
                                            {isPersonal && <span className="text-[10px] font-bold bg-violet-100 text-violet-600 dark:bg-violet-900/60 dark:text-violet-200 px-1.5 py-0.5 rounded inline-block">PROPIO</span>}
                                            {item.withdrawalReason && (() => { const w = withdrawalLabels[item.withdrawalReason]; return w ? <span className={`text-[10px] font-bold ${w.bgColor} ${w.color} px-1.5 py-0.5 rounded inline-block`}>{w.label}</span> : null; })()}
                                        </div>
                                    )}
                                </div>
                                <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-md text-xs font-semibold shrink-0 tabular-nums">
                                    x{item.quantity}
                                </span>
                            </div>

                            <div className={`mt-3 grid ${isPersonal ? 'grid-cols-2' : 'grid-cols-3'} gap-2 rounded-xl bg-gray-50 px-3 py-2.5`}>
                                {!isPersonal && (
                                    <div className="min-w-0">
                                        <p className="text-gray-400 text-[11px]">Compra{unitHint}</p>
                                        <p className="font-medium text-gray-700 text-sm tabular-nums truncate">{money(item.purchasePrice)}</p>
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <p className="text-gray-400 text-[11px]">Venta{unitHint}</p>
                                    <p className="font-medium text-gray-900 text-sm tabular-nums truncate">{money(item.salePrice)}</p>
                                </div>
                                <div className="min-w-0 text-right">
                                    <p className="text-gray-400 text-[11px]">{isPersonal ? 'Ingreso' : 'Ganancia'}{item.quantity > 1 ? ' total' : ''}</p>
                                    {isPersonal ? (
                                        <p className="font-bold text-violet-600 text-sm tabular-nums truncate">{money(total)}</p>
                                    ) : (
                                        <p className={`font-bold text-sm tabular-nums truncate ${isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>{money(profit)}</p>
                                    )}
                                </div>
                            </div>

                            {item.facturado && item.nroComprobante && (
                                <p className="mt-2 text-[11px] text-gray-500">Comprobante <span className="font-mono text-gray-700">{item.nroComprobante}</span></p>
                            )}

                            {item.vendedor && (
                                <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
                                    <span className="text-gray-500 truncate">Vendedor: <span className="font-medium text-gray-700">{item.vendedor}</span></span>
                                    {item.cobrado === false ? (
                                        <button
                                            onClick={() => onToggleCobrado(item.id, true)}
                                            className="shrink-0 text-[11px] font-bold bg-amber-500/20 text-amber-600 dark:text-amber-400 px-2.5 py-1.5 rounded-lg transition-all active:scale-95"
                                        >
                                            PENDIENTE DE COBRO
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => onToggleCobrado(item.id, false)}
                                            className="shrink-0 text-[11px] font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-2.5 py-1.5 rounded-lg transition-all active:scale-95"
                                        >
                                            COBRADO
                                        </button>
                                    )}
                                </div>
                            )}

                            <div className="mt-3 flex items-center gap-2">
                                {item.facturado ? (
                                    <button
                                        onClick={() => onToggleFacturado(item.id, false)}
                                        className="flex-1 min-w-0 h-10 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-medium flex items-center justify-center gap-1.5 transition-all active:scale-95 active:bg-green-800"
                                        title={item.nroComprobante ? `Comprobante ${item.nroComprobante} — tocá para desmarcar` : 'Facturada — tocá para desmarcar'}
                                    >
                                        <CheckCircle className="w-4 h-4 shrink-0" />
                                        Facturada
                                    </button>
                                ) : item.noFacturar ? (
                                    <button
                                        onClick={() => onToggleNoFacturar(item.id, false)}
                                        className="flex-1 min-w-0 h-10 rounded-xl bg-gray-400 hover:bg-gray-500 text-white text-sm font-medium flex items-center justify-center gap-1.5 transition-all active:scale-95 active:bg-gray-600"
                                        title="Excluida de facturación — tocá para volver a incluirla"
                                    >
                                        <XCircle className="w-4 h-4 shrink-0" />
                                        No se factura
                                    </button>
                                ) : canFacturar(item) ? (
                                    <>
                                        <button
                                            onClick={() => setFacturarItem(item)}
                                            className="flex-1 min-w-0 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium flex items-center justify-center gap-1.5 transition-all active:scale-95 active:bg-blue-800"
                                        >
                                            <FileText className="w-4 h-4 shrink-0" />
                                            Facturar
                                        </button>
                                        <button
                                            onClick={() => onToggleNoFacturar(item.id, true)}
                                            aria-label="No facturar esta venta"
                                            title="No facturar esta venta"
                                            className={`${iconBtn} border-gray-200 text-gray-400`}
                                        >
                                            <Ban className="w-4 h-4" />
                                        </button>
                                    </>
                                ) : (
                                    <div className="flex-1" />
                                )}
                                <button onClick={() => onEdit(item)} aria-label="Editar venta" title="Editar" className={`${iconBtn} border-blue-100 bg-blue-50 text-blue-700`}>
                                    <Edit2 className="w-4 h-4" />
                                </button>
                                <button onClick={() => onRepublish(item)} aria-label="Volver a publicar" title="Volver a publicar (reponer stock)" className={`${iconBtn} border-emerald-100 bg-emerald-50 text-emerald-700`}>
                                    <RotateCcw className="w-4 h-4" />
                                </button>
                                <button onClick={() => onDelete(item.id)} aria-label="Eliminar venta" title="Eliminar" className={`${iconBtn} border-rose-100 bg-rose-50 text-rose-700`}>
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-xs text-gray-600">
                    <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-[11px] tracking-wider">
                        <tr>
                            <th className="px-2 py-3 text-center w-10"></th>
                            <th className="px-2 py-3">Producto</th>
                            <th className="px-2 py-3 text-center">Ud</th>
                            <th className="px-2 py-3 text-right">Compra</th>
                            <th className="px-2 py-3 text-right">Venta</th>
                            <th className="px-2 py-3 text-right">Ganancia</th>
                            <th className="px-2 py-3 text-center">Estado</th>
                            <th className="px-2 py-3 text-center">Ubic.</th>
                            <th className="px-2 py-3 text-center">Tanda</th>
                            <th className="px-2 py-3 text-center">Cobro</th>
                            <th className="px-2 py-3 text-center whitespace-nowrap">F. Venta</th>
                            <th className="px-2 py-3 text-center">Facturar</th>
                            <th className="px-2 py-3 text-center w-20 lg:w-auto whitespace-nowrap">Acción</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {items.map((item) => {
                            const profit = ((item.salePrice || 0) * item.quantity) - (item.purchasePrice * item.quantity);
                            const isPositive = profit >= 0;
                            return (
                                <tr key={item.id} className={`hover:bg-gray-50/50 transition-colors group ${item.itemType === 'personal' ? 'bg-violet-50/30 dark:bg-violet-950/25' : ''}`}>
                                    <td className="px-2 py-2">
                                        {item.imageUrl ? (
                                            <div className="w-8 h-8 rounded-md overflow-hidden border border-gray-100">
                                                <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                                            </div>
                                        ) : (
                                            <div className={`w-8 h-8 rounded-md border border-dashed flex items-center justify-center ${item.itemType === 'personal' ? 'bg-violet-50 border-violet-200' : 'bg-gray-50 border-gray-200'}`}>
                                                {item.itemType === 'personal' && <User className="w-3 h-3 text-violet-400" />}
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-2 py-2 font-medium text-gray-900 max-w-[200px]">
                                        <div className="flex items-center gap-1.5 truncate">
                                            <span className="truncate" title={item.productName}>{item.productName}</span>
                                            {item.itemType === 'personal' && <span className="text-[9px] font-bold bg-violet-100 text-violet-600 dark:bg-violet-900/60 dark:text-violet-200 px-1 py-0.5 rounded shrink-0">PROPIO</span>}
                                            {item.withdrawalReason && (() => { const w = withdrawalLabels[item.withdrawalReason]; return w ? <span className={`text-[9px] font-bold ${w.bgColor} ${w.color} px-1 py-0.5 rounded shrink-0`}>{w.label}</span> : null; })()}
                                        </div>
                                    </td>
                                    <td className="px-2 py-2 text-center">
                                        <span className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded text-[11px] font-semibold">{item.quantity}</span>
                                    </td>
                                    <td className="px-2 py-2 text-right font-mono text-gray-500 whitespace-nowrap">{item.itemType === 'personal' ? <span className="text-violet-400">-</span> : `${money(item.purchasePrice)}`}</td>
                                    <td className="px-2 py-2 text-right font-mono font-medium text-gray-900 whitespace-nowrap">{money(item.salePrice)}</td>
                                    <td className={`px-2 py-2 text-right font-bold whitespace-nowrap ${item.itemType === 'personal' ? 'text-violet-600' : isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {item.itemType === 'personal' ? (
                                            <span>{money(((item.salePrice || 0) * item.quantity))}</span>
                                        ) : (
                                            <span className="inline-flex items-center gap-0.5">
                                                {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                                {money(profit)}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-2 py-2 text-center text-[11px] font-semibold text-gray-700 whitespace-nowrap">
                                        {conditionLabelMap[item.condition || 'nuevo']}
                                    </td>
                                    <td className="px-2 py-2 text-center text-[11px] text-gray-600 font-medium whitespace-nowrap">
                                        {item.location || '-'}
                                    </td>
                                    <td className="px-2 py-2 text-center text-[11px] text-gray-600 font-medium whitespace-nowrap">
                                        {resolveBatchRef(item) || 'Directa'}
                                    </td>
                                    <td className="px-2 py-2 text-center whitespace-nowrap">
                                        {item.vendedor ? (
                                            <div className="flex flex-col items-center gap-1">
                                                <span className="text-[10px] text-gray-500 dark:text-gray-400 leading-none">{item.vendedor}</span>
                                                {item.cobrado === false ? (
                                                    <button
                                                        onClick={() => onToggleCobrado(item.id, true)}
                                                        className="bg-amber-500/20 hover:bg-emerald-500/20 text-amber-600 dark:text-amber-400 hover:text-emerald-600 dark:hover:text-emerald-400 text-[10px] font-bold px-2 py-0.5 rounded transition-all active:scale-95"
                                                        title="Click para marcar como cobrado"
                                                    >
                                                        PENDIENTE
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => onToggleCobrado(item.id, false)}
                                                        className="bg-emerald-500/20 hover:bg-amber-500/20 text-emerald-600 dark:text-emerald-400 hover:text-amber-600 dark:hover:text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded transition-all active:scale-95"
                                                        title="Click para marcar como pendiente"
                                                    >
                                                        COBRADO
                                                    </button>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-[11px] text-gray-400">—</span>
                                        )}
                                    </td>
                                    <td className="px-2 py-2 text-center text-gray-400 text-[11px] whitespace-nowrap">
                                        {item.saleDate ? formatDateDDMMAAAA(item.saleDate) : '-'}
                                    </td>
                                    <td className="px-2 py-2 text-center">
                                        {item.facturado ? (
                                            <button
                                                onClick={() => onToggleFacturado(item.id, false)}
                                                className="bg-green-600 hover:bg-green-700 text-white text-[11px] px-1.5 py-0.5 rounded transition-colors inline-flex items-center gap-0.5"
                                                title="Click para desmarcar facturacion"
                                            >
                                                <CheckCircle className="w-3 h-3" />
                                                Facturada
                                            </button>
                                        ) : item.noFacturar ? (
                                            <button
                                                onClick={() => onToggleNoFacturar(item.id, false)}
                                                className="bg-gray-400 hover:bg-gray-500 text-white text-[11px] px-1.5 py-0.5 rounded transition-colors inline-flex items-center gap-0.5"
                                                title="Click para volver a incluir en facturacion"
                                            >
                                                <XCircle className="w-3 h-3" />
                                                Excluida
                                            </button>
                                        ) : canFacturar(item) ? (
                                            <div className="flex items-center justify-center gap-1">
                                                <button
                                                    onClick={() => setFacturarItem(item)}
                                                    className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] px-1.5 py-0.5 rounded transition-colors inline-flex items-center gap-0.5"
                                                >
                                                    <FileText className="w-3 h-3" />
                                                    Facturar
                                                </button>
                                                <Hint label="Excluir de facturación">
                                                    <button
                                                        onClick={() => onToggleNoFacturar(item.id, true)}
                                                        aria-label="Excluir de facturación"
                                                        title="Excluir de facturacion"
                                                        className="rounded p-1 text-gray-400 transition-all hover:bg-red-50 hover:text-red-500 active:scale-95 active:brightness-95 dark:hover:bg-white/10"
                                                    >
                                                        <X className="w-3 h-3" />
                                                    </button>
                                                </Hint>
                                            </div>
                                        ) : (
                                            <span className="text-gray-500 text-xs">—</span>
                                        )}
                                    </td>
                                    <td className="px-2 py-2 text-center">
                                        <div className="flex justify-center gap-1">
                                            <Hint label="Editar esta venta">
                                                <button
                                                    onClick={() => onEdit(item)}
                                                    aria-label="Editar esta venta"
                                                    title="Editar"
                                                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md p-1.5 text-blue-500 transition-all hover:bg-blue-50 hover:text-blue-700 active:scale-95 active:brightness-95 dark:hover:bg-white/10"
                                                >
                                                    <Edit2 className="w-3.5 h-3.5" />
                                                    <span className="hidden lg:inline text-[11px] font-semibold">Editar</span>
                                                </button>
                                            </Hint>
                                            <Hint label="Republicar — crear nuevo stock con los datos de este producto">
                                                <button
                                                    onClick={() => onRepublish(item)}
                                                    aria-label="Republicar — crear nuevo stock con los datos de este producto"
                                                    title="Republicar"
                                                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md p-1.5 text-emerald-500 transition-all hover:bg-emerald-50 hover:text-emerald-700 active:scale-95 active:brightness-95 dark:hover:bg-white/10"
                                                >
                                                    <RotateCcw className="w-3.5 h-3.5" />
                                                    <span className="hidden lg:inline text-[11px] font-semibold">Republicar</span>
                                                </button>
                                            </Hint>
                                            <Hint label="Eliminar esta venta">
                                                <button
                                                    onClick={() => onDelete(item.id)}
                                                    aria-label="Eliminar esta venta"
                                                    title="Eliminar"
                                                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md p-1.5 text-rose-400 transition-all hover:bg-rose-50 hover:text-rose-600 active:scale-95 active:brightness-95 dark:hover:bg-white/10"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                    <span className="hidden lg:inline text-[11px] font-semibold">Eliminar</span>
                                                </button>
                                            </Hint>
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

/* Barra de progreso de publicación: 4 segmentos (título, descripción, video, fotos).
   Reemplaza a los chips de texto — misma info, más compacta e interactiva. */
// ── Verificación de links de media (imagen/video) ──────────────────────────────
// Cache a nivel módulo: sobrevive re-renders y cambios de vista. url -> existe.
const mediaStatusCache = new Map<string, boolean>();
const mediaChecksInFlight = new Set<string>();

const DIRECT_VIDEO_RE = /\.(mp4|webm|mov|m4v|ogv|ogg|avi|mkv)([?#]|$)/i;
// TikTok expone oEmbed con `access-control-allow-origin: *`: 200 = vivo, 400/404 = caído.
const TIKTOK_URL_RE = /^https?:\/\/(www\.|vm\.|vt\.)?tiktok\.com\//i;

async function checkTikTokAlive(url: string): Promise<boolean | null> {
    try {
        const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
        // 400 = video eliminado/privado. Errores de red o 5xx del propio oEmbed no
        // dicen nada del link, así que devolvemos null (no verificado) para no
        // marcar rojo un video sano.
        if (res.status === 400 || res.status === 404) return false;
        if (res.ok) return true;
        return null;
    } catch {
        return null;
    }
}

// ── Preview de video en el panel ──────────────────────────────────────────────
// ID numérico directo desde la URL (www.tiktok.com/@user/video/<id>, /v/<id>, /embed/v2/<id>)
function getTikTokId(url: string): string | null {
    return url.match(/tiktok\.com\/(?:@[^/?#]+\/video\/|v\/|embed\/v2\/)(\d{6,})/i)?.[1] ?? null;
}

// Links cortos (vm./vt.) no traen el ID: se resuelve vía oEmbed, que responde
// con CORS abierto y el HTML del embed contiene data-video-id="<id>".
async function resolveTikTokId(url: string): Promise<string | null> {
    const direct = getTikTokId(url);
    if (direct) return direct;
    try {
        const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
        if (!res.ok) return null;
        const html = String((await res.json()).html || '');
        return html.match(/data-video-id="(\d+)"/)?.[1] ?? html.match(/tiktok\.com\/[^"]*?video\/(\d{6,})/)?.[1] ?? null;
    } catch {
        return null;
    }
}

function getYouTubeId(url: string): string | null {
    return url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/)?.[1] ?? null;
}

/** Preview del video de tienda dentro del modal: TikTok/YouTube embebidos,
 *  archivo directo con <video>, y fallback a link externo. */
function VideoPreview({ url }: { url: string }) {
    const [tiktokId, setTiktokId] = useState<string | null>(() => getTikTokId(url));

    useEffect(() => {
        let cancelled = false;
        setTiktokId(getTikTokId(url));
        if (TIKTOK_URL_RE.test(url)) {
            resolveTikTokId(url).then(id => { if (!cancelled && id) setTiktokId(id); });
        }
        return () => { cancelled = true; };
    }, [url]);

    const ytId = getYouTubeId(url);
    if (TIKTOK_URL_RE.test(url)) {
        if (!tiktokId) {
            return (
                <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full aspect-video rounded-xl bg-black text-white text-sm font-bold hover:bg-gray-800 transition-colors">
                    🎬 Ver video en TikTok
                </a>
            );
        }
        return (
            <iframe
                src={`https://www.tiktok.com/embed/v2/${tiktokId}`}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                title="Video de TikTok"
                className="mx-auto rounded-xl bg-black"
                style={{ height: '320px', width: 'auto', maxWidth: '100%', aspectRatio: '9 / 16' }}
            />
        );
    }
    if (ytId) {
        return (
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black">
                <iframe
                    src={`https://www.youtube.com/embed/${ytId}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    title="Video de YouTube"
                    className="absolute inset-0 w-full h-full"
                />
            </div>
        );
    }
    if (DIRECT_VIDEO_RE.test(url)) {
        return <video src={url} controls className="w-full max-h-64 rounded-xl bg-black" />;
    }
    return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 w-full aspect-video rounded-xl bg-black text-white text-sm font-bold hover:bg-gray-800 transition-colors">
            🎬 Ver video (abre en otra pestaña)
        </a>
    );
}

type MediaCheck = { url: string; kind: 'image' | 'video' };

/**
 * Chequea que los links de media sigan vivos. Las imágenes se validan cargándolas
 * con `Image()`; los videos de TikTok vía oEmbed y los directos a archivo con
 * `<video>` (los embeds de YouTube/etc. no se pueden validar desde el cliente).
 * Devuelve el set de URLs confirmadas como caídas.
 */
function useBrokenMedia(checks: MediaCheck[]): Set<string> {
    const key = checks.map(c => `${c.kind}:${c.url}`).join('\n');
    const [broken, setBroken] = useState<Set<string>>(
        () => new Set(checks.filter(c => mediaStatusCache.get(c.url) === false).map(c => c.url))
    );

    useEffect(() => {
        let cancelled = false;
        const mark = (url: string, ok: boolean) => {
            mediaStatusCache.set(url, ok);
            if (!ok && !cancelled) {
                setBroken(prev => prev.has(url) ? prev : new Set(prev).add(url));
            }
        };
        checks.forEach(({ url, kind }) => {
            if (mediaStatusCache.has(url) || mediaChecksInFlight.has(url)) return;
            if (kind === 'video' && !DIRECT_VIDEO_RE.test(url) && !TIKTOK_URL_RE.test(url)) return; // embed (YouTube etc.): no validable
            mediaChecksInFlight.add(url);
            let settled = false;
            const settle = (ok: boolean) => {
                if (settled) return;
                settled = true;
                mediaChecksInFlight.delete(url);
                mark(url, ok);
            };
            // "no verificado" (red caída, oEmbed indisponible): no marca rojo ni
            // cachea, para que se reintente en el próximo render.
            const skip = () => {
                if (settled) return;
                settled = true;
                mediaChecksInFlight.delete(url);
            };
            if (kind === 'video' && TIKTOK_URL_RE.test(url)) {
                setTimeout(skip, 12000);
                checkTikTokAlive(url).then(r => {
                    if (r === null) skip();
                    else settle(r);
                });
            } else if (kind === 'video') {
                const v = document.createElement('video');
                v.preload = 'metadata';
                v.muted = true;
                v.onloadeddata = () => settle(true);
                v.oncanplay = () => settle(true);
                v.onerror = () => settle(false);
                v.src = url;
                setTimeout(() => settle(false), 12000);
            } else {
                const img = new Image();
                img.onload = () => settle(true);
                img.onerror = () => settle(false);
                img.src = url;
                setTimeout(() => settle(false), 12000);
            }
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);

    return broken;
}

function StoreProgress({ hasTitle, hasDesc, hasVideo, photoCount, onOpen, videoBroken, photoBroken }: {
    hasTitle: boolean;
    hasDesc: boolean;
    hasVideo: boolean;
    photoCount: number;
    onOpen: () => void;
    videoBroken?: boolean;
    photoBroken?: boolean;
}) {
    const segments = [
        { label: 'Título', done: hasTitle, doneText: 'Título listo', missingText: 'Falta el título de la publicación', broken: false, brokenText: '' },
        { label: 'Desc', done: hasDesc, doneText: 'Descripción lista', missingText: 'Falta la descripción', broken: false, brokenText: '' },
        { label: 'Video', done: hasVideo, doneText: 'Video subido', missingText: 'Sin video (opcional)', broken: Boolean(hasVideo && videoBroken), brokenText: 'El link del video ya no funciona — click para reemplazarlo' },
        { label: 'Fotos', done: photoCount > 0, doneText: `${photoCount} foto${photoCount > 1 ? 's' : ''}`, missingText: 'Sin fotos', broken: Boolean(photoCount > 0 && photoBroken), brokenText: 'Algún link de foto ya no carga — click para reemplazarlo' },
    ];
    const doneCount = segments.filter(s => s.done && !s.broken).length;
    const pendientes = segments.filter(s => s.broken || (!s.done && s.label !== 'Video'));
    const resumen = segments.map(s => `${s.label}: ${s.broken ? s.brokenText : s.done ? s.doneText : s.missingText}`).join(' · ');
    return (
        <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            title={`Editar publicación de la tienda — ${resumen}`}
            aria-label={`Editar publicación de la tienda. ${resumen}`}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gray-100/90 dark:bg-slate-800/90 hover:bg-gray-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
        >
            <Edit2 className="w-3 h-3 text-violet-600 dark:text-violet-400 shrink-0" />
            <span className="flex items-center gap-1" aria-hidden="true">
                {segments.map(seg => (
                    <span
                        key={seg.label}
                        className={`h-1.5 w-3.5 rounded-full ${
                            seg.broken
                                ? 'bg-red-500'
                                : seg.done
                                    ? 'bg-emerald-500 dark:bg-emerald-400'
                                    : seg.label === 'Video'
                                        ? 'bg-slate-300 dark:bg-slate-600'
                                        : 'bg-amber-400 dark:bg-amber-500'
                        }`}
                    />
                ))}
            </span>
            <span className={`text-[10px] font-bold tabular-nums ${pendientes.some(s => s.broken) ? 'text-red-500' : doneCount === segments.length ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-slate-400'}`}>
                {doneCount}/{segments.length}
            </span>
        </button>
    );
}

/* ── Editor rápido de cantidades (badge de STOCK) ───────────────────────────────
   Una fila por registro real de stock (ubicación + costo). El input guarda su
   propio texto y recién confirma al salir del campo o con Enter: así se puede
   borrar el número y reescribirlo sin que se rellene solo con 1. */
function QtyRow({ item, onUpdateQuantity, onDelete }: {
    item: Item;
    onUpdateQuantity?: (id: string, quantity: number) => void;
    onDelete: (id: string) => void;
}) {
    const [val, setVal] = useState(String(item.quantity));

    useEffect(() => { setVal(String(item.quantity)); }, [item.quantity]);

    const commit = () => {
        const n = Math.floor(Number(val));
        if (!val || !Number.isFinite(n) || n < 1) { setVal(String(item.quantity)); return; }
        if (n !== item.quantity) onUpdateQuantity?.(item.id, n);
    };

    return (
        <div className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1.5">
            <span
                className="min-w-0 flex-1 truncate text-[11px] font-semibold text-gray-600"
                title={item.location || 'Sin ubicación'}
            >
                {item.location || 'Sin ubicación'}
            </span>
            <span className="font-mono text-[10px] text-gray-400">{money(item.purchasePrice)}</span>
            <div className="flex shrink-0 items-center gap-0.5">
                <button
                    type="button"
                    onClick={() => onUpdateQuantity?.(item.id, Math.max(1, item.quantity - 1))}
                    disabled={item.quantity <= 1}
                    title="Restar una unidad"
                    className="rounded-md p-1 text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                >
                    <Minus className="h-3 w-3" />
                </button>
                <input
                    type="text"
                    inputMode="numeric"
                    value={val}
                    onChange={e => setVal(e.target.value.replace(/[^\d]/g, ''))}
                    onBlur={commit}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    aria-label={`Cantidad en ${item.location || 'sin ubicación'}`}
                    className="w-11 rounded-md border border-gray-200 bg-gray-50 py-0.5 text-center text-xs font-bold text-gray-800 outline-none transition-all focus:border-blue-500 focus:bg-white focus:ring-1 focus:ring-blue-500"
                />
                <button
                    type="button"
                    onClick={() => onUpdateQuantity?.(item.id, item.quantity + 1)}
                    title="Sumar una unidad"
                    className="rounded-md p-1 text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-800 active:scale-95"
                >
                    <Plus className="h-3 w-3" />
                </button>
                <button
                    type="button"
                    onClick={() => onDelete(item.id)}
                    title="Eliminar este registro de stock"
                    className="ml-0.5 rounded-md p-1 text-gray-300 transition-all hover:bg-rose-50 hover:text-rose-600 active:scale-95"
                >
                    <Trash2 className="h-3 w-3" />
                </button>
            </div>
        </div>
    );
}

function QtyEditorPanel({ items, anchor, onUpdateQuantity, onDelete, onAddUnits, compact = false }: {
    items: Item[];
    anchor?: Item;
    onUpdateQuantity?: (id: string, quantity: number) => void;
    onDelete: (id: string) => void;
    onAddUnits?: (anchor: Item) => void;
    compact?: boolean;
}) {
    const total = items.reduce((a, i) => a + i.quantity, 0);
    const addAnchor = anchor || items[0];
    return (
        <div className={`space-y-1.5 text-left ${compact ? '' : 'mx-auto w-full max-w-md'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Ajustar cantidades · {total} u. en {items.length} registro{items.length === 1 ? '' : 's'}
                </span>
                {onAddUnits && addAnchor && (
                    <button
                        type="button"
                        onClick={() => onAddUnits(addAnchor)}
                        title="Cargar otra tanda del mismo producto con otro precio u otra ubicación"
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition-all hover:bg-blue-700 active:scale-95"
                    >
                        <Plus className="h-3 w-3" />
                        Otro precio / ubicación
                    </button>
                )}
            </div>
            {items.map(it => (
                <QtyRow key={it.id} item={it} onUpdateQuantity={onUpdateQuantity} onDelete={onDelete} />
            ))}
        </div>
    );
}

/* ── Acciones de un lote de stock ────────────────────────────────────────────
   Antes cada lote mostraba cinco botones (Vender, Editar, Separar, Dar de baja,
   Eliminar). Queda "Vender" a la vista y el resto en un menú. El menú se dibuja
   en un portal con posición fija para que no lo recorte el scroll de la tabla. */
function LotActions({ item, onSell, onEdit, onWithdraw, onDelete, onManageImages }: {
    item: Item;
    onSell: (i: Item) => void;
    onEdit: (i: Item) => void;
    onWithdraw: (item: Item, reason: WithdrawalReason) => void;
    onDelete: (id: string) => void;
    onManageImages?: (i: Item) => void;
}) {
    const [menu, setMenu] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
    const btnRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!menu) return;
        const close = () => setMenu(null);
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
        // El menú tiene posición fija respecto de la pantalla: mientras está
        // abierto se bloquea el desplazamiento de la página para que no quede
        // despegado de su botón. (Cerrarlo al detectar scroll fallaba: la inercia
        // del dedo lo abría y cerraba al instante.)
        const prevOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        window.addEventListener('resize', close);
        window.addEventListener('keydown', onKey);
        return () => {
            document.documentElement.style.overflow = prevOverflow;
            window.removeEventListener('resize', close);
            window.removeEventListener('keydown', onKey);
        };
    }, [menu]);

    const toggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (menu) { setMenu(null); return; }
        const r = btnRef.current?.getBoundingClientRect();
        if (!r) return;
        const right = Math.max(8, window.innerWidth - r.right);
        // Si no entra abajo, se abre hacia arriba
        setMenu(window.innerHeight - r.bottom < 260 ? { bottom: window.innerHeight - r.top + 6, right } : { top: r.bottom + 6, right });
    };
    const run = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); setMenu(null); fn(); };
    const itemCls = 'w-full text-left px-3.5 py-2.5 text-sm flex items-center gap-2.5 transition-colors';

    return (
        <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
                type="button"
                onClick={run(() => onSell(item))}
                className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white px-3 h-8 rounded-lg text-xs font-bold shadow-sm transition-all"
            >
                <DollarSign className="w-3.5 h-3.5" /> Vender
            </button>
            <button
                ref={btnRef}
                type="button"
                onClick={toggle}
                aria-haspopup="menu"
                aria-expanded={!!menu}
                aria-label="Más acciones"
                title="Más acciones: editar, dar de baja, eliminar"
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 active:scale-95 transition-all"
            >
                <MoreHorizontal className="w-4 h-4" />
            </button>
            {menu && createPortal(
                <>
                    <div className="fixed inset-0 z-[60]" onClick={(e) => { e.stopPropagation(); setMenu(null); }} />
                    <div
                        role="menu"
                        className="fixed z-[61] w-56 bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 overflow-hidden"
                        style={menu}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button role="menuitem" type="button" onClick={run(() => onEdit(item))} className={`${itemCls} text-gray-700 hover:bg-gray-50`}>
                            <Edit2 className="w-4 h-4 text-blue-600" /> Editar
                        </button>
                        {onManageImages && (
                            <button role="menuitem" type="button" onClick={run(() => onManageImages(item))} className={`${itemCls} text-gray-700 hover:bg-gray-50`}>
                                <ImageIcon className="w-4 h-4 text-violet-600" /> Fotos y tienda
                            </button>
                        )}
                        <p className="px-3.5 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400 border-t border-gray-100 mt-1">Dar de baja como…</p>
                        <button role="menuitem" type="button" onClick={run(() => onWithdraw(item, 'regalo'))} className={`${itemCls} text-gray-700 hover:bg-gray-50`}>
                            <Gift className="w-4 h-4 text-pink-600" /> Regalo
                        </button>
                        <button role="menuitem" type="button" onClick={run(() => onWithdraw(item, 'uso_personal'))} className={`${itemCls} text-gray-700 hover:bg-gray-50`}>
                            <User className="w-4 h-4 text-violet-600" /> Uso personal
                        </button>
                        <button role="menuitem" type="button" onClick={run(() => onWithdraw(item, 'perdida'))} className={`${itemCls} text-gray-700 hover:bg-gray-50`}>
                            <Ban className="w-4 h-4 text-red-600" /> Pérdida
                        </button>
                        <button role="menuitem" type="button" onClick={run(() => onDelete(item.id))} className={`${itemCls} text-rose-600 hover:bg-rose-50 border-t border-gray-100 mt-1`}>
                            <Trash2 className="w-4 h-4" /> Eliminar
                        </button>
                    </div>
                </>,
                document.body
            )}
        </div>
    );
}

/* El lugar es un botón: se toca y se elige a dónde mover las unidades. */
function LocationChip({ label, qty, onClick, className = '' }: { label: string; qty?: number; onClick: () => void; className?: string }) {
    const empty = !label || label === 'Sin ubicación';
    return (
        <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            title="Tocá para mover a otra ubicación"
            className={`inline-flex items-center gap-1 max-w-full text-[11px] font-semibold px-2 py-1 rounded-full border transition-all active:scale-95 ${empty
                ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'} ${className}`}
        >
            <MapPin className="w-3 h-3 shrink-0" />
            <span className="truncate">{empty ? 'Sin ubicación' : label}</span>
            {qty !== undefined && <span className="tabular-nums opacity-70">×{qty}</span>}
            <ChevronDown className="w-3 h-3 shrink-0 opacity-60" />
        </button>
    );
}

function MoveLocationDialog({ name, from, total, locations, onClose, onMove }: {
    name: string;
    from: string;
    total: number;
    locations: string[];
    onClose: () => void;
    onMove: (to: string, qty: number) => void;
}) {
    const [qty, setQty] = useState(total);
    const [custom, setCustom] = useState('');
    const destinos = locations.filter(l => normalizeText(l) !== normalizeText(from));
    const fromLabel = from || 'Sin ubicación';

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    const go = (to: string) => {
        const dest = to.trim();
        if (!dest || normalizeText(dest) === normalizeText(from)) return;
        onMove(dest, Math.min(total, Math.max(1, qty)));
    };

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-sm max-h-[85vh] overflow-y-auto ring-1 ring-black/5" role="dialog" aria-label="Mover a otra ubicación" onClick={(e) => e.stopPropagation()}>
                <div className="p-4 border-b border-gray-100 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-base font-bold text-gray-800">Mover de lugar</h2>
                        <p className="text-xs text-gray-500 truncate">{name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">Ahora en <span className="font-semibold text-gray-700">{fromLabel}</span> · {total} {total === 1 ? 'unidad' : 'unidades'}</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Cerrar" className="h-8 w-8 shrink-0 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-gray-600 flex items-center justify-center">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="p-4 space-y-4">
                    {total > 1 && (
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-gray-700">¿Cuántas muevo?</span>
                            <div className="flex items-center gap-2">
                                <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Una menos" className="h-9 w-9 rounded-lg border border-gray-200 bg-white text-gray-700 flex items-center justify-center disabled:opacity-40 active:scale-95"><Minus className="w-4 h-4" /></button>
                                <span className="w-16 text-center text-sm font-bold tabular-nums text-gray-900">{qty === total ? `Todas (${total})` : qty}</span>
                                <button type="button" onClick={() => setQty(q => Math.min(total, q + 1))} disabled={qty >= total} aria-label="Una más" className="h-9 w-9 rounded-lg border border-gray-200 bg-white text-gray-700 flex items-center justify-center disabled:opacity-40 active:scale-95"><Plus className="w-4 h-4" /></button>
                            </div>
                        </div>
                    )}
                    <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">¿A dónde?</p>
                        <div className="space-y-2">
                            {destinos.map(loc => (
                                <button key={loc} type="button" onClick={() => go(loc)} className="w-full flex items-center gap-2.5 px-3.5 py-3 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-800 hover:border-blue-400 hover:bg-blue-50 active:scale-[0.99] transition-all text-left">
                                    <MapPin className="w-4 h-4 text-blue-600 shrink-0" />
                                    <span className="truncate">{loc}</span>
                                </button>
                            ))}
                            {destinos.length === 0 && <p className="text-xs text-gray-400">No hay otras ubicaciones cargadas. Escribí una abajo.</p>}
                        </div>
                    </div>
                    <form onSubmit={(e) => { e.preventDefault(); go(custom); }} className="flex gap-2">
                        <input
                            type="text"
                            value={custom}
                            onChange={(e) => setCustom(e.target.value)}
                            placeholder="Otra ubicación…"
                            aria-label="Otra ubicación"
                            className="flex-1 min-w-0 px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm outline-none focus:border-blue-400 focus:bg-white"
                        />
                        <button type="submit" disabled={!custom.trim()} className="shrink-0 px-4 rounded-xl bg-black text-white text-sm font-medium disabled:opacity-40">Mover</button>
                    </form>
                </div>
            </div>
        </div>,
        document.body
    );
}

function InventoryTable({
    items, 
    allItems, 
    onEdit, 
    onDelete, 
    onSell, 
    resolveBatchRef, 
    onMoveUnits,
    onWithdraw, 
    onTogglePublicInStore, 
    onManageImages,
    onMerge,
    onUpdateQuantity,
    onAddUnits,
    batchHistory,
    locations = [],
    onOpenLocationsModal
}: {
    items: Item[],
    allItems: Item[],
    onEdit: (i: Item) => void,
    onDelete: (id: string) => void,
    onSell: (i: Item) => void,
    resolveBatchRef: (item: Item) => string | undefined,
    onMoveUnits?: (lots: Item[], qty: number, to: string) => void,
    onWithdraw: (item: Item, reason: WithdrawalReason) => void,
    onTogglePublicInStore: (id: string, value: boolean) => void,
    onManageImages: (item: Item) => void,
    onMerge?: (items: Item[]) => void,
    onUpdateQuantity?: (id: string, quantity: number) => void,
    onAddUnits?: (anchor: Item) => void,
    batchHistory: BatchRecord[],
    locations?: LocationItem[],
    onOpenLocationsModal?: () => void
}) {
    type ViewMode = 'products' | 'locations' | 'batches' | 'personal';
    const [viewMode, setViewMode] = useState<ViewMode>('products');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    // Lotes cuyo lugar se tocó para mover (null = diálogo cerrado)
    const [moveTarget, setMoveTarget] = useState<{ name: string; from: string; lots: Item[] } | null>(null);
    const locationNames = Array.from(new Map(
        [...locations.map(l => l.name), ...allItems.map(i => i.location || '')]
            .filter(Boolean)
            .map(n => [normalizeText(n), n] as [string, string])
    ).values()).sort((a, b) => a.localeCompare(b));
    const askMove = (name: string, from: string, lots: Item[]) => setMoveTarget({ name, from: from === 'Sin ubicación' ? '' : from, lots });
    const [qtyEditorKey, setQtyEditorKey] = useState<string | null>(null);

    // Verificar que los links de fotos/videos de tienda sigan vivos
    const mediaChecks = items.flatMap(i => [
        ...(i.imageUrl ? [{ url: i.imageUrl, kind: 'image' as const }] : []),
        ...(i.storeImages || []).map(u => ({ url: u, kind: 'image' as const })),
        ...(i.storeVideoUrl ? [{ url: i.storeVideoUrl, kind: 'video' as const }] : []),
    ]);
    const brokenMedia = useBrokenMedia(mediaChecks);

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => {
            if (prev.has(key)) return new Set();
            return new Set([key]);
        });
    };

    const getBatchStatus = (batchCodes: string[]): { label: string; color: string } | null => {
        if (batchCodes.length === 0) return null;
        const statuses = batchCodes.map(code => {
            const batch = batchHistory.find(b => b.batchCode === code);
            if (!batch) return null;
            const batchItems = allItems.filter(i => (i.batchRef || '') === code || resolveBatchRef(i) === code);
            const sellItems = batchItems.filter(i => i.itemType !== 'personal');
            const allSold = sellItems.length > 0 && sellItems.every(i => i.status === 'sold');
            if (allSold) return 'completado' as BatchStatus;
            return batch.batchStatus;
        }).filter(Boolean) as BatchStatus[];
        if (statuses.length === 0) return null;
        if (statuses.includes('en_camino')) return { label: 'En camino', color: 'bg-yellow-100 text-yellow-700' };
        if (statuses.includes('recibido')) return { label: 'Retirado', color: 'bg-blue-100 text-blue-700' };
        if (statuses.every(s => s === 'completado')) return { label: 'Completado', color: 'bg-emerald-100 text-emerald-700' };
        return null;
    };

    if (items.length === 0) {
        return <div className="p-8 sm:p-12 text-center text-gray-400">Tu inventario está vacío. Agrega productos para comenzar.</div>;
    }

    const filteredItems = searchQuery.trim()
        ? items.filter(item => {
            const q = normalizeText(searchQuery);
            return normalizeText(item.productName).includes(q)
                || normalizeText(item.location || '').includes(q)
                || normalizeText(resolveBatchRef(item) || '').includes(q);
        })
        : items;

    // Productos a la venta: todos los de reventa + los propios con precio fijado
    const forSaleItems = filteredItems.filter(i =>
        i.itemType !== 'personal' || (i.salePrice && i.salePrice > 0) || (i.estimatedSalePrice && i.estimatedSalePrice > 0)
    );

    // Productos propios sin precio (A convenir / uso propio)
    const filteredPersonalItems = filteredItems.filter(i =>
        i.itemType === 'personal' && !(i.salePrice && i.salePrice > 0) && !(i.estimatedSalePrice && i.estimatedSalePrice > 0)
    );

    const getLocationInfo = (locName: string) => {
        const norm = locName.trim().toLowerCase();
        return locations.find(l => l.name.trim().toLowerCase() === norm);
    };

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
    };

    const productGroups: ProductGroup[] = (() => {
        const map = new Map<string, ProductGroup>();
        forSaleItems.forEach(item => {
            const normName = normalizeText(item.productName);
            let grp = map.get(normName);
            if (!grp) {
                grp = { key: normName, name: item.productName, imageUrl: item.imageUrl, totalQty: 0, avgCost: 0, totalValue: 0, locations: [], batches: [], children: [] };
                map.set(normName, grp);
            }
            grp.children.push(item);
            grp.totalQty += item.quantity;
            grp.totalValue += (item.purchasePrice || 0) * item.quantity;
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
        }
        return Array.from(map.values()).sort((a, b) => {
            const newestA = Math.max(...a.children.map(c => new Date(c.date).getTime()));
            const newestB = Math.max(...b.children.map(c => new Date(c.date).getTime()));
            return newestB - newestA;
        });
    })();

    type LocationGroup = {
        key: string;
        location: string;
        phone?: string;
        totalQty: number;
        totalValue: number;
        products: { name: string; qty: number; avgCost: number; items: Item[] }[];
    };

    const locationGroups: LocationGroup[] = (() => {
        const map = new Map<string, LocationGroup>();
        forSaleItems.forEach(item => {
            const loc = item.location || 'Sin ubicación';
            const locKey = normalizeText(loc);
            let grp = map.get(locKey);
            if (!grp) {
                const locInfo = getLocationInfo(loc);
                grp = { 
                    key: locKey, 
                    location: loc,
                    phone: locInfo?.phone,
                    totalQty: 0, 
                    totalValue: 0, 
                    products: [] 
                };
                map.set(locKey, grp);
            }
            grp.totalQty += item.quantity;
            grp.totalValue += (item.purchasePrice || 0) * item.quantity;
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
                const totalCost = prod.items.reduce((a, i) => a + (i.purchasePrice || 0) * i.quantity, 0);
                prod.avgCost = prod.qty > 0 ? Math.round(totalCost / prod.qty) : 0;
            }
            grp.products.sort((a, b) => a.name.localeCompare(b.name));
        }
        return Array.from(map.values()).sort((a, b) => a.location.localeCompare(b.location));
    })();

    type BatchGroup = {
        key: string;
        batchCode: string;
        label: string;
        status: { label: string; color: string } | null;
        totalQty: number;
        totalValue: number;
        children: Item[];
    };

    const batchGroups: BatchGroup[] = (() => {
        const map = new Map<string, BatchGroup>();
        forSaleItems.forEach(item => {
            const bRef = resolveBatchRef(item) || '';
            const bKey = bRef || (item.itemType === 'personal' ? '__propio__' : '__direct__');
            let grp = map.get(bKey);
            if (!grp) {
                grp = {
                    key: bKey,
                    batchCode: bRef,
                    label: bRef ? getBatchLabel(bRef) : (item.itemType === 'personal' ? 'Artículos Propios' : 'Venta directa'),
                    status: bRef ? getBatchStatus([bRef]) : null,
                    totalQty: 0,
                    totalValue: 0,
                    children: []
                };
                map.set(bKey, grp);
            }
            grp.children.push(item);
            grp.totalQty += item.quantity;
            grp.totalValue += (item.purchasePrice || 0) * item.quantity;
        });
        return Array.from(map.values()).sort((a, b) => {
            if (a.key === '__direct__' || a.key === '__propio__') return 1;
            if (b.key === '__direct__' || b.key === '__propio__') return -1;
            const numA = Number(a.batchCode.match(/\d+/)?.[0] || 0);
            const numB = Number(b.batchCode.match(/\d+/)?.[0] || 0);
            return numB - numA;
        });
    })();

    type PersonalGroup = {
        key: string;
        name: string;
        imageUrl?: string;
        totalQty: number;
        locations: { loc: string; qty: number }[];
        children: Item[];
    };

    const personalGroups: PersonalGroup[] = (() => {
        const map = new Map<string, PersonalGroup>();
        filteredPersonalItems.forEach(item => {
            const normName = normalizeText(item.productName);
            let grp = map.get(normName);
            if (!grp) {
                grp = { key: normName, name: item.productName, imageUrl: item.imageUrl, totalQty: 0, locations: [], children: [] };
                map.set(normName, grp);
            }
            grp.children.push(item);
            grp.totalQty += item.quantity;
            if (!grp.imageUrl && item.imageUrl) grp.imageUrl = item.imageUrl;
            const loc = item.location || 'Sin ubicación';
            const existingLoc = grp.locations.find(l => normalizeText(l.loc) === normalizeText(loc));
            if (existingLoc) existingLoc.qty += item.quantity;
            else grp.locations.push({ loc, qty: item.quantity });
        });
        return Array.from(map.values()).sort((a, b) => {
            const newestA = Math.max(...a.children.map(c => new Date(c.date).getTime()));
            const newestB = Math.max(...b.children.map(c => new Date(c.date).getTime()));
            return newestB - newestA;
        });
    })();

    const personalTotalQty = filteredPersonalItems.reduce((a, i) => a + i.quantity, 0);

    return (
        <>
            {moveTarget && (
                <MoveLocationDialog
                    name={moveTarget.name}
                    from={moveTarget.from}
                    total={moveTarget.lots.reduce((acc, l) => acc + l.quantity, 0)}
                    locations={locationNames}
                    onClose={() => setMoveTarget(null)}
                    onMove={(to, qty) => { onMoveUnits?.(moveTarget.lots, qty, to); setMoveTarget(null); }}
                />
            )}
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-gray-500">
                        {viewMode === 'personal' ? (
                            <span className="text-violet-700 font-medium">
                                {personalGroups.length} productos propios a convenir · {personalTotalQty} unidad{personalTotalQty !== 1 ? 'es' : ''} (sin precio fijado)
                            </span>
                        ) : (
                            <>
                                {productGroups.length} productos en venta · {forSaleItems.reduce((a, i) => a + i.quantity, 0)} unidades en stock · {money(forSaleItems.reduce((a, i) => a + (i.purchasePrice || 0) * i.quantity, 0))} invertido
                                {personalTotalQty > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => { setViewMode('personal'); setExpandedGroups(new Set()); }}
                                        className="text-violet-600 hover:text-violet-800 ml-1.5 font-medium underline underline-offset-2"
                                    >
                                        · {personalTotalQty} propios a convenir
                                    </button>
                                )}
                            </>
                        )}
                    </p>
                    <div className="flex gap-1.5 flex-wrap">
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
                        <button
                            onClick={() => { setViewMode('batches'); setExpandedGroups(new Set()); }}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${viewMode === 'batches' ? 'bg-blue-600 border-blue-600 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}
                        >
                            <Box className="w-3.5 h-3.5" />
                            Por Tanda
                        </button>
                        <button
                            onClick={() => { setViewMode('personal'); setExpandedGroups(new Set()); }}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1.5 ${viewMode === 'personal' ? 'bg-violet-600 border-violet-600 text-white shadow-sm ring-2 ring-violet-200' : 'bg-white border-violet-200 text-violet-700 hover:bg-violet-50'}`}
                        >
                            <User className="w-3.5 h-3.5" />
                            Propios ({items.filter(i => i.itemType === 'personal').reduce((a, i) => a + i.quantity, 0)})
                        </button>
                        {viewMode === 'locations' && onOpenLocationsModal && (
                            <button
                                type="button"
                                onClick={onOpenLocationsModal}
                                className="text-xs text-blue-700 hover:bg-blue-100 font-bold flex items-center gap-1 bg-blue-50 border border-blue-200 px-2.5 py-1.5 rounded-lg transition-colors"
                            >
                                <MapPin className="w-3.5 h-3.5 text-blue-600" />
                                Configurar
                            </button>
                        )}
                    </div>
                </div>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Buscar producto, ubicación o tanda..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-gray-200 bg-white focus:border-blue-400 focus:ring-1 focus:ring-blue-400 outline-none transition-all"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>

            {/* ===== MOBILE VIEW ===== */}
            <div className="sm:hidden p-3 space-y-3">
                {viewMode === 'products' ? (
                    productGroups.length === 0 ? (
                        <div className="text-center py-8 text-gray-400 text-sm">No hay productos comerciales en stock.</div>
                    ) : (
                        productGroups.map((grp) => {
                            const repItem = grp.children.find(c => c.publicInStore) || grp.children.find(c => c.storeTitle || c.description || c.storeVideoUrl || (c.storeImages && c.storeImages.length > 0)) || grp.children[0];
                            const isPublic = grp.children.some(c => c.publicInStore);
                            const hasStoreTitle = Boolean(repItem?.storeTitle?.trim());
                            const hasDesc = Boolean(repItem?.description?.trim());
                            const hasVideo = Boolean(repItem?.storeVideoUrl?.trim());
                            const photoCount = (repItem?.storeImages?.length || 0) + (repItem?.imageUrl ? 1 : 0);
                            const videoBroken = Boolean(repItem?.storeVideoUrl?.trim()) && brokenMedia.has(repItem!.storeVideoUrl!.trim());
                            const photoBroken = [repItem?.imageUrl, ...(repItem?.storeImages || [])].some(u => !!u && brokenMedia.has(u));

                            return (
                                <div key={grp.key} className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => { if (grp.children.length > 1) toggleGroup(grp.key); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (grp.children.length > 1) toggleGroup(grp.key); } }}
                                        className="w-full cursor-pointer p-4 text-left"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-center gap-3">
                                                {grp.imageUrl ? (
                                                    <div title={brokenMedia.has(grp.imageUrl) ? 'El link de la foto ya no carga — click en el lápiz para reemplazarla' : undefined} className={`w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 ${brokenMedia.has(grp.imageUrl) ? 'border-2 border-red-400 ring-2 ring-red-200' : 'border border-gray-100'}`}>
                                                        <img src={grp.imageUrl} alt="" className="w-full h-full object-cover" />
                                                    </div>
                                                ) : (
                                                    <div className="w-10 h-10 rounded-lg border border-dashed flex-shrink-0 flex items-center justify-center bg-gray-50 border-gray-200">
                                                        <Package className="w-4 h-4 text-gray-400" />
                                                    </div>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h3 className="font-semibold text-gray-900 text-[15px] leading-snug">{grp.name}</h3>
                                                        {(() => {
                                                            const status = getBatchStatus(grp.batches);
                                                            if (!status) return null;
                                                            return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>;
                                                        })()}
                                                    </div>
                                                    <div className="flex flex-wrap gap-1 mt-1.5">
{grp.locations.map(l => (
<LocationChip key={l.loc} label={l.loc} qty={l.qty} onClick={() => askMove(grp.name, l.loc, grp.children.filter(c => normalizeText(c.location || 'Sin ubicación') === normalizeText(l.loc)))} />
))}
</div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                                <button
                                                    type="button"
                                                    onClick={() => setQtyEditorKey(qtyEditorKey === grp.key ? null : grp.key)}
                                                    title="Editar cantidades"
                                                    aria-expanded={qtyEditorKey === grp.key}
                                                    className={`px-2 py-1 rounded-md text-xs font-semibold text-white transition-all active:scale-95 ${qtyEditorKey === grp.key ? 'bg-blue-800 ring-2 ring-blue-300' : 'bg-blue-600 hover:bg-blue-700'}`}
                                                >
                                                    {grp.totalQty}
                                                </button>
                                                {grp.children.length > 1 && (expandedGroups.has(grp.key) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />)}
                                            </div>
                                        </div>
                                        {(() => {
                                            // Un solo número a la vista: el precio de venta. El costo queda en el detalle de cada lote.
                                            const precios = Array.from(new Set(grp.children.map(c => c.salePrice || 0).filter(v => v > 0)));
                                            return (
                                                <div className="mt-2 flex items-center justify-between gap-3 text-xs text-gray-500">
                                                    <span>
                                                        {precios.length === 0
                                                            ? <span className="text-amber-600 font-medium">Sin precio de venta</span>
                                                            : <>Venta <span className="text-sm font-bold text-gray-900 tabular-nums">{precios.length > 1 ? 'desde ' : ''}{money(Math.min(...precios))}</span></>}
                                                    </span>
                                                    {grp.children.length === 1
                                                        ? <LotActions item={grp.children[0]} onSell={onSell} onEdit={onEdit} onWithdraw={onWithdraw} onDelete={onDelete} />
                                                        : <span className="shrink-0 text-blue-600 font-semibold">{grp.children.length} lotes · ver</span>}
                                                </div>
                                            );
                                        })()}
                                    </div>

                                    {qtyEditorKey === grp.key && (
                                        <div className="border-t border-blue-100 bg-blue-50/60 px-4 py-3">
                                            <QtyEditorPanel
                                                items={grp.children}
                                                anchor={repItem}
                                                onUpdateQuantity={onUpdateQuantity}
                                                onDelete={onDelete}
                                                onAddUnits={onAddUnits}
                                            />
                                        </div>
                                    )}

                                    {/* Mobile Store Status Bar */}
                                    <div className="px-4 py-2 bg-slate-50/80 dark:bg-slate-900/50 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
                                        <div className="flex items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    const nextState = !isPublic;
                                                    grp.children.forEach(c => onTogglePublicInStore(c.id, nextState));
                                                }}
                                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold shadow-xs transition-all cursor-pointer ${
                                                    isPublic
                                                        ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-300 dark:ring-emerald-800/60'
                                                        : 'bg-gray-100 text-gray-600 ring-1 ring-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700'
                                                }`}
                                            >
                                                <span className={`w-1.5 h-1.5 rounded-full ${isPublic ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400 dark:bg-slate-500'}`} />
                                                {isPublic ? 'Publicado' : 'No publicado'}
                                            </button>
                                            </div>
                                        <div className="flex items-center gap-1 flex-nowrap overflow-x-auto">
                                            <StoreProgress
                                                hasTitle={hasStoreTitle}
                                                hasDesc={hasDesc}
                                                hasVideo={hasVideo}
                                                photoCount={photoCount}
                                                onOpen={() => onManageImages(repItem)}
                                                videoBroken={videoBroken}
                                                photoBroken={photoBroken}
                                            />
                                        </div>
                                    </div>
                                {expandedGroups.has(grp.key) && grp.children.length > 1 && (
                                    <div className="border-t border-gray-100 bg-gray-50/50 p-3 space-y-2">
                                        {(() => {
                                            const locMap = new Map<string, Item[]>();
                                            grp.children.forEach(item => {
                                                const loc = item.location || 'Sin ubicación';
                                                if (!locMap.has(loc)) locMap.set(loc, []);
                                                locMap.get(loc)!.push(item);
                                            });
                                            return Array.from(locMap.entries()).filter(([_, lItems]) => lItems.length > 1).map(([locName, lItems]) => {
                                                const totalQty = lItems.reduce((a, i) => a + i.quantity, 0);
                                                const totalCost = lItems.reduce((a, i) => a + i.purchasePrice * i.quantity, 0);
                                                const avgCost = Math.round(totalCost / totalQty);
                                                return (
                                                    <div key={`merge-m-${locName}`} className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 flex flex-col gap-2">
                                                        <div className="flex items-center gap-2 text-xs text-indigo-900 font-medium">
                                                            <Merge className="w-4 h-4 text-indigo-600 shrink-0" />
                                                            <span><b>{lItems.length} registros</b> en <b>{locName}</b> ({totalQty} u. · Costo prom: <b>{money(avgCost)}</b>)</span>
                                                        </div>
                                                        {onMerge && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); onMerge(lItems); }}
                                                                className="w-full bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5"
                                                            >
                                                                <Merge className="w-3.5 h-3.5" />
                                                                Unificar en 1 fila
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            });
                                        })()}
                                        {grp.children.map(item => (
                                            <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-3">
                                                <div className="flex justify-between items-center gap-2">
                                                    <LocationChip label={item.location || ''} onClick={() => askMove(item.productName, item.location || '', [item])} />
                                                    <span className="text-sm font-bold text-gray-700 tabular-nums shrink-0">×{item.quantity}</span>
                                                </div>
                                                <p className="text-xs text-gray-500 mt-1.5">
                                                    {[getBatchLabel(resolveBatchRef(item)), conditionLabelMap[item.condition || 'nuevo'], `costo ${money(item.purchasePrice)}`].join(' · ')}
                                                </p>
                                                <div className="mt-2.5 flex justify-end"><LotActions item={item} onSell={onSell} onEdit={onEdit} onWithdraw={onWithdraw} onDelete={onDelete} /></div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    }))
                ) : viewMode === 'locations' ? (
                    locationGroups.map((grp) => (
                        <div key={grp.key} className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                            <button type="button" onClick={() => toggleGroup(grp.key)} className="w-full p-4 text-left">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <MapPin className="w-4 h-4 text-blue-500" />
                                        <div>
                                            <h3 className="font-semibold text-gray-900">{grp.location}</h3>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="bg-blue-600 text-white px-2 py-1 rounded-md text-xs font-semibold">{grp.totalQty}</span>
                                        {expandedGroups.has(grp.key) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                                    </div>
                                </div>
                                <p className="text-xs text-gray-400 mt-1">{grp.products.length} productos · {money(grp.totalValue)}</p>
                            </button>
                            {expandedGroups.has(grp.key) && (
                                <div className="border-t border-gray-100 bg-gray-50/50 p-3 space-y-2">
                                    {grp.products.map((prod) => (
                                        <div key={prod.name} className="bg-white rounded-xl border border-gray-100 p-3">
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="font-medium text-gray-900">{prod.name}</span>
                                                <span className="text-xs font-semibold text-gray-600">×{prod.qty}</span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">Costo prom: {money(prod.avgCost)}/u</p>
                                            <div className="flex gap-2 mt-2 flex-wrap">
                                                {prod.items.length > 1 && onMerge && (
                                                    <button
                                                        onClick={() => onMerge(prod.items)}
                                                        className="text-[10px] font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-2 py-1 rounded-md flex items-center gap-1"
                                                    >
                                                        <Merge className="w-3 h-3" /> Unificar ({prod.items.length})
                                                    </button>
                                                )}
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
                    ))
                ) : viewMode === 'batches' ? (
                    batchGroups.map((grp) => (
                        <div key={grp.key} className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                            <button type="button" onClick={() => toggleGroup(grp.key)} className="w-full p-4 text-left">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <Box className="w-4 h-4 text-blue-500" />
                                        <h3 className="font-semibold text-gray-900">{grp.label}</h3>
                                        {grp.status && <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${grp.status.color}`}>{grp.status.label}</span>}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="bg-blue-600 text-white px-2 py-1 rounded-md text-xs font-semibold">{grp.totalQty}</span>
                                        {expandedGroups.has(grp.key) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                                    </div>
                                </div>
                                <p className="text-xs text-gray-400 mt-1">{grp.children.length} items · {money(grp.totalValue)}</p>
                            </button>
                            {expandedGroups.has(grp.key) && (
                                <div className="border-t border-gray-100 bg-gray-50/50 p-3 space-y-2">
                                    {grp.children.map(item => (
                                        <div key={item.id} className="bg-white rounded-xl border border-gray-100 p-3">
                                            <div className="flex justify-between items-center text-sm">
                                                <span className="font-medium text-gray-900">{item.productName}</span>
                                                <span className="text-xs font-semibold text-gray-600">×{item.quantity}</span>
                                            </div>
                                            <div className="flex gap-4 text-xs text-gray-500 mt-1">
                                                <span>Costo: {money(item.purchasePrice)}/u</span>
                                                <span>{item.location || 'Sin ubicación'}</span>
                                                <span>{conditionLabelMap[item.condition || 'nuevo']}</span>
                                            </div>
                                            <div className="mt-2.5 flex justify-end"><LotActions item={item} onSell={onSell} onEdit={onEdit} onWithdraw={onWithdraw} onDelete={onDelete} /></div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))
                ) : (
                    /* Mobile View: PROPIOS */
                    personalGroups.length === 0 ? (
                        <div className="text-center py-8 text-gray-400 text-sm">No tienes productos marcados como propios en stock.</div>
                    ) : (
                        personalGroups.map((grp) => (
                            <div key={grp.key} className="rounded-2xl border border-violet-200 bg-violet-50/30 shadow-sm overflow-hidden">
                                <button type="button" onClick={() => toggleGroup(grp.key)} className="w-full p-4 text-left">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-center gap-3">
                                            {grp.imageUrl ? (
                                                <div title={brokenMedia.has(grp.imageUrl) ? 'El link de la foto ya no carga' : undefined} className={`w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 ${brokenMedia.has(grp.imageUrl) ? 'border-2 border-red-400 ring-2 ring-red-200' : 'border border-violet-200'}`}>
                                                    <img src={grp.imageUrl} alt="" className="w-full h-full object-cover" />
                                                </div>
                                            ) : (
                                                <div className="w-10 h-10 rounded-lg border border-violet-200 bg-violet-100 flex-shrink-0 flex items-center justify-center">
                                                    <User className="w-4 h-4 text-violet-600" />
                                                </div>
                                            )}
                                            <div>
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <h3 className="font-semibold text-gray-900 leading-tight">{grp.name}</h3>
                                                    <span className="text-[10px] font-bold bg-violet-200 text-violet-800 px-1.5 py-0.5 rounded">PROPIO</span>
                                                </div>
                                                <div className="flex flex-wrap gap-1 mt-1.5">
{grp.locations.map(l => (
<LocationChip key={l.loc} label={l.loc} qty={l.qty} onClick={() => askMove(grp.name, l.loc, grp.children.filter(c => normalizeText(c.location || 'Sin ubicación') === normalizeText(l.loc)))} />
))}
</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="px-2 py-1 rounded-md text-xs font-semibold text-white bg-violet-600">{grp.totalQty}</span>
                                            {expandedGroups.has(grp.key) ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                                        </div>
                                    </div>
                                    <div className="mt-2 flex gap-4 text-xs text-violet-700">
                                        <span>Solo ingreso (sin costo de compra)</span>
                                    </div>
                                </button>
                                {expandedGroups.has(grp.key) && (
                                    <div className="border-t border-violet-100 bg-white/60 p-3 space-y-2">
                                        {grp.children.map(item => (
                                            <div key={item.id} className="bg-white rounded-xl border border-violet-100 p-3 shadow-xs">
                                                <div className="flex justify-between items-center text-sm">
                                                    <LocationChip label={item.location || ''} onClick={() => askMove(item.productName, item.location || '', [item])} />
                                                    <span className="text-xs font-bold text-violet-700">×{item.quantity}</span>
                                                </div>
                                                <div className="flex gap-4 text-xs text-gray-500 mt-1">
                                                    <span>{conditionLabelMap[item.condition || 'nuevo']}</span>
                                                    {item.salePrice && <span className="text-emerald-600 font-bold">Venta: {money(item.salePrice)}</span>}
                                                </div>
                                                <div className="mt-2.5 flex justify-end"><LotActions item={item} onSell={onSell} onEdit={onEdit} onWithdraw={onWithdraw} onDelete={onDelete} onManageImages={onManageImages} /></div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )
                )}
            </div>

            {/* ===== DESKTOP VIEW ===== */}
            <div className="hidden sm:block overflow-x-auto">
                {viewMode === 'products' ? (
                    productGroups.length === 0 ? (
                        <div className="p-8 text-center text-gray-400">No hay productos comerciales en stock.</div>
                    ) : (
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
                                    <th className="px-4 py-3 text-center min-w-[210px]">Publicación / Tienda</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {productGroups.map((grp) => {
                                    const repItem = grp.children.find(c => c.publicInStore) || grp.children.find(c => c.storeTitle || c.description || c.storeVideoUrl || (c.storeImages && c.storeImages.length > 0)) || grp.children[0];
                                    const isPublic = grp.children.some(c => c.publicInStore);
                                    const hasStoreTitle = Boolean(repItem?.storeTitle?.trim());
                                    const hasDesc = Boolean(repItem?.description?.trim());
                                    const hasVideo = Boolean(repItem?.storeVideoUrl?.trim());
                                    const photoCount = (repItem?.storeImages?.length || 0) + (repItem?.imageUrl ? 1 : 0);
                                    const videoBroken = Boolean(repItem?.storeVideoUrl?.trim()) && brokenMedia.has(repItem!.storeVideoUrl!.trim());
                                    const photoBroken = [repItem?.imageUrl, ...(repItem?.storeImages || [])].some(u => !!u && brokenMedia.has(u));

                                    return (
                                        <Fragment key={grp.key}>
                                            <tr
                                                key={grp.key}
                                                onClick={() => toggleGroup(grp.key)}
                                                className="transition-colors cursor-pointer group border-l-4 border-blue-400 bg-white hover:bg-blue-50/30"
                                            >
                                                <td className="px-3 py-3 text-gray-400 w-8">
                                                    {expandedGroups.has(grp.key)
                                                        ? <ChevronDown className="w-4 h-4 text-blue-400" />
                                                        : <ChevronRight className="w-4 h-4" />}
                                                </td>
                                                <td className="px-3 py-3">
                                                    {grp.imageUrl ? (
                                                        <div title={brokenMedia.has(grp.imageUrl) ? 'El link de la foto ya no carga — click en el lápiz para reemplazarla' : undefined} className={`w-10 h-10 rounded-xl overflow-hidden shadow-sm ${brokenMedia.has(grp.imageUrl) ? 'border-2 border-red-400 ring-2 ring-red-200' : 'border border-gray-100'}`}>
                                                            <img src={grp.imageUrl} alt="" className="w-full h-full object-cover" />
                                                        </div>
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-xl border-2 border-dashed flex items-center justify-center bg-gray-50 border-gray-200">
                                                            <Package className="w-4 h-4 text-gray-400" />
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="px-3 py-3">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-semibold text-gray-900 text-sm leading-snug">{grp.name}</span>
                                                        {(() => {
                                                            const status = getBatchStatus(grp.batches);
                                                            if (!status) return null;
                                                            return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>;
                                                        })()}
                                                    </div>
                                                    <p className="text-[11px] text-gray-400 mt-0.5">
                                                        {grp.batches.map(b => getBatchLabel(b)).join(', ') || 'Directa'}
                                                    </p>
                                                </td>
                                                <td className="px-3 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                                                    <div className="inline-flex items-center gap-1">
                                                        <button
                                                            type="button"
                                                            onClick={() => setQtyEditorKey(qtyEditorKey === grp.key ? null : grp.key)}
                                                            title="Editar cantidades"
                                                            aria-expanded={qtyEditorKey === grp.key}
                                                            className={`px-2.5 py-1 rounded-full text-xs font-bold text-white transition-all active:scale-95 ${qtyEditorKey === grp.key ? 'bg-blue-800 ring-2 ring-blue-300' : 'bg-blue-600 hover:bg-blue-700'}`}
                                                        >
                                                            {grp.totalQty}
                                                        </button>
                                                        </div>
                                                </td>
                                                <td className="px-3 py-3 text-right font-mono text-sm">
                                                    <span className="text-gray-700">{money(grp.avgCost)}</span>
                                                </td>
                                                <td className="px-3 py-3 text-right font-mono">
                                                    <span className="font-bold text-gray-900 text-sm">{money(grp.totalValue)}</span>
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <div className="flex flex-wrap justify-center gap-1">
                                                        {grp.locations.map(l => (
                                                            <LocationChip key={l.loc} label={l.loc} qty={l.qty} onClick={() => askMove(grp.name, l.loc, grp.children.filter(c => normalizeText(c.location || 'Sin ubicación') === normalizeText(l.loc)))} />
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-2 text-center" onClick={(e) => e.stopPropagation()}>
                                                    <div className="flex flex-col items-center justify-center gap-1.5 min-w-[210px]">
                                                        {/* Switch / Status & Edit */}
                                                        <div className="flex items-center gap-1.5">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const nextState = !isPublic;
                                                                    grp.children.forEach(c => onTogglePublicInStore(c.id, nextState));
                                                                }}
                                                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold transition-all shadow-xs cursor-pointer ${
                                                                    isPublic
                                                                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 ring-1 ring-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-300 dark:ring-emerald-800/60 dark:hover:bg-emerald-900/70'
                                                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 ring-1 ring-gray-200 dark:bg-slate-800/90 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700'
                                                                }`}
                                                                title={isPublic ? 'Publicado en tienda — click para pausar' : 'No publicado — click para publicar en tienda'}
                                                            >
                                                                <span className={`w-2 h-2 rounded-full ${isPublic ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400 dark:bg-slate-500'}`} />
                                                                {isPublic ? 'Publicado' : 'No publicado'}
                                                            </button>
                                                            </div>
                                                        {/* Completitud de la publicación (segmentos clicables) */}
                                                        <div className="flex items-center justify-center py-0.5">
                                                            <StoreProgress
                                                                hasTitle={hasStoreTitle}
                                                                hasDesc={hasDesc}
                                                                hasVideo={hasVideo}
                                                                photoCount={photoCount}
                                                                onOpen={() => onManageImages(repItem)}
                                                                videoBroken={videoBroken}
                                                                photoBroken={photoBroken}
                                                            />
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        {qtyEditorKey === grp.key && (
                                            <tr key={`qty-${grp.key}`} className="border-l-4 border-blue-500 bg-blue-50/60">
                                                <td colSpan={8} className="px-6 py-3">
                                                    <QtyEditorPanel
                                                        items={grp.children}
                                                        anchor={repItem}
                                                        onUpdateQuantity={onUpdateQuantity}
                                                        onDelete={onDelete}
                                                        onAddUnits={onAddUnits}
                                                    />
                                                </td>
                                            </tr>
                                        )}
                                        {expandedGroups.has(grp.key) && (
                                            <>
                                                {(() => {
                                                    const locMap = new Map<string, Item[]>();
                                                    grp.children.forEach(item => {
                                                        const loc = item.location || 'Sin ubicación';
                                                        if (!locMap.has(loc)) locMap.set(loc, []);
                                                        locMap.get(loc)!.push(item);
                                                    });
                                                    return Array.from(locMap.entries()).filter(([_, lItems]) => lItems.length > 1).map(([locName, lItems]) => {
                                                        const totalQty = lItems.reduce((a, i) => a + i.quantity, 0);
                                                        const totalCost = lItems.reduce((a, i) => a + i.purchasePrice * i.quantity, 0);
                                                        const avgCost = Math.round(totalCost / totalQty);
                                                        return (
                                                            <tr key={`merge-desktop-${locName}`} className="bg-indigo-50/70 border-l-4 border-indigo-500">
                                                                <td colSpan={8} className="px-6 py-2.5">
                                                                    <div className="flex items-center justify-between gap-3">
                                                                        <div className="flex items-center gap-2 text-xs text-indigo-900 font-medium">
                                                                            <Merge className="w-4 h-4 text-indigo-600 shrink-0" />
                                                                            <span>Hay <b>{lItems.length} registros individuales</b> en <b>{locName}</b> ({totalQty} unidades · Costo prom: <b>{money(avgCost)}</b>)</span>
                                                                        </div>
                                                                        {onMerge && (
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); onMerge(lItems); }}
                                                                                className="bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer"
                                                                                title={`Unificar los ${lItems.length} registros en 1 solo registro con costo promedio`}
                                                                            >
                                                                                <Merge className="w-3.5 h-3.5" />
                                                                                Unificar en 1 fila
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    });
                                                })()}
                                                {grp.children.map(item => (
                                                    <tr key={item.id} className="bg-slate-50 border-l-4 border-blue-200">
                                                <td className="pl-8 py-3" colSpan={2}>
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                                                            {getBatchLabel(resolveBatchRef(item))}
                                                        </span>
                                                        <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                                            {conditionLabelMap[item.condition || 'nuevo']}
                                                        </span>
                                                        <span className="text-[10px] text-gray-400">
                                                            {new Date(item.date).toLocaleDateString('es-AR')}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <LocationChip label={item.location || ''} onClick={() => askMove(item.productName, item.location || '', [item])} />
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <span className="text-sm font-bold text-gray-700">×{item.quantity}</span>
                                                </td>
                                                <td className="px-3 py-3 text-right font-mono text-xs text-gray-600">
                                                    {money(item.purchasePrice)}
                                                </td>
                                                <td className="px-3 py-3 text-right font-mono text-xs">
                                                    <span className="font-semibold text-gray-800">{money((item.purchasePrice * item.quantity))}</span>
                                                    {item.salePrice && <span className="block text-emerald-600 text-[10px]">→ {money(item.salePrice)}/u</span>}
                                                </td>
                                                <td className="px-3 py-3" colSpan={2}>
                                                    <div className="flex items-center gap-1">
                                                        <LotActions item={item} onSell={onSell} onEdit={onEdit} onWithdraw={onWithdraw} onDelete={onDelete} />
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                            </>
                                        )}
                                    </Fragment>
                                );
                            })}
                            </tbody>
                        </table>
                    )
                ) : viewMode === 'locations' ? (
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
                                <Fragment key={grp.key}>
                                    <tr
                                        key={grp.key}
                                        onClick={() => toggleGroup(grp.key)}
                                        className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                                    >
                                        <td className="px-4 py-3 text-gray-400">
                                            {expandedGroups.has(grp.key) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </td>
                                        <td className="px-4 py-3 font-bold text-gray-900 flex items-center gap-2">
                                            <MapPin className="w-4 h-4 text-blue-500" />
                                            {grp.location}
                                        </td>
                                        <td className="px-4 py-3 text-center text-xs font-semibold">{grp.products.length}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className="bg-blue-600 text-white px-2 py-1 rounded-md text-xs font-semibold">{grp.totalQty}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono font-medium text-gray-900">{money(grp.totalValue)}</td>
                                    </tr>
                                    {expandedGroups.has(grp.key) && grp.products.map(prod => (
                                        <tr key={prod.name} className="bg-blue-50/30 border-l-2 border-blue-200">
                                            <td className="px-4 py-2"></td>
                                            <td className="px-4 py-2 text-gray-700 font-medium text-xs">{prod.name}</td>
                                            <td className="px-4 py-2 text-center text-xs text-gray-400">
                                                prom: {money(prod.avgCost)}/u
                                            </td>
                                            <td className="px-4 py-2 text-center text-xs font-semibold">{prod.qty}</td>
                                            <td className="px-4 py-2 text-right">
                                                <div className="flex justify-end items-center gap-1">
                                                    {prod.items.length > 1 && onMerge && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); onMerge(prod.items); }}
                                                            className="bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 shadow-sm mr-1 cursor-pointer"
                                                            title="Unificar unidades en 1 registro con costo promedio"
                                                        >
                                                            <Merge className="w-3 h-3" /> Unificar
                                                        </button>
                                                    )}
                                                    {prod.items.map(item => (
                                                        <div key={item.id} className="flex gap-0.5">
                                                            <LotActions item={item} onSell={onSell} onEdit={onEdit} onWithdraw={onWithdraw} onDelete={onDelete} />
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                ) : viewMode === 'batches' ? (
                    <table className="w-full text-left text-sm text-gray-600">
                        <thead className="bg-gray-50 text-gray-700 uppercase font-semibold text-xs tracking-wider">
                            <tr>
                                <th className="px-4 py-3 w-8"></th>
                                <th className="px-4 py-3">Tanda</th>
                                <th className="px-4 py-3 text-center">Estado</th>
                                <th className="px-4 py-3 text-center">Productos</th>
                                <th className="px-4 py-3 text-center">Unidades</th>
                                <th className="px-4 py-3 text-right">Valor Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {batchGroups.map((grp) => (
                                <Fragment key={grp.key}>
                                    <tr
                                        key={grp.key}
                                        onClick={() => toggleGroup(grp.key)}
                                        className="hover:bg-gray-50/50 transition-colors cursor-pointer"
                                    >
                                        <td className="px-4 py-3 text-gray-400">
                                            {expandedGroups.has(grp.key) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </td>
                                        <td className="px-4 py-3 font-medium text-gray-900 flex items-center gap-2">
                                            <Box className="w-4 h-4 text-blue-500" />
                                            {grp.label}
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            {grp.status ? (
                                                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${grp.status.color}`}>{grp.status.label}</span>
                                            ) : (
                                                <span className="text-xs text-gray-400">-</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center text-xs font-semibold">{grp.children.length}</td>
                                        <td className="px-4 py-3 text-center">
                                            <span className="bg-blue-600 text-white px-2 py-1 rounded-md text-xs font-semibold">{grp.totalQty}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono font-medium text-gray-900">{money(grp.totalValue)}</td>
                                    </tr>
                                    {expandedGroups.has(grp.key) && grp.children.map(item => (
                                        <tr key={item.id} className="bg-blue-50/30 border-l-2 border-blue-200">
                                            <td className="px-4 py-2"></td>
                                            <td className="px-4 py-2 text-gray-700 font-medium text-xs">
                                                {item.productName}
                                            </td>
                                            <td className="px-4 py-2 text-center text-xs text-gray-500">
                                                {conditionLabelMap[item.condition || 'nuevo']}
                                            </td>
                                            <td className="px-4 py-2 text-center text-xs text-gray-500">
                                                {item.location || '-'}
                                            </td>
                                            <td className="px-4 py-2 text-center text-xs font-semibold">{item.quantity}</td>
                                            <td className="px-4 py-2 text-right">
                                                <div className="flex justify-end items-center gap-1">
                                                    <span className="text-xs font-mono mr-2">{money(item.purchasePrice)}/u</span>
                                                    <LotActions item={item} onSell={onSell} onEdit={onEdit} onWithdraw={onWithdraw} onDelete={onDelete} />
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </Fragment>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    /* Desktop View: PROPIOS */
                    personalGroups.length === 0 ? (
                        <div className="p-8 text-center text-gray-400">No tienes productos propios en stock actualmente.</div>
                    ) : (
                        <table className="w-full text-left text-sm text-gray-600">
                            <thead className="bg-violet-50/80 text-violet-900 uppercase font-semibold text-xs tracking-wider border-b border-violet-100">
                                <tr>
                                    <th className="px-4 py-3 w-8"></th>
                                    <th className="px-4 py-3 w-10">Img</th>
                                    <th className="px-4 py-3">Producto Propio</th>
                                    <th className="px-4 py-3 text-center">Stock</th>
                                    <th className="px-4 py-3 text-center">Ubicaciones</th>
                                    <th className="px-4 py-3 text-right">Precio Venta</th>
                                    <th className="px-4 py-3 text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-violet-100/60">
                                {personalGroups.map((grp) => (
                                    <Fragment key={grp.key}>
                                        <tr
                                            key={grp.key}
                                            onClick={() => toggleGroup(grp.key)}
                                            className="transition-colors cursor-pointer group border-l-4 border-violet-500 bg-violet-50/30 hover:bg-violet-50/70"
                                        >
                                            <td className="px-3 py-3 text-violet-400 w-8">
                                                {expandedGroups.has(grp.key)
                                                    ? <ChevronDown className="w-4 h-4 text-violet-600" />
                                                    : <ChevronRight className="w-4 h-4" />}
                                            </td>
                                            <td className="px-3 py-3">
                                                {grp.imageUrl ? (
                                                    <div title={brokenMedia.has(grp.imageUrl) ? 'El link de la foto ya no carga' : undefined} className={`w-10 h-10 rounded-xl overflow-hidden shadow-xs ${brokenMedia.has(grp.imageUrl) ? 'border-2 border-red-400 ring-2 ring-red-200' : 'border border-violet-200'}`}>
                                                        <img src={grp.imageUrl} alt="" className="w-full h-full object-cover" />
                                                    </div>
                                                ) : (
                                                    <div className="w-10 h-10 rounded-xl border border-violet-200 bg-violet-100 flex items-center justify-center">
                                                        <User className="w-4 h-4 text-violet-600" />
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-3">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-bold text-gray-900 text-sm leading-snug">{grp.name}</span>
                                                    <span className="text-[10px] font-bold bg-violet-200 text-violet-800 px-2 py-0.5 rounded-full">PROPIO</span>
                                                </div>
                                                <p className="text-[11px] text-violet-600 mt-0.5 font-medium">
                                                    Solo ingreso · Sin costo de compra asignado
                                                </p>
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <span className="px-2.5 py-1 rounded-full text-xs font-bold text-white bg-violet-600 shadow-xs">{grp.totalQty}</span>
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <div className="flex flex-wrap justify-center gap-1">
                                                    {grp.locations.map(l => (
                                                        <LocationChip key={l.loc} label={l.loc} qty={l.qty} onClick={() => askMove(grp.name, l.loc, grp.children.filter(c => normalizeText(c.location || 'Sin ubicación') === normalizeText(l.loc)))} />
                                                    ))}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3 text-right font-mono text-xs text-gray-500">
                                                {grp.children.some(c => c.salePrice) ? (
                                                    <span className="text-emerald-700 font-bold">
                                                        {money(Math.max(...grp.children.map(c => c.salePrice || 0)))}/u
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400">A convenir</span>
                                                )}
                                            </td>
                                            <td className="px-3 py-3 text-right">
                                                <span className="text-xs font-bold text-violet-600 hover:text-violet-800">
                                                    {expandedGroups.has(grp.key) ? 'Ocultar items ▲' : 'Ver items ▼'}
                                                </span>
                                            </td>
                                        </tr>
                                        {expandedGroups.has(grp.key) && grp.children.map(item => (
                                            <tr key={item.id} className="bg-violet-50/20 border-l-4 border-violet-300">
                                                <td className="pl-8 py-3" colSpan={2}>
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className="text-[10px] font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
                                                            {conditionLabelMap[item.condition || 'nuevo']}
                                                        </span>
                                                        <span className="text-[10px] text-gray-400">
                                                            {new Date(item.date).toLocaleDateString('es-AR')}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3">
                                                    <div className="flex items-center gap-1.5">
                                                        <LocationChip label={item.location || ''} onClick={() => askMove(item.productName, item.location || '', [item])} />
                                                    </div>
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <span className="text-sm font-bold text-violet-900">×{item.quantity}</span>
                                                </td>
                                                <td className="px-3 py-3 text-center">
                                                    <span className="text-xs text-violet-600 font-medium">Uso / Propio</span>
                                                </td>
                                                <td className="px-3 py-3 text-right font-mono text-xs">
                                                    {item.salePrice ? (
                                                        <span className="font-bold text-emerald-600">{money(item.salePrice)}</span>
                                                    ) : (
                                                        <span className="text-gray-400">—</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-3">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <LotActions item={item} onSell={onSell} onEdit={onEdit} onWithdraw={onWithdraw} onDelete={onDelete} onManageImages={onManageImages} />
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </Fragment>
                                ))}
                            </tbody>
                        </table>
                    )
                )}
            </div>
        </>
    );
}

// ── Formato único de las descripciones de tienda ───────────────────────────────
/* Toda descripción sigue el mismo molde: una viñeta por línea, con la forma
   `EMOJI **Etiqueta:** contenido`. La negrita se usa SOLO en la etiqueta, así el
   texto se ve igual en la tienda, en el bot de WhatsApp y al pegarlo en Facebook. */

/** Emojis iniciales de una viñeta (incluye tonos de piel, ZWJ y variation selector). */
const BULLET_EMOJI = /^(?:[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D])+/u;

/** Línea de cierre, idéntica en toda la tienda. La comparte el prompt de la IA. */
const CIERRE_CONTACTO = '💬 **Contacto:** escribime un mensaje directo y coordinamos la entrega';

/**
 * Saca los asteriscos de markdown dejando el texto. Un `*` entre alfanuméricos
 * (ej. `2*USB`) se conserva porque ahí no es negrita, es multiplicación.
 */
function stripAsterisks(line: string): string {
    return line.replace(/\*+/g, (m, offset: number, full: string) => {
        const before = full[offset - 1] ?? ' ';
        const after = full[offset + m.length] ?? ' ';
        if (m.length === 1 && /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after)) return m;
        return '';
    });
}

/**
 * Normaliza una descripción al formato único. Corre sobre lo que devuelve la IA
 * y sobre todo lo que se guarde a mano, así las descripciones viejas (negrita
 * mezclada, viñetas `-`, líneas enteras en bold) quedan homogéneas.
 *
 * Las líneas que no tienen etiqueta quedan en texto plano: la negrita nunca
 * aparece suelta.
 */
function normalizeStoreDescription(raw: string): string {
    if (!raw.trim()) return '';

    const lines = raw.split(/\r?\n/).map(line => {
        let l = stripAsterisks(line.replace(/__(.+?)__/g, '$1'))
            .replace(/^\s*#{1,6}\s*/, '')      // ### Título → Título
            .replace(/^\s*[-–—•]\s+/, '')      // viñetas de markdown → las reemplaza el emoji
            .trim();
        if (!l) return '';

        // El emoji inicial se separa para no meterlo dentro de la negrita
        const emoji = l.match(BULLET_EMOJI)?.[0] ?? '';
        if (emoji) l = l.slice(emoji.length).trim();

        // El cierre es siempre el mismo, sin importar cómo estaba redactado antes
        if (/mensaje directo/i.test(l)) return CIERRE_CONTACTO;

        // Etiqueta = lo que va antes del primer `:`, si parece etiqueta y no una
        // oración larga ni un link (`https://...` también trae dos puntos).
        const colon = l.indexOf(':');
        const label = colon > 0 ? l.slice(0, colon).trim() : '';
        const isLabel = !l.includes('://') && label.length > 0 && label.length <= 40 && !/[?!.]/.test(label);

        // El contenido cierra sin punto final, igual que lo que genera la IA
        const content = (isLabel ? l.slice(colon + 1) : l).trim().replace(/([^.])\.$/, '$1');

        const parts = isLabel
            ? [emoji, `**${label}:**`, content]
            : [emoji, content];
        return parts.filter(Boolean).join(' ');
    });

    // Una viñeta por línea, sin líneas en blanco: igual que lo que genera la IA
    return lines.filter(Boolean).join('\n').trim();
}

function StoreImagesModal({ item, onClose, onSave, onClearAll, onGeneratePlaca }: {
    item: Item;
    onClose: () => void;
    onSave: (id: string, patch: Partial<Item>) => Promise<void>;
    onClearAll: () => void;
    onGeneratePlaca: () => void;
}) {
    const [images, setImages] = useState<string[]>(item.storeImages || []);
    const [videoUrl, setVideoUrl] = useState<string>(item.storeVideoUrl || '');
    const [description, setDescription] = useState<string>(item.description || '');
    const [storeTitle, setStoreTitle] = useState<string>(item.storeTitle || '');
    const [storeGroup, setStoreGroup] = useState<string>(item.storeGroup || '');
    const [storeVariantName, setStoreVariantName] = useState<string>(item.storeVariantName || '');
    const [uploading, setUploading] = useState(false);
    const [uploadingVideo, setUploadingVideo] = useState(false);
    const [saving, setSaving] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const [showUrlInput, setShowUrlInput] = useState(false);
    const [videoUrlInput, setVideoUrlInput] = useState('');
    const [showVideoUrlInput, setShowVideoUrlInput] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fbCopied, setFbCopied] = useState(false);
    const [titleCopied, setTitleCopied] = useState(false);

    // ── AI Generation States ──
    const [showAiPanel, setShowAiPanel] = useState(false);
    const [aiApiKey, setAiApiKey] = useState(() => localStorage.getItem('ai_api_key') || '');
    const [aiInput, setAiInput] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [aiError, setAiError] = useState<string | null>(null);

    const handleGenerateWithAI = async () => {
        if (!aiApiKey.trim()) { setAiError('Ingresá tu API Key primero.'); return; }
        if (!aiInput.trim()) { setAiError('Pegá los datos del producto para que la IA los procese.'); return; }
        setIsGenerating(true);
        setAiError(null);
        localStorage.setItem('ai_api_key', aiApiKey.trim());
        try {
            const systemPrompt = `Eres un experto en copywriting para ecommerce. Tu trabajo es recibir texto desordenado o especificaciones técnicas de un producto y transformarlo en un título atractivo y una descripción optimizada para ventas.

TÍTULO
- Corto y llamativo, con uno o dos emojis.

DESCRIPCIÓN — formato estricto, sin excepciones:
- Entre 4 y 6 líneas. Una viñeta por línea, sin líneas en blanco entre ellas.
- CADA línea sigue exactamente este molde: EMOJI **Etiqueta:** contenido
- La etiqueta es de 1 a 3 palabras, sin emojis, y los dos puntos van DENTRO de la negrita.
- El contenido va en texto normal: sin negrita, sin asteriscos y sin punto final.
- La negrita (**) se usa SOLO en la etiqueta. Nunca en el contenido ni en una línea entera.
- Un emoji distinto por línea, siempre al principio.
- Las dos últimas líneas son siempre estas, textuales:
📦 **Condición:** producto totalmente nuevo en caja
${CIERRE_CONTACTO}
- Ignora texto spam, marcas de agua o fragmentos repetitivos.
- NO incluyas precios, ubicación ni datos de envío.

Ejemplo de descripción bien formada:
🔋 **Batería:** 20000mAh para varias cargas completas
⚡ **Carga rápida:** 18W por USB-C
🔌 **Puertos:** 2 USB para cargar dos equipos a la vez
📦 **Condición:** producto totalmente nuevo en caja
${CIERRE_CONTACTO}

Formato OBLIGATORIO:
[TITULO]
Aquí va el título
[/TITULO]
[DESCRIPCION]
Aquí va la descripción
[/DESCRIPCION]`;

            const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${aiApiKey.trim()}`,
                },
                body: JSON.stringify({
                    model: 'openai/gpt-oss-120b',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `Ordena esto y genera título y descripción para:\n\n${aiInput.trim()}` },
                    ],
                    temperature: 0.4,
                }),
            });
            if (!res.ok) {
                const errBody = await res.text();
                if (res.status === 401 || res.status === 403) {
                    throw new Error('API Key inválida. Verificá que sea correcta.');
                }
                throw new Error(`Error ${res.status}: ${errBody.slice(0, 200)}`);
            }
            const data = await res.json();
            const text = data.choices?.[0]?.message?.content || '';
            const titleMatch = text.match(/\[TITULO\]\s*([\s\S]*?)\s*\[\/TITULO\]/i);
            const descMatch = text.match(/\[DESCRIPCION\]\s*([\s\S]*?)\s*\[\/DESCRIPCION\]/i);
            if (titleMatch?.[1]) setStoreTitle(titleMatch[1].trim());
            if (descMatch?.[1]) setDescription(normalizeStoreDescription(descMatch[1]));
            if (!titleMatch && !descMatch) {
                setAiError('La IA no devolvió el formato esperado. Intentá de nuevo.');
            } else {
                setShowAiPanel(false);
                setAiInput('');
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error al conectar con la IA';
            setAiError(msg);
        } finally {
            setIsGenerating(false);
        }
    };

    const addImages = (urls: string[]) => setImages(prev => [...prev, ...urls.filter(u => u && !prev.includes(u))]);

    const handleFiles = async (files: FileList | null) => {
        if (!files || !files.length) return;
        setUploading(true);
        setError(null);
        try {
            const urls = await Promise.all(Array.from(files).map(f => imageService.upload(f)));
            addImages(urls);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al subir imagen');
        } finally {
            setUploading(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        // Separate images and videos
        const files = e.dataTransfer.files;
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        const videoFiles = Array.from(files).filter(f => f.type.startsWith('video/'));
        if (imageFiles.length) {
            const dt = new DataTransfer();
            imageFiles.forEach(f => dt.items.add(f));
            handleFiles(dt.files);
        }
        if (videoFiles.length) handleVideoFile(videoFiles[0]);
    };

    const handleUrlAdd = async () => {
        const trimmed = urlInput.trim();
        if (!trimmed) return;
        setUploading(true);
        setError(null);
        addImages([trimmed]);
        try {
            const uploaded = await imageService.upload(trimmed);
            setImages(prev => prev.map(u => u === trimmed ? uploaded : u));
        } catch {
            // keep external URL as-is
        } finally {
            setUploading(false);
            setUrlInput('');
            setShowUrlInput(false);
        }
    };

    const handleVideoFile = async (file: File) => {
        setUploadingVideo(true);
        setError(null);
        try {
            const { supabase } = await import('../lib/supabase');
            const ext = file.name.split('.').pop() || 'mp4';
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('');
            const filePath = `vid_${hash}.${ext}`;
            const { data: existing } = await supabase.storage.from('product-images').list('', { search: `vid_${hash}.${ext}` });
            if (!existing?.some(f => f.name === `vid_${hash}.${ext}`)) {
                const { error: upErr } = await supabase.storage.from('product-images').upload(filePath, file, { contentType: file.type, upsert: false });
                if (upErr && !upErr.message?.includes('already exists')) throw upErr;
            }
            const { data } = supabase.storage.from('product-images').getPublicUrl(filePath);
            setVideoUrl(data.publicUrl);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al subir video');
        } finally {
            setUploadingVideo(false);
        }
    };

    const handleVideoUrlSave = () => {
        const trimmed = videoUrlInput.trim();
        if (!trimmed) return;
        setVideoUrl(trimmed);
        setVideoUrlInput('');
        setShowVideoUrlInput(false);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Se normaliza siempre: lo que generó la IA, lo pegado a mano y las
            // descripciones viejas quedan todas con el mismo formato.
            const cleanDescription = normalizeStoreDescription(description);
            setDescription(cleanDescription);
            await onSave(item.id, {
                storeImages: images,
                storeVideoUrl: videoUrl || '',
                description: cleanDescription,
                storeTitle: storeTitle.trim() || '',
                storeGroup: storeGroup.trim().toLowerCase().replace(/\s+/g, '-') || '',
                storeVariantName: storeVariantName.trim() || '',
            });
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al guardar');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col ring-1 ring-black/5">
                {/* Header */}
                <div className="p-4 border-b border-gray-100 bg-white flex items-center justify-between gap-3 sticky top-0 z-10 rounded-t-3xl sm:rounded-t-2xl">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-9 h-9 rounded-xl bg-violet-100 text-violet-600 flex items-center justify-center shrink-0"><ImageIcon className="w-4 h-4" /></span>
                        <div className="min-w-0">
                            <h2 className="text-sm font-bold text-gray-800">Fotos y video de tienda</h2>
                            <p className="text-xs text-gray-500 truncate max-w-[220px]">{item.productName}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="h-8 w-8 rounded-full bg-gray-50 border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex items-center justify-center transition-all shrink-0">
                        <X className="w-4 h-4" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-gray-50">
                    {/* ── TÍTULO DE PUBLICACIÓN ── */}
                    <div className="rounded-2xl bg-white border border-gray-200/70 p-4 space-y-2.5 shadow-xs">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="w-7 h-7 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center shrink-0"><FileText className="w-3.5 h-3.5" /></span>
                                <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Título de publicación</p>
                            </div>
                            {(storeTitle.trim() || item.productName) && (
                                <button
                                    onClick={() => {
                                        const t = storeTitle.trim() || item.productName;
                                        navigator.clipboard.writeText(t).then(() => {
                                            setTitleCopied(true);
                                            setTimeout(() => setTitleCopied(false), 2000);
                                        });
                                    }}
                                    className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all ${titleCopied ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'}`}
                                >
                                    {titleCopied ? '✓ Copiado' : '📋 Copiar'}
                                </button>
                            )}
                        </div>
                        <input
                            type="text"
                            value={storeTitle}
                            onChange={e => setStoreTitle(e.target.value)}
                            placeholder={item.productName}
                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50/60 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 focus:bg-white transition-colors"
                        />
                        <p className="text-[11px] text-gray-400 leading-snug">El título que generás con Gemini para Facebook. Se muestra en la tienda en lugar del nombre interno.</p>
                    </div>

                    {/* ── GRUPO (variantes) ── */}
                    <div className="rounded-2xl bg-white border border-gray-200/70 p-4 space-y-2.5 shadow-xs">
                        <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0"><Layers className="w-3.5 h-3.5" /></span>
                            <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Agrupar variantes</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2.5">
                            <div>
                                <input
                                    type="text"
                                    value={storeGroup}
                                    onChange={e => setStoreGroup(e.target.value)}
                                    placeholder="ej: cable-tipo-c"
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50/60 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 focus:bg-white transition-colors"
                                />
                                <p className="text-[11px] text-gray-400 mt-1 leading-snug">Código de grupo: el mismo en todos los productos similares.</p>
                            </div>
                            <div>
                                <input
                                    type="text"
                                    value={storeVariantName}
                                    onChange={e => setStoreVariantName(e.target.value)}
                                    placeholder="ej: 2 metros"
                                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50/60 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 focus:bg-white transition-colors"
                                />
                                <p className="text-[11px] text-gray-400 mt-1 leading-snug">Nombre de esta variante: cómo se muestra en la lista de opciones.</p>
                            </div>
                        </div>
                    </div>

                    {/* ── DESCRIPCIÓN ── */}
                    <div className="rounded-2xl bg-white border border-gray-200/70 p-4 space-y-2.5 shadow-xs">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center shrink-0"><MessageCircle className="w-3.5 h-3.5" /></span>
                                <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Descripción</p>
                            </div>
                            {description.trim() && (
                                <button
                                    onClick={() => {
                                        const post = [
                                            storeTitle.trim() || item.productName,
                                            '',
                                            description.trim(),
                                            '',
                                            `📍 Fotos, medidas, ubicación y envíos: ${productUrl(item.id)}`,
                                            `💬 Solo respondo por WhatsApp (${STORE_CONFIG.whatsappUser}) o por la web: gestioná tu pedido ahí.`,
                                        ].join('\n');
                                        navigator.clipboard.writeText(post).then(() => {
                                            setFbCopied(true);
                                            setTimeout(() => setFbCopied(false), 2000);
                                        });
                                    }}
                                    className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-all ${fbCopied ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'}`}
                                >
                                    {fbCopied ? '✓ Copiado' : '📋 Copiar'}
                                </button>
                            )}
                        </div>
                        <textarea
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Pegá acá la descripción (ej. generada con Gemini). Se muestra en la tienda, la lee el bot de WhatsApp y la copiás lista para Facebook."
                            rows={4}
                            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50/60 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 focus:bg-white transition-colors resize-y"
                        />
                    </div>

                    {/* ── GENERAR CON IA ── */}
                    <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50/80 to-indigo-50/60 overflow-hidden">
                        <button
                            onClick={() => setShowAiPanel(!showAiPanel)}
                            className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold text-violet-700 hover:bg-violet-100/50 transition-all"
                        >
                            <span className="flex items-center gap-2">
                                <span className="text-base">✨</span>
                                Generar título y descripción con IA
                            </span>
                            <ChevronDown className={`w-4 h-4 transition-transform ${showAiPanel ? 'rotate-180' : ''}`} />
                        </button>
                        {showAiPanel && (
                            <div className="px-4 pb-4 space-y-3 border-t border-violet-100">
                                {/* API Key */}
                                <div className="pt-3">
                                    <label className="text-[11px] font-semibold text-violet-600 uppercase tracking-wide">API Key de Groq</label>
                                    <div className="flex gap-2 mt-1">
                                        <input
                                            type="password"
                                            value={aiApiKey}
                                            onChange={e => setAiApiKey(e.target.value)}
                                            placeholder="sk-..."
                                            className="flex-1 px-3 py-2 rounded-lg border border-violet-200 text-xs outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-100 bg-white"
                                        />
                                        {aiApiKey && (
                                            <span className="self-center text-[10px] text-emerald-600 font-semibold">✓ Guardada</span>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-violet-400 mt-0.5">Tu API Key de Groq. Se guarda en tu navegador.</p>
                                </div>
                                {/* Input de datos */}
                                <div>
                                    <label className="text-[11px] font-semibold text-violet-600 uppercase tracking-wide">Datos del producto (texto desordenado, specs, notas...)</label>
                                    <textarea
                                        value={aiInput}
                                        onChange={e => setAiInput(e.target.value)}
                                        placeholder={'Pegá acá toda la info cruda del producto...\n\nEj: Cargador Xiaomi Redmi 20000mAh, modelo PB200LZM, USB-C, carga rapida 18W, 2 puertos, blanco, nuevo en caja'}
                                        rows={5}
                                        className="w-full mt-1 px-3 py-2.5 rounded-lg border border-violet-200 text-sm outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-100 resize-y bg-white"
                                    />
                                </div>
                                {aiError && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{aiError}</p>}
                                <button
                                    onClick={handleGenerateWithAI}
                                    disabled={isGenerating || !aiInput.trim()}
                                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-bold hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                                >
                                    {isGenerating ? (
                                        <><Loader2 className="w-4 h-4 animate-spin" />Generando con IA...</>
                                    ) : (
                                        <>✨ Generar título y descripción</>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* ── FOTOS ── */}
                    <div className="rounded-2xl bg-white border border-gray-200/70 p-4 space-y-3 shadow-xs">
                        <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0"><ImageIcon className="w-3.5 h-3.5" /></span>
                            <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Fotos</p>
                        </div>

                        {images.length > 0 ? (
                            <div className="grid grid-cols-3 gap-2">
                                {images.map((url, i) => (
                                    <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 group">
                                        <img src={url} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.src = 'https://placehold.co/200x200?text=Error'; }} />
                                        <button
                                            onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                        {i === 0 && <span className="absolute bottom-1 left-1 text-[9px] font-bold bg-black/50 text-white px-1 py-0.5 rounded">Principal</span>}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-xs text-gray-400">Sin fotos adicionales — se muestra la foto principal del producto.</p>
                        )}

                        {/* Drop zone */}
                        <div
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={handleDrop}
                            className={`flex flex-col items-center justify-center gap-2 px-4 py-4 rounded-xl border-2 border-dashed transition-all ${dragOver ? 'border-violet-400 bg-violet-50' : 'border-gray-200 bg-gray-50 hover:border-gray-400'}`}
                        >
                            {uploading ? (
                                <><Loader2 className="w-5 h-5 text-violet-500 animate-spin" /><span className="text-sm text-violet-600">Subiendo...</span></>
                            ) : (
                                <><Upload className="w-5 h-5 text-gray-400" /><span className="text-sm text-gray-500">Arrastrar fotos aquí o</span></>
                            )}
                            <label className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-medium text-gray-600 hover:border-gray-400 cursor-pointer transition-all">
                                Seleccionar fotos
                                <input type="file" accept="image/*" multiple className="hidden" onChange={e => handleFiles(e.target.files)} disabled={uploading} />
                            </label>
                        </div>

                        {showUrlInput ? (
                            <div className="flex gap-2">
                                <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleUrlAdd()} placeholder="https://..." className="flex-1 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50/60 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 focus:bg-white transition-colors" autoFocus />
                                <button onClick={handleUrlAdd} disabled={uploading || !urlInput.trim()} className="px-3 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium disabled:opacity-50">Agregar</button>
                                <button onClick={() => { setShowUrlInput(false); setUrlInput(''); }} className="px-2 py-2 rounded-xl border border-gray-200 text-sm text-gray-500"><X className="w-4 h-4" /></button>
                            </div>
                        ) : (
                            <button onClick={() => setShowUrlInput(true)} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-dashed border-gray-200 text-sm text-gray-500 hover:border-gray-400 bg-gray-50 transition-all">
                                <ImageIcon className="w-4 h-4" />Pegar link de foto
                            </button>
                        )}
                    </div>

                    {/* ── VIDEO ── */}
                    <div className="rounded-2xl bg-white border border-gray-200/70 p-4 space-y-3 shadow-xs">
                        <div className="flex items-center gap-2">
                            <span className="w-7 h-7 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0"><Play className="w-3.5 h-3.5 fill-current" /></span>
                            <p className="text-xs font-bold text-gray-600 uppercase tracking-wide">Video</p>
                        </div>

                        {videoUrl ? (
                            <div className="space-y-2">
                                <VideoPreview url={videoUrl} />
                                <div className="flex items-center gap-2 p-3 rounded-xl border border-gray-200 bg-gray-50">
                                    <span className="text-lg">🎬</span>
                                    <p className="text-xs text-gray-600 flex-1 truncate">{videoUrl}</p>
                                    <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-all" title="Abrir video en otra pestaña">
                                        <ArrowUpRight className="w-3.5 h-3.5" />
                                    </a>
                                    <button onClick={() => setVideoUrl('')} className="shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all" title="Quitar video">
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {/* Upload video file */}
                                <label className={`flex items-center justify-center gap-2 px-4 py-4 rounded-xl border-2 border-dashed transition-all cursor-pointer ${uploadingVideo ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-gray-50 hover:border-gray-400'}`}>
                                    {uploadingVideo ? (
                                        <><Loader2 className="w-5 h-5 text-amber-500 animate-spin" /><span className="text-sm text-amber-600">Subiendo video...</span></>
                                    ) : (
                                        <><span className="text-xl">🎬</span><span className="text-sm text-gray-500">Subir video (MP4, MOV…)</span></>
                                    )}
                                    <input type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleVideoFile(f); e.target.value = ''; }} disabled={uploadingVideo} />
                                </label>

                                {/* Video URL */}
                                {showVideoUrlInput ? (
                                    <div className="flex gap-2">
                                        <input type="url" value={videoUrlInput} onChange={e => setVideoUrlInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleVideoUrlSave()} placeholder="https://youtube.com/watch?v=... o link directo" className="flex-1 px-3 py-2 rounded-xl border border-gray-200 bg-gray-50/60 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:bg-white transition-colors" autoFocus />
                                        <button onClick={handleVideoUrlSave} disabled={!videoUrlInput.trim()} className="px-3 py-2 rounded-xl bg-amber-500 text-white text-sm font-medium disabled:opacity-50">OK</button>
                                        <button onClick={() => { setShowVideoUrlInput(false); setVideoUrlInput(''); }} className="px-2 py-2 rounded-xl border border-gray-200 text-sm text-gray-500"><X className="w-4 h-4" /></button>
                                    </div>
                                ) : (
                                    <button onClick={() => setShowVideoUrlInput(true)} className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-dashed border-gray-200 text-sm text-gray-500 hover:border-gray-400 bg-gray-50 transition-all">
                                        <span>🔗</span>Pegar link de YouTube / TikTok
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {error && <p className="text-xs text-red-500 text-center">{error}</p>}

                    {/* Generar placa para Marketplace */}
                    <button
                        onClick={onGeneratePlaca}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-all"
                    >
                        🪧 Generar placa para Marketplace
                    </button>

                    {/* Eliminar datos de tienda */}
                    {(item.storeImages?.length || item.storeVideoUrl || item.description || item.storeTitle || item.storeGroup) ? (
                        <button
                            onClick={onClearAll}
                            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-red-100 text-xs font-medium text-red-500 hover:bg-red-50 transition-all"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            Eliminar datos de tienda (libera espacio)
                        </button>
                    ) : null}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-100 flex gap-2">
                    <button onClick={onClose} className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-all">
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-1 px-4 py-2.5 rounded-xl bg-black text-white text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                    >
                        {saving ? <><Loader2 className="w-4 h-4 animate-spin" />Guardando...</> : `Guardar${images.length > 0 ? ` (${images.length} foto${images.length !== 1 ? 's' : ''})` : ''}${videoUrl ? ' + video' : ''}`}
                    </button>
                </div>
            </div>
        </div>
    );
}

function ImageUploadField({ currentUrl, onUploaded, existingImages = [] }: { currentUrl: string, onUploaded: (url: string) => void, existingImages?: { url: string; name: string }[] }) {
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [urlInput, setUrlInput] = useState('');
    const [showUrlInput, setShowUrlInput] = useState(false);
    const [showGallery, setShowGallery] = useState(false);

    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        setError(null);
        try {
            const publicUrl = await imageService.upload(file);
            onUploaded(publicUrl);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error al subir imagen');
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const handleUrlSave = async () => {
        const trimmed = urlInput.trim();
        if (!trimmed) return;
        setUploading(true);
        setError(null);
        // Save the URL immediately so it persists even if Supabase upload fails
        onUploaded(trimmed);
        try {
            const publicUrl = await imageService.upload(trimmed);
            onUploaded(publicUrl);
        } catch {
            // External URL already saved above — keep it as-is
        } finally {
            setUploading(false);
            setUrlInput('');
            setShowUrlInput(false);
        }
    };

    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Imagen del producto</label>

            {currentUrl ? (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50">
                    <div className="w-14 h-14 rounded-lg border border-gray-200 overflow-hidden shrink-0 bg-white">
                        <img src={currentUrl} alt="Producto" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.src = 'https://placehold.co/100x100?text=Error')} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-500 truncate">{currentUrl.length > 50 ? '...' + currentUrl.slice(-45) : currentUrl}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                        <label className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all ${uploading ? 'bg-blue-100 text-blue-600' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>
                            {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                            Cambiar
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} disabled={uploading} />
                        </label>
                        <button type="button" onClick={() => onUploaded('')}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all" title="Quitar imagen">
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="flex gap-2">
                        <label className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed transition-all cursor-pointer ${uploading ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-gray-50 hover:border-gray-400'}`}>
                            {uploading ? (
                                <><Loader2 className="w-4 h-4 animate-spin text-blue-600" /><span className="text-sm text-blue-600">Subiendo...</span></>
                            ) : (
                                <><Upload className="w-4 h-4 text-gray-400" /><span className="text-sm text-gray-500">Subir foto</span></>
                            )}
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} disabled={uploading} />
                        </label>
                        <button type="button" onClick={() => setShowUrlInput(!showUrlInput)}
                            className={`flex items-center gap-1.5 px-4 py-3 rounded-xl border-2 border-dashed transition-all ${showUrlInput ? 'border-black bg-gray-100' : 'border-gray-200 bg-gray-50 hover:border-gray-400'}`}>
                            <ImageIcon className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-500">Pegar link</span>
                        </button>
                        {existingImages.length > 0 && (
                            <button type="button" onClick={() => { setShowGallery(!showGallery); setShowUrlInput(false); }}
                                className={`flex items-center gap-1.5 px-4 py-3 rounded-xl border-2 border-dashed transition-all ${showGallery ? 'border-black bg-gray-100' : 'border-gray-200 bg-gray-50 hover:border-gray-400'}`}>
                                <Layers className="w-4 h-4 text-gray-400" />
                                <span className="text-sm text-gray-500">Existente</span>
                            </button>
                        )}
                    </div>

                    {showUrlInput && (
                        <div className="flex gap-2">
                            <input
                                type="url"
                                className="flex-1 px-3 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white text-gray-700 text-sm"
                                placeholder="https://... pega el link de la imagen"
                                value={urlInput}
                                onChange={e => setUrlInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleUrlSave(); } }}
                                autoFocus
                            />
                            <button type="button" onClick={handleUrlSave} disabled={!urlInput.trim() || uploading}
                                className="px-3 py-2 rounded-xl bg-black text-white text-sm font-medium disabled:opacity-40 hover:bg-gray-800 transition-all flex items-center gap-1">
                                {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                Guardar
                            </button>
                        </div>
                    )}

                    {showGallery && existingImages.length > 0 && (
                        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 p-2 rounded-xl border border-gray-200 bg-gray-50 max-h-40 overflow-y-auto">
                            {existingImages.map((img, idx) => (
                                <button
                                    key={idx}
                                    type="button"
                                    onClick={() => { onUploaded(img.url); setShowGallery(false); }}
                                    className="group relative aspect-square rounded-lg border-2 border-transparent hover:border-black overflow-hidden bg-white transition-all"
                                    title={img.name}
                                >
                                    <img src={img.url} alt={img.name} className="w-full h-full object-cover" onError={(e) => (e.currentTarget.src = 'https://placehold.co/80x80?text=?')} />
                                    <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <p className="text-[9px] text-white truncate">{img.name}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
        </div>
    );
}

function ComboboxInput({ value, onChange, suggestions, placeholder, className, required }: {
    value: string;
    onChange: (val: string) => void;
    suggestions: string[];
    placeholder?: string;
    className?: string;
    required?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(-1);
    const containerRef = useRef<HTMLDivElement>(null);

    const filtered = value.trim().length === 0
        ? suggestions.slice(0, 8)
        : suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase())).slice(0, 8);

    useEffect(() => {
        setHighlighted(-1);
    }, [value]);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    const select = (val: string) => {
        onChange(val);
        setOpen(false);
    };

    const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!open || filtered.length === 0) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, -1)); }
        else if (e.key === 'Enter' && highlighted >= 0) { e.preventDefault(); select(filtered[highlighted]); }
        else if (e.key === 'Escape') setOpen(false);
    };

    return (
        <div ref={containerRef} className="relative">
            <input
                type="text"
                required={required}
                placeholder={placeholder}
                value={value}
                autoComplete="off"
                className={className}
                onFocus={() => setOpen(true)}
                onKeyDown={handleKey}
                onChange={e => { onChange(e.target.value); setOpen(true); }}
            />
            {open && filtered.length > 0 && (
                <ul className="absolute z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                    {filtered.map((s, i) => (
                        <li
                            key={s}
                            onMouseDown={() => select(s)}
                            className={`px-4 py-2.5 text-sm cursor-pointer ${i === highlighted ? 'bg-blue-50 text-blue-700' : 'text-gray-700 hover:bg-gray-50'}`}
                        >
                            {s}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function ProductForm({ 
    formData, 
    setFormData, 
    onSubmit, 
    onCancel, 
    isEditing, 
    editingItemStatus, 
    suggestedNames = [], 
    locations = [],
    onOpenLocationsModal,
    batchCodes = [], 
    existingImages = [], 
    isSaving = false 
}: {
    formData: Partial<Item>,
    setFormData: React.Dispatch<React.SetStateAction<Partial<Item>>>,
    onSubmit: (e: React.FormEvent) => void,
    onCancel: () => void,
    isEditing: boolean,
    editingItemStatus?: ItemStatus,
    suggestedNames?: string[],
    locations?: LocationItem[],
    onOpenLocationsModal?: () => void,
    batchCodes?: string[],
    existingImages?: { url: string; name: string }[],
    isSaving?: boolean
}) {

    const [purchasePriceInput, setPurchasePriceInput] = useState('');
    const [salePriceInput, setSalePriceInput] = useState('');
    const [quantityInput, setQuantityInput] = useState('1');

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
        setPurchasePriceInput(formatMoney(formData.purchasePrice));
    }, [formData.purchasePrice]);

    useEffect(() => {
        setSalePriceInput(formatMoney(formData.salePrice));
    }, [formData.salePrice]);

    // Cantidad: guardamos el texto tal cual para poder borrar el campo y reescribirlo
    // (antes un `|| 1` lo devolvía a 1 y no se podía pasar de 1 a 2 sin quedar en 12).
    useEffect(() => {
        setQuantityInput(formData.quantity && formData.quantity > 0 ? String(Math.floor(formData.quantity)) : '');
    }, [formData.quantity]);

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
                    className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-wider rounded-md transition-all ${formData.status === 'in_stock' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
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



            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del Producto</label>
                <ComboboxInput
                    required
                    value={formData.productName || ''}
                    onChange={val => setFormData({ ...formData, productName: val })}
                    suggestions={suggestedNames}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white"
                />
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
                        type="text"
                        inputMode="numeric"
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white"
                        placeholder="Ej: 1"
                        value={quantityInput}
                        onChange={e => {
                            const digits = e.target.value.replace(/[^\d]/g, '');
                            setQuantityInput(digits);
                            setFormData({ ...formData, quantity: digits ? Number(digits) : 0 });
                        }}
                        onBlur={() => {
                            if (!quantityInput) {
                                setQuantityInput('1');
                                setFormData({ ...formData, quantity: 1 });
                            }
                        }}
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
                    <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium text-gray-700">Ubicación</label>
                        {onOpenLocationsModal && (
                            <button
                                type="button"
                                onClick={onOpenLocationsModal}
                                className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1"
                            >
                                <MapPin className="w-3 h-3" />
                                Gestionar
                            </button>
                        )}
                    </div>
                    <div className="flex gap-1.5">
                        <select
                            className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white text-gray-700 font-medium"
                            value={formData.location || ''}
                            onChange={e => setFormData({ ...formData, location: e.target.value })}
                        >
                            <option value="">Seleccionar ubicación...</option>
                            {locations.map(loc => (
                                <option key={loc.id} value={loc.name}>
                                    📍 {loc.name} {loc.isDefault ? '(Predeterminada)' : ''}
                                </option>
                            ))}
                            {formData.location && !locations.some(l => l.name === formData.location) && (
                                <option value={formData.location}>
                                    📍 {formData.location} (Ubicación actual)
                                </option>
                            )}
                        </select>
                        {onOpenLocationsModal && (
                            <button
                                type="button"
                                onClick={onOpenLocationsModal}
                                className="p-2 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-600 transition-colors shrink-0"
                                title="Agregar o editar ubicaciones"
                            >
                                <Plus className="w-4 h-4 text-blue-600" />
                            </button>
                        )}
                    </div>
                    <p className="text-[11px] text-emerald-600 font-medium mt-1 flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />
                        Contacto de WhatsApp: <span className="font-mono">{STORE_CONFIG.whatsappUser}</span>
                    </p>
                </div>
            </div>

            {formData.status === 'sold' && (
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Vendedor (opcional)</label>
                    <input
                        type="text"
                        placeholder="Ej: María, Juan — dejar vacío si cobraste vos"
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-black focus:ring-1 focus:ring-black outline-none transition-all bg-gray-50 focus:bg-white text-gray-700"
                        value={formData.vendedor || ''}
                        onChange={e => {
                            const vendedor = e.target.value;
                            setFormData({ ...formData, vendedor: vendedor || undefined, cobrado: vendedor ? false : true });
                        }}
                    />
                    <p className="text-xs text-gray-400 mt-1">Si indicás un vendedor, la venta queda como "cobro pendiente"</p>
                </div>
            )}

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

            <ImageUploadField
                currentUrl={formData.imageUrl || ''}
                onUploaded={(url) => setFormData({ ...formData, imageUrl: url })}
                existingImages={existingImages}
            />

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
                    disabled={isSaving}
                    className={`flex-1 px-4 py-3 rounded-xl text-white font-medium shadow-lg transition-all transform active:scale-95 flex justify-center items-center gap-2 disabled:opacity-60 disabled:pointer-events-none ${formData.status === 'sold' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200' : 'bg-black hover:bg-gray-800 shadow-gray-200'}`}
                >
                    {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {isSaving ? 'Guardando...' : getSubmitLabel()}
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
        const confirmTotal = confirm(`¿Confirmar DEVOLUCIÓN TOTAL de "${pricingItem.productName}" (${qtyToReturn} unidades)?\n\nSe descontarán de la tanda y del inventario.\nReembolso estimado: ${money((qtyToReturn * estimatedUnitCost))}`);
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
                        location: batchDefaultLocation || existingStock.location,
                        ...inheritStoreFields(existingStock, findStoreDonor(inventoryItems, item.productName, item.condition, existingStock.id))
                    });
                    setItemBatchMap((prev) => ({ ...prev, [existingStock.id]: batchCode }));
                } else {
                    const newStock = {
                        productName: item.productName,
                        purchasePrice: adjustedUnitCost,
                        salePrice: item.unitSalePrice,
                        quantity: item.quantity,
                        date: nowIso,
                        status: 'in_stock' as ItemStatus,
                        condition: item.condition,
                        itemType: 'resale' as ItemType,
                        batchRef: batchCode,
                        location: batchDefaultLocation,
                        category: item.category
                    };
                    // Producto que ya se vendió antes: recupera fotos, video, descripción y publicación
                    const created = await itemService.createItem({
                        ...newStock,
                        ...inheritStoreFields(newStock, findStoreDonor(inventoryItems, item.productName, item.condition))
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
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                    <div className="col-span-2 md:col-span-1">
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
                        <p className="font-semibold text-gray-900">{money(listedSubtotal)}</p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2">
                        <p className="text-xs text-gray-500">Factor de ajuste</p>
                        <p className="font-semibold text-gray-900">{allocationFactor.toLocaleString('es-AR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}x</p>
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
                            <div className="flex flex-col sm:flex-row gap-2">
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
                                    className="flex-1 min-w-0 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                                />
                                <div className="flex shrink-0 rounded-xl border border-gray-200 overflow-hidden text-xs font-medium">
                                    <button
                                        type="button"
                                        onClick={() => setCreditMode('already_applied')}
                                        className={`flex-1 sm:flex-none whitespace-nowrap px-3 py-2 transition-colors ${creditMode === 'already_applied' ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                                        title="El crédito ya fue descontado por Temu en el total pagado"
                                    >
                                        Ya aplicado
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setCreditMode('manual')}
                                        className={`flex-1 sm:flex-none whitespace-nowrap px-3 py-2 transition-colors ${creditMode === 'manual' ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                                        title="El crédito lo pagaste vos, se suma al total invertido"
                                    >
                                        Lo pagué yo
                                    </button>
                                </div>
                            </div>
                            {creditMode === 'manual' && creditAmount > 0 && (
                                <p className="text-xs text-blue-600 mt-1">
                                    Costo efectivo: {money(Math.round(effectiveTotalPaid))} ({money(Math.round(totalPaid))} + {money(Math.round(creditAmount))} de crédito propio)
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
                <div className="grid grid-cols-2 md:grid-cols-7 gap-2.5 sm:gap-3">
                    <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Nombre del producto"
                        aria-label="Nombre del producto"
                        className="col-span-2 min-w-0 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                    />
                    <input
                        type="text"
                        list="category-suggestions"
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        placeholder="Categoría"
                        aria-label="Categoría"
                        className="col-span-2 md:col-span-1 min-w-0 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
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
                        aria-label="Cantidad"
                        title="Cantidad"
                        className="min-w-0 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
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
                        aria-label="Precio de lista por unidad"
                        className="min-w-0 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
                    />
                    <select
                        value={newDisposition}
                        onChange={(e) => setNewDisposition(e.target.value as 'sell' | 'keep')}
                        aria-label="Destino del producto"
                        className="min-w-0 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none"
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
                        aria-label="Precio de venta por unidad"
                        className="min-w-0 px-4 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:bg-white outline-none disabled:opacity-50"
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
                                                                            <span>Vendidos: {p.historyMatch.totalSold} u. a ~{money(p.historyMatch.avgSalePrice)}</span>
                                                                        )}
                                                                        {p.historyMatch.lastSalePrice > 0 && (
                                                                            <span className="text-green-600 font-medium">Últ. venta: {money(p.historyMatch.lastSalePrice)}</span>
                                                                        )}
                                                                        {p.historyMatch.inStock > 0 && (
                                                                            <span className="text-blue-600 font-medium">{p.historyMatch.inStock} en stock</span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </td>
                                                            <td className="px-3 py-2 text-center">{p.cantidad}</td>
                                                            <td className="px-3 py-2 text-right">{money(p.precio_unit_final)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="grid grid-cols-3 gap-3 text-sm">
                                            <div className="bg-gray-50 rounded-xl px-3 py-2">
                                                <p className="text-xs text-gray-500">Total del JSON</p>
                                                <p className="font-semibold">{money(importPreview.total_pagado)}</p>
                                            </div>
                                            <div className="bg-gray-50 rounded-xl px-3 py-2">
                                                <p className="text-xs text-gray-500">Crédito</p>
                                                <p className="font-semibold">{importPreview.credito > 0 ? `${money(importPreview.credito)}` : 'No aplica'}</p>
                                            </div>
                                            <div className="bg-gray-50 rounded-xl px-3 py-2">
                                                <p className="text-xs text-gray-500">Cargo importación</p>
                                                <p className="font-semibold">{importPreview.cargo_importacion > 0 ? `${money(importPreview.cargo_importacion)}` : 'No aplica'}</p>
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
                                                        ? `Costo efectivo: ${money(importPreview.total_pagado)} (el crédito ya fue restado por Temu)`
                                                        : `Costo efectivo: ${money((importPreview.total_pagado + importPreview.credito))} (${money(importPreview.total_pagado)} + ${money(importPreview.credito)} de crédito pagado por vos)`
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

            {normalizedItems.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-sm border border-dashed border-gray-200 px-4 py-8 text-center">
                    <p className="text-sm font-medium text-gray-600">Todavía no hay productos en este pedido</p>
                    <p className="text-xs text-gray-400 mt-1">Agregalos con el formulario de arriba o con "Importar JSON".</p>
                </div>
            ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
                <table className="w-full min-w-[920px] text-sm text-gray-700">
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
                                    <td className="px-4 py-3 text-right">{money(Math.round(item.listedUnitPrice))}</td>
                                    <td className="px-4 py-3 text-right">
                                        <span className="font-semibold">{money(Math.round(adjustedUnitCost))}</span>
                                        {importCharges > 0 && (
                                            <div className="text-xs text-gray-400 leading-tight mt-0.5">
                                                <span>Base: {money(Math.round(baseCostUnit))}</span>
                                                <span className="mx-1">·</span>
                                                <span className="text-amber-600">Import: {money(Math.round(importShareUnit))}</span>
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
                                        {item.disposition === 'keep' ? '-' : (Number.isFinite(marginPercent) ? percent(marginPercent) : '0%')}
                                    </td>
                                    <td className={`px-4 py-3 text-right font-semibold ${totalProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {item.disposition === 'keep'
                                            ? `Retenido: ${money(Math.round(adjustedUnitCost * item.quantity))}`
                                            : `${money(Math.round(totalProfit))}`}
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
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="col-span-2 sm:col-span-1 bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-xs text-gray-500">Total invertido</p>
                    <p className="text-base sm:text-lg tabular-nums font-bold text-gray-900">{money(Math.round(effectiveTotalPaid))}</p>
                    {importCharges > 0 && (
                        <div className="text-xs text-gray-400 mt-1 space-y-0.5">
                            <div>Productos: {money(Math.round(effectiveTotalPaid - importCharges))}</div>
                            <div className="text-amber-600">Importación: {money(Math.round(importCharges))}</div>
                        </div>
                    )}
                    {creditMode === 'manual' && creditAmount > 0 && (
                        <p className="text-xs text-blue-500 mt-1">Crédito propio descontado: −{money(Math.round(creditAmount))}</p>
                    )}
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-xs text-gray-500">Costo a recuperar con ventas</p>
                    <p className="text-base sm:text-lg tabular-nums font-bold text-gray-900">{money(Math.round(effectiveCostToRecover))}</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-xs text-gray-500">Ganancia monetaria esperada</p>
                    <p className={`text-base sm:text-lg tabular-nums font-bold ${expectedProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {money(Math.round(expectedProfit))}
                    </p>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-xs text-gray-500">Valor de productos que te quedas</p>
                    <p className="text-base sm:text-lg tabular-nums font-bold text-blue-700">{money(Math.round(retainedValue))}</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-4">
                    <p className="text-xs text-gray-500">Resultado económico total (cash + retenido)</p>
                    <p className={`text-base sm:text-lg tabular-nums font-bold ${totalEconomicValue >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {money(Math.round(totalEconomicValue))}
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
                                            <span className="text-xs text-gray-400">{new Date(record.createdAt).toLocaleDateString('es-AR')} · {record.itemsCount} {record.itemsCount === 1 ? 'producto' : 'productos'}</span>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-0.5">Invertido: {money(safeMoney(record.totalPaid))} · Venta esperada: {money(safeMoney(record.totalSellRevenue))}{safeMoney(record.retainedValue) > 0 ? ` · Retenido: ${money(safeMoney(record.retainedValue))}` : ''}</p>
                                    </div>
                                </button>
                                <div className="flex items-center justify-between sm:justify-end gap-3 flex-wrap">
                                    <div className="flex flex-col items-start sm:items-end gap-0.5 tabular-nums">
                                        <p className={`font-bold whitespace-nowrap ${record.cashProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            Est: {money(safeMoney(record.cashProfit))}
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
                                                <p className={`text-xs font-bold whitespace-nowrap ${actualProfit >= record.cashProfit ? 'text-emerald-500' : 'text-amber-500'}`}>
                                                    Real: {money(Math.round(actualProfit))}
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
                                                        {(() => { const wItems = actual.matches.filter((m: Item) => m.withdrawalReason); return wItems.map((m: Item) => { const w = withdrawalLabels[m.withdrawalReason!]; return w ? <span key={m.id} className={`ml-1.5 text-[10px] font-bold ${w.color}`}>{w.label}</span> : null; }); })()}
                                                    </td>
                                                    <td className="px-3 py-2 text-center">{item.quantity}</td>
                                                    <td className="px-3 py-2 text-right text-gray-600">{money(safeMoney(unitCost))}</td>
                                                    <td className="px-3 py-2 text-right font-medium">{money(safeMoney(totalCost))}</td>
                                                    <td className="px-3 py-2 text-right text-gray-500">
                                                        {item.disposition === 'sell' ? `${money(safeMoney(expectedRevenue))}` : '—'}
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
                                                            <span className="font-semibold text-emerald-700">{money(safeMoney(actual.totalSoldRevenue))}</span>
                                                        ) : (
                                                            <span className="text-gray-400">—</span>
                                                        )}
                                                        {actual.totalSoldQty > 0 && actual.avgSalePrice > 0 && (
                                                            <span className="block text-[10px] text-gray-400">prom: {money(safeMoney(actual.avgSalePrice))}/u</span>
                                                        )}
                                                    </td>
                                                    <td className={`px-3 py-2 text-right font-bold ${actual.totalSoldQty > 0 ? (realProfit >= 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-gray-300'}`}>
                                                        {actual.totalSoldQty > 0 ? `${money(safeMoney(realProfit))}` : '—'}
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
                                                    <td className="px-3 py-2.5 text-right text-gray-900">{money(safeMoney(grandTotalCost))}</td>
                                                    <td className="px-3 py-2.5 text-right text-gray-500">{money(safeMoney(grandTotalExpectedRevenue))}</td>
                                                    <td className="px-3 py-2.5 text-center text-emerald-600">
                                                        {rows.reduce((a, r) => a + r.actual.totalSoldQty, 0)} / {selectedRecordItems.reduce((a, i) => a + i.quantity, 0)}
                                                    </td>
                                                    <td className="px-3 py-2.5 text-right text-emerald-700">{money(safeMoney(grandTotalRevenue))}</td>
                                                    <td className={`px-3 py-2.5 text-right font-bold ${grandTotalProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                        {money(safeMoney(grandTotalProfit))}
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

/* Tooltip propio para los botones que quedan solo-icono en pantallas angostas.
   El atributo `title` no se puede estilar y no aparece al navegar con teclado,
   así que esto se muestra en hover Y en focus-within.
   Se abre hacia la IZQUIERDA y centrado en la fila a propósito: la tabla vive
   dentro de un `overflow-x-auto`, que recortaría un tooltip que salga hacia arriba.
   Ojo con los colores: `index.css` pisa `.bg-gray-100` y `.text-gray-900` en modo
   oscuro con `!important`, así que acá se usan tonos fuera de esa lista. */
function Hint({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <span className="relative inline-flex group/hint">
            {children}
            <span
                role="tooltip"
                className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-2 z-30 whitespace-nowrap rounded-lg bg-gray-900 px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover/hint:opacity-100 group-focus-within/hint:opacity-100 dark:bg-slate-200 dark:text-slate-900"
            >
                {label}
            </span>
        </span>
    );
}

function MetricCard({ title, value, icon, trend, trendColor, bgColor }: { title: string, value: string, icon: React.ReactNode, trend?: string, trendColor?: string, bgColor: string }) {
    const getBadgeStyle = () => {
        if (!trendColor) return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
        if (trendColor.includes('emerald') || trendColor.includes('green')) {
            return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-200/50 dark:border-emerald-800/40';
        }
        if (trendColor.includes('violet') || trendColor.includes('purple')) {
            return 'bg-violet-100 text-violet-700 dark:bg-violet-950/70 dark:text-violet-300 border border-violet-200/50 dark:border-violet-800/40';
        }
        if (trendColor.includes('blue')) {
            return 'bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/40';
        }
        if (trendColor.includes('amber') || trendColor.includes('orange')) {
            return 'bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/40';
        }
        if (trendColor.includes('red') || trendColor.includes('rose')) {
            return 'bg-red-100 text-red-700 dark:bg-red-950/70 dark:text-red-300 border border-red-200/50 dark:border-red-800/40';
        }
        return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    };

    return (
        <div className={`${bgColor} p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md`}>
            <div className="flex justify-between items-start mb-3 sm:mb-4 gap-2">
                <div className="p-2.5 sm:p-3 bg-gray-50 rounded-xl">
                    {icon}
                </div>
                {trend && (
                    <span className={`text-[10px] sm:text-xs font-semibold px-2 sm:px-2.5 py-1 rounded-lg whitespace-nowrap ${getBadgeStyle()}`}>
                        {trend}
                    </span>
                )}
            </div>
            <div>
                <p className="text-gray-500 text-xs sm:text-sm font-medium mb-1">{title}</p>
                <h3 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight leading-tight tabular-nums break-words">{value}</h3>
            </div>
        </div>
    );
}

/* Los colores de recharts van como props, no como clases de Tailwind, así que el
   modo oscuro se resuelve con la prop `dark` en vez de con variantes `dark:`. */
function ProfitChart({ items, dark = false }: { items: Item[]; dark?: boolean }) {
    // Group by Date 
    const dataMap = new Map<string, number>();

    // Sort items by date first
    // Use saleDate for profit charting, or generic date if saleDate missing (fallback)
    const sortedItems = [...items].sort((a, b) => new Date(a.saleDate || a.date).getTime() - new Date(b.saleDate || b.date).getTime());

    // Se agrupa por día completo (con año): agrupando solo por "día y mes", dos
    // ventas del mismo día de años distintos se sumaban en un mismo punto.
    const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const years = new Set<number>();
    sortedItems.forEach(item => {
        const d = new Date(item.saleDate || item.date);
        if (isNaN(d.getTime())) return;
        years.add(d.getFullYear());
        const profit = ((item.salePrice || 0) - item.purchasePrice) * item.quantity;
        dataMap.set(dayKey(d), (dataMap.get(dayKey(d)) || 0) + profit);
    });

    const multiYear = years.size > 1;
    const data = Array.from(dataMap.entries()).map(([key, profit]) => {
        const [y, m, d] = key.split('-').map(Number);
        const date = new Date(y, m - 1, d).toLocaleDateString('es-AR', multiYear
            ? { day: '2-digit', month: 'short', year: '2-digit' }
            : { day: '2-digit', month: 'short' }).replace(/-/g, ' ');
        return { date, profit: Math.round(profit) };
    });

    if (data.length === 0) {
        return <div className="h-full w-full flex items-center justify-center text-gray-400">Sin datos suficientes para graficar</div>;
    }

    const tickColor = dark ? '#70839d' : '#9ca3af';
    const gridColor = dark ? '#2b3649' : '#f3f4f6';

    return (
        <ResponsiveContainer width="100%" height="100%">
            <AreaChart
                data={data}
                margin={{
                    top: 10,
                    right: 12,
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
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: tickColor, fontSize: 12 }}
                    minTickGap={24}
                    interval="preserveStartEnd"
                    dy={10}
                />
                <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: tickColor, fontSize: 12 }}
                    width={52}
                    tickFormatter={moneyCompact}
                />
                <Tooltip
                    contentStyle={{
                        borderRadius: '12px',
                        border: 'none',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        backgroundColor: dark ? '#1f2937' : '#ffffff',
                        color: dark ? '#f8fafc' : '#111827',
                    }}
                    labelStyle={{ color: dark ? '#9fb0c7' : '#6b7280' }}
                    formatter={(value) => [money(Number(value)), 'Ganancia'] as [string, string]}
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
