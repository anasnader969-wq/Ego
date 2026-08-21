class EgoTools {
  constructor(config = {}) {
    this.config = {
      responseStartTargetMs: 3000,
      maxMemoryItems: 10000,
      maxTaskHistory: 1000,
      autoImprove: true,
      autoRegisterTools: true,
      ...config
    };

    this.tools = new Map();
    this.memory = [];
    this.tasks = new Map();
    this.taskHistory = [];
    this.extensions = new Map();
    this.listeners = new Set();

    this.voice = {
      connected: false,
      streaming: false
    };

    this.video = {
      connected: false,
      streaming: false
    };

    this.registerCoreTools();
  }

  on(listener) {
    if (typeof listener !== "function") {
      throw new Error("Listener must be a function.");
    }

    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {}
    }
  }

  createId(prefix) {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return `${prefix}_${crypto.randomUUID()}`;
    }

    return `${prefix}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;
  }

  registerTool(tool) {
    if (!tool || !tool.name) {
      throw new Error("Tool name is required.");
    }

    this.tools.set(tool.name, {
      ...tool,
      registeredAt: Date.now()
    });

    this.emit({
      type: "tool_registered",
      name: tool.name
    });

    return true;
  }

  unregisterTool(name) {
    return this.tools.delete(name);
  }

  hasTool(name) {
    return this.tools.has(name);
  }

  getTool(name) {
    return this.tools.get(name) || null;
  }

  listTools() {
    return [...this.tools.values()];
  }

  async useTool(name, input = {}, context = {}) {
    const tool = this.tools.get(name);

    if (!tool) {
      throw new Error(`Tool "${name}" not found.`);
    }

    if (typeof tool.execute !== "function") {
      throw new Error(`Tool "${name}" has no executor.`);
    }

    return tool.execute(input, context);
  }

  remember(content, options = {}) {
    if (!content) return null;

    const memory = {
      id: this.createId("memory"),
      content,
      type: options.type || "general",
      importance:
        typeof options.importance === "number"
          ? options.importance
          : 0.5,
      metadata: options.metadata || {},
      createdAt: Date.now(),
      lastUsedAt: Date.now()
    };

    this.memory.push(memory);

    if (this.memory.length > this.config.maxMemoryItems) {
      this.memory.shift();
    }

    this.emit({
      type: "memory_created",
      memory
    });

    return memory;
  }

  searchMemory(query, limit = 10) {
    const text = String(query).toLowerCase();

    return this.memory
      .filter(memory =>
        String(memory.content)
          .toLowerCase()
          .includes(text)
      )
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit)
      .map(memory => {
        memory.lastUsedAt = Date.now();
        return memory;
      });
  }

  getRecentMemory(limit = 20) {
    return this.memory
      .slice(-limit)
      .reverse();
  }

  forgetMemory(id) {
    const index = this.memory.findIndex(
      memory => memory.id === id
    );

    if (index === -1) return false;

    this.memory.splice(index, 1);
    return true;
  }

  clearMemory() {
    this.memory = [];
  }

  async startVoiceChat(adapter = null) {
    this.voice.connected = true;
    this.voice.streaming = true;

    if (adapter && typeof adapter.connect === "function") {
      await adapter.connect({
        mode: "voice",
        streaming: true
      });
    }

    this.emit({
      type: "voice_connected"
    });

    return {
      success: true,
      mode: "voice",
      streaming: true
    };
  }

  stopVoiceChat(adapter = null) {
    this.voice.connected = false;
    this.voice.streaming = false;

    if (adapter && typeof adapter.disconnect === "function") {
      adapter.disconnect();
    }

    this.emit({
      type: "voice_disconnected"
    });
  }

  async sendVoice(input, aiHandler) {
    if (typeof aiHandler !== "function") {
      throw new Error("AI voice handler is required.");
    }

    const startedAt = Date.now();

    const result = await aiHandler(input, {
      realtime: true,
      elapsedMs: () => Date.now() - startedAt
    });

    this.emit({
      type: "voice_response",
      result,
      elapsedMs: Date.now() - startedAt
    });

    return result;
  }

  async startVideoChat(adapter = null) {
    this.video.connected = true;
    this.video.streaming = true;

    if (adapter && typeof adapter.connect === "function") {
      await adapter.connect({
        mode: "video",
        streaming: true
      });
    }

    this.emit({
      type: "video_connected"
    });

    return {
      success: true,
      mode: "video",
      streaming: true
    };
  }

  stopVideoChat(adapter = null) {
    this.video.connected = false;
    this.video.streaming = false;

    if (adapter && typeof adapter.disconnect === "function") {
      adapter.disconnect();
    }

    this.emit({
      type: "video_disconnected"
    });
  }

  async analyzeImage(
    image,
    instruction = "",
    visionHandler
  ) {
    if (typeof visionHandler !== "function") {
      throw new Error("Vision handler is required.");
    }

    return visionHandler({
      type: "image",
      image,
      instruction,
      realtime: true
    });
  }

  async analyzeVideoFrame(
    frame,
    instruction = "",
    visionHandler
  ) {
    if (typeof visionHandler !== "function") {
      throw new Error("Vision handler is required.");
    }

    return visionHandler({
      type: "video_frame",
      frame,
      instruction,
      realtime: true
    });
  }

  async generateCode({
    description,
    language = "javascript",
    framework = "",
    existingFiles = [],
    aiHandler
  }) {
    if (typeof aiHandler !== "function") {
      throw new Error("AI code handler is required.");
    }

    return aiHandler({
      type: "generate_code",
      description,
      language,
      framework,
      existingFiles
    });
  }

  async editCode({
    code,
    instruction,
    language = "javascript",
    aiHandler
  }) {
    if (typeof aiHandler !== "function") {
      throw new Error("AI code handler is required.");
    }

    return aiHandler({
      type: "edit_code",
      code,
      instruction,
      language
    });
  }

  async debugCode({
    code,
    error,
    language = "javascript",
    aiHandler
  }) {
    if (typeof aiHandler !== "function") {
      throw new Error("AI code handler is required.");
    }

    return aiHandler({
      type: "debug_code",
      code,
      error,
      language
    });
  }

  async reviewCode({
    code,
    language = "javascript",
    aiHandler
  }) {
    if (typeof aiHandler !== "function") {
      throw new Error("AI code handler is required.");
    }

    return aiHandler({
      type: "review_code",
      code,
      language
    });
  }

  async createProject({
    name,
    description,
    type = "application",
    platform = "cross-platform",
    aiHandler
  }) {
    if (typeof aiHandler !== "function") {
      throw new Error("AI project handler is required.");
    }

    const task = this.createTask(
      `create_project:${name}`
    );

    try {
      const result = await aiHandler({
        type: "create_project",
        name,
        description,
        projectType: type,
        platform
      });

      this.completeTask(task.id, result);

      return result;
    } catch (error) {
      this.failTask(task.id, error.message);
      throw error;
    }
  }

  async createWebsite({
    description,
    aiHandler
  }) {
    return this.createProject({
      name: "website",
      description,
      type: "website",
      platform: "web",
      aiHandler
    });
  }

  async createApp({
    description,
    platform = "cross-platform",
    aiHandler
  }) {
    return this.createProject({
      name: "application",
      description,
      type: "application",
      platform,
      aiHandler
    });
  }

  async createGame({
    description,
    engine = "",
    platform = "cross-platform",
    aiHandler
  }) {
    if (typeof aiHandler !== "function") {
      throw new Error("AI project handler is required.");
    }

    return aiHandler({
      type: "create_game",
      description,
      engine,
      platform
    });
  }

  async createAIModel({
    description,
    architecture = "",
    aiHandler
  }) {
    if (typeof aiHandler !== "function") {
      throw new Error("AI model handler is required.");
    }

    return aiHandler({
      type: "create_ai_model",
      description,
      architecture
    });
  }

  createTask(name, metadata = {}) {
    const task = {
      id: this.createId("task"),
      name,
      status: "running",
      progress: 0,
      message: "",
      metadata,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.tasks.set(task.id, task);

    this.emit({
      type: "task_started",
      task
    });

    return task;
  }

  updateTask(id, progress, message = "") {
    const task = this.tasks.get(id);

    if (!task) return null;

    task.progress = Math.max(
      0,
      Math.min(100, progress)
    );

    task.message = message;
    task.updatedAt = Date.now();

    this.emit({
      type: "task_progress",
      task
    });

    return task;
  }

  completeTask(id, result = null) {
    const task = this.tasks.get(id);

    if (!task) return null;

    task.status = "completed";
    task.progress = 100;
    task.result = result;
    task.updatedAt = Date.now();

    this.taskHistory.push(task);

    if (this.taskHistory.length > this.config.maxTaskHistory) {
      this.taskHistory.shift();
    }

    this.emit({
      type: "task_completed",
      task
    });

    return task;
  }

  failTask(id, error) {
    const task = this.tasks.get(id);

    if (!task) return null;

    task.status = "failed";
    task.error = error;
    task.updatedAt = Date.now();

    this.taskHistory.push(task);

    this.emit({
      type: "task_failed",
      task
    });

    return task;
  }

  getTask(id) {
    return this.tasks.get(id) || null;
  }

  getActiveTasks() {
    return [...this.tasks.values()]
      .filter(task => task.status === "running");
  }

  async discoverMissingCapability(
    requirement,
    aiHandler
  ) {
    if (typeof aiHandler !== "function") {
      throw new Error("AI capability handler is required.");
    }

    return aiHandler({
      type: "discover_capability",
      requirement,
      availableTools: this.listTools(),
      currentCapabilities: [
        ...this.extensions.values()
      ]
    });
  }

  async buildCapability({
    name,
    objective,
    aiHandler,
    tester = null
  }) {
    if (typeof aiHandler !== "function") {
      throw new Error("AI extension handler is required.");
    }

    const existing = this.extensions.get(name);

    const result = await aiHandler({
      type: "build_capability",
      name,
      objective,
      existing,
      availableTools: this.listTools()
    });

    if (!result || !result.success) {
      return result || {
        success: false,
        error: "Capability generation failed."
      };
    }

    if (
      this.config.autoRegisterTools &&
      result.tool
    ) {
      this.registerTool(result.tool);
    }

    const extension = {
      id: this.createId("extension"),
      name,
      objective,
      version: existing
        ? this.incrementVersion(existing.version)
        : "1.0.0",
      implementation: result.implementation,
      status: "created",
      createdAt: Date.now()
    };

    if (typeof tester === "function") {
      const test = await tester(extension);

      extension.test = test;

      if (!test || !test.passed) {
        extension.status = "failed";

        return {
          success: false,
          extension
        };
      }
    }

    extension.status = "active";

    this.extensions.set(
      name,
      extension
    );

    this.emit({
      type: "capability_created",
      extension
    });

    return {
      success: true,
      extension
    };
  }

  async improveCapability({
    name,
    problem,
    aiHandler,
    tester = null
  }) {
    return this.buildCapability({
      name,
      objective:
        `Improve capability "${name}" to solve this problem: ${problem}`,
      aiHandler,
      tester
    });
  }

  async executeRequest({
    request,
    aiHandler,
    visionHandler = null,
    adapter = null,
    tester = null
  }) {
    if (!request) {
      throw new Error("Request is required.");
    }

    if (typeof aiHandler !== "function") {
      throw new Error("AI handler is required.");
    }

    const startedAt = Date.now();

    this.emit({
      type: "request_started",
      request,
      targetResponseStartMs:
        this.config.responseStartTargetMs
    });

    const result = await aiHandler({
      request,
      tools: this.listTools(),
      memory: this.getRecentMemory(30),
      extensions: [...this.extensions.values()],
      voice: this.voice,
      video: this.video,
      realtime: true,
      visionHandler,
      adapter,
      tester,
      elapsedMs: () =>
        Date.now() - startedAt
    });

    this.emit({
      type: "request_completed",
      result,
      durationMs:
        Date.now() - startedAt
    });

    if (this.config.autoImprove) {
      this.remember(
        {
          request,
          result
        },
        {
          type: "interaction",
          importance: 0.35
        }
      );
    }

    return result;
  }

  incrementVersion(version) {
    const parts = String(version)
      .split(".")
      .map(value => Number(value) || 0);

    while (parts.length < 3) {
      parts.push(0);
    }

    parts[2] += 1;

    return parts.join(".");
  }

  exportState() {
    return {
      memory: this.memory,
      extensions: [...this.extensions.values()],
      tasks: [...this.tasks.values()],
      taskHistory: this.taskHistory
    };
  }

  importState(state) {
    if (!state) return;

    if (Array.isArray(state.memory)) {
      this.memory =
        state.memory.slice(
          -this.config.maxMemoryItems
        );
    }

    if (Array.isArray(state.extensions)) {
      this.extensions = new Map(
        state.extensions.map(extension => [
          extension.name,
          extension
        ])
      );
    }

    if (Array.isArray(state.tasks)) {
      this.tasks = new Map(
        state.tasks.map(task => [
          task.id,
          task
        ])
      );
    }

    if (Array.isArray(state.taskHistory)) {
      this.taskHistory =
        state.taskHistory.slice(
          -this.config.maxTaskHistory
        );
    }
  }

  registerCoreTools() {
    this.registerTool({
      name: "memory",
      category: "core",
      description:
        "Manage persistent contextual memory.",
      execute: async (
        input
      ) => {
        if (input.action === "remember") {
          return this.remember(
            input.content,
            input.options
          );
        }

        if (input.action === "search") {
          return this.searchMemory(
            input.query,
            input.limit
          );
        }

        if (input.action === "recent") {
          return this.getRecentMemory(
            input.limit
          );
        }

        if (input.action === "forget") {
          return this.forgetMemory(
            input.id
          );
        }

        if (input.action === "clear") {
          return this.clearMemory();
        }

        throw new Error(
          "Unknown memory action."
        );
      }
    });

    this.registerTool({
      name: "voice",
      category: "communication",
      description:
        "Real-time voice interaction.",
      execute: async (
        input,
        context
      ) => {
        if (input.action === "start") {
          return this.startVoiceChat(
            context.adapter
          );
        }

        if (input.action === "stop") {
          return this.stopVoiceChat(
            context.adapter
          );
        }

        if (input.action === "send") {
          return this.sendVoice(
            input.message,
            context.aiHandler
          );
        }

        throw new Error(
          "Unknown voice action."
        );
      }
    });

    this.registerTool({
      name: "video",
      category: "communication",
      description:
        "Real-time video interaction and visual understanding.",
      execute: async (
        input,
        context
      ) => {
        if (input.action === "start") {
          return this.startVideoChat(
            context.adapter
          );
        }

        if (input.action === "stop") {
          return this.stopVideoChat(
            context.adapter
          );
        }

        if (input.action === "frame") {
          return this.analyzeVideoFrame(
            input.frame,
            input.instruction,
            context.visionHandler
          );
        }

        throw new Error(
          "Unknown video action."
        );
      }
    });

    this.registerTool({
      name: "vision",
      category: "vision",
      description:
        "Understand images, camera frames and video.",
      execute: async (
        input,
        context
      ) => {
        if (input.action === "image") {
          return this.analyzeImage(
            input.image,
            input.instruction,
            context.visionHandler
          );
        }

        if (input.action === "camera") {
          return this.analyzeVideoFrame(
            input.frame,
            input.instruction,
            context.visionHandler
          );
        }

        throw new Error(
          "Unknown vision action."
        );
      }
    });

    this.registerTool({
      name: "code",
      category: "development",
      description:
        "Generate, edit, debug and review code.",
      execute: async (
        input,
        context
      ) => {
        if (input.action === "generate") {
          return this.generateCode({
            ...input,
            aiHandler:
              context.aiHandler
          });
        }

        if (input.action === "edit") {
          return this.editCode({
            ...input,
            aiHandler:
              context.aiHandler
          });
        }

        if (input.action === "debug") {
          return this.debugCode({
            ...input,
            aiHandler:
              context.aiHandler
          });
        }

        if (input.action === "review") {
          return this.reviewCode({
            ...input,
            aiHandler:
              context.aiHandler
          });
        }

        throw new Error(
          "Unknown code action."
        );
      }
    });

    this.registerTool({
      name: "projects",
      category: "development",
      description:
        "Create complete software projects from natural language.",
      execute: async (
        input,
        context
      ) => {
        if (input.type === "website") {
          return this.createWebsite({
            ...input,
            aiHandler:
              context.aiHandler
          });
        }

        if (input.type === "game") {
          return this.createGame({
            ...input,
            aiHandler:
              context.aiHandler
          });
        }

        if (input.type === "ai_model") {
          return this.createAIModel({
            ...input,
            aiHandler:
              context.aiHandler
          });
        }

        return this.createApp({
          ...input,
          aiHandler:
            context.aiHandler
        });
      }
    });

    this.registerTool({
      name: "tasks",
      category: "system",
      description:
        "Manage long-running tasks and progress.",
      execute: async (
        input
      ) => {
        if (input.action === "create") {
          return this.createTask(
            input.name,
            input.metadata
          );
        }

        if (input.action === "update") {
          return this.updateTask(
            input.id,
            input.progress,
            input.message
          );
        }

        if (input.action === "complete") {
          return this.completeTask(
            input.id,
            input.result
          );
        }

        if (input.action === "fail") {
          return this.failTask(
            input.id,
            input.error
          );
        }

        if (input.action === "active") {
          return this.getActiveTasks();
        }

        throw new Error(
          "Unknown task action."
        );
      }
    });

    this.registerTool({
      name: "self_extension",
      category: "evolution",
      description:
        "Create and improve capabilities through the connected AI execution layer.",
      execute: async (
        input,
        context
      ) => {
        if (input.action === "discover") {
          return this.discoverMissingCapability(
            input.requirement,
            context.aiHandler
          );
        }

        if (input.action === "build") {
          return this.buildCapability({
            name: input.name,
            objective: input.objective,
            aiHandler:
              context.aiHandler,
            tester:
              context.tester
          });
        }

        if (input.action === "improve") {
          return this.improveCapability({
            name: input.name,
            problem: input.problem,
            aiHandler:
              context.aiHandler,
            tester:
              context.tester
          });
        }

        throw new Error(
          "Unknown self-extension action."
        );
      }
    });
  }
}

const egoTools = new EgoTools();

export { EgoTools };

export default egoTools;
