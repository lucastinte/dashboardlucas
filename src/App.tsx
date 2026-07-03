import { AuthProvider, useAuth } from './contexts/AuthContext'
import Dashboard from './components/Dashboard'
import Login from './components/Login'
import ResetPassword from './components/ResetPassword'
import Store from './components/Store'
import StoreProduct from './components/StoreProduct'

function AppContent() {
  const { session, loading, isRecovery } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-gray-200 border-t-black rounded-full animate-spin" />
      </div>
    )
  }

  if (isRecovery && session) return <ResetPassword />

  return session ? <Dashboard /> : <Login />
}

function App() {
  const path = window.location.pathname;
  if (path === '/tienda' || path === '/tienda/') return <Store />;
  if (path.startsWith('/tienda/producto/')) {
    const id = path.replace('/tienda/producto/', '').replace(/\/$/, '');
    return <StoreProduct id={id} />;
  }

  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
