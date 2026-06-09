import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Lock, KeyRound, CheckCircle, AlertCircle } from 'lucide-react';

export default function ResetPassword() {
    const { updatePassword, clearRecovery } = useAuth();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [loading, setLoading] = useState(false);

    const isDark = document.documentElement.classList.contains('dark');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres');
            return;
        }
        if (password !== confirm) {
            setError('Las contraseñas no coinciden');
            return;
        }

        setLoading(true);
        const { error } = await updatePassword(password);
        if (error) {
            setError(error.message);
        } else {
            setSuccess(true);
            setTimeout(() => {
                clearRecovery();
                window.location.hash = '';
            }, 2000);
        }
        setLoading(false);
    };

    return (
        <div className={`min-h-screen flex items-center justify-center px-4 ${isDark ? 'bg-[#0b1220]' : 'bg-gradient-to-b from-slate-50 to-white'}`}>
            <div className="w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg ${isDark ? 'bg-blue-600' : 'bg-black'}`}>
                        <KeyRound className="w-7 h-7 text-white" />
                    </div>
                    <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Nueva contraseña</h1>
                    <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Elegí tu nueva contraseña</p>
                </div>

                <div className={`rounded-2xl border p-6 shadow-xl ${isDark ? 'bg-[#111827] border-gray-700' : 'bg-white border-gray-200'}`}>
                    {success ? (
                        <div className="flex flex-col items-center gap-3 py-4">
                            <CheckCircle className="w-12 h-12 text-emerald-500" />
                            <p className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>Contraseña actualizada</p>
                            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Redirigiendo al dashboard...</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && (
                                <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    {error}
                                </div>
                            )}

                            <div>
                                <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Nueva contraseña
                                </label>
                                <div className="relative">
                                    <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        required
                                        autoComplete="new-password"
                                        placeholder="Mínimo 6 caracteres"
                                        className={`w-full pl-10 pr-4 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${isDark ? 'bg-[#0b1220] border-gray-600 text-white placeholder-gray-500' : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'}`}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                    Confirmar contraseña
                                </label>
                                <div className="relative">
                                    <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                                    <input
                                        type="password"
                                        value={confirm}
                                        onChange={e => setConfirm(e.target.value)}
                                        required
                                        autoComplete="new-password"
                                        placeholder="Repetí la contraseña"
                                        className={`w-full pl-10 pr-4 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${isDark ? 'bg-[#0b1220] border-gray-600 text-white placeholder-gray-500' : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'}`}
                                    />
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-black text-white font-medium text-sm hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                            >
                                {loading ? (
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                ) : (
                                    <KeyRound className="w-4 h-4" />
                                )}
                                {loading ? 'Guardando...' : 'Guardar contraseña'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
