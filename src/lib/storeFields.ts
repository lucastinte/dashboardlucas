import type { Item, ItemCondition } from '../types';

// ── Datos de tienda ────────────────────────────────────────────────────────
// Fotos, video, textos y agrupación que vinculan un producto con la tienda.
// Viven en cada registro de items, así que cualquier flujo que cree un registro
// nuevo (reponer stock, tanda, separar) o borre uno (vender el último, fusionar)
// tiene que traspasarlos explícitamente o se pierden.

export const normalizeText = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

export const hasStoreContent = (i: Partial<Item>) =>
    !!(i.description || i.storeTitle || i.storeVideoUrl || (i.storeImages?.length ?? 0) > 0);

/** Traspaso completo de los datos de tienda de un mismo registro. */
export const pickStoreFields = (i: Partial<Item>): Partial<Item> => ({
    description: i.description,
    storeTitle: i.storeTitle,
    storeGroup: i.storeGroup,
    storeVariantName: i.storeVariantName,
    storeImages: i.storeImages,
    storeVideoUrl: i.storeVideoUrl,
});

/** Último registro del mismo producto (en stock o vendido) que tenga datos de
 *  tienda, para heredarlos al volver a tener stock. Prioriza misma condición,
 *  después lo que está en stock, después lo más reciente. */
export const findStoreDonor = (all: Item[], productName: string, condition?: ItemCondition, excludeId?: string): Item | undefined => {
    const key = normalizeText(productName || '');
    if (!key) return undefined;
    const when = (i: Item) => new Date(i.saleDate || i.date || 0).getTime();
    return all
        .filter(i => i.id !== excludeId && normalizeText(i.productName || '') === key && hasStoreContent(i))
        .sort((a, b) =>
            Number((b.condition || 'nuevo') === condition) - Number((a.condition || 'nuevo') === condition) ||
            Number(b.status === 'in_stock') - Number(a.status === 'in_stock') ||
            when(b) - when(a)
        )[0];
};

/** Completa SOLO los campos de tienda vacíos de `target` con los de `donor`
 *  (no pisa lo que ya tenga).
 *  - El nombre de variante NO se hereda: dos variantes pueden compartir nombre
 *    de producto y la reposición podría quedar con el color/medida equivocado.
 *  - Publicación: si el donante sigue en stock se respeta su estado (pudo
 *    ocultarse a propósito); si es una venta, se publica, porque tenía contenido
 *    de tienda y las ventas no guardan si estaban publicadas. */
export const inheritStoreFields = (target: Partial<Item>, donor?: Partial<Item>): Partial<Item> => {
    if (!donor) return {};
    const patch: Partial<Item> = {};
    if (!target.description && donor.description) patch.description = donor.description;
    if (!target.storeTitle && donor.storeTitle) patch.storeTitle = donor.storeTitle;
    if (!target.storeGroup && donor.storeGroup) patch.storeGroup = donor.storeGroup;
    if (!(target.storeImages?.length) && donor.storeImages?.length) patch.storeImages = donor.storeImages;
    if (!target.storeVideoUrl && donor.storeVideoUrl) patch.storeVideoUrl = donor.storeVideoUrl;
    if (!target.imageUrl && donor.imageUrl) patch.imageUrl = donor.imageUrl;
    const donorPublished = donor.status === 'sold' ? hasStoreContent(donor) : !!donor.publicInStore;
    if (!target.publicInStore && donorPublished) patch.publicInStore = true;
    return patch;
};
