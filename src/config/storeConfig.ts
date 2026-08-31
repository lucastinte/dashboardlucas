export const STORE_CONFIG = {
  storeName: 'Lucas Shop',
  defaultWhatsApp: '3885925942', // Sin código de país: área 388 + 5925942 (el +54/549 lo agrega cada uso)
};

/**
 * Normaliza un número de WhatsApp/teléfono: quita caracteres no numéricos
 * y el prefijo de país (549/54), dejando el número local.
 * El +54/549 se agrega recién al generar la placa o el link wa.me.
 */
export function normalizeWhatsApp(input?: string): string {
  if (!input) return '';
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('549')) digits = digits.slice(3);
  else if (digits.startsWith('54')) digits = digits.slice(2);
  return digits;
}

/**
 * Genera un enlace a WhatsApp limpio.
 * @param text Mensaje a pre-escribir.
 * @param phone Número de teléfono destino (opcional, usa el predeterminado si no se pasa).
 */
export function getWhatsAppUrl(text: string, phone: string = STORE_CONFIG.defaultWhatsApp): string {
  // wa.me necesita el número internacional completo: prefijo 549 (Argentina mobile)
  const full = `549${normalizeWhatsApp(phone)}`;
  return `https://wa.me/${full}?text=${encodeURIComponent(text)}`;
}
