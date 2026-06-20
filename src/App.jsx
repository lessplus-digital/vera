import React, { useState } from 'react'
import { useTheme } from './hooks/useTheme'
import { useAuth } from './hooks/useAuth'
import { useOrders } from './hooks/useOrders'
import { useSupportCount } from './hooks/useSupportCount'
import { useMediaQuery } from './hooks/useMediaQuery'
import Sidebar from './components/layout/Sidebar'
import Header from './components/layout/Header'
import LoginPage from './pages/auth/LoginPage'
import DashboardPage from './pages/dashboard/DashboardPage'
import SupportPanel from './pages/support/SupportPanel'
import StatisticsPage from './pages/statistics/StatisticsPage'
import ClientsPage from './pages/clients/ClientsPage'
import ReservationsPage from './pages/reservations/ReservationsPage'

export default function App() {
  // El tema vive aquí para que también aplique en la pantalla de login.
  const { theme, toggleTheme } = useTheme()
  const { session, loading } = useAuth()

  if (loading) {
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

  return <DashboardShell theme={theme} onToggleTheme={toggleTheme} />
}

/* Shell autenticado: aquí viven los hooks que consultan datos (requieren sesión). */
function DashboardShell({ theme, onToggleTheme }) {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)
  const supportCount = useSupportCount()
  const { orders, loading, newIds, stats, lastUpdate, fetchOrders } = useOrders()

  // Colapsa a solo-iconos en tablet; se vuelve cajón (drawer) en móvil.
  const collapsed = useMediaQuery('(max-width: 1024px)')
  const isMobile  = useMediaQuery('(max-width: 768px)')

  return (
    <div className="app-shell" style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
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
          activeTab={activeTab}
          stats={stats}
          lastUpdate={lastUpdate}
          showHamburger={isMobile}
          onToggleSidebar={() => setMobileOpen(true)}
        />

        {activeTab === 'dashboard' && (
          <DashboardPage loading={loading} orders={orders} newIds={newIds} onUpdated={fetchOrders} />
        )}
        {activeTab === 'soporte' && <SupportPanel />}
        {activeTab === 'estadisticas' && <StatisticsPage />}
        {activeTab === 'clientes' && <ClientsPage />}
        {activeTab === 'reservas' && <ReservationsPage />}
      </div>
    </div>
  )
}
