import { requestUrl } from "obsidian";

/**
 * Configuration options for the Kroki client.
 */
export interface KrokiClientOptions {
  /**
   * The base URL of the Kroki server (e.g. 'https://kroki.io' or 'http://localhost:8000').
   */
  serverUrl?: string;
}

/**
 * Kroki client responsible for communicating with the Kroki API
 * to render Mermaid diagrams into PNG images.
 */
export class KrokiClient {
  private serverUrl: string;

  /**
   * Creates an instance of the Kroki client.
   * @param options Initial configuration options.
   */
  constructor(options: KrokiClientOptions = {}) {
    // Normalize URL by removing the trailing slash if it exists
    this.serverUrl = (options.serverUrl || "https://kroki.io").replace(/\/$/, "");
  }

  /**
   * Sends the Mermaid diagram source code to the Kroki API and returns
   * the resulting PNG image as an ArrayBuffer.
   * 
   * @param mermaidCode The Mermaid diagram source code.
   * @returns A Promise resolving to the ArrayBuffer representing the PNG image.
   * @throws Error if the API call fails (HTTP status code other than 200).
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

      // Validate HTTP response status
      if (response.status === 200) {
        return response.arrayBuffer;
      }

      // Handle Rate Limit status code explicitly
      if (response.status === 429) {
        throw new Error(
          "Kroki API: Rate limit exceeded. Please try again later or configure a custom Kroki instance in settings."
        );
      }

      throw new Error(`Kroki API: Error ${response.status} - ${response.text || "Unknown error"}`);
    } catch (error) {
      // If it is already a formatted error thrown by us, rethrow it
      if (error instanceof Error && error.message.startsWith("Kroki API:")) {
        throw error;
      }

      // In case the response details are encapsulated inside the error thrown by requestUrl
      const status = (error as { status?: number })?.status;
      const text = (error as { text?: string })?.text;

      if (status) {
        if (status === 429) {
          throw new Error(
            "Kroki API: Rate limit exceeded. Please try again later or configure a custom Kroki instance in settings."
          );
        }
        throw new Error(`Kroki API: Error ${status} - ${text || "Unknown network error"}`);
      }

      // Generic connection error
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Kroki API: Network error - ${message}`);
    }
  }
}
