export type ItemStatus = 'in_stock' | 'sold';
export type ItemCondition = 'nuevo' | 'semi_uso' | 'usado';
export type ItemType = 'resale' | 'personal';
export type WithdrawalReason = 'regalo' | 'uso_personal' | 'perdida';

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
    itemType: ItemType;
    batchRef?: string;
    location?: string;
    estimatedSalePrice?: number;
    publishUrls?: string;
    imageUrl?: string;
    category?: string;
    facturado?: boolean;
    noFacturar?: boolean;
    withdrawalReason?: WithdrawalReason;
    envioAplica?: boolean;
    envioCosto?: number;
    envioMetodo?: string;
    cobrado?: boolean;
    vendedor?: string;
    formasPago?: string[];
    montoEfectivo?: number;
    montoTransferencia?: number;
    montoTarjeta?: number;
    montoMercadoPago?: number;
    montoOtro?: number;
}

// Deprecated but kept for temporary compatibility if needed during migration, 
// though we will migrate state immediately.
export interface Sale extends Item { }
