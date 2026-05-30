import { App, PluginSettingTab, Setting } from "obsidian";
import MermaidToImagePlugin from "./main";

/**
 * Interface defining the plugin configuration options.
 */
export interface MermaidSettings {
  /**
   * Output format for local offline images.
   */
  localFormat: "svg" | "png" | "webp";
  /**
   * Where to save the generated local images:
   * - 'same-folder': In the same folder as the active note.
   * - 'custom-folder': In a user-specified folder path.
   */
  storageLocation: "same-folder" | "custom-folder";
  /**
   * The vault folder path (e.g., 'assets/diagrams') where images will be stored
   * when `storageLocation` is 'custom-folder'.
   */
  customFolderPath: string;
}

/**
 * Default plugin settings.
 */
export const DEFAULT_SETTINGS: MermaidSettings = {
  localFormat: "png",
  storageLocation: "same-folder",
  customFolderPath: "",
};

/**
 * Plugin settings tab.
 */
export class MermaidSettingTab extends PluginSettingTab {
  plugin: MermaidToImagePlugin;

  constructor(app: App, plugin: MermaidToImagePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setHeading().setName("Mermaid block to image configuration");

    // 1. Local image format configuration
    new Setting(containerEl)
      .setName("Local image format")
      .setDesc("Select the output image format. Svg is 100% offline, crisp, and preserves theme colors. PNG/WebP are also generated locally offline using a canvas.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("svg", "Svg (scalable vector graphics)")
          .addOption("png", "PNG (portable network graphics)")
          .addOption("webp", "WebP (modern image format)")
          .setValue(this.plugin.settings.localFormat)
          .onChange(async (value: "svg" | "png" | "webp") => {
            this.plugin.settings.localFormat = value;
            await this.plugin.saveSettings();
          })
      );

    // 2. Storage location strategy configuration
    new Setting(containerEl)
      .setName("Storage location")
      .setDesc("Where should the generated local images be saved?")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("same-folder", "Same folder as the note")
          .addOption("custom-folder", "Custom folder in the vault")
          .setValue(this.plugin.settings.storageLocation)
          .onChange(async (value: "same-folder" | "custom-folder") => {
            this.plugin.settings.storageLocation = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

    // 3. Custom folder path configuration (displayed only if 'custom-folder' is active)
    if (this.plugin.settings.storageLocation === "custom-folder") {
      new Setting(containerEl)
        .setName("Custom folder path")
        .setDesc("Folder in your vault where images will be stored.")
        .addText((text) =>
          text
            .setPlaceholder("Assets/diagrams")
            .setValue(this.plugin.settings.customFolderPath)
            .onChange(async (value) => {
              this.plugin.settings.customFolderPath = value.trim();
              await this.plugin.saveSettings();
            })
        );
    }
  }
}
