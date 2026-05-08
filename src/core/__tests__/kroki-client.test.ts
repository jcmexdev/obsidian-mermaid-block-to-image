import { vi, describe, it, expect, beforeEach } from 'vitest';
import { KrokiClient } from '../kroki-client';
import { requestUrl } from 'obsidian';

// Mock Obsidian requestUrl
vi.mock('obsidian', () => ({
  requestUrl: vi.fn(),
}));

describe('KrokiClient', () => {
  let client: KrokiClient;
  const mockServerUrl = 'https://kroki.io';

  beforeEach(() => {
    client = new KrokiClient({ serverUrl: mockServerUrl });
    vi.clearAllMocks();
  });

  it('should make a POST request to the correct endpoint and return an ArrayBuffer', async () => {
    // Arrange
    const dummyBuffer = new ArrayBuffer(8);
    const mockResponse = {
      status: 200,
      headers: {},
      arrayBuffer: dummyBuffer,
      text: 'PNG binary content',
      json: null,
    };
    vi.mocked(requestUrl).mockResolvedValue(mockResponse as any);

    const mermaidCode = 'graph TD\n  A --> B';

    // Act
    const result = await client.generateImage(mermaidCode);

    // Assert
    expect(requestUrl).toHaveBeenCalledWith({
      url: 'https://kroki.io/mermaid/png',
      method: 'POST',
      contentType: 'text/plain',
      body: mermaidCode,
    });
    expect(result).toBe(dummyBuffer);
  });

  it('should throw an error with status and text if Kroki returns non-200 status', async () => {
    // Arrange
    const mockResponse = {
      status: 400,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
      text: 'Error in diagram syntax',
      json: null,
    };
    vi.mocked(requestUrl).mockResolvedValue(mockResponse as any);

    const mermaidCode = 'graph TD\n  A -x- B';

    // Act & Assert
    await expect(client.generateImage(mermaidCode)).rejects.toThrow(
      'Kroki API: Error 400 - Error in diagram syntax'
    );
  });

  it('should throw a custom error for rate limit (429)', async () => {
    // Arrange
    const mockResponse = {
      status: 429,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
      text: 'Too Many Requests',
      json: null,
    };
    vi.mocked(requestUrl).mockResolvedValue(mockResponse as any);

    // Act & Assert
    await expect(client.generateImage('graph TD\nA')).rejects.toThrow(
      'Kroki API: Rate limit exceeded. Please try again later or configure a custom Kroki instance in settings.'
    );
  });

  it('should respect custom server URLs in configuration', async () => {
    // Arrange
    const customClient = new KrokiClient({ serverUrl: 'http://localhost:8000' });
    const dummyBuffer = new ArrayBuffer(4);
    vi.mocked(requestUrl).mockResolvedValue({
      status: 200,
      headers: {},
      arrayBuffer: dummyBuffer,
      text: '',
      json: null,
    } as any);

    // Act
    await customClient.generateImage('graph TD\nA');

    // Assert
    expect(requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'http://localhost:8000/mermaid/png',
      })
    );
  });
});
