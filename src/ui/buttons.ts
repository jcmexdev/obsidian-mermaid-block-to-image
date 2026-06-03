import { MarkdownView, setIcon, Notice, requestUrl } from "obsidian";
import type MermaidToImagePlugin from "../main";
import { convertMermaidBlockToUrl, restoreUrlToCodeBlock, downloadMermaidAsFile, updateDiagramSize, decodeDiagramFromUrl } from "./editor-handlers";
import { extractTitle, slugify, matchImageSource } from "../utils/markdown-parser";

const MERMAID_SELECTOR = ".block-language-mermaid, .mermaid";
const IMAGE_SELECTOR = ".internal-embed, .image-embed, img";
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

  // 2. Process commented block image embeds or remote images
  const isImage = container.classList?.contains("internal-embed") || container.classList?.contains("image-embed") || container.tagName === "IMG";
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
    btn.setAttribute("aria-label", "Convert to URL");
    setIcon(btn, "image");

    plugin.registerDomEvent(btn, "click", async (e) => {
      e.stopPropagation();
      e.preventDefault();

      const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      const editor = (activeView && activeView.getMode() === "source" && activeView.file?.path === sourcePath) ? activeView.editor : null;
      
      await convertMermaidBlockToUrl(plugin.app, editor, plugin, targetLine, sourcePath, false);
    });
  }

  if (!container.querySelector(".mermaid-action-btn-download-active")) {
    const downloadBtn = container.createDiv({ cls: "edit-block-button mermaid-action-btn-download-active" });
    downloadBtn.setAttribute("aria-label", "Download image");
    setIcon(downloadBtn, "download");

    plugin.registerDomEvent(downloadBtn, "click", async (e) => {
      e.stopPropagation();
      e.preventDefault();

      const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      const editor = (activeView && activeView.getMode() === "source" && activeView.file?.path === sourcePath) ? activeView.editor : null;
      
      await downloadMermaidAsFile(plugin.app, editor, plugin, targetLine, sourcePath, false);
    });
  }
}

/**
 * Attaches a "Restore URL to Mermaid" and "Download image" buttons to a generated Mermaid diagram image.
 */
function attachRestoreButton(embedDiv: HTMLElement, plugin: MermaidToImagePlugin, sourcePath: string, targetLine?: number): void {
  let targetContainer = embedDiv;
  if (embedDiv.tagName === "IMG") {
    const parent = embedDiv.parentElement;
    if (!parent) return;

    // Check if the parent is a designated image embed container
    const isParentWrapper = parent.classList.contains("image-embed") || 
                           parent.classList.contains("internal-embed");
                           
    if (isParentWrapper) {
      targetContainer = parent;
    } else {
      // Wrap the img tag in a span to keep buttons absolute position relative to the image bounds
      const doc = embedDiv.ownerDocument || activeDocument;
      let wrapper = parent.querySelector(`.mermaid-image-wrapper`) as HTMLElement;
      if (!wrapper || !wrapper.contains(embedDiv)) {
        wrapper = doc.createElement("span");
        wrapper.classList.add("mermaid-image-wrapper");
        parent.insertBefore(wrapper, embedDiv);
        wrapper.appendChild(embedDiv);
      }
      targetContainer = wrapper;
    }
  }

  if (targetContainer.hasAttribute(PROCESSED_ATTR)) return;
  targetContainer.setAttribute(PROCESSED_ATTR, "true");

  // Dynamically ensure relative positioning so buttons align correctly
  if (getComputedStyle(targetContainer).position === "static") {
    targetContainer.classList.add("mermaid-image-container");
  }

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
          if (lineText && matchImageSource(lineText, src)) {
            lineToRestore = i;
            break;
          }
        }
      }
    } else {
      // 2. Backward compatibility: check for old commented block format
      if (lineToRestore !== undefined && lineToRestore < lines.length) {
        const lineText = lines[lineToRestore];
        if (lineText && matchImageSource(lineText, src)) {
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
          if (lineText && matchImageSource(lineText, src)) {
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

    // Detect diagram theme to apply appropriate CSS class for dark/light contrast
    let isDarkTheme = false;
    try {
      const decodedCode = await decodeDiagramFromUrl(src);
      // Check if the decoded code contains a dark theme directive
      if (
        decodedCode.includes("'theme': 'dark'") ||
        decodedCode.includes('"theme": "dark"') ||
        decodedCode.includes("theme: dark")
      ) {
        isDarkTheme = true;
      }
    } catch (e) {
      console.warn("Could not decode diagram from URL to check theme:", e);
    }
    targetContainer.setAttribute("data-mermaid-theme", isDarkTheme ? "dark" : "light");

    // 1. Create Restore Button
    if (!targetContainer.querySelector(".mermaid-action-btn-restore")) {
      const btn = targetContainer.createDiv({ cls: "edit-block-button mermaid-action-btn-restore" });
      btn.setAttribute("aria-label", "Restore URL to Mermaid");
      setIcon(btn, "history");

      plugin.registerDomEvent(btn, "click", async (e) => {
        e.stopPropagation();
        e.preventDefault();

        const currentView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        const currentEditor = (currentView && currentView.getMode() === "source" && currentView.file?.path === sourcePath) ? currentView.editor : null;

        // Re-verify line in case lines shifted in the editor or file
        let finalLine = lineToRestore;
        if (currentEditor) {
          const currentLineCount = currentEditor.lineCount();
          for (let i = 0; i < currentLineCount; i++) {
            if (matchImageSource(currentEditor.getLine(i), src)) {
              finalLine = i;
              break;
            }
          }
        } else {
          const activeFile = plugin.app.vault.getFileByPath(sourcePath);
          if (activeFile) {
            const content = await plugin.app.vault.read(activeFile);
            const docLines = content.split("\n");
            for (let i = 0; i < docLines.length; i++) {
              if (matchImageSource(docLines[i] || "", src)) {
                finalLine = i;
                break;
              }
            }
          }
        }

        await restoreUrlToCodeBlock(plugin.app, currentEditor, plugin, finalLine, sourcePath, false);
      });
    }

    // 2. Create Download Button
    if (!targetContainer.querySelector(".mermaid-action-btn-download")) {
      const downloadBtn = targetContainer.createDiv({ cls: "edit-block-button mermaid-action-btn-download" });
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

    // 4. Create visual drag handle
    if (!targetContainer.querySelector(".mermaid-resize-handle")) {
      const handle = targetContainer.createDiv({ cls: "mermaid-resize-handle" });

      plugin.registerDomEvent(handle, "mousedown", (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const img = targetContainer.tagName === "IMG" ? targetContainer as HTMLImageElement : targetContainer.querySelector("img");
        if (!img) return;

        const startX = e.clientX;
        const startWidth = img.getBoundingClientRect().width;
        const doc = targetContainer.ownerDocument || activeDocument;

        doc.body.classList.add("mermaid-resizing-active");

        // Create or get visual tooltip overlay
        let tooltip = targetContainer.querySelector(".mermaid-resize-tooltip") as HTMLElement;
        if (!tooltip) {
          tooltip = targetContainer.createDiv({ cls: "mermaid-resize-tooltip" });
        }
        tooltip.setText(`${Math.round(startWidth)}px`);

        const onMouseMove = (moveEvent: MouseEvent) => {
          const deltaX = moveEvent.clientX - startX;
          let newWidth = Math.round(startWidth + deltaX);
          
          if (newWidth < 200) newWidth = 200;
          if (newWidth > 1600) newWidth = 1600;

          img.style.width = `${newWidth}px`;
          img.style.maxWidth = "100%";
          img.style.height = "auto";

          // Update tooltip text content dynamically
          tooltip.setText(`${newWidth}px`);
        };

        const onMouseUp = async (upEvent: MouseEvent) => {
          window.removeEventListener("mousemove", onMouseMove);
          window.removeEventListener("mouseup", onMouseUp);
          doc.body.classList.remove("mermaid-resizing-active");

          // Remove tooltip
          if (tooltip) {
            tooltip.remove();
          }

          const finalWidth = img.getBoundingClientRect().width;
          const widthStr = `${Math.round(finalWidth)}`;

          const currentView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
          const currentEditor = (currentView && currentView.getMode() === "source" && currentView.file?.path === sourcePath) ? currentView.editor : null;

          // Re-verify line in case lines shifted in the editor or file
          let finalLine = lineToRestore;
          if (currentEditor) {
            const currentLineCount = currentEditor.lineCount();
            for (let i = 0; i < currentLineCount; i++) {
              if (matchImageSource(currentEditor.getLine(i), src)) {
                finalLine = i;
                break;
              }
            }
          } else {
            const activeFile = plugin.app.vault.getFileByPath(sourcePath);
            if (activeFile) {
              const content = await plugin.app.vault.read(activeFile);
              const docLines = content.split("\n");
              for (let i = 0; i < docLines.length; i++) {
                if (matchImageSource(docLines[i] || "", src)) {
                  finalLine = i;
                  break;
                }
              }
            }
          }

          await updateDiagramSize(plugin.app, currentEditor, plugin, finalLine, widthStr, sourcePath, false);
        };

        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
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
