import { App, Editor, MarkdownView, Notice, TFile } from "obsidian";
import MermaidToImagePlugin from "../main";
import { extractTitle, findMermaidBlockAtLine, formatCommentedBlock, getCodeHash, slugify } from "../utils/markdown-parser";

/**
 * Ensures that a nested folder path exists in the vault,
 * recursively creating directories if needed.
 * 
 * @param app The Obsidian App instance.
 * @param folderPath The folder path to verify or create.
 */
export async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
  if (!folderPath || folderPath === "/" || folderPath === ".") return;
  
  const folder = app.vault.getAbstractFileByPath(folderPath);
  if (folder) return;

  const lastSlash = folderPath.lastIndexOf("/");
  if (lastSlash !== -1) {
    const parent = folderPath.substring(0, lastSlash);
    await ensureFolderExists(app, parent);
  }

  try {
    await app.vault.createFolder(folderPath);
  } catch {
    // Ignored if the folder was created concurrently
  }
}

/**
 * Converts a Mermaid block to a local image saved in the vault.
 * Generates SVG locally and offline via window.mermaid, and converts it locally
 * to PNG/WebP via Canvas without canvas tainting issues by using Base64 Data URIs.
 */
export async function convertMermaidBlockToLocalImage(app: App, editor: Editor, plugin: MermaidToImagePlugin): Promise<void> {
  const cursor = editor.getCursor();
  
  const lines: string[] = [];
  const lineCount = editor.lineCount();
  for (let i = 0; i < lineCount; i++) {
    lines.push(editor.getLine(i));
  }

  const block = findMermaidBlockAtLine(lines, cursor.line);
  if (!block) {
    new Notice("No active or commented Mermaid code block found under the cursor.");
    return;
  }

  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) {
    new Notice("No active note found. Cannot save image.");
    return;
  }

  const format = plugin.settings.localFormat; // 'svg' | 'png' | 'webp'
  const loadingNotice = new Notice(`Rendering local ${format.toUpperCase()} diagram offline...`, 0);

  try {
    let arrayBuffer: ArrayBuffer;

    // 1. Render SVG locally and offline using Obsidian's Mermaid engine
    const mermaid = (window as Window & { mermaid?: { render: (id: string, text: string) => Promise<{ svg: string }> } }).mermaid;
    if (!mermaid) {
      throw new Error("Obsidian's global 'mermaid' instance is not available.");
    }
    const renderId = `mermaid-local-render-${Date.now()}`;
    const { svg } = await mermaid.render(renderId, block.code);
    if (!svg) {
      throw new Error("Local Mermaid render returned empty output.");
    }

    if (format === "svg") {
      arrayBuffer = new TextEncoder().encode(svg).buffer;
    } else {
      // 2. Convert SVG string to a Base64 data: URI to avoid canvas HTML5 security issues (tainted canvas)
      const bytes = new TextEncoder().encode(svg);
      let binString = "";
      bytes.forEach((b) => {
        binString += String.fromCharCode(b);
      });
      const svgDataURL = "data:image/svg+xml;base64," + btoa(binString);

      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load local SVG for conversion"));
        img.src = svgDataURL;
      });

      // Calculate width and height (with viewBox fallback)
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

      const canvas = activeDocument.createEl("canvas");
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

      arrayBuffer = await blob.arrayBuffer();
    }

    // Resolve target path for saving file
    let targetFolder = "";
    if (plugin.settings.storageLocation === 'custom-folder' && plugin.settings.customFolderPath) {
      targetFolder = plugin.settings.customFolderPath.trim().replace(/\/$/, "");
    } else {
      targetFolder = activeFile.parent ? activeFile.parent.path : "";
      if (targetFolder === "/" || targetFolder === ".") {
        targetFolder = "";
      }
    }

    const title = extractTitle(block.code);
    const slug = title ? slugify(title) : "";
    const filename = slug ? `${slug}.${format}` : `mermaid-${await getCodeHash(block.code)}.${format}`;
    const filePath = targetFolder ? `${targetFolder}/${filename}` : filename;

    // Delete old local file if path changed
    if (block.existingImagePath && !block.isExistingImageRemote) {
      const oldFile = app.vault.getAbstractFileByPath(block.existingImagePath);
      if (oldFile instanceof TFile && oldFile.path !== filePath) {
        try {
          await app.fileManager.trashFile(oldFile);
        } catch (e) {
          console.warn("Failed to delete previous image file:", e);
        }
      }
    }

    if (targetFolder) {
      await ensureFolderExists(app, targetFolder);
    }

    const existingFile = app.vault.getAbstractFileByPath(filePath);
    if (existingFile instanceof TFile) {
      await app.vault.modifyBinary(existingFile, arrayBuffer);
    } else {
      await app.vault.createBinary(filePath, arrayBuffer);
    }

    const imageLink = `![[${filePath}]]`;
    const replacementText = formatCommentedBlock(block.code, imageLink);

    const endLine = (block.imageLinkLine && !block.isExistingImageRemote) ? block.imageLinkLine : block.endLine;
    const endCh = editor.getLine(endLine).length;

    editor.replaceRange(
      replacementText,
      { line: block.startLine, ch: 0 },
      { line: endLine, ch: endCh }
    );

    // Force a re-render of the preview mode to clear cached HTML and reload the new image
    const activeView = app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      activeView.previewMode.rerender(true);
    }

    loadingNotice.hide();
    new Notice(`Mermaid diagram successfully saved as local ${format.toUpperCase()}!`);

  } catch (error) {
    loadingNotice.hide();
    const errorMsg = error instanceof Error ? error.message : String(error);
    new Notice(`Local image generation failed: ${errorMsg}`);
    console.error("Local Mermaid to Image error:", error);
  }
}
