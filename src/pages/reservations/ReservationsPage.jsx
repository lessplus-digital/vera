import React, { useState, useMemo, useRef } from 'react'
import { Calendar, dateFnsLocalizer, Views } from 'react-big-calendar'
import { format, parse, startOfWeek, getDay, addMinutes } from 'date-fns'
import { es } from 'date-fns/locale'
import { useReservations } from '../../hooks/useReservations'
import { sendWhatsAppMessage } from '../../lib/whatsapp'
import { RESERVATION_STATES, RESERVATION_DURATION_MIN } from '../../utils/constants'
import ReservationModal from './ReservationModal'
import ReservationDetail from './ReservationDetail'

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
  return {
    id: r.reserva_id,
    title: `${r.nombre_cliente || 'Sin nombre'} · ${r.personas} pers.`,
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
  const [toast, setToast] = useState(null)   // null | { type, text }
  const toastTimer = useRef(null)

  const events = useMemo(() => reservations.map(toEvent), [reservations])

  function showToast(type, text) {
    clearTimeout(toastTimer.current)
    setToast({ type, text })
    toastTimer.current = setTimeout(() => setToast(null), 4500)
  }

  async function notifyClient(kind, r) {
    const { fecha, hora } = reservaFechaLegible(r)
    const nombre = r.nombre_cliente || ''
    const text = kind === 'create'
      ? `¡Hola ${nombre}! Tu reserva en Vera Pizzería quedó registrada 🍕\n\n📅 ${fecha}\n🕗 ${hora}\n👥 ${r.personas} ${r.personas === 1 ? 'persona' : 'personas'}\n\n¡Te esperamos!`
      : `Hola ${nombre}, tu reserva del ${fecha} a las ${hora} fue cancelada. Si deseas reprogramarla, escríbenos por aquí y con gusto te ayudamos 🍕`

    try {
      await sendWhatsAppMessage(r.telefono, text)
      showToast('success', kind === 'create'
        ? '✓ Reserva creada — cliente notificado por WhatsApp'
        : '✓ Reserva eliminada — cliente notificado por WhatsApp')
    } catch (waError) {
      console.error('Error notificando por WhatsApp:', waError)
      showToast('warn', kind === 'create'
        ? 'Reserva creada, pero falló la notificación por WhatsApp'
        : 'Reserva eliminada, pero falló la notificación por WhatsApp')
    }
  }

  async function handleCreate(form) {
    const { error: createError, reservation } = await createReservation(form)
    if (createError) return { error: createError }
    notifyClient('create', reservation)
    return { error: null }
  }

  async function handleDelete(r) {
    const { error: deleteError } = await deleteReservation(r.reserva_id)
    if (deleteError) {
      showToast('error', deleteError)
      return { error: deleteError }
    }
    setDetail(null)
    notifyClient('delete', r)
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

      {toast && (
        <div className={`rsv-toast ${toast.type}`}>{toast.text}</div>
      )}
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

      <button className="rsv-new" onClick={onNew}>+ Nueva reserva</button>
    </div>
  )
}
