import { Editor, MarkdownView, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, MermaidSettings, MermaidSettingTab } from "./settings";
import { registerContextMenu } from "./ui/context-menu";
import { downloadMermaidAsFile, convertMermaidBlockToUrl, restoreUrlToCodeBlock } from "./ui/editor-handlers";
import { processMermaidButtons, observeForLateMermaid } from "./ui/buttons";

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

    // 4. Add commands in the Obsidian command palette
    this.addCommand({
      id: "download-mermaid-as-image",
      name: "Download image",
      editorCallback: async (editor: Editor, _view: MarkdownView) => {
        await downloadMermaidAsFile(this.app, editor, this);
      },
    });

    this.addCommand({
      id: "convert-mermaid-to-url",
      name: "Convert to URL",
      editorCallback: async (editor: Editor, _view: MarkdownView) => {
        await convertMermaidBlockToUrl(this.app, editor, this);
      },
    });

    this.addCommand({
      id: "restore-url-to-mermaid",
      name: "Restore URL to Mermaid",
      editorCallback: async (editor: Editor, _view: MarkdownView) => {
        await restoreUrlToCodeBlock(this.app, editor, this);
      },
    });

    // 5. Reading mode: Obsidian's supported, scoped extension point.
    // Obsidian's built-in mermaid renderer replaces a placeholder
    // `<pre>` with a `<div class="mermaid">` asynchronously, often
    // *after* this post-processor first runs. We synchronously try
    // the current subtree, and if no mermaid block is present yet
    // we attach a short-lived MutationObserver scoped to `el` only
    // that waits for the replacement and disconnects itself once it fires.
    this.registerMarkdownPostProcessor((el, ctx) => {
      const sectionInfo = ctx.getSectionInfo(el);
      const lineStart = sectionInfo ? sectionInfo.lineStart : undefined;

      if (processMermaidButtons(el, this, ctx.sourcePath, lineStart)) return;
      observeForLateMermaid(el, this, ctx.sourcePath, lineStart);
    });
  }

  /**
   * Executed when the plugin is disabled or unloaded.
   */
  onunload() {
    console.debug("Mermaid Block to Image plugin unloaded");
  }

  /**
   * Loads configurations from the data file.
   */
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MermaidSettings>);
    // Coerce deprecated 'svg' urlFormat to 'png' to avoid rendering errors
    if ((this.settings.urlFormat as string) === "svg") {
      this.settings.urlFormat = "png";
    }
  }

  /**
   * Saves configurations to the data file.
   */
  async saveSettings() {
    await this.saveData(this.settings);
  }
}
