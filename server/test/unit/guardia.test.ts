import { describe, expect, it } from 'vitest'
import { conGuardia, leerMonto, pesos, revisar, type Hechos } from '../../src/guardia/guardia.js'

const reglas = (texto: string, h: Hechos) => revisar(texto, h).map((v) => v.regla)

describe('leerMonto / pesos', () => {
  it.each([
    ['$7.500', 7500],
    ['$ 7500', 7500],
    ['$45.000,', 45000],
    ['7.500 pesos', 7500],
    ['7 mil', 7000],
    ['7,5 mil', 7500],
    ['$1.250.000', 1250000],
  ])('%s → %d', (t, n) => expect(leerMonto(t)).toBe(n))

  it('formatea como en Colombia', () => {
    expect(pesos(7500)).toBe('$7.500')
    expect(pesos(1250000)).toBe('$1.250.000')
  })
})

describe('BUG-061: barrio sin cobertura', () => {
  const h: Hechos = { montos: [], cobertura: { cubierto: false } }

  it('bloquea la tarifa y el tiempo sacados de la memoria', () => {
    expect(reglas('¡Claro! El domicilio a Niquía cuesta $7.500 y llega en 30 a 45 minutos 🛵', h)).toEqual([
      'monto_desconocido',
      'tiempo_sin_cobertura',
    ])
  })

  it('deja pasar la respuesta correcta (sugerir el barrio)', () => {
    expect(reglas('No encontré "niqia" 🤔 ¿Quisiste decir Niquía?', h)).toEqual([])
  })

  it('con cobertura, el tiempo sí se puede decir', () => {
    expect(reglas('Llega en 30 a 45 minutos, el domicilio es $7.500', { montos: [7500], cobertura: { cubierto: true } })).toEqual([])
  })
})

describe('montos', () => {
  it('solo pasan los que devolvió una herramienta', () => {
    const h: Hechos = { montos: [32000, 5000] }
    expect(reglas('La hawaiana mediana está en $32.000 y el domicilio $5.000', h)).toEqual([])
    expect(reglas('La hawaiana mediana está en $30.000', h)).toEqual(['monto_desconocido'])
  })

  it('un número con punto de miles sin "$" también es plata', () => {
    expect(reglas('La estofada mediana está en 51.500', { montos: [51500] })).toEqual([])
    expect(reglas('La estofada mediana está en 49.000', { montos: [51500] })).toEqual(['monto_desconocido'])
  })

  it('números que no son dinero no cuentan', () => {
    expect(reglas('Somos 4 personas, a las 7 y media', { montos: [] })).toEqual([])
  })
})

describe('pedido', () => {
  it('pedido creado: tiene que decir el id y el total exactos', () => {
    const h: Hechos = { montos: [], pedidoCreado: { pedido_id: 'PED-301', total: 45500 } }
    expect(reglas('¡Listo! Tu pedido PED-301 por $45.500 quedó registrado 🍕', h)).toEqual([])
    expect(reglas('¡Listo! Tu pedido quedó registrado 🍕', h)).toEqual(['pedido_sin_id_o_total'])
    expect(reglas('Tu pedido PED-301 por $45.000 quedó registrado', h)).toEqual(['monto_desconocido', 'pedido_sin_id_o_total'])
  })

  it('no puede decir que el pedido quedó creado si no se creó', () => {
    expect(reglas('¡Perfecto! Tu pedido quedó confirmado 🙌', { montos: [] })).toEqual(['pedido_inventado'])
  })

  it('sí puede hablar de un pedido suyo que ya existe', () => {
    expect(reglas('Tu pedido PED-280 está confirmado y en cocina', { montos: [], pedidosConocidos: ['PED-280'] })).toEqual([])
  })

  it('no puede citar un id que no es suyo', () => {
    expect(reglas('Tu pedido PED-999 va en camino', { montos: [], pedidosConocidos: ['PED-280'] })).toEqual(['pedido_inventado'])
  })
})

describe('internos', () => {
  it.each(['Lo revisé en el sistema', 'No me aparece en nuestro sistema', 'Según la base de datos', 'Voy a usar mi herramienta', 'Error de n8n'])(
    'bloquea "%s"',
    (t) => expect(reglas(t, { montos: [] })).toContain('internos'),
  )
})

describe('conGuardia', () => {
  const h: Hechos = { montos: [], cobertura: { cubierto: false } }

  it('pasa a la primera sin regenerar', async () => {
    let n = 0
    const r = await conGuardia(async () => (n++, 'Ese barrio no lo cubrimos 🙏'), h, 'SEGURO')
    expect(r).toMatchObject({ texto: 'Ese barrio no lo cubrimos 🙏', intentos_fallidos: 0 })
    expect(n).toBe(1)
  })

  it('regenera una vez pasándole lo que falló', async () => {
    const vistas: string[][] = []
    const r = await conGuardia(
      async (v) => {
        vistas.push(v.map((x) => x.regla))
        return v.length ? 'Ese barrio no lo cubrimos 🙏' : 'Llega en 40 minutos'
      },
      h,
      'SEGURO',
    )
    expect(vistas).toEqual([[], ['tiempo_sin_cobertura']])
    expect(r).toMatchObject({ texto: 'Ese barrio no lo cubrimos 🙏', intentos_fallidos: 1 })
  })

  it('si falla dos veces sale el texto seguro', async () => {
    const r = await conGuardia(async () => 'Llega en 40 minutos, $7.500', h, 'SEGURO')
    expect(r.texto).toBe('SEGURO')
    expect(r.intentos_fallidos).toBe(2)
    expect(r.violaciones.length).toBeGreaterThan(0)
  })
})
