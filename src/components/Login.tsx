import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Lock, Mail, LogIn, AlertCircle, Moon, Sun } from 'lucide-react';

export default function Login() {
    const { signIn } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        const saved = localStorage.getItem('dashboard_theme');
        return saved === 'dark' ? 'dark' : 'light';
    });

    const isDark = theme === 'dark';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        const { error } = await signIn(email, password);
        if (error) {
            setError(error.message === 'Invalid login credentials'
                ? 'Email o contraseña incorrectos'
                : error.message);
        }
        setLoading(false);
    };

    const toggleTheme = () => {
        const next = isDark ? 'light' : 'dark';
        setTheme(next);
        localStorage.setItem('dashboard_theme', next);
        document.documentElement.classList.toggle('dark', next === 'dark');
    };

    return (
        <div className={`min-h-screen flex items-center justify-center px-4 transition-colors ${isDark ? 'bg-[#0b1220]' : 'bg-gradient-to-b from-slate-50 to-white'}`}>
            {/* Theme toggle */}
            <button
                type="button"
                onClick={toggleTheme}
                className={`fixed top-5 right-5 h-10 w-10 rounded-xl border flex items-center justify-center transition-colors ${isDark ? 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'} shadow-sm`}
                title={isDark ? 'Modo claro' : 'Modo oscuro'}
            >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <div className="w-full max-w-sm">
                {/* Logo / Brand */}
                <div className="text-center mb-8">
                    <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg ${isDark ? 'bg-blue-600' : 'bg-black'}`}>
                        <span className="text-2xl font-bold text-white">L</span>
                    </div>
                    <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Dashboard</h1>
                    <p className={`text-sm mt-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Iniciá sesión para continuar</p>
                </div>

                {/* Login Card */}
                <div className={`rounded-2xl border p-6 shadow-xl ${isDark ? 'bg-[#111827] border-gray-700' : 'bg-white border-gray-200'}`}>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {error && (
                            <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                {error}
                            </div>
                        )}

                        <div>
                            <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                Email
                            </label>
                            <div className="relative">
                                <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    required
                                    autoComplete="email"
                                    placeholder="tu@email.com"
                                    className={`w-full pl-10 pr-4 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${isDark ? 'bg-[#0b1220] border-gray-600 text-white placeholder-gray-500' : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'}`}
                                />
                            </div>
                        </div>

                        <div>
                            <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                Contraseña
                            </label>
                            <div className="relative">
                                <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    required
                                    autoComplete="current-password"
                                    placeholder="Tu contraseña"
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
                                <LogIn className="w-4 h-4" />
                            )}
                            {loading ? 'Ingresando...' : 'Ingresar'}
                        </button>
                    </form>
                </div>

                <p className={`text-center text-xs mt-4 ${isDark ? 'text-gray-600' : 'text-gray-400'}`}>
                    Acceso restringido
                </p>
            </div>
        </div>
    );
}
