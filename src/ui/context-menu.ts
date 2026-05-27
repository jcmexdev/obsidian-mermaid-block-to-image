import { Editor, Menu } from "obsidian";
import { findMermaidBlockAtLine } from "../utils/markdown-parser";
import { convertMermaidBlockAtCursor } from "./editor-handlers";
import MermaidToImagePlugin from "../main";

/**
 * Registers the editor context menu event to allow diagram conversion
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
        menu.addItem((item) => {
          const title = block.type === "commented" ? "Regenerate Mermaid diagram" : "Convert Mermaid to PNG";
          item
            .setTitle(title)
            .setIcon("image")
            .onClick(async () => {
              await convertMermaidBlockAtCursor(plugin.app, editor, plugin);
            });
        });
      }
    })
  );
}
