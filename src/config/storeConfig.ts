export const STORE_CONFIG = {
  storeName: 'Lucas Shop',
  defaultWhatsApp: '5493885925942', // Código de país 549 + área 388 + 5925942
};

/**
 * Genera un enlace a WhatsApp limpio.
 * @param text Mensaje a pre-escribir.
 * @param phone Número de teléfono destino (opcional, usa el predeterminado si no se pasa).
 */
export function getWhatsAppUrl(text: string, phone: string = STORE_CONFIG.defaultWhatsApp): string {
  // Limpiar caracteres no numéricos del teléfono
  const cleanPhone = phone.replace(/\D/g, '');
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}
