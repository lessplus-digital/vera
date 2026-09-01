// Permisos por rol — para la UI.
//
// ⚠️ ESTO NO ES LA FRONTERA DE SEGURIDAD. La frontera son las políticas RLS de
// Supabase (ver `docs/database/schema.md` §Modelo de permisos). El JWT viaja en
// cada llamada REST y de realtime, así que un domiciliario que pida
// `GET /rest/v1/pedidos?select=*` recibe SOLO sus domicilios asignados —
// lo diga o no este archivo.
//
// Lo que hace este archivo es evitarle al usuario pantallas que la BD ya le
// vacía: un mesero no debería ver la tab Soporte para encontrarse una lista
// vacía y creer que está rota. Es cortesía, no protección.
//
// Regla al tocarlo: cada entrada de aquí tiene que corresponder a una política
// real. Si aflojas algo aquí sin aflojar la RLS, la pantalla se ve pero llega
// vacía; si lo aflojas en la RLS sin actualizar aquí, abriste un agujero de
// verdad. La tabla de referencia está en `docs/database/schema.md`.

export const ROLES = {
  ADMIN:        'admin',
  MESERO:       'mesero',
  DOMICILIARIO: 'domiciliario',
}

export const ROL_LABEL = {
  admin:        'Administrador',
  mesero:       'Mesero',
  domiciliario: 'Domiciliario',
}

// Tabs del sidebar visibles por rol. El orden lo define NAV_ITEMS en Sidebar.
//
// El mesero no tiene sección de salón todavía (depende de PLATEO-52): hoy su
// alcance real son pedidos, historial, clientes, reservas y consultar el menú.
const TABS_POR_ROL = {
  admin: [
    'dashboard', 'soporte', 'estadisticas', 'historial',
    'clientes', 'reservas', 'menu', 'resenas', 'usuarios', 'configuracion',
  ],
  mesero: [
    'dashboard', 'historial', 'clientes', 'reservas', 'menu',
  ],
  // El domiciliario no navega: su pantalla es la lista de sus entregas.
  domiciliario: [
    'dashboard',
  ],
}

// Capacidades sueltas que no son "una tab". Cada una refleja una política.
const CAPACIDADES_POR_ROL = {
  admin: {
    asignarDomiciliario: true,  // pedidos.domiciliario_id — solo admin
    editarPedido:        true,  // RPC editar_pedido
    crearPedido:         true,
    cambiarEstadoPedido: true,  // UPDATE directo sobre pedidos
    marcarEntregado:     true,  // RPC marcar_entregado
    // Tab Usuarios: `perfiles` (RLS `es_admin()` + trigger_proteger_perfil),
    // el bucket `avatares` (políticas con `OR es_admin()`) y las contraseñas
    // vía la Edge Function `admin-password`, que revalida el rol por su cuenta.
    gestionarUsuarios:   true,
    gestionarMenu:       true,
  },
  mesero: {
    // Lo respalda `trigger_validar_asignacion`, no la RLS: el mesero necesita
    // UPDATE sobre `pedidos` para el flujo de cocina, y una política no puede
    // limitar UNA columna. Sin el trigger podía reasignar el reparto por API.
    asignarDomiciliario: false,
    editarPedido:        true,
    crearPedido:         true,
    cambiarEstadoPedido: true,
    marcarEntregado:     true,
    gestionarUsuarios:   false,
    gestionarMenu:       false, // solo lectura del catálogo
  },
  domiciliario: {
    asignarDomiciliario: false,
    editarPedido:        false,
    crearPedido:         false,
    cambiarEstadoPedido: false, // no tiene política de UPDATE: solo el RPC
    marcarEntregado:     true,
    gestionarUsuarios:   false,
    gestionarMenu:       false,
  },
}

/** Tabs que puede ver un rol. Rol desconocido o nulo → ninguna. */
export function tabsPermitidas(rol) {
  return TABS_POR_ROL[rol] ?? []
}

/** ¿Este rol puede ver esta tab? */
export function puedeVerTab(rol, tab) {
  return tabsPermitidas(rol).includes(tab)
}

/** ¿Este rol tiene esta capacidad? Desconocida o rol nulo → false (falla cerrado). */
export function puede(rol, capacidad) {
  return CAPACIDADES_POR_ROL[rol]?.[capacidad] ?? false
}

/** Primera tab del rol — a dónde cae al entrar. */
export function tabInicial(rol) {
  return tabsPermitidas(rol)[0] ?? null
}
