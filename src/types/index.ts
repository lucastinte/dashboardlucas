export type ItemStatus = 'in_stock' | 'sold';
export type ItemCondition = 'nuevo' | 'semi_uso' | 'usado';

export interface Item {
    id: string;
    productName: string;
    purchasePrice: number;
    salePrice?: number; // Optional, only exists if sold or target price
    quantity: number;
    date: string; // Purchase date or Creation date
    saleDate?: string; // Only if sold
    status: ItemStatus;
    condition: ItemCondition;
    batchRef?: string;
}

// Deprecated but kept for temporary compatibility if needed during migration, 
// though we will migrate state immediately.
export interface Sale extends Item { }
