import { MarkdownView, setIcon, Notice, requestUrl } from "obsidian";
import type MermaidToImagePlugin from "../main";
import { convertMermaidBlockToUrl, restoreUrlToCodeBlock, downloadMermaidAsFile } from "./editor-handlers";
import { extractTitle, slugify } from "../utils/markdown-parser";

const MERMAID_SELECTOR = ".block-language-mermaid, .mermaid";
const IMAGE_SELECTOR = ".internal-embed, .image-embed";
const PROCESSED_ATTR = "data-mermaid-image-processed";
 
/**
 * Attaches the appropriate convert/restore buttons to any Mermaid diagram or generated image
 * found at or under the given element.
 * Returns true if at least one block was found and processed.
 */
export function processMermaidButtons(container: HTMLElement, plugin: MermaidToImagePlugin, sourcePath: string, targetLine?: number): boolean {
  let found = false;

  // 1. Process active mermaid blocks
  const isMermaid = container.classList?.contains("block-language-mermaid") || container.classList?.contains("mermaid");
  if (isMermaid) {
    attachConvertButton(container, plugin, sourcePath, targetLine);
    found = true;
  } else {
    const blocks = container.querySelectorAll<HTMLElement>(MERMAID_SELECTOR);
    blocks.forEach((block) => {
      attachConvertButton(block, plugin, sourcePath, targetLine);
    });
    if (blocks.length > 0) found = true;
  }

  // 2. Process commented block image embeds
  const isImage = container.classList?.contains("internal-embed") || container.classList?.contains("image-embed");
  if (isImage) {
    attachRestoreButton(container, plugin, sourcePath, targetLine);
    found = true;
  } else {
    const embeds = container.querySelectorAll<HTMLElement>(IMAGE_SELECTOR);
    embeds.forEach((embed) => {
      attachRestoreButton(embed, plugin, sourcePath, targetLine);
    });
    if (embeds.length > 0) found = true;
  }

  return found;
}

/**
 * Attaches a "Convert to URL" button to an active Mermaid block.
 */
function attachConvertButton(container: HTMLElement, plugin: MermaidToImagePlugin, sourcePath: string, targetLine?: number): void {
  if (container.hasAttribute(PROCESSED_ATTR)) return;
  container.setAttribute(PROCESSED_ATTR, "true");

  if (!container.querySelector(".mermaid-action-btn-convert")) {
    const btn = container.createDiv({ cls: "edit-block-button mermaid-action-btn-convert" });
    btn.setAttribute("aria-label", "Convert to image URL");
    setIcon(btn, "image");

    plugin.registerDomEvent(btn, "click", async (e) => {
      e.stopPropagation();
      e.preventDefault();

      const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      const editor = (activeView && activeView.getMode() === "source") ? activeView.editor : null;
      
      await convertMermaidBlockToUrl(plugin.app, editor, plugin, targetLine);
    });
  }

  if (!container.querySelector(".mermaid-action-btn-download-active")) {
    const downloadBtn = container.createDiv({ cls: "edit-block-button mermaid-action-btn-download-active" });
    downloadBtn.setAttribute("aria-label", "Download Mermaid as image");
    setIcon(downloadBtn, "download");

    plugin.registerDomEvent(downloadBtn, "click", async (e) => {
      e.stopPropagation();
      e.preventDefault();

      const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      const editor = (activeView && activeView.getMode() === "source") ? activeView.editor : null;
      
      await downloadMermaidAsFile(plugin.app, editor, plugin, targetLine);
    });
  }
}

/**
 * Attaches a "Restore code" and "Download" buttons to a generated Mermaid diagram image.
 */
function attachRestoreButton(embedDiv: HTMLElement, plugin: MermaidToImagePlugin, sourcePath: string, targetLine?: number): void {
  if (embedDiv.hasAttribute(PROCESSED_ATTR)) return;
  embedDiv.setAttribute(PROCESSED_ATTR, "true");

  const src = embedDiv.getAttribute("src") || embedDiv.querySelector("img")?.getAttribute("src");
  if (!src) return;

  const file = plugin.app.vault.getFileByPath(sourcePath);
  if (!file) return;

  // Perform asynchronous verification of the commented code block or direct URL in the file
  void (async () => {
    const content = await plugin.app.vault.read(file);
    const lines = content.split("\n");
    let isMermaidImage = false;
    let lineToRestore = targetLine;

    // 1. Check if the URL is a direct diagram URL (starts with Kroki or Mermaid.ink or contains /mermaid/)
    const isDirectDiagramUrl = src.includes("kroki.io/") || 
                               src.includes("mermaid.ink/") || 
                               src.includes("/mermaid/");

    if (isDirectDiagramUrl) {
      isMermaidImage = true;
      // Find the line that contains the URL in the file
      if (lineToRestore === undefined) {
        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i];
          if (lineText && lineText.includes(src)) {
            lineToRestore = i;
            break;
          }
        }
      }
    } else {
      // 2. Backward compatibility: check for old commented block format
      if (lineToRestore !== undefined && lineToRestore < lines.length) {
        const lineText = lines[lineToRestore];
        if (lineText && lineText.includes(src)) {
          for (let j = Math.max(0, lineToRestore - 4); j < lineToRestore; j++) {
            if (lines[j]?.includes("Autogenerated by Mermaid Block to Image")) {
              isMermaidImage = true;
              break;
            }
          }
        }
      }

      // Fallback scan if lineToRestore was off or undefined
      if (!isMermaidImage) {
        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i];
          if (lineText && lineText.includes(src)) {
            for (let j = Math.max(0, i - 4); j < i; j++) {
              if (lines[j]?.includes("Autogenerated by Mermaid Block to Image")) {
                isMermaidImage = true;
                lineToRestore = i;
                break;
              }
            }
            if (isMermaidImage) break;
          }
        }
      }
    }

    if (!isMermaidImage || lineToRestore === undefined) return;

    // 1. Create Restore Button
    if (!embedDiv.querySelector(".mermaid-action-btn-restore")) {
      const btn = embedDiv.createDiv({ cls: "edit-block-button mermaid-action-btn-restore" });
      btn.setAttribute("aria-label", "Restore to Mermaid block");
      setIcon(btn, "code-2");

      plugin.registerDomEvent(btn, "click", async (e) => {
        e.stopPropagation();
        e.preventDefault();

        const currentView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        const currentEditor = (currentView && currentView.getMode() === "source") ? currentView.editor : null;

        // Re-verify line in case lines shifted in the editor
        let finalLine = lineToRestore;
        if (currentEditor) {
          const currentLineCount = currentEditor.lineCount();
          for (let i = 0; i < currentLineCount; i++) {
            if (currentEditor.getLine(i).includes(src)) {
              finalLine = i;
              break;
            }
          }
        }

        await restoreUrlToCodeBlock(plugin.app, currentEditor, plugin, finalLine);
      });
    }

    // 2. Create Download Button
    if (!embedDiv.querySelector(".mermaid-action-btn-download")) {
      const downloadBtn = embedDiv.createDiv({ cls: "edit-block-button mermaid-action-btn-download" });
      downloadBtn.setAttribute("aria-label", "Download image");
      setIcon(downloadBtn, "download");

      plugin.registerDomEvent(downloadBtn, "click", async (e) => {
        e.stopPropagation();
        e.preventDefault();

        new Notice("Starting image download...");
        
        try {
          // If the image URL is external (Kroki/Mermaid.ink), fetch it to avoid CORS issues
          let downloadUrl = src;
          if (src.startsWith("http")) {
            const response = await requestUrl({ url: src });
            if (response.status !== 200) {
              throw new Error(`Failed to fetch image: Status ${response.status}`);
            }
            const blob = new Blob([response.arrayBuffer], { type: response.headers["content-type"] || "image/png" });
            downloadUrl = URL.createObjectURL(blob);
          }

          // Extract extension from configuration
          const ext = plugin.settings.downloadFormat;
          const title = slugify(extractTitle(content) || "mermaid-diagram");
          const filename = `${title}.${ext}`;

          const a = activeDocument.body.createEl("a");
          a.href = downloadUrl;
          a.download = filename;
          a.click();
          a.remove();

          if (src.startsWith("http")) {
            URL.revokeObjectURL(downloadUrl);
          }
          
          new Notice("Image downloaded successfully.");
        } catch (error) {
          console.error("Failed to download image:", error);
          new Notice("Failed to download image. Opening in browser...");
          window.open(src, "_blank");
        }
      });
    }
  })();
}

/**
 * Mutation observer helper to handle Reading Mode late rendering of Mermaid SVGs.
 */
export function observeForLateMermaid(el: HTMLElement, plugin: MermaidToImagePlugin, sourcePath: string, targetLine?: number): void {
  const win = el.ownerDocument?.defaultView ?? activeWindow;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    win.clearTimeout(timeoutId);
  };
  const observer = new MutationObserver(() => {
    if (processMermaidButtons(el, plugin, sourcePath, targetLine)) {
      finish();
    }
  });
  observer.observe(el, { childList: true, subtree: true });
  const timeoutId = win.setTimeout(finish, 5000);
}
