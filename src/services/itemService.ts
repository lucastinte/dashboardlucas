
import { supabase } from '../lib/supabase';
import type { Item, ItemCondition, ItemStatus } from '../types';

const hasMissingColumn = (error: { message?: string; details?: string; hint?: string } | null, column: string) => {
    if (!error) return false;
    const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
    return combined.includes(column.toLowerCase());
};

const withoutColumns = <T extends Record<string, unknown>>(payload: T, columns: string[]) => {
    const rest = { ...payload };
    for (const col of columns) delete rest[col];
    return rest;
};

// Helper to map DB columns (snake_case) to application model (camelCase)
const mapFromDb = (dbItem: any): Item => ({
    id: dbItem.id,
    productName: dbItem.product_name,
    purchasePrice: Number(dbItem.purchase_price),
    salePrice: dbItem.sale_price ? Number(dbItem.sale_price) : undefined,
    quantity: Number(dbItem.quantity),
    date: dbItem.date || dbItem.created_at, // Use explicit date or fallback
    saleDate: dbItem.sale_date || undefined,
    status: dbItem.status as ItemStatus,
    condition: (dbItem.item_condition || 'nuevo') as ItemCondition,
    batchRef: dbItem.batch_ref || undefined
});

// Helper to map application model to DB columns
const mapToDb = (item: Partial<Item>) => {
    const dbItem: any = {};
    if (item.productName !== undefined) dbItem.product_name = item.productName;
    if (item.purchasePrice !== undefined) dbItem.purchase_price = item.purchasePrice;
    if (item.salePrice !== undefined) dbItem.sale_price = item.salePrice;
    if (item.quantity !== undefined) dbItem.quantity = item.quantity;
    if (item.date !== undefined) dbItem.date = item.date;
    if (item.saleDate !== undefined) dbItem.sale_date = item.saleDate;
    if (item.status !== undefined) dbItem.status = item.status;
    if (item.condition !== undefined) dbItem.item_condition = item.condition;
    if (item.batchRef !== undefined) dbItem.batch_ref = item.batchRef;
    return dbItem;
};

export const itemService = {
    async getItems(): Promise<Item[]> {
        const { data, error } = await supabase
            .from('items')
            .select('*')
            .order('date', { ascending: false });

        if (error) throw error;
        return (data || []).map(mapFromDb);
    },

    async createItems(items: Omit<Item, 'id'>[]): Promise<Item[]> {
        const dbItems = items.map(mapToDb);

        const { data, error } = await supabase
            .from('items')
            .insert(dbItems)
            .select();

        if (error) throw error;
        return (data || []).map(mapFromDb);
    },

    async createItem(item: Omit<Item, 'id'>): Promise<Item> {
        const dbItem = mapToDb(item);

        let { data, error } = await supabase
            .from('items')
            .insert(dbItem)
            .select()
            .single();

        // Backward compatibility: DB may not have newer optional columns yet.
        if (hasMissingColumn(error, 'item_condition') && 'item_condition' in dbItem) {
            ({ data, error } = await supabase
                .from('items')
                .insert(withoutColumns(dbItem, ['item_condition']))
                .select()
                .single());
        }
        if (hasMissingColumn(error, 'batch_ref') && 'batch_ref' in dbItem) {
            ({ data, error } = await supabase
                .from('items')
                .insert(withoutColumns(dbItem, ['batch_ref']))
                .select()
                .single());
        }

        if (error) throw error;
        return mapFromDb(data);
    },

    async updateItem(id: string, updates: Partial<Item>): Promise<Item> {
        const dbUpdates = mapToDb(updates);

        let { data, error } = await supabase
            .from('items')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

        // Backward compatibility: DB may not have newer optional columns yet.
        if (hasMissingColumn(error, 'item_condition') && 'item_condition' in dbUpdates) {
            ({ data, error } = await supabase
                .from('items')
                .update(withoutColumns(dbUpdates, ['item_condition']))
                .eq('id', id)
                .select()
                .single());
        }
        if (hasMissingColumn(error, 'batch_ref') && 'batch_ref' in dbUpdates) {
            ({ data, error } = await supabase
                .from('items')
                .update(withoutColumns(dbUpdates, ['batch_ref']))
                .eq('id', id)
                .select()
                .single());
        }

        if (error) throw error;
        return mapFromDb(data);
    },

    async deleteItem(id: string): Promise<void> {
        const { error } = await supabase
            .from('items')
            .delete()
            .eq('id', id);

        if (error) throw error;
    }
};
