import { App, Component, Editor, MarkdownRenderer, MarkdownView, Notice } from "obsidian";
import MermaidToImagePlugin from "../main";
import {
  extractTitle,
  extractWidth,
  updateWidthInCode,
  findMermaidBlockAtLine,
  getCodeHash,
  parseImageLink,
  slugify,
  injectThemeDirective,
  stripInjectedTheme,
  hasThemeInCode
} from "../utils/markdown-parser";

/**
 * Resolves the effective Mermaid theme.
 * If set to 'match-obsidian', it dynamically queries the body class of the active window.
 */
function getEffectiveTheme(plugin: MermaidToImagePlugin): string {
  const theme = plugin.settings.theme;
  if (theme === "match-obsidian") {
    const isDark = activeDocument?.body?.classList.contains("theme-dark") ?? false;
    return isDark ? "dark" : "default";
  }
  return theme;
}

/**
 * Compresses a string using deflate and encodes it into URL-safe base64.
 * Uses native browser CompressionStream.
 */
async function compressAndEncode(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const stream = new Blob([data]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream("deflate"));
  const compressedBuffer = await new Response(compressedStream).arrayBuffer();
  
  const bytes = new Uint8Array(compressedBuffer);
  let binString = "";
  bytes.forEach((b) => {
    binString += String.fromCharCode(b);
  });
  return btoa(binString)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decodes a URL-safe base64 string and decompresses it using deflate.
 * Uses native browser DecompressionStream.
 */
async function decodeAndDecompress(base64: string): Promise<string> {
  let standardBase64 = base64.replace(/-/g, "+").replace(/_/g, "/");
  while (standardBase64.length % 4) {
    standardBase64 += "=";
  }
  
  const binString = atob(standardBase64);
  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  
  const stream = new Blob([bytes]).stream();
  const decompressedStream = stream.pipeThrough(new DecompressionStream("deflate"));
  const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();
  
  return new TextDecoder().decode(decompressedBuffer);
}

/**
 * Decodes the Mermaid diagram code from a Kroki or Mermaid.ink URL.
 */
export async function decodeDiagramFromUrl(url: string): Promise<string> {
  if (url.includes("mermaid.ink/")) {
    const pakoIdx = url.indexOf("/pako:");
    if (pakoIdx === -1) {
      throw new Error("Invalid Mermaid.ink URL format (missing '/pako:')");
    }
    const base64 = url.substring(pakoIdx + 6).split("?")[0] || "";
    const jsonStr = await decodeAndDecompress(base64);
    const state = JSON.parse(jsonStr) as { code?: unknown };
    if (!state || typeof state.code !== "string") {
      throw new Error("Decoded state does not contain diagram code.");
    }
    return state.code;
  }
  
  if (url.includes("kroki.io/") || url.includes("/mermaid/")) {
    const mermaidIdx = url.indexOf("/mermaid/");
    if (mermaidIdx === -1) {
      throw new Error("Invalid Kroki URL format");
    }
    const pathPart = url.substring(mermaidIdx + 9);
    const slashIdx = pathPart.indexOf("/");
    if (slashIdx === -1) {
      throw new Error("Invalid Kroki URL format (missing base64 segment)");
    }
    const base64 = pathPart.substring(slashIdx + 1).split("?")[0] || "";
    return await decodeAndDecompress(base64);
  }
  
  throw new Error("URL is not a recognized Kroki or Mermaid.ink diagram link.");
}

interface MermaidInstance {
  render: (id: string, text: string) => Promise<{ svg: string }>;
}

/**
 * Ensures Obsidian's internal Mermaid engine is fully loaded and initialized.
 * If not already loaded (e.g. at vault startup before opening a mermaid file),
 * it forces loading by rendering a dummy mermaid block using MarkdownRenderer.
 */
async function ensureMermaidLoaded(app: App): Promise<MermaidInstance | undefined> {
  const win = window as Window & { mermaid?: MermaidInstance };
  const mermaid = win.mermaid;
  if (mermaid) return mermaid;

  const dummy = activeDocument.body.createDiv();
  // eslint-disable-next-line obsidianmd/no-static-styles-assignment
  dummy.style.display = "none";
  try {
    const comp = new Component();
    comp.load();
    await MarkdownRenderer.render(app, "```mermaid\nflowchart TD\n  A\n```", dummy, "", comp);
    comp.unload();
  } catch (err) {
    console.error("Failed to force load mermaid via MarkdownRenderer:", err);
  } finally {
    dummy.remove();
  }

  return win.mermaid;
}

/**
 * Downloads a Mermaid block to the user's PC as an image file.
 * Formats: SVG, PNG, or WebP. Renders locally using Obsidian's Mermaid engine.
 */
export async function downloadMermaidAsFile(
  app: App,
  editor: Editor | null,
  plugin: MermaidToImagePlugin,
  targetLine?: number,
  sourcePath?: string,
  fallbackToCursor = true
): Promise<void> {
  let line = targetLine;
  if (line === undefined && fallbackToCursor && editor) {
    line = editor.getCursor().line;
  }
  if (line === undefined) {
    new Notice("Could not determine diagram line number.");
    return;
  }

  let lines: string[] = [];
  const activeFile = sourcePath ? app.vault.getFileByPath(sourcePath) : app.workspace.getActiveFile();

  if (editor) {
    const lineCount = editor.lineCount();
    for (let i = 0; i < lineCount; i++) {
      lines.push(editor.getLine(i));
    }
  } else {
    if (!activeFile) {
      new Notice("No active note found. Cannot download image.");
      return;
    }
    const fileContent = await app.vault.read(activeFile);
    lines = fileContent.split("\n");
  }

  let block = findMermaidBlockAtLine(lines, line);
  if (!block && targetLine !== undefined) {
    // Search outward to find the nearest block within 5 lines
    const maxOffset = Math.min(line, lines.length - line);
    for (let offset = 1; offset <= maxOffset && offset <= 5; offset++) {
      const prevLine = line - offset;
      if (prevLine >= 0) {
        const pBlock = findMermaidBlockAtLine(lines, prevLine);
        if (pBlock) {
          block = pBlock;
          line = prevLine;
          break;
        }
      }
      const nextLine = line + offset;
      if (nextLine < lines.length) {
        const nBlock = findMermaidBlockAtLine(lines, nextLine);
        if (nBlock) {
          block = nBlock;
          line = nextLine;
          break;
        }
      }
    }
  }
  if (!block) {
    new Notice("No active or commented Mermaid code block found.");
    return;
  }

  const format = plugin.settings.downloadFormat;
  const loadingNotice = new Notice(`Generating ${format.toUpperCase()} diagram for download...`, 0);

  try {
    const mermaid = await ensureMermaidLoaded(app);
    if (!mermaid) {
      throw new Error("Obsidian's global 'mermaid' instance is not available.");
    }
    const renderId = `mermaid-local-render-${Date.now()}`;
    const effectiveTheme = getEffectiveTheme(plugin);
    const themedCode = hasThemeInCode(block.code || "")
      ? (block.code || "")
      : injectThemeDirective(block.code || "", effectiveTheme);
    const { svg } = await mermaid.render(renderId, themedCode);
    if (!svg) {
      throw new Error("Local Mermaid render returned empty output.");
    }

    let downloadBlob: Blob;
    if (format === "svg") {
      downloadBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    } else {
      const bytes = new TextEncoder().encode(svg);
      let binString = "";
      bytes.forEach((b) => {
        binString += String.fromCharCode(b);
      });
      const svgDataURL = "data:image/svg+xml;base64," + btoa(binString);

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load SVG for conversion"));
        img.src = svgDataURL;
      });

      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      if (!width || !height) {
        const viewBoxMatch = svg.match(/viewBox=["']\s*([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s*["']/);
        if (viewBoxMatch) {
          const wStr = viewBoxMatch[3];
          const hStr = viewBoxMatch[4];
          if (wStr !== undefined && hStr !== undefined) {
            width = parseFloat(wStr);
            height = parseFloat(hStr);
          }
        }
      }
      if (!width) width = 800;
      if (!height) height = 600;

      const canvas = activeDocument.body.createEl("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Could not get 2D canvas context for image conversion");
      }
      ctx.drawImage(img, 0, 0, width, height);

      const mimeType = format === "webp" ? "image/webp" : "image/png";
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), mimeType);
      });

      if (!blob) {
        throw new Error(`Failed to convert canvas to ${format.toUpperCase()}`);
      }
      downloadBlob = blob;
      canvas.remove();
    }

    const title = extractTitle(block.code || "");
    const slug = title ? slugify(title) : "";
    const filename = slug ? `${slug}.${format}` : `mermaid-${await getCodeHash(block.code || "")}.${format}`;

    const url = URL.createObjectURL(downloadBlob);
    const a = activeDocument.body.createEl("a");
    a.href = url;
    a.download = filename;
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    loadingNotice.hide();
    new Notice(`Mermaid diagram downloaded successfully as ${format.toUpperCase()}!`);
  } catch (error) {
    loadingNotice.hide();
    const errorMsg = error instanceof Error ? error.message : String(error);
    new Notice(`Download failed: ${errorMsg}`);
    console.error("Mermaid download error:", error);
  }
}

/**
 * Converts a Mermaid code block to a URL-encoded image link in markdown.
 * Supports Kroki and Mermaid.ink. Deletes the code block entirely.
 */
export async function convertMermaidBlockToUrl(
  app: App,
  editor: Editor | null,
  plugin: MermaidToImagePlugin,
  targetLine?: number,
  sourcePath?: string,
  fallbackToCursor = true
): Promise<void> {
  const activeFile = sourcePath ? app.vault.getFileByPath(sourcePath) : app.workspace.getActiveFile();
  if (!activeFile) {
    new Notice("No active note found. Cannot convert diagram.");
    return;
  }

  let line = targetLine;
  if (line === undefined && fallbackToCursor && editor) {
    line = editor.getCursor().line;
  }
  if (line === undefined) {
    new Notice("Could not determine diagram line number.");
    return;
  }

  let lines: string[] = [];
  if (editor) {
    const lineCount = editor.lineCount();
    for (let i = 0; i < lineCount; i++) {
      lines.push(editor.getLine(i));
    }
  } else {
    const fileContent = await app.vault.read(activeFile);
    lines = fileContent.split("\n");
  }

  let block = findMermaidBlockAtLine(lines, line);
  if (!block && targetLine !== undefined) {
    // Search outward to find the nearest block within 5 lines
    const maxOffset = Math.min(line, lines.length - line);
    for (let offset = 1; offset <= maxOffset && offset <= 5; offset++) {
      const prevLine = line - offset;
      if (prevLine >= 0) {
        const pBlock = findMermaidBlockAtLine(lines, prevLine);
        if (pBlock) {
          block = pBlock;
          line = prevLine;
          break;
        }
      }
      const nextLine = line + offset;
      if (nextLine < lines.length) {
        const nBlock = findMermaidBlockAtLine(lines, nextLine);
        if (nBlock) {
          block = nBlock;
          line = nextLine;
          break;
        }
      }
    }
  }

  if (!block || block.type !== "active") {
    new Notice("No active Mermaid code block found.");
    return;
  }

  const format = plugin.settings.urlFormat;
  const service = plugin.settings.service;
  const loadingNotice = new Notice(`Generating diagram URL via ${service === "kroki" ? "Kroki" : "Mermaid.ink"}...`, 0);

  try {
    let url = "";

    const hasTheme = hasThemeInCode(block.code || "");
    const effectiveTheme = getEffectiveTheme(plugin);

    // Compute width options: prioritize diagram-specific frontmatter/comment or fallback to default 500
    const widthFromCode = extractWidth(block.code || "");
    const configWidth = widthFromCode || "500";
    const isPercent = configWidth.endsWith("%");
    const apiWidth = isPercent ? 1200 : (parseInt(configWidth) || 500);

    if (service === "kroki") {
      const server = (plugin.settings.krokiServerUrl || "https://kroki.io").replace(/\/$/, "");
      const krokiFormat = format === "webp" ? "png" : format;
      const themedCode = hasTheme
        ? (block.code || "")
        : injectThemeDirective(block.code || "", effectiveTheme);
      const base64 = await compressAndEncode(themedCode);
      url = `${server}/mermaid/${krokiFormat}/${base64}`;
    } else {
      const server = (plugin.settings.mermaidInkServerUrl || "https://mermaid.ink").replace(/\/$/, "");
      const themedCode = hasTheme
        ? (block.code || "")
        : injectThemeDirective(block.code || "", effectiveTheme);
      const state: { code: string; mermaid?: { theme: string } } = {
        code: themedCode,
      };
      if (!hasTheme) {
        state.mermaid = { theme: effectiveTheme };
      }
      const base64 = await compressAndEncode(JSON.stringify(state));
      
      if (format === "svg") {
        url = `${server}/svg/pako:${base64}?width=${apiWidth}`;
      } else if (format === "webp") {
        url = `${server}/img/pako:${base64}?type=webp`;
      } else {
        url = `${server}/img/pako:${base64}`;
      }
    }

    const title = extractTitle(block.code || "");
    const altText = title ? `${title}|${configWidth}` : `Mermaid Diagram|${configWidth}`;
    const replacementText = `![${altText}](${url})`;

    const endLine = block.endLine;

    if (editor) {
      const endCh = editor.getLine(endLine).length;
      editor.replaceRange(
        replacementText,
        { line: block.startLine, ch: 0 },
        { line: endLine, ch: endCh }
      );
    } else {
      lines.splice(block.startLine, endLine - block.startLine + 1, replacementText);
      await app.vault.modify(activeFile, lines.join("\n"));
    }

    const activeView = app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      activeView.previewMode.rerender(true);
    }

    loadingNotice.hide();
    new Notice(`Mermaid block converted to ${format.toUpperCase()} URL successfully!`);
  } catch (error) {
    loadingNotice.hide();
    const errorMsg = error instanceof Error ? error.message : String(error);
    new Notice(`URL generation failed: ${errorMsg}`);
    console.error("Mermaid URL generation error:", error);
  }
}

/**
 * Restores a diagram image URL back to an active code block.
 * Decodes base64 data directly from the URL.
 */
export async function restoreUrlToCodeBlock(
  app: App,
  editor: Editor | null,
  plugin: MermaidToImagePlugin,
  targetLine?: number,
  sourcePath?: string,
  fallbackToCursor = true
): Promise<void> {
  const activeFile = sourcePath ? app.vault.getFileByPath(sourcePath) : app.workspace.getActiveFile();
  if (!activeFile) {
    new Notice("No active note found.");
    return;
  }

  let line = targetLine;
  if (line === undefined && fallbackToCursor && editor) {
    line = editor.getCursor().line;
  }
  if (line === undefined) {
    new Notice("Could not determine diagram line number.");
    return;
  }

  let lines: string[] = [];
  if (editor) {
    const lineCount = editor.lineCount();
    for (let i = 0; i < lineCount; i++) {
      lines.push(editor.getLine(i));
    }
  } else {
    const fileContent = await app.vault.read(activeFile);
    lines = fileContent.split("\n");
  }

  const lineText = lines[line];
  if (!lineText) {
    new Notice("No diagram image link found at cursor line.");
    return;
  }

  // 1. Check if it is the old commented block format (backward compatibility)
  const block = findMermaidBlockAtLine(lines, line);
  if (block && block.type === "commented") {
    try {
      const imageLink = block.existingImageLink ? `%% ${block.existingImageLink} %%` : "";
      const cleanedCode = stripInjectedTheme(block.code);
      const replacementLines = [
        "```mermaid",
        cleanedCode,
        "```",
      ];
      if (imageLink) {
        replacementLines.push(imageLink);
      }
      const replacementText = replacementLines.join("\n");

      const endLine = block.imageLinkLine ? block.imageLinkLine : block.endLine;

      if (editor) {
        const endCh = editor.getLine(endLine).length;
        editor.replaceRange(
          replacementText,
          { line: block.startLine, ch: 0 },
          { line: endLine, ch: endCh }
        );
      } else {
        lines.splice(block.startLine, endLine - block.startLine + 1, replacementText);
        await app.vault.modify(activeFile, lines.join("\n"));
      }

      const activeView = app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView) {
        activeView.previewMode.rerender(true);
      }
      new Notice("Diagram restored to active code block for editing!");
      return;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to restore code block: ${errorMsg}`);
      return;
    }
  }

  // 2. Otherwise, decode the direct URL format from the target line
  const parsed = parseImageLink(lineText);
  if (parsed && parsed.isRemote) {
    const loadingNotice = new Notice("Decompressing diagram URL...", 0);
    try {
      const decodedCodeRaw = await decodeDiagramFromUrl(parsed.path);
      let decodedCode = stripInjectedTheme(decodedCodeRaw);
      
      // Extract width from alt text if present
      const mdMatch = lineText.match(/^!\[([^\]]*)\]/);
      if (mdMatch) {
        const altPart = mdMatch[1] || "";
        const altParts = altPart.split("|");
        const widthPart = altParts[1]?.trim();
        if (widthPart && widthPart !== "500") {
          decodedCode = updateWidthInCode(decodedCode, widthPart);
        }
      }

      const replacementText = [
        "```mermaid",
        decodedCode,
        "```"
      ].join("\n");

      if (editor) {
        const endCh = lineText.length;
        editor.replaceRange(
          replacementText,
          { line, ch: 0 },
          { line, ch: endCh }
        );
      } else {
        lines.splice(line, 1, replacementText);
        await app.vault.modify(activeFile, lines.join("\n"));
      }

      const activeView = app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView) {
        activeView.previewMode.rerender(true);
      }

      loadingNotice.hide();
      new Notice("Diagram restored to active code block for editing!");
    } catch (error) {
      loadingNotice.hide();
      const errorMsg = error instanceof Error ? error.message : String(error);
      new Notice(`Failed to restore code block: ${errorMsg}`);
    }
  } else {
    new Notice("No commented block or remote diagram link found at cursor.");
  }
}

/**
 * Updates a converted diagram's width to the specified value.
 * Decodes the original Mermaid diagram code, updates its width property,
 * re-encodes/compresses the code back into the remote URL, replaces the link,
 * and re-renders the view.
 */
export async function updateDiagramSize(
  app: App,
  editor: Editor | null,
  plugin: MermaidToImagePlugin,
  targetLine: number | undefined,
  nextWidth: string,
  sourcePath?: string,
  fallbackToCursor = false
): Promise<void> {
  const activeFile = sourcePath ? app.vault.getFileByPath(sourcePath) : app.workspace.getActiveFile();
  if (!activeFile) {
    new Notice("No active note found.");
    return;
  }

  let line = targetLine;
  if (line === undefined && fallbackToCursor && editor) {
    line = editor.getCursor().line;
  }
  if (line === undefined) {
    new Notice("Could not determine diagram line number.");
    return;
  }

  let lines: string[] = [];
  if (editor) {
    const lineCount = editor.lineCount();
    for (let i = 0; i < lineCount; i++) {
      lines.push(editor.getLine(i));
    }
  } else {
    const fileContent = await app.vault.read(activeFile);
    lines = fileContent.split("\n");
  }

  const lineText = lines[line];
  if (!lineText) {
    new Notice("No diagram image link found at cursor line.");
    return;
  }

  const parsed = parseImageLink(lineText);
  if (!parsed || !parsed.isRemote) {
    new Notice("No remote diagram link found at cursor line.");
    return;
  }

  // Parse current width from the link.
  // Match standard Markdown image link: ![alt|width](url)
  const mdMatch = lineText.match(/^(!\[)([^\]]*)(\]\()([^)]+)(\))$/);
  if (!mdMatch) {
    new Notice("Failed to parse image link format.");
    return;
  }

  const prefix = mdMatch[1]; // "!["
  const altPart = mdMatch[2] || ""; // "Title|width"
  const mid = mdMatch[3]; // "]("
  const urlPart = mdMatch[4] || ""; // "https://..."
  const suffix = mdMatch[5]; // ")"

  const altParts = altPart.split("|");
  const title = altParts[0] || "";

  try {
    const newAltPart = title ? `${title}|${nextWidth}` : `Mermaid Diagram|${nextWidth}`;
    const replacementText = `${prefix}${newAltPart}${mid}${urlPart}${suffix}`;

    if (editor) {
      editor.replaceRange(
        replacementText,
        { line, ch: 0 },
        { line, ch: lineText.length }
      );
    } else {
      lines.splice(line, 1, replacementText);
      await app.vault.modify(activeFile, lines.join("\n"));
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    new Notice(`Failed to save diagram size: ${errorMsg}`);
    console.error("Saving diagram size failed:", error);
  }
}
