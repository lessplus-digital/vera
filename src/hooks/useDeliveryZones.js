import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Zonas de cobertura de domicilio y los barrios que cuelgan de cada una
// (tablas `zonas_entrega` y `barrios`). Son las MISMAS que lee el bot vía la
// tool `consultar_cobertura`, igual que `faq` o `motivos_reserva`: la tarifa
// que se escriba aquí es la que el Agente Pedidos le cobra al cliente por
// WhatsApp.
//
// Lo que NO se decide aquí es cuánto pagó un pedido concreto: eso lo congela
// el trigger `trigger_tarifa_domicilio` en `pedidos.costo_domicilio` al momento
// de crearlo. Subirle la tarifa a una zona no reescribe pedidos viejos.
//
// Sin realtime, mismo criterio que `useFaq`/`useBusinessInfo`: el único
// escritor es este dashboard y cada mutación ya refresca la lista.
export function useDeliveryZones() {
  const [zonas, setZonas] = useState([])
  const [sinClasificar, setSinClasificar] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchZonas = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('zonas_entrega')
      .select('clave, nombre, descripcion, costo, tiempo_estimado, es_base, activo, orden, barrios(clave, nombre, activo)')
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true })

    if (fetchError) {
      console.error('Error cargando zonas de domicilio:', fetchError)
      setError(fetchError.message)
      setLoading(false)
      return
    }

    const normalizadas = (data || []).map(z => ({
      ...z,
      costo: Number(z.costo ?? 0),
      barrios: [...(z.barrios || [])].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    }))
    setZonas(normalizadas)
    setError(null)
    setLoading(false)
  }, [])

  // Barrios que llegaron por WhatsApp y NO están en el catálogo: el trigger los
  // guardó tal cual los escribió el cliente y les cobró la tarifa base. Son
  // exactamente la lista de barrios que al restaurante le falta cargar.
  //
  // El GROUP BY se hace en JS porque PostgREST no lo expone; se traen solo los
  // pedidos con zona NULL, que es un subconjunto pequeño por definición.
  const fetchSinClasificar = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('pedidos')
      .select('barrio, fecha_pedido')
      .eq('tipo_pedido', 'domicilio')
      .is('zona', null)
      .not('barrio', 'is', null)
      .order('fecha_pedido', { ascending: false })
      .limit(500)

    if (fetchError) {
      console.error('Error cargando barrios sin clasificar:', fetchError)
      return
    }

    const conteo = new Map()
    for (const row of data || []) {
      const nombre = String(row.barrio || '').trim()
      if (!nombre) continue
      const key = nombre.toLowerCase()
      const previo = conteo.get(key)
      if (previo) previo.pedidos += 1
      else conteo.set(key, { nombre, pedidos: 1 })
    }
    setSinClasificar([...conteo.values()].sort((a, b) => b.pedidos - a.pedidos))
  }, [])

  const refetch = useCallback(async () => {
    await Promise.all([fetchZonas(), fetchSinClasificar()])
  }, [fetchZonas, fetchSinClasificar])

  useEffect(() => { refetch() }, [refetch])

  async function createZona({ nombre, descripcion, costo, tiempo_estimado }) {
    const orden = zonas.length ? Math.max(...zonas.filter(z => !z.es_base).map(z => z.orden), 0) + 1 : 0

    const { error: insertError } = await supabase
      .from('zonas_entrega')
      .insert({ clave: claveDesde(nombre), nombre, descripcion: descripcion || null, costo, tiempo_estimado: tiempo_estimado || null, orden })

    if (insertError) {
      console.error('Error creando zona:', insertError)
      return { error: mensajeDeError(insertError) }
    }
    await fetchZonas()
    return { error: null }
  }

  async function updateZona(clave, patch) {
    const { error: updateError } = await supabase
      .from('zonas_entrega')
      .update(patch)
      .eq('clave', clave)

    if (updateError) {
      console.error('Error actualizando zona:', updateError)
      return { error: mensajeDeError(updateError) }
    }
    await fetchZonas()
    return { error: null }
  }

  async function deleteZona(clave) {
    const { error: deleteError } = await supabase.from('zonas_entrega').delete().eq('clave', clave)

    if (deleteError) {
      console.error('Error eliminando zona:', deleteError)
      return { error: mensajeDeError(deleteError) }
    }
    await refetch()
    return { error: null }
  }

  // Toggle optimista, mismo patrón que el switch de la FAQ.
  async function setZonaActiva(clave, activo) {
    const prev = zonas
    setZonas(zs => zs.map(z => (z.clave === clave ? { ...z, activo } : z)))

    const { error: updateError } = await supabase
      .from('zonas_entrega')
      .update({ activo })
      .eq('clave', clave)

    if (updateError) {
      console.error('Error actualizando zona:', updateError)
      setZonas(prev)
      return { error: mensajeDeError(updateError) }
    }
    return { error: null }
  }

  // Acepta uno o varios barrios en el mismo texto: "Niquía, Camacol, Terranova"
  // entra en UN solo insert, no tres round-trips. Se parte por coma, punto y
  // coma o salto de línea, para que pegar una lista de cualquier lado funcione.
  //
  // `clave` la deriva el trigger `trigger_normalizar_barrio` desde el nombre —
  // aquí NO se manda, para que la normalización viva en un solo sitio. Por eso
  // el dedupe local es a propósito tonto (solo mayúsculas/espacios): sirve para
  // no mandar dos veces lo mismo del propio lote, pero quién es duplicado DE
  // VERDAD lo decide la BD, que sí sabe que "Niquia" y "NIQUÍA" son el mismo.
  async function addBarrios(zona, texto) {
    const vistos = new Set()
    const nombres = []
    for (const parte of String(texto || '').split(/[,;\n]/)) {
      const limpio = parte.replace(/\s+/g, ' ').trim()
      if (!limpio) continue
      const key = limpio.toLowerCase()
      if (vistos.has(key)) continue
      vistos.add(key)
      nombres.push(limpio)
    }
    if (!nombres.length) return { error: 'Escribe el nombre del barrio.' }

    // `ignoreDuplicates` es un ON CONFLICT DO NOTHING: un barrio que ya existe
    // (en esta zona o en otra) NO se mueve solo — se reporta y ya. Moverlo es
    // una decisión explícita, y para eso está `moveBarrio`.
    const { data, error: insertError } = await supabase
      .from('barrios')
      .upsert(nombres.map(nombre => ({ nombre, zona })), { onConflict: 'clave', ignoreDuplicates: true })
      .select('clave')

    if (insertError) {
      console.error('Error agregando barrios:', insertError)
      return { error: mensajeDeError(insertError) }
    }

    await refetch()
    const agregados = data?.length ?? 0
    return { error: null, agregados, repetidos: nombres.length - agregados }
  }

  async function moveBarrio(clave, zona) {
    const { error: updateError } = await supabase.from('barrios').update({ zona }).eq('clave', clave)

    if (updateError) {
      console.error('Error moviendo barrio:', updateError)
      return { error: mensajeDeError(updateError) }
    }
    await fetchZonas()
    return { error: null }
  }

  async function deleteBarrio(clave) {
    const { error: deleteError } = await supabase.from('barrios').delete().eq('clave', clave)

    if (deleteError) {
      console.error('Error eliminando barrio:', deleteError)
      return { error: 'No se pudo eliminar el barrio. Intenta de nuevo.' }
    }
    await refetch()
    return { error: null }
  }

  return {
    zonas,
    sinClasificar,
    loading,
    error,
    createZona,
    updateZona,
    deleteZona,
    setZonaActiva,
    addBarrios,
    moveBarrio,
    deleteBarrio,
    refetch,
  }
}

// Catálogo plano de barrios para los formularios que crean pedidos (no para
// administrar zonas — eso es `useDeliveryZones`). Solo lectura y solo lo activo.
//
// `tarifaBase` es lo que la BD cobrará si el barrio elegido no está en el
// catálogo. Se expone para poder mostrar el mismo número que se va a cobrar,
// sin volver a quemar un 5000 en el frontend como se hacía antes.
export function useBarrioOptions() {
  const [barrios, setBarrios] = useState([])
  const [tarifaBase, setTarifaBase] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchOpciones() {
      const [{ data: filas, error: barriosError }, { data: base }] = await Promise.all([
        supabase
          .from('barrios')
          .select('clave, nombre, zonas_entrega ( clave, nombre, costo, activo )')
          .eq('activo', true)
          .order('nombre'),
        supabase
          .from('zonas_entrega')
          .select('costo')
          .eq('es_base', true)
          .maybeSingle(),
      ])

      if (cancelled) return

      if (barriosError) console.error('Error cargando barrios:', barriosError)

      setBarrios(
        (filas || [])
          .filter(b => b.zonas_entrega?.activo)
          .map(b => ({
            clave: b.clave,
            nombre: b.nombre,
            zona: b.zonas_entrega.nombre,
            costo: Number(b.zonas_entrega.costo ?? 0),
          }))
      )
      setTarifaBase(base ? Number(base.costo ?? 0) : null)
      setLoading(false)
    }

    fetchOpciones()
    return () => { cancelled = true }
  }, [])

  return { barrios, tarifaBase, loading }
}

// Slug de la zona. Solo es el identificador interno (la PK); lo que ve el
// cliente es `nombre`. El de los BARRIOS no se calcula aquí: ese sí participa
// del match contra lo que escribe el cliente, así que lo deriva la BD.
function claveDesde(nombre) {
  const base = String(nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || `zona-${Date.now().toString(36)}`
}

function mensajeDeError(err) {
  const detalle = `${err?.message || ''} ${err?.details || ''}`

  if (detalle.includes('zonas_entrega_pkey')) {
    return 'Ya existe una zona con ese nombre.'
  }
  if (detalle.includes('barrios_pkey')) {
    return 'Ese barrio ya está asignado a una zona.'
  }
  if (detalle.includes('zona base')) {
    // Los levanta `proteger_zona_base()` con su propio texto, ya en español.
    return detalle.replace(/^.*?(No se puede borrar la zona base|Siempre tiene que haber|La zona base no se puede)/, '$1').split('\n')[0]
  }
  if (detalle.includes('zonas_entrega_costo_check')) {
    return 'La tarifa no puede ser negativa.'
  }
  if (detalle.includes('violates foreign key') && detalle.includes('barrios')) {
    return 'No se puede borrar la zona: todavía tiene barrios asignados. Muévelos primero.'
  }
  if (detalle.includes('row-level security')) {
    return 'Solo un administrador puede cambiar las zonas de domicilio.'
  }
  return 'No se pudo guardar. Intenta de nuevo.'
}
