import { App, Editor, Notice, TFile } from "obsidian";
import { findMermaidBlockAtLine, getCodeHash, formatCommentedBlock } from "../utils/markdown-parser";
import { KrokiClient } from "../core/kroki-client";
import MermaidToImagePlugin from "../main";

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
 * Performs conversion of the Mermaid block (active or commented) located at the cursor line.
 * 
 * @param app The Obsidian App instance.
 * @param editor The active editor instance.
 * @param plugin The active plugin instance.
 */
export async function convertMermaidBlockAtCursor(app: App, editor: Editor, plugin: MermaidToImagePlugin): Promise<void> {
  const cursor = editor.getCursor();
  
  // 1. Read all current lines of the editor to perform parsing
  const lines: string[] = [];
  const lineCount = editor.lineCount();
  for (let i = 0; i < lineCount; i++) {
    lines.push(editor.getLine(i));
  }

  // 2. Locate the Mermaid block at the cursor line
  const block = findMermaidBlockAtLine(lines, cursor.line);
  if (!block) {
    new Notice("No active or commented Mermaid code block found under the cursor.");
    return;
  }

  // 3. Verify there is an active file being edited
  const activeFile = app.workspace.getActiveFile();
  if (!activeFile) {
    new Notice("No active note found. Cannot save image.");
    return;
  }

  // 4. Show a persistent loading Notice (timeout 0)
  const loadingNotice = new Notice("Converting Mermaid diagram to PNG via Kroki...", 0);

  try {
    // 5. Instantiate Kroki client and generate the image
    const krokiClient = new KrokiClient({ serverUrl: plugin.settings.krokiInstanceUrl });
    const arrayBuffer = await krokiClient.generateImage(block.code);

    // 6. Resolve the target path for saving the PNG file
    let targetFolder = "";
    if (plugin.settings.storageLocation === 'custom-folder' && plugin.settings.customFolderPath) {
      targetFolder = plugin.settings.customFolderPath.trim().replace(/\/$/, "");
    } else {
      // Default: same folder as note
      targetFolder = activeFile.parent ? activeFile.parent.path : "";
      if (targetFolder === "/" || targetFolder === ".") {
        targetFolder = "";
      }
    }

    const hash = await getCodeHash(block.code);
    const filename = `mermaid-${hash}.png`;
    const filePath = targetFolder ? `${targetFolder}/${filename}` : filename;

    // 7. If there is a previous associated image and it is different, remove it
    if (block.existingImagePath && !block.isExistingImageRemote) {
      const oldFile = app.vault.getAbstractFileByPath(block.existingImagePath);
      if (oldFile instanceof TFile && oldFile.path !== filePath) {
        try {
          await app.fileManager.trashFile(oldFile);
        } catch (e) {
          console.warn("Mermaid Block to Image: Failed to delete previous image file:", e);
        }
      }
    }

    // 8. Create folder structure if needed and write PNG data
    if (targetFolder) {
      await ensureFolderExists(app, targetFolder);
    }

    const existingFile = app.vault.getAbstractFileByPath(filePath);
    if (existingFile instanceof TFile) {
      await app.vault.modifyBinary(existingFile, arrayBuffer);
    } else {
      await app.vault.createBinary(filePath, arrayBuffer);
    }

    // 9. Replace the code block in the editor with the commented-out block and image link
    const imageLink = `![[${filePath}]]`;
    const replacementText = formatCommentedBlock(block.code, imageLink);

    // If the existing image is a remote URL link, we do NOT overwrite it.
    // Instead, we insert the new local image link directly before it.
    const endLine = (block.imageLinkLine && !block.isExistingImageRemote) ? block.imageLinkLine : block.endLine;
    const endCh = editor.getLine(endLine).length;

    editor.replaceRange(
      replacementText,
      { line: block.startLine, ch: 0 },
      { line: endLine, ch: endCh }
    );

    loadingNotice.hide();
    new Notice("Mermaid diagram successfully converted to PNG!");

  } catch (error) {
    loadingNotice.hide();
    const errorMsg = error instanceof Error ? error.message : String(error);
    new Notice(`Conversion failed: ${errorMsg}`);
    console.error("Mermaid Block to Image error:", error);
  }
}
