// Salida hacia WhatsApp. El resto del servidor solo conoce esta interfaz, así
// las pruebas y el simulador usan `FakeWhatsApp` sin tocar Meta.

export type ParametroPlantilla = string

export type Media = { bytes: Uint8Array; mime: string }

export interface WhatsApp {
  enviarTexto(telefono: string, texto: string): Promise<{ id: string }>
  /** Descarga una foto/archivo que mandó el cliente (por su media id). */
  descargarMedia(mediaId: string): Promise<Media>
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

  // Meta en dos pasos: GET /{media-id} da una URL temporal; esa URL también exige el token.
  async descargarMedia(mediaId: string): Promise<Media> {
    const auth = { Authorization: `Bearer ${this.o.accessToken}` }
    const info = await this.fetch(`https://graph.facebook.com/${this.o.apiVersion}/${mediaId}`, { headers: auth })
    const meta = (await info.json().catch(() => ({}))) as { url?: string; mime_type?: string; error?: { message?: string; code?: number } }
    if (!info.ok || !meta.url) {
      throw new ErrorWhatsApp(meta.error?.message ?? `media ${mediaId}: HTTP ${info.status}`, info.status, meta.error?.code ?? null)
    }
    const archivo = await this.fetch(meta.url, { headers: auth })
    if (!archivo.ok) throw new ErrorWhatsApp(`descarga de media: HTTP ${archivo.status}`, archivo.status, null)
    return {
      bytes: new Uint8Array(await archivo.arrayBuffer()),
      mime: meta.mime_type ?? archivo.headers.get('content-type') ?? 'application/octet-stream',
    }
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
  /** Media ids que fallan al descargar (para probar el camino de error). */
  readonly mediaQueFalla = new Set<string>()
  /** mime de cada media id (como lo reporta Meta); el simulador lo registra al enviar la foto. */
  readonly mimes = new Map<string, string>()
  private n = 0

  async descargarMedia(mediaId: string): Promise<Media> {
    if (this.mediaQueFalla.has(mediaId)) throw new ErrorWhatsApp(`media ${mediaId} no disponible`, 404, null)
    return { bytes: new TextEncoder().encode(`imagen-falsa:${mediaId}`), mime: this.mimes.get(mediaId) ?? 'image/jpeg' }
  }

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
