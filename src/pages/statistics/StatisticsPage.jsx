import React from 'react'
import { useStatistics } from '../../hooks/useStatistics'
import PeriodSelector from './PeriodSelector'
import KpiCards from './KpiCards'
import SalesChart from './SalesChart'
import TopClients from './TopClients'
import ProductsRanking from './ProductsRanking'
import HourlyHeatmap from './HourlyHeatmap'
import CancellationStats from './CancellationStats'
import DeliveryStats from './DeliveryStats'
import CategoryRevenue from './CategoryRevenue'
import RiskClients from './RiskClients'

export default function StatisticsPage() {
  const {
    loading, error, aggregates, clients, atRisk, categorias, range,
    filters, setPreset, setCustomFrom, setCustomTo, setGranularity, setCategoria,
  } = useStatistics()

  return (
    <div className="stats-page">
      <PeriodSelector
        preset={filters.preset}
        onPreset={setPreset}
        customFrom={filters.customFrom}
        customTo={filters.customTo}
        onCustomFrom={setCustomFrom}
        onCustomTo={setCustomTo}
        granularity={filters.granularity}
        onGranularity={setGranularity}
      />

      {error && (
        <div className="stats-error">Error cargando estadísticas: {error}</div>
      )}

      {!range && filters.preset === 'custom' && (
        <div className="stats-empty big">Selecciona un rango de fechas válido</div>
      )}

      {range && (loading || !aggregates) ? (
        <div className="stats-empty big">Cargando estadísticas…</div>
      ) : range && aggregates && (
        <>
          <KpiCards kpis={aggregates.kpis} deltas={aggregates.deltas} rating={aggregates.rating} />

          <SalesChart data={aggregates.series} />

          <div className="stats-grid-2">
            <CategoryRevenue data={aggregates.ingresosPorCategoria} />
            <DeliveryStats entrega={aggregates.entrega} />
          </div>

          <div className="stats-grid-2">
            <TopClients clients={clients} />
            <RiskClients clients={atRisk} />
          </div>

          <div className="stats-grid-2">
            <ProductsRanking
              top={aggregates.topProductos}
              bottom={aggregates.bottomProductos}
              categorias={categorias}
              categoria={filters.categoria}
              onCategoria={setCategoria}
            />
            <div className="stats-stack">
              <HourlyHeatmap heatmap={aggregates.heatmap} />
              <CancellationStats
                kpis={aggregates.kpis}
                motivos={aggregates.motivosCancelacion}
                rating={aggregates.rating}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
