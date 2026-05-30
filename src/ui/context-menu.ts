import { Editor, Menu } from "obsidian";
import { findMermaidBlockAtLine } from "../utils/markdown-parser";
import { convertMermaidBlockToLocalImage } from "./editor-handlers";
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
      const format = plugin.settings.localFormat.toUpperCase();
      
      if (block) {
        menu.addItem((item) => {
          const title = block.type === "commented"
            ? `Regenerate local ${format} image`
            : `Convert to local ${format} image`;
          item
            .setTitle(title)
            .setIcon("image")
            .onClick(async () => {
              await convertMermaidBlockToLocalImage(plugin.app, editor, plugin);
            });
        });
      }
    })
  );
}
