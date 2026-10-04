export const STORE_CONFIG = {
  storeName: 'Lucas Shop',
  // Usuario de WhatsApp del negocio (no un número): WhatsApp identifica por
  // @usuario, y es el mismo para todas las ubicaciones.
  whatsappUser: '@lucastinte',
  // Base pública de la tienda, para armar links a productos (ej: ${storeBaseUrl}/producto/<id>).
  // Formato actual: sin el prefijo /tienda, que quedó deprecado.
  storeBaseUrl: 'https://lepzito.vercel.app',
};

/**
 * Normaliza un usuario de WhatsApp: deja sólo los caracteres que WhatsApp
 * acepta (letras, números, puntos y guiones bajos) y garantiza un único @
 * adelante. Reglas de WhatsApp: 3-35 caracteres y al menos una letra.
 *
 * Devuelve '' para cualquier cosa que no sea un usuario válido: los números de
 * teléfono que se guardaban antes caen acá, así no se muestran como "@12345".
 */
export function normalizeWhatsAppUser(input?: string): string {
  if (!input) return '';
  const handle = input.trim().replace(/^@+/, '').replace(/[^A-Za-z0-9._]/g, '');
  if (handle.length < 3 || !/[A-Za-z]/.test(handle)) return '';
  return `@${handle}`;
}

/**
 * Normaliza un teléfono: quita caracteres no numéricos y el prefijo de país
 * (549/54), dejando el número local. Sólo para el campo "teléfono" de la
 * ubicación; el contacto de WhatsApp ahora es un @usuario.
 */
export function normalizePhone(input?: string): string {
  if (!input) return '';
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('549')) digits = digits.slice(3);
  else if (digits.startsWith('54')) digits = digits.slice(2);
  return digits;
}
