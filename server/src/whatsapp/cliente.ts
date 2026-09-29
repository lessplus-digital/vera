// Salida hacia WhatsApp. El resto del servidor solo conoce esta interfaz, así
// las pruebas y el simulador usan `FakeWhatsApp` sin tocar Meta.

export type ParametroPlantilla = string

export interface WhatsApp {
  enviarTexto(telefono: string, texto: string): Promise<{ id: string }>
  enviarPlantilla(
    telefono: string,
    nombre: string,
    idioma: string,
    parametros: ParametroPlantilla[],
  ): Promise<{ id: string }>
}

export class ErrorWhatsApp extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codigoMeta: number | null,
  ) {
    super(message)
    this.name = 'ErrorWhatsApp'
  }
}

type OpcionesGraph = {
  accessToken: string
  phoneNumberId: string
  apiVersion: string
  fetch?: typeof fetch
}

export class GraphWhatsApp implements WhatsApp {
  private readonly url: string
  private readonly fetch: typeof fetch

  constructor(private readonly o: OpcionesGraph) {
    this.url = `https://graph.facebook.com/${o.apiVersion}/${o.phoneNumberId}/messages`
    this.fetch = o.fetch ?? fetch
  }

  enviarTexto(telefono: string, texto: string) {
    return this.enviar({ to: telefono, type: 'text', text: { preview_url: true, body: texto } })
  }

  enviarPlantilla(telefono: string, nombre: string, idioma: string, parametros: ParametroPlantilla[]) {
    // Meta rechaza parámetros con saltos de línea, tabs o 4+ espacios seguidos.
    const limpios = parametros.map((p) => p.replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   '))
    return this.enviar({
      to: telefono,
      type: 'template',
      template: {
        name: nombre,
        language: { code: idioma },
        components: limpios.length
          ? [{ type: 'body', parameters: limpios.map((text) => ({ type: 'text', text })) }]
          : [],
      },
    })
  }

  private async enviar(cuerpo: Record<string, unknown>): Promise<{ id: string }> {
    const res = await this.fetch(this.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.o.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...cuerpo }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[]
      error?: { message?: string; code?: number }
    }
    if (!res.ok || !json.messages?.[0]) {
      throw new ErrorWhatsApp(json.error?.message ?? `HTTP ${res.status}`, res.status, json.error?.code ?? null)
    }
    return { id: json.messages[0].id }
  }
}

export type Enviado =
  | { tipo: 'texto'; telefono: string; texto: string; id: string }
  | { tipo: 'plantilla'; telefono: string; nombre: string; idioma: string; parametros: string[]; id: string }

/** Guarda en memoria todo lo que "se envió". Para pruebas, simulador y WA_MODO=fake. */
export class FakeWhatsApp implements WhatsApp {
  readonly enviados: Enviado[] = []
  private n = 0

  async enviarTexto(telefono: string, texto: string) {
    const id = `wamid.fake.${++this.n}`
    this.enviados.push({ tipo: 'texto', telefono, texto, id })
    return { id }
  }

  async enviarPlantilla(telefono: string, nombre: string, idioma: string, parametros: string[]) {
    const id = `wamid.fake.${++this.n}`
    this.enviados.push({ tipo: 'plantilla', telefono, nombre, idioma, parametros, id })
    return { id }
  }

  textosPara(telefono: string): string[] {
    return this.enviados.filter((e) => e.telefono === telefono && e.tipo === 'texto').map((e) => (e as { texto: string }).texto)
  }
}
