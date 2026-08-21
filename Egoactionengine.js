// EgoActionEngine.js

class EgoActionEngine {
  constructor({
    tools = null,
    permissions = null,
    memory = null,
    logger = console,
    config = {}
  } = {}) {
    this.tools = tools;
    this.permissions = permissions;
    this.memory = memory;
    this.logger = logger;

    this.config = {
      maxParallelActions: 8,
      timeoutMs: 3000,
      requirePermission: true,
      allowParallel: true,
      dryRun: false,
      ...config
    };

    this.running = false;
    this.activeActions = new Map();
    this.history = [];
    this.listeners = new Map();
  }

  async execute(action) {
    this.validateAction(action);

    const id = action.id || this.createId();

    if (
      this.config.requirePermission &&
      !this.hasPermission(action)
    ) {
      throw new Error(
        `Permission denied for action: ${action.name}`
      );
    }

    if (this.config.dryRun) {
      return {
        success: true,
        dryRun: true,
        action
      };
    }

    const tool = this.resolveTool(action.name);

    if (!tool) {
      throw new Error(
        `Tool not found: ${action.name}`
      );
    }

    const startedAt = Date.now();

    this.activeActions.set(id, {
      id,
      action,
      startedAt
    });

    this.emit("action_started", {
      id,
      action
    });

    try {
      const result = await this.withTimeout(
        this.invokeTool(tool, action.parameters || {}),
        this.config.timeoutMs
      );

      const record = {
        id,
        action,
        result,
        success: true,
        startedAt,
        finishedAt: Date.now()
      };

      this.history.push(record);

      await this.remember(record);

      this.emit("action_completed", record);

      return record;
    } catch (error) {
      const record = {
        id,
        action,
        success: false,
        error: error.message,
        startedAt,
        finishedAt: Date.now()
      };

      this.history.push(record);

      this.emit("action_failed", record);

      throw error;
    } finally {
      this.activeActions.delete(id);
    }
  }

  async executeMany(actions = []) {
    if (!Array.isArray(actions)) {
      throw new Error("Actions must be an array.");
    }

    if (!this.config.allowParallel) {
      const results = [];

      for (const action of actions) {
        results.push(
          await this.execute(action)
        );
      }

      return results;
    }

    const results = [];

    for (
      let i = 0;
      i < actions.length;
      i += this.config.maxParallelActions
    ) {
      const batch = actions.slice(
        i,
        i + this.config.maxParallelActions
      );

      const batchResults =
        await Promise.allSettled(
          batch.map(action =>
            this.execute(action)
          )
        );

      results.push(...batchResults);
    }

    return results;
  }

  resolveTool(name) {
    if (!this.tools) return null;

    if (
      typeof this.tools.getTool === "function"
    ) {
      return this.tools.getTool(name);
    }

    if (
      typeof this.tools.get === "function"
    ) {
      return this.tools.get(name);
    }

    return null;
  }

  async invokeTool(tool, parameters) {
    if (typeof tool === "function") {
      return tool(parameters);
    }

    if (
      typeof tool.execute === "function"
    ) {
      return tool.execute(parameters);
    }

    if (
      typeof tool.run === "function"
    ) {
      return tool.run(parameters);
    }

    throw new Error(
      "Tool does not expose an executable interface."
    );
  }

  hasPermission(action) {
    if (!this.permissions) {
      return !this.config.requirePermission;
    }

    if (
      typeof this.permissions.canExecute ===
      "function"
    ) {
      return this.permissions.canExecute(action);
    }

    if (
      typeof this.permissions.has === "function"
    ) {
      return this.permissions.has(action.name);
    }

    return false;
  }

  validateAction(action) {
    if (!action || typeof action !== "object") {
      throw new Error("Invalid action.");
    }

    if (
      !action.name ||
      typeof action.name !== "string"
    ) {
      throw new Error(
        "Action name is required."
      );
    }
  }

  async remember(record) {
    if (
      !this.memory ||
      typeof this.memory.remember !== "function"
    ) {
      return;
    }

    await this.memory.remember(
      record,
      {
        type: "action_history",
        actionName: record.action.name
      }
    );
  }

  getHistory(limit = 100) {
    return this.history.slice(-limit);
  }

  clearHistory() {
    this.history = [];
  }

  getActiveActions() {
    return Array.from(
      this.activeActions.values()
    );
  }

  cancel(id) {
    const action =
      this.activeActions.get(id);

    if (!action) return false;

    this.emit("action_cancel_requested", {
      id
    });

    return true;
  }

  on(event, callback) {
    if (typeof callback !== "function") {
      throw new Error(
        "Callback must be a function."
      );
    }

    if (!this.listeners.has(event)) {
      this.listeners.set(
        event,
        new Set()
      );
    }

    this.listeners.get(event).add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  emit(event, data = {}) {
    const listeners =
      this.listeners.get(event);

    if (!listeners) return;

    for (const callback of listeners) {
      try {
        callback(data);
      } catch (error) {
        this.logger.error(error);
      }
    }
  }

  async withTimeout(promise, timeoutMs) {
    let timer;

    const timeout =
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              "Action execution timed out."
            )
          );
        }, timeoutMs);
      });

    try {
      return await Promise.race([
        promise,
        timeout
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  createId() {
    return (
      "action_" +
      Date.now().toString(36) +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 10)
    );
  }

  getStatus() {
    return {
      active:
        this.activeActions.size,
      history:
        this.history.length,
      toolsConnected:
        !!this.tools,
      permissionsConnected:
        !!this.permissions,
      dryRun:
        this.config.dryRun
    };
  }
}

export default EgoActionEngine;
export { EgoActionEngine };
