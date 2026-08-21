class EgoAIEngine {
  constructor({
    tools,
    model = null,
    vision = null,
    memory = null,
    executor = null,
    sandbox = null,
    logger = console,
    config = {}
  } = {}) {
    if (!tools) {
      throw new Error("EgoTools is required.");
    }

    this.tools = tools;
    this.model = model;
    this.vision = vision;
    this.memory = memory || tools;
    this.executor = executor;
    this.sandbox = sandbox;
    this.logger = logger;

    this.config = {
      maxSteps: 40,
      maxRetries: 3,
      enableMemory: true,
      enablePlanning: true,
      enableReflection: true,
      enableSelfImprovement: true,
      requireTestsForChanges: true,
      streamResponses: true,
      ...config
    };

    this.state = {
      running: false,
      currentRequest: null,
      currentPlan: null,
      step: 0,
      history: []
    };
  }

  async run(request, context = {}) {
    if (!request) {
      throw new Error("Request is required.");
    }

    if (this.state.running) {
      throw new Error("Ego is already processing another request.");
    }

    this.state.running = true;
    this.state.currentRequest = request;
    this.state.step = 0;

    const startedAt = Date.now();

    try {
      this.emit("request_started", {
        request,
        startedAt
      });

      const memories = await this.retrieveMemory(
        request
      );

      const understanding =
        await this.understandRequest(
          request,
          memories,
          context
        );

      const plan =
        await this.createPlan(
          understanding,
          context
        );

      this.state.currentPlan = plan;

      this.emit("plan_created", {
        plan
      });

      const result =
        await this.executePlan(
          plan,
          context
        );

      const finalResult =
        await this.reflect(
          request,
          result,
          context
        );

      await this.storeExperience(
        request,
        understanding,
        finalResult
      );

      this.emit("request_completed", {
        durationMs:
          Date.now() - startedAt,
        result: finalResult
      });

      return finalResult;
    } catch (error) {
      this.emit("request_failed", {
        error
      });

      throw error;
    } finally {
      this.state.running = false;
      this.state.currentRequest = null;
      this.state.currentPlan = null;
      this.state.step = 0;
    }
  }

  async understandRequest(
    request,
    memories,
    context
  ) {
    const prompt = {
      type: "understand_request",
      request,
      memories,
      availableTools:
        this.getAvailableTools(),
      context
    };

    if (!this.model) {
      return {
        intent: "unknown",
        goal: request,
        entities: [],
        requirements: [],
        constraints: [],
        needsTools: true
      };
    }

    return this.model.generate(prompt);
  }

  async createPlan(
    understanding,
    context
  ) {
    if (!this.config.enablePlanning) {
      return {
        goal: understanding.goal,
        steps: [
          {
            id: "step_1",
            type: "direct",
            action: understanding.goal
          }
        ]
      };
    }

    if (!this.model) {
      return {
        goal: understanding.goal,
        steps: [
          {
            id: "step_1",
            type: "reason",
            action: understanding.goal
          }
        ]
      };
    }

    const plan =
      await this.model.generate({
        type: "create_plan",
        understanding,
        tools:
          this.getAvailableTools(),
        context
      });

    return this.normalizePlan(plan);
  }

  normalizePlan(plan) {
    if (!plan || !Array.isArray(plan.steps)) {
      return {
        goal: plan?.goal || "Complete request",
        steps: [
          {
            id: "step_1",
            type: "reason",
            action:
              plan?.goal ||
              "Complete request"
          }
        ]
      };
    }

    return {
      goal: plan.goal || "Complete request",
      steps: plan.steps.slice(
        0,
        this.config.maxSteps
      )
    };
  }

  async executePlan(
    plan,
    context
  ) {
    const results = [];

    for (const step of plan.steps) {
      this.state.step++;

      this.emit("step_started", {
        step,
        index: this.state.step
      });

      const result =
        await this.executeStep(
          step,
          context
        );

      results.push({
        step,
        result
      });

      this.emit("step_completed", {
        step,
        result
      });

      if (
        result &&
        result.stop === true
      ) {
        break;
      }
    }

    return {
      success: true,
      goal: plan.goal,
      results
    };
  }

  async executeStep(
    step,
    context
  ) {
    if (!step) {
      throw new Error("Invalid plan step.");
    }

    if (
      step.type === "tool"
    ) {
      return this.executeToolStep(
        step,
        context
      );
    }

    if (
      step.type === "self_improve"
    ) {
      return this.selfImprove(
        step,
        context
      );
    }

    if (
      step.type === "reason"
    ) {
      return this.reason(
        step,
        context
      );
    }

    if (
      step.type === "respond"
    ) {
      return {
        success: true,
        response:
          step.response || ""
      };
    }

    return this.executeDynamicStep(
      step,
      context
    );
  }

  async executeToolStep(
    step,
    context
  ) {
    if (!step.tool) {
      throw new Error(
        "Tool name is required."
      );
    }

    const tool =
      this.tools.getTool(step.tool);

    if (!tool) {
      return this.handleMissingCapability(
        step,
        context
      );
    }

    let lastError = null;

    for (
      let attempt = 1;
      attempt <= this.config.maxRetries;
      attempt++
    ) {
      try {
        return await this.tools.useTool(
          step.tool,
          step.input || {},
          {
            ...context,
            aiEngine: this,
            aiHandler: this.model
              ? input =>
                  this.model.generate(input)
              : null,
            visionHandler:
              this.vision,
            executor:
              this.executor,
            sandbox:
              this.sandbox
          }
        );
      } catch (error) {
        lastError = error;

        this.emit("tool_error", {
          tool: step.tool,
          attempt,
          error
        });

        if (
          attempt <
          this.config.maxRetries
        ) {
          await this.recoverFromToolError(
            step,
            error,
            context
          );
        }
      }
    }

    throw lastError;
  }

  async executeDynamicStep(
    step,
    context
  ) {
    if (!this.model) {
      return {
        success: false,
        error:
          "No model is connected to execute this dynamic capability."
      };
    }

    return this.model.generate({
      type: "dynamic_execution",
      step,
      availableTools:
        this.getAvailableTools(),
      context
    });
  }

  async reason(
    step,
    context
  ) {
    if (!this.model) {
      return {
        success: true,
        result: step.action
      };
    }

    return this.model.generate({
      type: "reasoning",
      task: step.action,
      context
    });
  }

  async reflect(
    request,
    result,
    context
  ) {
    if (!this.config.enableReflection) {
      return result;
    }

    if (!this.model) {
      return result;
    }

    const evaluation =
      await this.model.generate({
        type: "evaluate_result",
        request,
        result,
        context
      });

    if (
      evaluation &&
      evaluation.needsImprovement
    ) {
      return {
        ...result,
        evaluation,
        needsImprovement: true
      };
    }

    return {
      ...result,
      evaluation
    };
  }

  async retrieveMemory(request) {
    if (!this.config.enableMemory) {
      return [];
    }

    if (
      !this.memory ||
      typeof this.memory.searchMemory !==
        "function"
    ) {
      return [];
    }

    return this.memory.searchMemory(
      request,
      20
    );
  }

  async storeExperience(
    request,
    understanding,
    result
  ) {
    if (!this.config.enableMemory) {
      return;
    }

    if (
      !this.memory ||
      typeof this.memory.remember !==
        "function"
    ) {
      return;
    }

    this.memory.remember(
      {
        request,
        understanding,
        result
      },
      {
        type: "experience",
        importance: 0.4
      }
    );
  }

  async handleMissingCapability(
    step,
    context
  ) {
    if (
      !this.config.enableSelfImprovement
    ) {
      return {
        success: false,
        error:
          `Capability "${step.tool}" is unavailable.`
      };
    }

    return this.selfImprove(
      {
        type: "self_improve",
        capability:
          step.tool,
        objective:
          step.action ||
          `Create capability ${step.tool}`
      },
      context
    );
  }

  async selfImprove(
    step,
    context
  ) {
    if (!this.model) {
      return {
        success: false,
        error:
          "No AI model is connected for capability development."
      };
    }

    const capabilityName =
      step.capability ||
      step.tool ||
      "dynamic_capability";

    const specification =
      await this.model.generate({
        type: "design_capability",
        name: capabilityName,
        objective:
          step.objective ||
          step.action ||
          "",
        existingTools:
          this.getAvailableTools(),
        context
      });

    if (!specification) {
      return {
        success: false,
        error:
          "Capability specification could not be created."
      };
    }

    const implementation =
      await this.model.generate({
        type: "implement_capability",
        specification,
        context
      });

    if (!implementation) {
      return {
        success: false,
        error:
          "Capability implementation could not be created."
      };
    }

    const validation =
      await this.validateImprovement(
        implementation,
        context
      );

    if (!validation.passed) {
      return {
        success: false,
        stage: "validation",
        validation
      };
    }

    if (
      !this.tools ||
      typeof this.tools.buildCapability !==
        "function"
    ) {
      return {
        success: false,
        error:
          "Tool extension interface is unavailable."
      };
    }

    return this.tools.buildCapability({
      name: capabilityName,
      objective:
        step.objective ||
        step.action ||
        "",
      aiHandler:
        input =>
          this.model.generate(input),
      tester:
        extension =>
          this.testExtension(
            extension,
            context
          )
    });
  }

  async validateImprovement(
    implementation,
    context
  ) {
    if (
      !this.config.requireTestsForChanges
    ) {
      return {
        passed: true,
        skipped: true
      };
    }

    if (
      !this.sandbox ||
      typeof this.sandbox.validate !==
        "function"
    ) {
      return {
        passed: false,
        reason:
          "A sandbox validator is required before installing generated changes."
      };
    }

    try {
      return await this.sandbox.validate(
        implementation,
        context
      );
    } catch (error) {
      return {
        passed: false,
        reason:
          error?.message ||
          String(error)
      };
    }
  }

  async testExtension(
    extension,
    context
  ) {
    if (
      !this.sandbox ||
      typeof this.sandbox.test !==
        "function"
    ) {
      return {
        passed: false,
        reason:
          "Sandbox test environment unavailable."
      };
    }

    try {
      const result =
        await this.sandbox.test(
          extension,
          context
        );

      return {
        passed:
          result?.passed === true,
        result
      };
    } catch (error) {
      return {
        passed: false,
        error:
          error?.message ||
          String(error)
      };
    }
  }

  async recoverFromToolError(
    step,
    error,
    context
  ) {
    if (!this.model) {
      return null;
    }

    return this.model.generate({
      type: "recover",
      failedStep: step,
      error:
        error?.message ||
        String(error),
      availableTools:
        this.getAvailableTools(),
      context
    });
  }

  getAvailableTools() {
    if (
      !this.tools ||
      typeof this.tools.listTools !==
        "function"
    ) {
      return [];
    }

    return this.tools
      .listTools()
      .map(tool => ({
        name: tool.name,
        category: tool.category,
        description:
          tool.description
      }));
  }

  getState() {
    return {
      ...this.state,
      availableTools:
        this.getAvailableTools()
    };
  }

  emit(type, data = {}) {
    if (
      this.tools &&
      typeof this.tools.emit ===
        "function"
    ) {
      this.tools.emit({
        type,
        timestamp: Date.now(),
        ...data
      });
    }
  }
}

export default EgoAIEngine;
export { EgoAIEngine };
