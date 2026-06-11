import React, { useState } from 'react'
import { useTheme } from './hooks/useTheme'
import { useOrders } from './hooks/useOrders'
import { useSupportCount } from './hooks/useSupportCount'
import Header from './components/layout/Header'
import DashboardPage from './pages/dashboard/DashboardPage'
import SupportPanel from './pages/support/SupportPanel'
import StatisticsPage from './pages/statistics/StatisticsPage'

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const { theme, toggleTheme } = useTheme()
  const supportCount = useSupportCount()
  const { orders, loading, newIds, stats, lastUpdate, fetchOrders } = useOrders()

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>
      <Header
        theme={theme}
        onToggleTheme={toggleTheme}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        stats={stats}
        supportCount={supportCount}
        lastUpdate={lastUpdate}
      />
      {activeTab === 'dashboard' && (
        <DashboardPage loading={loading} orders={orders} newIds={newIds} onUpdated={fetchOrders} />
      )}
      {activeTab === 'soporte' && <SupportPanel />}
      {activeTab === 'estadisticas' && <StatisticsPage />}
    </div>
  )
}
