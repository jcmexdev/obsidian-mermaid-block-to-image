import { App, PluginSettingTab, Setting } from "obsidian";
import MermaidToImagePlugin from "./main";

/**
 * Interface defining the plugin configuration options.
 */
export interface MermaidSettings {
  /**
   * Format used when downloading diagrams directly to the PC.
   */
  downloadFormat: "svg" | "png" | "webp";
  /**
   * Format used when converting diagrams to online URLs.
   */
  urlFormat: "svg" | "png" | "webp";
  /**
   * The online service to use for generating URL encoded diagram images.
   */
  service: "kroki" | "mermaid-ink";
  /**
   * Custom server URL for Kroki.
   */
  krokiServerUrl: string;
  /**
   * Custom server URL for Mermaid.ink.
   */
  mermaidInkServerUrl: string;
  /**
   * The theme to use for rendering diagrams.
   */
  theme: "match-obsidian" | "default" | "dark" | "forest" | "neutral" | "base";
}

/**
 * Default plugin settings.
 */
export const DEFAULT_SETTINGS: MermaidSettings = {
  downloadFormat: "png",
  urlFormat: "png",
  service: "mermaid-ink",
  krokiServerUrl: "https://kroki.io",
  mermaidInkServerUrl: "https://mermaid.ink",
  theme: "match-obsidian",
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

    // Guide explaining formats
    const descEl = containerEl.createDiv({ cls: "setting-item-description" });
    descEl.setText(
      "Format Guide:\n" +
      "• SVG: Vector format. Diagrams will be 100% crisp at any zoom level and use very little space.\n" +
      "• PNG: Standard raster format with transparent background. Great for copying and pasting into other apps.\n" +
      "• WebP: Modern raster format with high compression and excellent quality."
    );
    descEl.addClass("mermaid-settings-guide");

    // 1. Download format configuration
    new Setting(containerEl)
      .setName("Download image format")
      .setDesc("Image format used when downloading the diagram directly to your computer.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("svg", "Svg (scalable vector graphics)")
          .addOption("png", "PNG (portable network graphics)")
          .addOption("webp", "WebP (modern image format)")
          .setValue(this.plugin.settings.downloadFormat)
          .onChange(async (value: "svg" | "png" | "webp") => {
            this.plugin.settings.downloadFormat = value;
            await this.plugin.saveSettings();
          })
      );

    // 2. Mermaid theme configuration
    new Setting(containerEl)
      .setName("Mermaid theme")
      .setDesc("Select the theme to use for rendering diagrams. 'match Obsidian theme' dynamically selects dark or default based on your Obsidian environment.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("match-obsidian", "Match Obsidian theme (dynamic)")
          .addOption("default", "Default (light)")
          .addOption("dark", "Dark")
          .addOption("forest", "Forest (green)")
          .addOption("neutral", "Neutral (gray)")
          .addOption("base", "Base (simple)")
          .setValue(this.plugin.settings.theme)
          .onChange(async (value: "match-obsidian" | "default" | "dark" | "forest" | "neutral" | "base") => {
            this.plugin.settings.theme = value;
            await this.plugin.saveSettings();
          })
      );

    // 3. URL service configuration
    new Setting(containerEl)
      .setName("URL service provider")
      .setDesc("Online service used to render and generate image URL links.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("mermaid-ink", "Mermaid.ink (Official)")
          .addOption("kroki", "Kroki.io")
          .setValue(this.plugin.settings.service)
          .onChange(async (value: "kroki" | "mermaid-ink") => {
            this.plugin.settings.service = value;
            
            // Kroki does not support webp. If it was active, fallback to png.
            if (value === "kroki" && this.plugin.settings.urlFormat === "webp") {
              this.plugin.settings.urlFormat = "png";
            }
            
            await this.plugin.saveSettings();
            (this as unknown as { display(): void }).display();
          })
      );

    // 3. URL format configuration (dynamic options depending on service)
    const isKroki = this.plugin.settings.service === "kroki";
    new Setting(containerEl)
      .setName("URL image format")
      .setDesc("Image format for the generated markdown URL link. Kroki does not support WebP.")
      .addDropdown((dropdown) => {
        dropdown.addOption("svg", "Svg (scalable vector graphics)");
        dropdown.addOption("png", "PNG (portable network graphics)");
        
        if (!isKroki) {
          dropdown.addOption("webp", "WebP (modern image format)");
        }
        
        dropdown.setValue(this.plugin.settings.urlFormat);
        dropdown.onChange(async (value: "svg" | "png" | "webp") => {
          this.plugin.settings.urlFormat = value;
          await this.plugin.saveSettings();
        });
      });

    // 4. Custom Server URL configuration
    if (isKroki) {
      new Setting(containerEl)
        .setName("Kroki server URL")
        .setDesc("Base URL of the Kroki server to use.")
        .addText((text) =>
          text
            .setPlaceholder("https://kroki.io")
            .setValue(this.plugin.settings.krokiServerUrl)
            .onChange(async (value) => {
              this.plugin.settings.krokiServerUrl = value.trim() || "https://kroki.io";
              await this.plugin.saveSettings();
            })
        );
    } else {
      new Setting(containerEl)
        .setName("Mermaid.ink server URL")
        .setDesc("Base URL of the Mermaid.ink server to use.")
        .addText((text) =>
          text
            .setPlaceholder("https://mermaid.ink")
            .setValue(this.plugin.settings.mermaidInkServerUrl)
            .onChange(async (value) => {
              this.plugin.settings.mermaidInkServerUrl = value.trim() || "https://mermaid.ink";
              await this.plugin.saveSettings();
            })
        );
    }
  }
}
