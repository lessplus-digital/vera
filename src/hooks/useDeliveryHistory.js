import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getRange } from '../utils/dateRanges'

const PAGINA = 20

// Períodos del historial. 'todo' no pasa por getRange: es la ausencia de filtro.
export const PERIODOS = [
  { key: 'hoy',  label: 'Hoy' },
  { key: '7d',   label: '7 días' },
  { key: '30d',  label: '30 días' },
  { key: 'todo', label: 'Todo' },
]

function rangoDe(periodo) {
  if (periodo === 'todo') return { from: null, to: null }
  return getRange(periodo)
}

/*
 * Historial de entregas de UN domiciliario.
 *
 * Sirve a dos pantallas con el mismo código: el repartidor viendo lo suyo y el
 * admin abriendo el de cualquiera. No hay ninguna comprobación de rol aquí, y
 * es correcto: la política `pedidos_select` ya decide qué filas existen para
 * quien pregunta. Si un domiciliario pasara el id de otro, recibiría una lista
 * vacía y ceros — no un error, porque para él esas filas no existen.
 *
 * Se ordena y filtra por `fecha_entrega` (timestamptz), no por `fecha_pedido`
 * (timestamp sin tz con valor UTC): lo que interesa es cuándo se entregó.
 */
export function useDeliveryHistory(domiciliarioId, periodo = '7d') {
  const [entregas, setEntregas] = useState([])
  const [resumen, setResumen] = useState({ entregas: 0, total: 0, efectivo: 0 })
  const [loading, setLoading] = useState(true)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [hayMas, setHayMas] = useState(false)
  const [error, setError] = useState(null)

  // Evita que una respuesta lenta de un período anterior pise a la del actual
  // cuando el usuario cambia rápido de pestaña.
  const peticion = useRef(0)

  const consultar = useCallback(async (desde) => {
    const { from, to } = rangoDe(periodo)

    let q = supabase
      .from('pedidos')
      .select('pedido_id, telefono, direccion_entrega, metodo_pago, total, fecha_entrega, clientes ( nombre )')
      .eq('domiciliario_id', domiciliarioId)
      .eq('estado', 'entregado')
      .not('fecha_entrega', 'is', null)
      .order('fecha_entrega', { ascending: false })
      .range(desde, desde + PAGINA - 1)

    if (from) q = q.gte('fecha_entrega', from.toISOString())
    if (to)   q = q.lt('fecha_entrega', to.toISOString())

    return q
  }, [domiciliarioId, periodo])

  const cargar = useCallback(async () => {
    if (!domiciliarioId) {
      setEntregas([]); setResumen({ entregas: 0, total: 0, efectivo: 0 }); setLoading(false)
      return
    }

    const id = ++peticion.current
    setLoading(true)
    setError(null)

    const { from, to } = rangoDe(periodo)

    // El resumen va aparte porque tiene que abarcar TODO el período: sumar solo
    // la página cargada daría una cifra que crece al hacer scroll.
    const [lista, agregado] = await Promise.all([
      consultar(0),
      supabase.rpc('resumen_entregas', {
        p_domiciliario: domiciliarioId,
        p_desde: from ? from.toISOString() : null,
        p_hasta: to   ? to.toISOString()   : null,
      }),
    ])

    if (id !== peticion.current) return   // llegó tarde: ya hay otro período en curso

    if (lista.error) {
      console.error('Error cargando el historial de entregas:', lista.error)
      setError('No se pudo cargar el historial.')
      setEntregas([])
    } else {
      setEntregas(lista.data || [])
      setHayMas((lista.data || []).length === PAGINA)
    }

    if (agregado.error) {
      console.error('Error cargando el resumen de entregas:', agregado.error)
    } else {
      const r = agregado.data?.[0]
      setResumen({
        entregas: Number(r?.entregas ?? 0),
        total:    Number(r?.total ?? 0),
        efectivo: Number(r?.efectivo ?? 0),
      })
    }

    setLoading(false)
  }, [domiciliarioId, periodo, consultar])

  useEffect(() => { cargar() }, [cargar])

  async function cargarMas() {
    if (cargandoMas || !hayMas) return
    setCargandoMas(true)

    const id = peticion.current
    const { data, error: masError } = await consultar(entregas.length)
    setCargandoMas(false)

    if (id !== peticion.current) return
    if (masError) {
      console.error('Error cargando más entregas:', masError)
      setError('No se pudieron cargar más entregas.')
      return
    }

    setEntregas(prev => [...prev, ...(data || [])])
    setHayMas((data || []).length === PAGINA)
  }

  return { entregas, resumen, loading, cargandoMas, hayMas, error, cargarMas, refetch: cargar }
}
