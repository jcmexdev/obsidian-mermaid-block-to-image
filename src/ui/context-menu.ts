import { Editor, Menu } from "obsidian";
import { findMermaidBlockAtLine, parseImageLink } from "../utils/markdown-parser";
import { downloadMermaidAsFile, convertMermaidBlockToUrl, restoreUrlToCodeBlock } from "./editor-handlers";
import MermaidToImagePlugin from "../main";

/**
 * Registers the editor context menu event to allow diagram actions
 * by right-clicking on a Mermaid code block in Source Mode or Live Preview.
 * 
 * @param plugin The active plugin instance.
 */
export function registerContextMenu(plugin: MermaidToImagePlugin) {
  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
      const cursor = editor.getCursor();
      
      // Read lines from the editor
      const lines: string[] = [];
      const lineCount = editor.lineCount();
      for (let i = 0; i < lineCount; i++) {
        lines.push(editor.getLine(i));
      }

      // Check if there is a Mermaid block under the cursor
      const block = findMermaidBlockAtLine(lines, cursor.line);
      
      if (block) {
        if (block.type === "active") {
          const downloadFormat = plugin.settings.downloadFormat.toUpperCase();
          const urlFormat = plugin.settings.urlFormat.toUpperCase();

          menu.addItem((item) => {
            item
              .setTitle(`Download Mermaid as ${downloadFormat}`)
              .setIcon("download")
              .onClick(async () => {
                await downloadMermaidAsFile(plugin.app, editor, plugin);
              });
          });

          menu.addItem((item) => {
            item
              .setTitle(`Mermaid to ${urlFormat} URL`)
              .setIcon("link")
              .onClick(async () => {
                await convertMermaidBlockToUrl(plugin.app, editor, plugin);
              });
          });
        } else if (block.type === "commented") {
          menu.addItem((item) => {
            item
              .setTitle("Restore URL to Mermaid block")
              .setIcon("code-2")
              .onClick(async () => {
                await restoreUrlToCodeBlock(plugin.app, editor, plugin);
              });
          });
        }
      } else {
        const lineText = lines[cursor.line];
        if (lineText) {
          const parsed = parseImageLink(lineText);
          if (parsed && parsed.isRemote && (
            parsed.path.includes("kroki.io/") || 
            parsed.path.includes("mermaid.ink/") || 
            parsed.path.includes("/mermaid/")
          )) {
            menu.addItem((item) => {
              item
                .setTitle("Restore URL to Mermaid block")
                .setIcon("code-2")
                .onClick(async () => {
                  await restoreUrlToCodeBlock(plugin.app, editor, plugin);
                });
            });
          }
        }
      }
    })
  );
}
