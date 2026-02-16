
import { supabase } from '../lib/supabase';
import type { Item, ItemCondition, ItemStatus } from '../types';

const isMissingConditionColumnError = (error: { message?: string; details?: string; hint?: string } | null) => {
    if (!error) return false;
    const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();
    return combined.includes('item_condition') || combined.includes('column') && combined.includes('condition');
};

const withoutCondition = <T extends Record<string, unknown>>(payload: T) => {
    const { item_condition, ...rest } = payload;
    void item_condition;
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
    condition: (dbItem.item_condition || 'nuevo') as ItemCondition
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

    async createItem(item: Omit<Item, 'id'>): Promise<Item> {
        const dbItem = mapToDb(item);

        let { data, error } = await supabase
            .from('items')
            .insert(dbItem)
            .select()
            .single();

        // Backward compatibility: DB may not have item_condition yet.
        if (isMissingConditionColumnError(error) && 'item_condition' in dbItem) {
            ({ data, error } = await supabase
                .from('items')
                .insert(withoutCondition(dbItem))
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

        // Backward compatibility: DB may not have item_condition yet.
        if (isMissingConditionColumnError(error) && 'item_condition' in dbUpdates) {
            ({ data, error } = await supabase
                .from('items')
                .update(withoutCondition(dbUpdates))
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
