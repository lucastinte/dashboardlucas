import { supabase } from '../lib/supabase';
import type { LocationItem, Item } from '../types';
import { STORE_CONFIG } from '../config/storeConfig';

const LOCAL_STORAGE_KEY = 'dashboard_locations';

// Helper to map DB columns (snake_case) to application model (camelCase)
const mapFromDb = (row: any): LocationItem => ({
    id: row.id,
    name: row.name,
    whatsapp: row.whatsapp || undefined,
    phone: row.phone || undefined,
    address: row.address || undefined,
    isDefault: row.is_default === true,
    createdAt: row.created_at || undefined,
});

// Helper to map model to DB columns
const mapToDb = (loc: Partial<LocationItem>) => {
    const row: any = {};
    if (loc.id) row.id = loc.id;
    if (loc.name !== undefined) row.name = loc.name.trim();
    if (loc.whatsapp !== undefined) row.whatsapp = loc.whatsapp ? loc.whatsapp.trim() : null;
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
            if (Array.isArray(parsed)) return parsed;
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
                dbLocations = data.map(mapFromDb);
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
            return local;
        }

        // If completely empty, extract from existing items or provide initial defaults
        const existingNames = Array.from(
            new Set(
                itemsFallback
                    .map(i => (i.location || '').trim())
                    .filter(loc => loc.length > 0)
            )
        );

        const initialList: LocationItem[] = [];
        const baseNames = existingNames.length > 0 ? existingNames : ['Abra Pampa', 'Jujuy'];

        baseNames.forEach((name, idx) => {
            initialList.push({
                id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `loc-${Date.now()}-${idx}`,
                name,
                whatsapp: STORE_CONFIG.defaultWhatsApp,
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
        whatsapp?: string;
        phone?: string;
        address?: string;
        isDefault?: boolean;
    }): Promise<LocationItem> {
        const id = locationData.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `loc-${Date.now()}`);
        const newItem: LocationItem = {
            id,
            name: locationData.name.trim(),
            whatsapp: locationData.whatsapp?.trim() || undefined,
            phone: locationData.phone?.trim() || undefined,
            address: locationData.address?.trim() || undefined,
            isDefault: locationData.isDefault || false,
            createdAt: new Date().toISOString()
        };

        // 1. Update local storage immediately
        const current = getLocalLocations();
        let updated: LocationItem[];
        if (current.some(l => l.id === id || l.name.toLowerCase() === newItem.name.toLowerCase())) {
            updated = current.map(l => (l.id === id || l.name.toLowerCase() === newItem.name.toLowerCase()) ? { ...l, ...newItem, id: l.id } : l);
        } else {
            updated = [...current, newItem].sort((a, b) => a.name.localeCompare(b.name));
        }

        // If this is set as default, unset others
        if (newItem.isDefault) {
            updated = updated.map(l => ({ ...l, isDefault: l.id === id }));
        }

        setLocalLocations(updated);

        // 2. Sync to Supabase
        try {
            const dbPayload = mapToDb(newItem);
            const { data, error } = await supabase
                .from('locations')
                .upsert(dbPayload, { onConflict: 'name' })
                .select()
                .single();

            if (!error && data) {
                return mapFromDb(data);
            }
        } catch (e) {
            console.warn('Could not sync location to Supabase', e);
        }

        return newItem;
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

    getWhatsAppForLocation(locations: LocationItem[], locationName?: string): string {
        if (!locationName) return STORE_CONFIG.defaultWhatsApp;
        const norm = locationName.trim().toLowerCase();
        const found = locations.find(l => l.name.trim().toLowerCase() === norm);
        return found?.whatsapp?.trim() || STORE_CONFIG.defaultWhatsApp;
    }
};
