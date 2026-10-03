import { describe, expect, it } from 'vitest'
import { cargarConfig } from '../../src/config.js'

const base = { WA_VERIFY_TOKEN: 'v', WA_APP_SECRET: 's', WA_MODO: 'fake', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'k' }

describe('config', () => {
  it('arranca con .env.example tal cual: HOOK_TOKEN vacío = avisos apagados', () => {
    expect(cargarConfig({ ...base, HOOK_TOKEN: '' }).HOOK_TOKEN).toBeUndefined()
    expect(() => cargarConfig({ ...base, HOOK_TOKEN: 'corto' })).toThrow(/HOOK_TOKEN/)
    expect(cargarConfig({ ...base, HOOK_TOKEN: 'x'.repeat(16) }).HOOK_TOKEN).toHaveLength(16)
  })

  it('DASHBOARD_ORIGENES: lista separada por comas, vacía por defecto', () => {
    expect(cargarConfig(base).DASHBOARD_ORIGENES).toEqual([])
    expect(cargarConfig({ ...base, DASHBOARD_ORIGENES: 'https://vera.plateo.cloud, http://localhost:5173,' }).DASHBOARD_ORIGENES).toEqual([
      'https://vera.plateo.cloud',
      'http://localhost:5173',
    ])
  })
})
