import React, { useState, useEffect } from 'react'
import { useTheme } from './hooks/useTheme'
import { useAuth } from './hooks/useAuth'
import { puedeVerTab, tabInicial, ROLES } from './utils/permisos'
import Icon from './components/Icon'
import { useOrders } from './hooks/useOrders'
import { useSupportCount } from './hooks/useSupportCount'
import { useMediaQuery } from './hooks/useMediaQuery'
import Sidebar from './components/layout/Sidebar'
import Header from './components/layout/Header'
import LoginPage from './pages/auth/LoginPage'
import DashboardPage from './pages/dashboard/DashboardPage'
import DeliveriesPage from './pages/deliveries/DeliveriesPage'
import SupportPanel from './pages/support/SupportPanel'
import StatisticsPage from './pages/statistics/StatisticsPage'
import ClientsPage from './pages/clients/ClientsPage'
import ReservationsPage from './pages/reservations/ReservationsPage'
import MenuPage from './pages/menu/MenuPage'
import SettingsPage from './pages/settings/SettingsPage'
import HistoryPage from './pages/history/HistoryPage'
import ReviewsPage from './pages/reviews/ReviewsPage'
import UsersPage from './pages/users/UsersPage'

export default function App() {
  // El tema vive aquí para que también aplique en la pantalla de login.
  const { theme, toggleTheme } = useTheme()
  const { session, loading, perfilLoading, rol, perfil, signOut } = useAuth()

  // Se espera también al perfil: el rol decide qué tabs existen, así que montar
  // el shell antes de conocerlo haría parpadear opciones que el usuario no tiene.
  if (loading || (session && perfilLoading)) {
    return (
      <div className="auth-splash">
        <div className="spinner" />
        <span>Cargando…</span>
      </div>
    )
  }

  if (!session) {
    return <LoginPage theme={theme} onToggleTheme={toggleTheme} />
  }

  // Sesión válida pero sin rol utilizable: cuenta desactivada, o creada en
  // Supabase y todavía sin permisos asignados por un admin. La BD ya le
  // devuelve vacío todo; esto le explica por qué en vez de mostrarle un
  // dashboard fantasma.
  if (!rol) {
    return <SinAcceso perfil={perfil} onSignOut={signOut} />
  }

  return <DashboardShell theme={theme} onToggleTheme={toggleTheme} rol={rol} />
}

function SinAcceso({ perfil, onSignOut }) {
  const desactivada = Boolean(perfil) && !perfil.activo

  return (
    <div className="auth-splash">
      <div style={{ color: 'var(--amber)' }}><Icon name="lock" size={36} /></div>
      <h1 style={{ fontSize: 'var(--fs-title)', fontWeight: 700, margin: 0 }}>
        {desactivada ? 'Tu cuenta está desactivada' : 'Tu cuenta todavía no tiene permisos'}
      </h1>
      <p style={{ maxWidth: 420, textAlign: 'center', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
        {desactivada
          ? 'Un administrador del restaurante desactivó tu acceso. Si crees que es un error, contáctalo.'
          : 'Un administrador del restaurante tiene que asignarte un rol antes de que puedas entrar.'}
      </p>
      <button className="btn secondary" onClick={onSignOut}>Cerrar sesión</button>
    </div>
  )
}

/* Shell autenticado: aquí viven los hooks que consultan datos (requieren sesión). */
function DashboardShell({ theme, onToggleTheme, rol }) {
  const [activeTab, setActiveTab] = useState(() => tabInicial(rol))
  const [mobileOpen, setMobileOpen] = useState(false)
  const supportCount = useSupportCount()
  const { orders, loading, newIds, stats, lastUpdate, fetchOrders } = useOrders()

  // Si el rol cambia en vivo (un admin lo degradó), la tab abierta puede dejar
  // de existir. Sin esto quedaría una pantalla en blanco sin explicación.
  useEffect(() => {
    if (!puedeVerTab(rol, activeTab)) setActiveTab(tabInicial(rol))
  }, [rol, activeTab])

  // Cada tab se comprueba al renderizar, no solo al pintar el sidebar: así un
  // `setActiveTab` desde cualquier otro punto tampoco puede colar una pantalla
  // fuera de rol. La barrera real sigue siendo la RLS — esto es coherencia de UI.
  const ver = tab => puedeVerTab(rol, tab) && activeTab === tab

  // Colapsa a solo-iconos en tablet; se vuelve cajón (drawer) en móvil.
  const collapsed = useMediaQuery('(max-width: 1024px)')
  const isMobile  = useMediaQuery('(max-width: 768px)')

  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        rol={rol}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        supportCount={supportCount}
        theme={theme}
        onToggleTheme={onToggleTheme}
        collapsed={collapsed && !isMobile}
        mobileOpen={isMobile && mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="app-main" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Header
          theme={theme}
          rol={rol}
          activeTab={activeTab}
          stats={stats}
          lastUpdate={lastUpdate}
          showHamburger={isMobile}
          onToggleSidebar={() => setMobileOpen(true)}
        />

        {/* Misma tab, dos pantallas: el domiciliario no opera un kanban de
            cocina, opera una lista de entregas. Los datos son los mismos —
            `useOrders` ya le llega filtrado por RLS a sus pedidos asignados. */}
        {ver('dashboard') && (
          rol === ROLES.DOMICILIARIO
            ? <DeliveriesPage loading={loading} orders={orders} onUpdated={fetchOrders} />
            : <DashboardPage loading={loading} orders={orders} newIds={newIds} onUpdated={fetchOrders} />
        )}
        {ver('soporte')       && <SupportPanel />}
        {ver('estadisticas')  && <StatisticsPage />}
        {ver('historial')     && <HistoryPage />}
        {ver('clientes')      && <ClientsPage />}
        {ver('reservas')      && <ReservationsPage />}
        {ver('menu')          && <MenuPage />}
        {ver('resenas')       && <ReviewsPage />}
        {ver('usuarios')      && <UsersPage />}
        {ver('configuracion') && <SettingsPage />}
      </div>
    </div>
  )
}
