import { App, PluginSettingTab, Setting } from "obsidian";
import MermaidToImagePlugin from "./main";

/**
 * Interface defining the plugin configuration options.
 */
export interface MermaidSettings {
  /**
   * The base URL of the Kroki server (defaults to https://kroki.io).
   */
  krokiInstanceUrl: string;
  /**
   * Where to save the generated PNG images:
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
  krokiInstanceUrl: "https://kroki.io",
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

    new Setting(containerEl).setHeading().setName("Settings for Mermaid block to image");

    // 1. Kroki server URL configuration
    new Setting(containerEl)
      .setName("Kroki instance URL")
      .setDesc("The base URL of the Kroki server. Default is the free public instance: https://kroki.io. You can self-host your own.")
      .addText((text) =>
        text
          .setPlaceholder("https://kroki.io")
          .setValue(this.plugin.settings.krokiInstanceUrl)
          .onChange(async (value) => {
            this.plugin.settings.krokiInstanceUrl = value.trim() || "https://kroki.io";
            await this.plugin.saveSettings();
          })
      );

    // 2. Storage location strategy configuration
    new Setting(containerEl)
      .setName("Storage location")
      .setDesc("Where should the generated PNG images be saved?")
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
