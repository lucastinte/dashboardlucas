import { supabase } from '../lib/supabase';
import type { LocationItem, Item } from '../types';
import { normalizePhone } from '../config/storeConfig';

const LOCAL_STORAGE_KEY = 'dashboard_locations';

// Clave para comparar nombres: sin mayúsculas ni espacios de más.
// La columna `name` de la tabla es unique pero case-sensitive, así que
// "Abra Pampa" y "abra pampa" pueden existir como filas distintas.
const normalizeLocName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

// Cuál de dos registros homónimos conviene conservar
const isRichest = (a: LocationItem, b: LocationItem) => {
    const score = (l: LocationItem) =>
        (l.isDefault ? 4 : 0) +
        (l.address ? 1 : 0) +
        (l.phone ? 1 : 0);
    return score(a) >= score(b);
};

// Une los duplicados que sólo difieren en mayúsculas/espacios, completando
// los campos que falten con los del otro registro.
const dedupeLocations = (locs: LocationItem[]): LocationItem[] => {
    const byKey = new Map<string, LocationItem>();

    for (const loc of locs) {
        const key = normalizeLocName(loc.name);
        const prev = byKey.get(key);

        if (!prev) {
            byKey.set(key, { ...loc });
            continue;
        }

        const keep = isRichest(prev, loc) ? prev : loc;
        const other = keep === prev ? loc : prev;

        byKey.set(key, {
            ...keep,
            phone: keep.phone || other.phone,
            address: keep.address || other.address,
            isDefault: keep.isDefault || other.isDefault,
            createdAt: keep.createdAt || other.createdAt,
        });
    }

    return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
};

// Helper to map DB columns (snake_case) to application model (camelCase)
// La columna `whatsapp` de Supabase quedó sin uso: el contacto de WhatsApp es
// uno solo para todo el negocio (STORE_CONFIG.whatsappUser), no por ubicación.
const mapFromDb = (row: any): LocationItem => ({
    id: row.id,
    name: row.name,
    phone: normalizePhone(row.phone) || undefined,
    address: row.address || undefined,
    isDefault: row.is_default === true,
    createdAt: row.created_at || undefined,
});

// Helper to map model to DB columns
const mapToDb = (loc: Partial<LocationItem>) => {
    const row: any = {};
    if (loc.id) row.id = loc.id;
    if (loc.name !== undefined) row.name = loc.name.trim();
    if (loc.phone !== undefined) row.phone = loc.phone ? loc.phone.trim() : null;
    if (loc.address !== undefined) row.address = loc.address ? loc.address.trim() : null;
    if (loc.isDefault !== undefined) row.is_default = loc.isDefault;
    return row;
};

const getLocalLocations = (): LocationItem[] => {
    try {
        const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.map(loc => ({
                    id: loc.id,
                    name: loc.name,
                    phone: normalizePhone(loc.phone) || undefined,
                    address: loc.address || undefined,
                    isDefault: loc.isDefault === true,
                    createdAt: loc.createdAt,
                }));
            }
        }
    } catch (e) {
        console.warn('Error reading locations from localStorage', e);
    }
    return [];
};

const setLocalLocations = (locations: LocationItem[]) => {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(locations));
    } catch (e) {
        console.warn('Error saving locations to localStorage', e);
    }
};

export const locationService = {
    async getLocations(itemsFallback: Item[] = []): Promise<LocationItem[]> {
        let dbLocations: LocationItem[] = [];
        let fetchedFromDb = false;

        try {
            const { data, error } = await supabase
                .from('locations')
                .select('*')
                .order('name', { ascending: true });

            if (!error && Array.isArray(data)) {
                dbLocations = dedupeLocations(data.map(mapFromDb));
                fetchedFromDb = true;
                setLocalLocations(dbLocations);
            }
        } catch (err) {
            console.warn('Supabase locations table not ready or offline, using local cache', err);
        }

        if (fetchedFromDb && dbLocations.length > 0) {
            return dbLocations;
        }

        // Fallback to local storage
        const local = getLocalLocations();
        if (local.length > 0) {
            return dedupeLocations(local);
        }

        // If completely empty, extract from existing items or provide initial defaults
        const existingNames = Array.from(
            new Map(
                itemsFallback
                    .map(i => (i.location || '').trim())
                    .filter(loc => loc.length > 0)
                    .map(loc => [normalizeLocName(loc), loc] as const)
            ).values()
        );

        const initialList: LocationItem[] = [];
        const baseNames = existingNames.length > 0 ? existingNames : ['Abra Pampa', 'Jujuy'];

        baseNames.forEach((name, idx) => {
            initialList.push({
                id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `loc-${Date.now()}-${idx}`,
                name,
                isDefault: idx === 0,
                createdAt: new Date().toISOString()
            });
        });

        setLocalLocations(initialList);
        return initialList;
    },

    async saveLocation(locationData: {
        id?: string;
        name: string;
        phone?: string;
        address?: string;
        isDefault?: boolean;
    }): Promise<LocationItem> {
        const id = locationData.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `loc-${Date.now()}`);
        const newItem: LocationItem = {
            id,
            name: locationData.name.trim(),
            phone: normalizePhone(locationData.phone) || undefined,
            address: locationData.address?.trim() || undefined,
            isDefault: locationData.isDefault || false,
            createdAt: new Date().toISOString()
        };

        // 1. Update local storage immediately
        const current = getLocalLocations();
        const matchLocal = current.find(l => l.id === id || normalizeLocName(l.name) === normalizeLocName(newItem.name));
        const canonicalId = matchLocal?.id || id;
        const canonicalItem: LocationItem = { ...newItem, id: canonicalId };

        let updated: LocationItem[];
        if (matchLocal) {
            updated = current.map(l =>
                (l.id === canonicalId || normalizeLocName(l.name) === normalizeLocName(canonicalItem.name))
                    ? { ...l, ...canonicalItem, id: l.id }
                    : l
            );
        } else {
            updated = [...current, canonicalItem].sort((a, b) => a.name.localeCompare(b.name, 'es'));
        }

        // If this is set as default, unset others
        if (canonicalItem.isDefault) {
            updated = updated.map(l => ({ ...l, isDefault: l.id === canonicalId }));
        }

        setLocalLocations(updated);

        // 2. Sync to Supabase
        try {
            // Emparejamos por nombre sin distinguir mayúsculas en vez de usar
            // upsert onConflict:'name': la unique de Postgres es case-sensitive,
            // así que ese upsert insertaba una fila nueva cada vez que el nombre
            // cambiaba sólo de mayúsculas ("ari" vs "Ari") y la lista se llenaba
            // de duplicados con el mismo WhatsApp.
            const { data: rows } = await supabase.from('locations').select('*');
            const existing = Array.isArray(rows)
                ? rows.find(r => normalizeLocName(String(r.name || '')) === normalizeLocName(canonicalItem.name))
                : undefined;
            const targetId = existing?.id || canonicalId;

            const { data, error } = await supabase
                .from('locations')
                .upsert(mapToDb({ ...canonicalItem, id: targetId }), { onConflict: 'id' })
                .select()
                .single();

            if (!error && data) {
                if (canonicalItem.isDefault) {
                    await supabase.from('locations').update({ is_default: false }).neq('id', targetId);
                }
                return mapFromDb(data);
            }
            if (error) {
                console.warn('Could not sync location to Supabase', error.message);
            }
        } catch (e) {
            console.warn('Could not sync location to Supabase', e);
        }

        return canonicalItem;
    },

    async deleteLocation(id: string): Promise<void> {
        // 1. Remove from local storage
        const current = getLocalLocations();
        const updated = current.filter(l => l.id !== id);
        setLocalLocations(updated);

        // 2. Remove from Supabase
        try {
            await supabase.from('locations').delete().eq('id', id);
        } catch (e) {
            console.warn('Could not delete location from Supabase', e);
        }
    },
};
