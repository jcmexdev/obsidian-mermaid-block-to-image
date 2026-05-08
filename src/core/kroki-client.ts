import { requestUrl } from "obsidian";

/**
 * Opciones de configuración para el cliente de Kroki.
 */
export interface KrokiClientOptions {
  /**
   * La URL base de la instancia de Kroki (ej. 'https://kroki.io' o 'http://localhost:8000').
   */
  serverUrl?: string;
}

/**
 * Cliente Kroki encargado de interactuar con la API de Kroki para renderizar
 * diagramas Mermaid en formato PNG.
 */
export class KrokiClient {
  private serverUrl: string;

  /**
   * Crea una instancia del cliente de Kroki.
   * @param options Opciones de configuración inicial.
   */
  constructor(options: KrokiClientOptions = {}) {
    // Normalizar la URL eliminando la barra diagonal final si existe
    this.serverUrl = (options.serverUrl || "https://kroki.io").replace(/\/$/, "");
  }

  /**
   * Envía el código de un diagrama Mermaid a la API de Kroki y devuelve
   * la imagen PNG resultante como un ArrayBuffer.
   * 
   * @param mermaidCode El código fuente del diagrama Mermaid.
   * @returns Un Promise que se resuelve con el ArrayBuffer que representa la imagen PNG.
   * @throws Error si la llamada a la API falla (código HTTP distinto de 200).
   */
  async generateImage(mermaidCode: string): Promise<ArrayBuffer> {
    const url = `${this.serverUrl}/mermaid/png`;

    try {
      const response = await requestUrl({
        url,
        method: "POST",
        contentType: "text/plain",
        body: mermaidCode,
      });

      // Validar código de respuesta HTTP
      if (response.status === 200) {
        return response.arrayBuffer;
      }

      // Tratar específicamente el código de límite de velocidad (Rate Limit)
      if (response.status === 429) {
        throw new Error(
          "Kroki API: Rate limit exceeded. Please try again later or configure a custom Kroki instance in settings."
        );
      }

      throw new Error(`Kroki API: Error ${response.status} - ${response.text || "Unknown error"}`);
    } catch (error) {
      // Si ya es un error formateado por nosotros, volver a lanzarlo
      if (error instanceof Error && error.message.startsWith("Kroki API:")) {
        throw error;
      }

      // En el caso de que la respuesta venga en el objeto de error arrojado por requestUrl
      const status = (error as any)?.status;
      const text = (error as any)?.text;

      if (status) {
        if (status === 429) {
          throw new Error(
            "Kroki API: Rate limit exceeded. Please try again later or configure a custom Kroki instance in settings."
          );
        }
        throw new Error(`Kroki API: Error ${status} - ${text || "Unknown network error"}`);
      }

      // Error genérico de conexión
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Kroki API: Network error - ${message}`);
    }
  }
}
