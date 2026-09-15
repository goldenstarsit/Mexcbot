import { validateTradingConfig } from "../config/validateTradingConfig.js";

export default class TradingConfigService {
  constructor({
    runtimeTradingConfigRepository,
    defaultConfig,
  }) {
    if (!runtimeTradingConfigRepository) {
      throw new Error(
        "Runtime trading config repository is required",
      );
    }

    if (!defaultConfig) {
      throw new Error("Default trading config is required");
    }

    this.repository = runtimeTradingConfigRepository;
    this.defaultConfig = structuredClone(defaultConfig);
  }

  initialize() {
    const existing = this.repository.getConfig();

    if (existing) {
      return existing;
    }

    this.repository.save(this.defaultConfig);

    return this.repository.getConfig();
  }

  getCurrent() {
    const current =
      this.repository.getConfig() ?? this.initialize();

    return structuredClone(current);
  }

  createCycleSnapshot() {
    const current = this.getCurrent();

    return {
      version: current.version,
      config: structuredClone(current.config),
    };
  }

  update(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Trading config is required");
    }

    validateTradingConfig(config);

    this.repository.save(structuredClone(config));

    return this.getCurrent();
  }
}
