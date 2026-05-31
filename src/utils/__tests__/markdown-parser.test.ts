/* eslint-disable */
import { vi, describe, it, expect } from 'vitest';
import { convertMermaidBlockToUrl, restoreUrlToCodeBlock } from '../../ui/editor-handlers';
import { parseImageLink, extractTitle, slugify, stripInjectedTheme } from '../markdown-parser';

// Mock obsidian before importing anything that uses it
vi.mock("obsidian", () => {
  return {
    Notice: class {
      constructor(public message: string, public duration?: number) {}
      hide() {}
    },
    MarkdownRenderer: {
      render: vi.fn(),
    },
    Component: class {
      load() {}
      unload() {}
    },
    MarkdownView: class {
      previewMode = {
        rerender: vi.fn(),
      };
      getMode() {
        return "source";
      }
    },
    requestUrl: vi.fn(),
  };
});

// Setup mock document for window/DOM environment
(globalThis as any).activeDocument = {
  body: {
    classList: {
      contains: (cls: string) => cls === "theme-dark",
    },
    createEl: (tag: string) => {
      if (tag === "canvas") {
        return {
          getContext: () => ({
            drawImage: () => {},
          }),
          toBlob: (cb: any) => cb(new Blob()),
          remove: () => {},
        };
      }
      return {
        setAttribute: () => {},
        appendChild: () => {},
        style: {},
      };
    },
  },
} as any;

(globalThis as any).activeWindow = {} as any;

const mockApp = {
  workspace: {
    getActiveFile: () => ({ path: "note.md" }),
    getActiveViewOfType: () => ({
      previewMode: {
        rerender: () => {},
      },
    }),
  },
  vault: {
    read: async () => "",
    modify: async () => {},
  },
} as any;

class MockEditor {
  lines: string[];
  cursorLine: number;

  constructor(lines: string[], cursorLine: number = 0) {
    this.lines = lines;
    this.cursorLine = cursorLine;
  }

  getCursor() {
    return { line: this.cursorLine, ch: 0 };
  }

  lineCount() {
    return this.lines.length;
  }

  getLine(i: number) {
    return this.lines[i] || "";
  }

  replaceRange(
    text: string,
    start: { line: number; ch: number },
    end: { line: number; ch: number }
  ) {
    const before = this.lines.slice(0, start.line);
    const after = this.lines.slice(end.line + 1);
    const newLines = text.split("\n");
    this.lines = [...before, ...newLines, ...after];
  }
}

describe('Mermaid Plugin Specs', () => {
  describe("Convert Block to URL Spec", () => {
    it("should convert active Mermaid block to Kroki URL and replace in editor", async () => {
      const plugin = {
        settings: {
          urlFormat: "png",
          service: "kroki",
          krokiServerUrl: "https://kroki.io",
          theme: "default",
        },
        saveSettings: async () => {},
      } as any;

      const editor = new MockEditor([
        "Some introduction text",
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```",
        "Some concluding text"
      ], 2); // cursor inside block

      await convertMermaidBlockToUrl(mockApp, editor as any, plugin);

      // Verify that the code block has been replaced by an image link
      expect(editor.lines[1]).toContain("![Mermaid Diagram](https://kroki.io/mermaid/png/");
      expect(editor.lines[2]).toBe("Some concluding text"); // block is gone, lines shifted up
    });

    it("should convert active Mermaid block to Mermaid.ink URL with theme", async () => {
      const plugin = {
        settings: {
          urlFormat: "svg",
          service: "mermaid-ink",
          mermaidInkServerUrl: "https://mermaid.ink",
          theme: "dark",
        },
        saveSettings: async () => {},
      } as any;

      const editor = new MockEditor([
        "```mermaid",
        "graph TD",
        "  A --> B",
        "```",
      ], 1);

      await convertMermaidBlockToUrl(mockApp, editor as any, plugin);

      expect(editor.lines[0]).toContain("![Mermaid Diagram](https://mermaid.ink/svg/pako:");
    });
  });

  describe("Restore URL to Mermaid Spec", () => {
    it("should restore a Kroki URL back to active code block", async () => {
      const plugin = {
        settings: {
          theme: "default",
        },
      } as any;

      // First let's generate a valid Kroki URL to use for restoring
      const testCode = "graph TD\n  A --> B";
      const pluginForGen = {
        settings: {
          urlFormat: "png",
          service: "kroki",
          krokiServerUrl: "https://kroki.io",
          theme: "default",
        },
      } as any;
      const editorForGen = new MockEditor(["```mermaid", testCode, "```"], 1);
      await convertMermaidBlockToUrl(mockApp, editorForGen as any, pluginForGen);
      const generatedUrlLine = editorForGen.lines[0] || "";

      // Now restore it
      const editorToRestore = new MockEditor([generatedUrlLine], 0);
      await restoreUrlToCodeBlock(mockApp, editorToRestore as any, plugin);

      expect(editorToRestore.lines[0]).toBe("```mermaid");
      expect(editorToRestore.lines[1]).toContain("graph TD");
      expect(editorToRestore.lines[2]).toContain("A --> B");
      expect(editorToRestore.lines[3]).toBe("```");
    });

    it("should restore a Mermaid.ink URL back to active code block", async () => {
      const plugin = {
        settings: {
          theme: "default",
        },
      } as any;

      const testCode = "graph TD\n  A --> C";
      const pluginForGen = {
        settings: {
          urlFormat: "svg",
          service: "mermaid-ink",
          mermaidInkServerUrl: "https://mermaid.ink",
          theme: "default",
        },
      } as any;
      const editorForGen = new MockEditor(["```mermaid", testCode, "```"], 1);
      await convertMermaidBlockToUrl(mockApp, editorForGen as any, pluginForGen);
      const generatedUrlLine = editorForGen.lines[0] || "";

      const editorToRestore = new MockEditor([generatedUrlLine], 0);
      await restoreUrlToCodeBlock(mockApp, editorToRestore as any, plugin);

      expect(editorToRestore.lines[0]).toBe("```mermaid");
      expect(editorToRestore.lines[1]).toContain("graph TD");
      expect(editorToRestore.lines[2]).toContain("A --> C");
      expect(editorToRestore.lines[3]).toBe("```");
    });
  });

  describe("Metadata & Title Specs", () => {
    it("should extract title from diagram frontmatter", () => {
      const code = "---\ntitle: Network Architecture\n---\nflowchart TD\n  A";
      expect(extractTitle(code)).toBe("Network Architecture");
    });

    it("should extract title from diagram specific inline syntax", () => {
      const code = "pie title Favorite Foods\n  \"Apples\" : 45";
      expect(extractTitle(code)).toBe("Favorite Foods");
    });

    it("should slugify title to URL-safe filename format", () => {
      expect(slugify("Network Architecture (Draft 1)")).toBe("network-architecture-draft-1");
    });
  });

  describe("Theme Handling Specs", () => {
    it("should strip auto-injected theme directive when restoring", () => {
      const code = "%%{init: {'theme': 'dark'}}%%\ngraph TD\n  A --> B";
      expect(stripInjectedTheme(code)).toBe("graph TD\n  A --> B");
    });
  });

  describe("Image Link Parsing Spec", () => {
    it("should identify remote diagram URLs correctly", () => {
      const parsed = parseImageLink("![alt](https://mermaid.ink/img/pako:abc)");
      expect(parsed).not.toBeNull();
      expect(parsed!.path).toBe("https://mermaid.ink/img/pako:abc");
      expect(parsed!.isRemote).toBe(true);
    });

    it("should identify wiki-style image links", () => {
      const parsed = parseImageLink("![[attachments/image.png]]");
      expect(parsed).not.toBeNull();
      expect(parsed!.path).toBe("attachments/image.png");
      expect(parsed!.isRemote).toBe(false);
    });
  });
});
