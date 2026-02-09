
import { supabase } from '../lib/supabase';
import type { Item, ItemStatus } from '../types';

// Helper to map DB columns (snake_case) to application model (camelCase)
const mapFromDb = (dbItem: any): Item => ({
    id: dbItem.id,
    productName: dbItem.product_name,
    purchasePrice: Number(dbItem.purchase_price),
    salePrice: dbItem.sale_price ? Number(dbItem.sale_price) : undefined,
    quantity: Number(dbItem.quantity),
    date: dbItem.date || dbItem.created_at, // Use explicit date or fallback
    saleDate: dbItem.sale_date || undefined,
    status: dbItem.status as ItemStatus
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
        // Let Supabase generate ID and created_at if not provided
        const { data, error } = await supabase
            .from('items')
            .insert(dbItem)
            .select()
            .single();

        if (error) throw error;
        return mapFromDb(data);
    },

    async updateItem(id: string, updates: Partial<Item>): Promise<Item> {
        const dbUpdates = mapToDb(updates);
        const { data, error } = await supabase
            .from('items')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

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
