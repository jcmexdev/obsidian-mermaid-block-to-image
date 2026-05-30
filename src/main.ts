import { Editor, MarkdownView, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, MermaidSettings, MermaidSettingTab } from "./settings";
import { registerContextMenu } from "./ui/context-menu";
import { convertMermaidBlockToLocalImage } from "./ui/editor-handlers";

/**
 * Main plugin class for "Mermaid Block to Image" in Obsidian.
 * Manages plugin lifecycle hooks, loads and saves configurations,
 * and registers commands and UI integrations.
 */
export default class MermaidToImagePlugin extends Plugin {
  /**
   * Active configuration settings.
   */
  settings: MermaidSettings;

  /**
   * Executed when the plugin is loaded and activated.
   */
  async onload() {
    // 1. Load persisted configurations or fallback defaults
    await this.loadSettings();

    // 2. Add settings tab in the Obsidian settings window
    this.addSettingTab(new MermaidSettingTab(this.app, this));

    // 3. Register editor context menu (right-click) handler
    registerContextMenu(this);

    // 4. Add command in the Obsidian command palette
    this.addCommand({
      id: "convert-mermaid-to-local-image",
      name: "Convert Mermaid block to local image",
      editorCallback: async (editor: Editor, _view: MarkdownView) => {
        await convertMermaidBlockToLocalImage(this.app, editor, this);
      },
    });
  }

  /**
   * Executed when the plugin is disabled or unloaded.
   */
  onunload() {
    // Obsidian automatically cleans up event listeners registered through registerContextMenu
    console.debug("Mermaid Block to Image plugin unloaded");
  }

  /**
   * Loads configurations from the data file.
   */
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MermaidSettings>);
  }

  /**
   * Saves configurations to the data file.
   */
  async saveSettings() {
    await this.saveData(this.settings);
  }
}
