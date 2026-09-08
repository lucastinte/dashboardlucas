import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, Loader2, ExternalLink, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { Item } from '../types';

/**
 * Panel "Stock en Google Sheets" — espejo de una sola vía.
 * Empuja el stock actual (stockItems, ya filtrado en Dashboard) a una hoja de
 * Google vía su Apps Script publicado como Web App (/exec).
 *
 * Env var requerida: VITE_SHEETS_WEBAPP_URL
 */
interface StockSheetsPanelProps {
    stockItems: Item[];
    stockValue: number;
    /** Resuelve la tanda de un item (misma función que usa InventoryTable). */
    resolveBatchRef?: (item: Item) => string;
}

const WEBAPP_URL = (import.meta.env.VITE_SHEETS_WEBAPP_URL as string | undefined)?.trim() || '';

const HEADERS = [
    'Producto',
    'Cantidad',
    'Condición',
    'Ubicación',
    'Precio compra',
    'Precio venta',
    'Categoría',
    'Tanda',
    'En tienda',
    'Fecha',
] as const;

const CONDITION_LABEL: Record<string, string> = {
    nuevo: 'Nuevo',
    semi_uso: 'Semi uso',
    usado: 'Usado',
};

const STORAGE_KEY = 'lucas_stock_sheet';

const fmtDate = (value?: string) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
};

const toNumber = (value: unknown) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

type SyncResult = { url: string; lastSyncAt: string };

const loadStored = (): SyncResult | null => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<SyncResult>;
        if (parsed && typeof parsed.url === 'string') {
            return { url: parsed.url, lastSyncAt: parsed.lastSyncAt || '' };
        }
        return null;
    } catch {
        return null;
    }
};

const persistStored = (result: SyncResult) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
    } catch {
        // localStorage puede no estar disponible; el sync igual funciona.
    }
};

export default function StockSheetsPanel({ stockItems, stockValue, resolveBatchRef }: StockSheetsPanelProps) {
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastSync, setLastSync] = useState<SyncResult | null>(() => loadStored());
    const [syncedRows, setSyncedRows] = useState<number | null>(null);

    const configured = Boolean(WEBAPP_URL);

    useEffect(() => {
        setError(null);
    }, [WEBAPP_URL]);

    const buildRows = useCallback((): (string | number)[][] => {
        return stockItems.map((item) => [
            item.productName || '',
            toNumber(item.quantity) || 1,
            CONDITION_LABEL[item.condition] || 'Nuevo',
            item.location || '',
            toNumber(item.purchasePrice),
            toNumber(item.salePrice ?? item.estimatedSalePrice),
            item.category || '',
            resolveBatchRef ? resolveBatchRef(item) : item.batchRef || '',
            item.publicInStore ? 'Sí' : 'No',
            fmtDate(item.date),
        ]);
    }, [stockItems, resolveBatchRef]);

    const sync = async () => {
        if (!configured || syncing) return;
        setSyncing(true);
        setError(null);
        setSyncedRows(null);
        try {
            const rows = buildRows();
            const payload = { headers: [...HEADERS], items: rows };
            const res = await fetch(WEBAPP_URL, {
                method: 'POST',
                body: JSON.stringify(payload),
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            });

            let data: { ok?: boolean; error?: string; rows?: number; url?: string } | null = null;
            const text = await res.text();
            try {
                data = JSON.parse(text);
            } catch {
                data = null;
            }

            if (!res.ok || !data?.ok) {
                const detail = data?.error || `HTTP ${res.status}`;
                throw new Error(detail || 'La hoja no respondió correctamente.');
            }

            const result: SyncResult = {
                url: data.url || '',
                lastSyncAt: new Date().toISOString(),
            };
            setSyncedRows(data.rows ?? rows.length);
            if (result.url) {
                setLastSync(result);
                persistStored(result);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'No se pudo sincronizar. Revisá la URL del Web App.');
        } finally {
            setSyncing(false);
        }
    };

    const lastSyncLabel = lastSync?.lastSyncAt
        ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(lastSync.lastSyncAt))
        : null;

    const sheetLink = lastSync?.url || '';

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                    <div className="h-11 w-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                        <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base sm:text-lg font-bold text-gray-800">Stock en Google Sheets</h3>
                        <p className="text-gray-500 text-sm">
                            Espejo de tu inventario en una planilla compartida, para verlo y colaborar afuera.
                        </p>
                        <div className="mt-1.5 text-xs font-medium text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            <span className="text-emerald-700 bg-emerald-50 rounded-md px-2 py-0.5">
                                {stockItems.length} producto{stockItems.length === 1 ? '' : 's'}
                            </span>
                            <span className="text-orange-700 bg-orange-50 rounded-md px-2 py-0.5">
                                ${stockValue.toLocaleString()} en stock
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={sync}
                        disabled={!configured || syncing || stockItems.length === 0}
                        className="inline-flex items-center gap-2 bg-black hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl shadow-lg transition-all hover:scale-[1.01] active:scale-95 font-medium text-sm"
                    >
                        {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                        {syncing ? 'Sincronizando…' : 'Sincronizar hoja'}
                    </button>
                    {sheetLink && (
                        <a
                            href={sheetLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 bg-white hover:bg-gray-50 text-emerald-700 border border-emerald-200 px-4 py-2.5 rounded-xl shadow-sm transition-colors font-medium text-sm"
                        >
                            <ExternalLink className="w-4 h-4" />
                            Abrir la hoja
                        </a>
                    )}
                </div>
            </div>

            {/* Estado del sync */}
            {(lastSyncLabel || syncedRows !== null || error) && (
                <div className="mt-4 pt-4 border-t border-gray-100 text-sm space-y-2">
                    {error && (
                        <div className="flex items-start gap-2 text-red-700 bg-red-50 rounded-lg px-3 py-2">
                            <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>No se pudo sincronizar: {error}</span>
                        </div>
                    )}
                    {!error && lastSyncLabel && (
                        <div className="flex items-start gap-2 text-gray-600">
                            <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />
                            <span>
                                {syncedRows !== null && (
                                    <>
                                        <strong className="text-gray-800">{syncedRows} filas</strong>
                                        <span> · </span>
                                    </>
                                )}
                                Última sincronización: {lastSyncLabel}
                            </span>
                        </div>
                    )}
                    {!error && stockItems.length === 0 && (
                        <div className="flex items-start gap-2 text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>No hay productos en stock para exportar.</span>
                        </div>
                    )}
                </div>
            )}

            {/* Sin configurar: instrucciones cortas */}
            {!configured && (
                <div className="mt-4 rounded-xl bg-blue-50 border border-blue-100 p-4 text-sm text-gray-700">
                    <p className="font-semibold text-gray-800 mb-1.5 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-blue-600" />
                        Falta conectar la planilla
                    </p>
                    <ol className="list-decimal list-inside space-y-1 text-gray-600">
                        <li>Creá la hoja en Drive y pegá el código de <code className="bg-white px-1.5 py-0.5 rounded text-xs">GOOGLE_SHEETS_SETUP.md</code> en Extensiones → Apps Script.</li>
                        <li>Implementar → Nueva implementación → Aplicación web (acceso: Cualquier persona) y copiá la URL <code className="bg-white px-1.5 py-0.5 rounded text-xs">/exec</code>.</li>
                        <li>Guardala en <code className="bg-white px-1.5 py-0.5 rounded text-xs">.env</code> como <code className="bg-white px-1.5 py-0.5 rounded text-xs">VITE_SHEETS_WEBAPP_URL=...</code> y reiniciá el dev server.</li>
                    </ol>
                </div>
            )}
        </div>
    );
}
