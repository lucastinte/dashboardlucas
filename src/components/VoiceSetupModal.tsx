import { useState } from 'react';
import { Mic, X, Copy, Check, ExternalLink } from 'lucide-react';

// Guía para armar el Atajo de Siri que carga productos por voz.
// Se abre desde el botón "Agregar por voz" del inventario. Muestra la URL del
// endpoint de este deploy y los pasos del lado del iPhone; los env vars se
// configuran en Vercel, no acá.
export default function VoiceSetupModal({ onClose }: { onClose: () => void }) {
    const endpoint = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/quick-add`;
    const [copied, setCopied] = useState<string | null>(null);

    const copy = async (text: string, key: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(key);
            setTimeout(() => setCopied(null), 2000);
        } catch {
            /* clipboard bloqueado — el usuario lo copia a mano */
        }
    };

    const bodyExample = JSON.stringify({ texto: 'compré 3 parlantes jbl a 15 lucas, quedan en el depósito' }, null, 2);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
            <div
                className="bg-white dark:bg-gray-900 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                <div className="sticky top-0 flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-t-2xl">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <Mic className="w-5 h-5 text-violet-600" />
                        Agregar productos por voz
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-5 space-y-5 text-sm text-gray-700 dark:text-gray-300">
                    <div>
                        <p className="font-semibold text-gray-900 dark:text-white mb-2">1. Configurar en Vercel (una vez)</p>
                        <p className="mb-2">En tu proyecto → Settings → Environment Variables, agregá:</p>
                        <ul className="list-disc pl-5 space-y-1 font-mono text-xs">
                            <li><b>QUICK_ADD_TOKEN</b> — una clave secreta inventada (ej: una frase larga)</li>
                            <li><b>SUPABASE_SERVICE_ROLE_KEY</b> — en Supabase → Settings → API</li>
                            <li><b>GROQ_API_KEY</b> — <i>(opcional)</i> para que la IA interprete el dictado</li>
                        </ul>
                        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                            Después de guardarlas, hacé un redeploy para que tomen efecto.
                        </p>
                    </div>

                    <div>
                        <p className="font-semibold text-gray-900 dark:text-white mb-2">2. Crear el Atajo en el iPhone</p>
                        <ol className="list-decimal pl-5 space-y-1.5">
                            <li>App <b>Atajos</b> → <b>+</b> para crear uno nuevo</li>
                            <li>Agregá la acción <b>«Dictar texto»</b> (idioma: español)</li>
                            <li>Agregá <b>«Obtener contenido de la URL»</b>:
                                <ul className="list-disc pl-5 mt-1 space-y-1 text-xs">
                                    <li>Método: <b>POST</b></li>
                                    <li>URL: la de abajo</li>
                                    <li>Encabezados: <code className="font-mono">Authorization</code> = <code className="font-mono">Bearer TU_TOKEN</code></li>
                                    <li>Cuerpo JSON: campo <code className="font-mono">texto</code> = <code className="font-mono">Texto dictado</code></li>
                                </ul>
                            </li>
                            <li>Agregá <b>«Mostrar alerta»</b> con <code className="font-mono">Contenido de la URL</code> para ver la confirmación</li>
                            <li>Tocá el nombre del atajo → <b>«Agregar a Siri»</b> y poné una frase como <i>«Cargar producto»</i></li>
                        </ol>
                    </div>

                    <div>
                        <p className="font-semibold text-gray-900 dark:text-white mb-2">Endpoint de este dashboard</p>
                        <button
                            type="button"
                            onClick={() => copy(endpoint, 'endpoint')}
                            className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 font-mono text-xs text-left hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                        >
                            <span className="truncate">{endpoint}</span>
                            {copied === 'endpoint' ? <Check className="w-4 h-4 text-emerald-600 shrink-0" /> : <Copy className="w-4 h-4 text-gray-400 shrink-0" />}
                        </button>
                    </div>

                    <div>
                        <p className="font-semibold text-gray-900 dark:text-white mb-2">Cuerpo de ejemplo</p>
                        <button
                            type="button"
                            onClick={() => copy(bodyExample, 'body')}
                            className="w-full flex items-start justify-between gap-2 px-3 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 font-mono text-xs text-left hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
                        >
                            <span className="whitespace-pre-wrap">{bodyExample}</span>
                            {copied === 'body' ? <Check className="w-4 h-4 text-emerald-600 shrink-0" /> : <Copy className="w-4 h-4 text-gray-400 shrink-0" />}
                        </button>
                    </div>

                    <div className="rounded-xl bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 p-3 text-xs text-violet-800 dark:text-violet-300">
                        <p className="font-semibold mb-1">Probalo en el momento</p>
                        <p>Mantené apretado el atajo o decí <b>«Hey Siri, cargar producto»</b>, dictá <i>«compré 2 cables HDMI a 5 lucas, en casa»</i> y el producto aparece en el inventario.</p>
                    </div>

                    <a
                        href="https://support.apple.com/es-ar/guide/shortcuts/apd2c25d1d0e/ios"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Ayuda de Atajos de Apple
                    </a>
                </div>
            </div>
        </div>
    );
}
