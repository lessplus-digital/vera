import React, { useState, useMemo } from 'react'
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, addMinutes } from 'date-fns'
import { es } from 'date-fns/locale'
import { useReservations } from '../../hooks/useReservations'
import { sendWhatsAppTemplate } from '../../lib/whatsapp'
import { RESERVATION_STATES, RESERVATION_DURATION_MIN, WA_TEMPLATES } from '../../utils/constants'
import ReservationModal from './ReservationModal'
import ReservationDetail from './ReservationDetail'
import Toast from '../../components/Toast'
import { useToast } from '../../hooks/useToast'

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: date => startOfWeek(date, { locale: es }),
  getDay,
  locales: { es },
})

const MESSAGES = {
  today: 'Hoy',
  previous: '‹',
  next: '›',
  month: 'Mes',
  week: 'Semana',
  day: 'Día',
  date: 'Fecha',
  time: 'Hora',
  event: 'Reserva',
  noEventsInRange: 'No hay reservas en este rango',
  showMore: n => `+${n} más`,
}

const FORMATS = {
  monthHeaderFormat: (date, culture, loc) => loc.format(date, 'MMMM yyyy', culture),
  dayHeaderFormat: (date, culture, loc) => loc.format(date, "EEEE d 'de' MMMM", culture),
  dayRangeHeaderFormat: ({ start, end }, culture, loc) =>
    `${loc.format(start, 'd MMM', culture)} — ${loc.format(end, 'd MMM yyyy', culture)}`,
  weekdayFormat: (date, culture, loc) => loc.format(date, 'EEE', culture),
  dayFormat: (date, culture, loc) => loc.format(date, 'EEE d', culture),
  timeGutterFormat: (date, culture, loc) => loc.format(date, 'HH:mm', culture),
  eventTimeRangeFormat: ({ start }, culture, loc) => loc.format(start, 'HH:mm', culture),
}

function toEvent(r) {
  const start = new Date(`${r.fecha}T${r.hora}`)
  // 🎉 marca las reservas con montaje (ocasión con costo): son las que la sala
  // tiene que preparar antes, así que se ven sin abrir el detalle.
  const montaje = Number(r.costo_motivo || 0) > 0 ? '🎉 ' : ''
  return {
    id: r.reserva_id,
    title: `${montaje}${r.nombre_cliente || 'Sin nombre'} · ${r.personas} pers.`,
    start,
    end: addMinutes(start, RESERVATION_DURATION_MIN),
    resource: r,
  }
}

function reservaFechaLegible(r) {
  const start = new Date(`${r.fecha}T${r.hora}`)
  return {
    fecha: format(start, "EEEE d 'de' MMMM", { locale: es }),
    hora: format(start, 'h:mm a', { locale: es }),
  }
}

export default function ReservationsPage() {
  const { reservations, loading, error, createReservation, deleteReservation } = useReservations()
  const [view, setView] = useState(Views.WEEK)
  const [date, setDate] = useState(new Date())
  const [modal, setModal] = useState(null)   // null | { fecha?, hora? } prefill
  const [detail, setDetail] = useState(null) // null | reserva
  const { toast, showToast } = useToast()

  const events = useMemo(() => reservations.map(toEvent), [reservations])

  // Confirmación de reserva: va por la plantilla aprobada `recordatorio_reserva`,
  // NO por texto libre. El cliente pudo haber sido creado a mano desde el dashboard
  // y no haberle escrito nunca al bot → estaría fuera de la ventana de 24h, donde
  // el texto libre se "acepta" (200) pero no se entrega (ver edge-cases #16).
  async function notifyCreated(r) {
    const { fecha, hora } = reservaFechaLegible(r)
    const { name, lang } = WA_TEMPLATES.recordatorioReserva
    try {
      await sendWhatsAppTemplate(String(r.telefono || '').replace(/\D/g, ''), name, lang, [
        (r.nombre_cliente || 'Cliente').trim().split(/\s+/)[0],
        fecha,
        hora,
        String(r.personas),
      ])
      showToast('success', '✓ Reserva creada — cliente notificado por WhatsApp')
    } catch (waError) {
      console.error('Error notificando por WhatsApp:', waError)
      showToast('warn', 'Reserva creada, pero falló la notificación por WhatsApp')
    }
  }

  // Cancelación: va por plantilla (`cancelacion_reserva`, Utility) desde 2026-07-29.
  // Antes era texto libre, que Meta acepta con 200 pero NO entrega si el cliente no
  // escribió en las últimas 24h — justo el caso de una reserva creada desde el dashboard.
  async function notifyDeleted(r) {
    const { fecha, hora } = reservaFechaLegible(r)
    const { name, lang } = WA_TEMPLATES.cancelacionReserva
    try {
      await sendWhatsAppTemplate(String(r.telefono || '').replace(/\D/g, ''), name, lang, [
        (r.nombre_cliente || 'Cliente').trim().split(/\s+/)[0],
        fecha,
        hora,
      ])
      showToast('success', '✓ Reserva eliminada — cliente notificado por WhatsApp')
    } catch (waError) {
      console.error('Error notificando por WhatsApp:', waError)
      showToast('warn', 'Reserva eliminada, pero falló el aviso por WhatsApp')
    }
  }

  async function handleCreate(form) {
    const { error: createError, reservation } = await createReservation(form)
    if (createError) return { error: createError }
    notifyCreated(reservation)
    return { error: null }
  }

  async function handleDelete(r) {
    const { error: deleteError } = await deleteReservation(r.reserva_id)
    if (deleteError) {
      showToast('error', deleteError)
      return { error: deleteError }
    }
    setDetail(null)
    notifyDeleted(r)
    return { error: null }
  }

  function handleSelectSlot({ start }) {
    setModal({
      fecha: format(start, 'yyyy-MM-dd'),
      hora: view === Views.MONTH ? '' : format(start, 'HH:mm'),
    })
  }

  const components = useMemo(() => ({
    toolbar: props => <CalToolbar {...props} onNew={() => setModal({})} />,
  }), [])

  return (
    <div className="rsv-page">
      {error && <div className="rsv-error">Error cargando reservas: {error}</div>}

      {loading ? (
        <div className="rsv-empty">Cargando reservas…</div>
      ) : (
        <div className="rsv-calendar">
          <Calendar
            localizer={localizer}
            culture="es"
            events={events}
            view={view}
            onView={setView}
            date={date}
            onNavigate={setDate}
            views={[Views.DAY, Views.WEEK, Views.MONTH]}
            messages={MESSAGES}
            formats={FORMATS}
            components={components}
            selectable
            popup
            longPressThreshold={150}
            onSelectSlot={handleSelectSlot}
            onSelectEvent={event => setDetail(event.resource)}
            eventPropGetter={event => ({ className: `rsv-ev ${event.resource?.estado || 'pendiente'}` })}
            min={new Date(0, 0, 0, 10, 0)}
            max={new Date(0, 0, 0, 23, 30)}
            scrollToTime={new Date(0, 0, 0, 17, 0)}
          />
        </div>
      )}

      {modal && (
        <ReservationModal
          initial={modal}
          onSave={handleCreate}
          onClose={() => setModal(null)}
        />
      )}

      {detail && (
        <ReservationDetail
          reservation={detail}
          legible={reservaFechaLegible(detail)}
          onDelete={handleDelete}
          onClose={() => setDetail(null)}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}

function CalToolbar({ label, onNavigate, onView, view, onNew }) {
  return (
    <div className="rsv-toolbar">
      <div className="rsv-nav">
        <button onClick={() => onNavigate('TODAY')}>Hoy</button>
        <button className="arrow" onClick={() => onNavigate('PREV')}>‹</button>
        <button className="arrow" onClick={() => onNavigate('NEXT')}>›</button>
      </div>

      <span className="rsv-label">{label.charAt(0).toUpperCase() + label.slice(1)}</span>

      <div className="rsv-legend">
        {RESERVATION_STATES.map(s => (
          <span key={s.value} className={`dot-item ${s.cls}`}>
            <span className="dot" />{s.short}
          </span>
        ))}
      </div>

      <div className="rsv-views">
        {[[Views.DAY, 'Día'], [Views.WEEK, 'Semana'], [Views.MONTH, 'Mes']].map(([v, l]) => (
          <button key={v} className={view === v ? 'active' : ''} onClick={() => onView(v)}>{l}</button>
        ))}
      </div>

      <button className="btn primary" onClick={onNew}>+ Nueva reserva</button>
    </div>
  )
}
