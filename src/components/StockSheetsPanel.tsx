import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Loader2, ExternalLink, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import type { Item } from '../types';

/**
 * Panel "Stock en Google Sheets" — espejo de una sola vía.
 * Empuja a una hoja de Google (vía su Apps Script /exec) SOLO los productos
 * publicados en tienda, con las columnas que ve un cliente:
 * Producto (título de tienda), Descripción, Precio de venta, Cantidad y Categoría.
 *
 * Env var requerida: VITE_SHEETS_WEBAPP_URL
 */
interface StockSheetsPanelProps {
    stockItems: Item[];
}

const WEBAPP_URL = (import.meta.env.VITE_SHEETS_WEBAPP_URL as string | undefined)?.trim() || '';

const HEADERS = [
    'Producto',
    'Descripción',
    'Precio venta',
    'Cantidad',
    'Categoría',
] as const;

const STORAGE_KEY = 'lucas_stock_sheet';

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

export default function StockSheetsPanel({ stockItems }: StockSheetsPanelProps) {
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastSync, setLastSync] = useState<SyncResult | null>(() => loadStored());
    const [syncedRows, setSyncedRows] = useState<number | null>(null);

    const configured = Boolean(WEBAPP_URL);

    // Solo exporta lo publicado en tienda (lo que ve un cliente).
    const publishedItems = useMemo(() => stockItems.filter((item) => item.publicInStore), [stockItems]);
    const publishedValue = publishedItems.reduce(
        (acc, item) => acc + (item.salePrice ?? item.estimatedSalePrice ?? 0) * (toNumber(item.quantity) || 1),
        0
    );

    useEffect(() => {
        setError(null);
    }, [WEBAPP_URL]);

    const buildRows = useCallback((): (string | number)[][] => {
        return publishedItems.map((item) => [
            item.storeTitle?.trim() || item.productName || '',
            item.description || '',
            toNumber(item.salePrice ?? item.estimatedSalePrice),
            toNumber(item.quantity) || 1,
            item.category || '',
        ]);
    }, [publishedItems]);

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
                            Espejo de lo publicado en tu tienda, con las columnas que ve un cliente. Lista para compartir afuera.
                        </p>
                        <div className="mt-1.5 text-xs font-medium text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            <span className="text-emerald-700 bg-emerald-50 rounded-md px-2 py-0.5">
                                {publishedItems.length} publicado{publishedItems.length === 1 ? '' : 's'} en tienda
                            </span>
                            <span className="text-orange-700 bg-orange-50 rounded-md px-2 py-0.5">
                                ${publishedValue.toLocaleString()} en venta
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={sync}
                        disabled={!configured || syncing || publishedItems.length === 0}
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
                    {!error && publishedItems.length === 0 && (
                        <div className="flex items-start gap-2 text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                            <span>No hay productos publicados en tienda para exportar.</span>
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
