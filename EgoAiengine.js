class EgoAIEngine {
  constructor({
    tools = null,
    model = null,
    memory = null,
    sandbox = null,
    executor = null,
    logger = console,
    config = {}
  } = {}) {
    this.tools = tools;
    this.model = model;
    this.memory = memory;
    this.sandbox = sandbox;
    this.executor = executor;
    this.logger = logger;

    this.config = {
      maxSteps: 50,
      maxRetries: 3,
      enableMemory: true,
      enablePlanning: true,
      enableReflection: true,
      enableSelfImprovement: true,
      requireTestsForChanges: true,
      autoRollback: true,
      ...config
    };

    this.state = {
      running: false,
      request: null,
      step: 0,
      history: [],
      improvements: []
    };
  }

  async run(request, context = {}) {
    if (!request) {
      throw new Error("Request is required.");
    }

    if (this.state.running) {
      throw new Error("EgoAIEngine is already running.");
    }

    this.state.running = true;
    this.state.request = request;
    this.state.step = 0;

    try {
      const memories = await this.retrieveMemory(request);

      const understanding = await this.understand(
        request,
        memories,
        context
      );

      const plan = await this.createPlan(
        understanding,
        context
      );

      const result = await this.executePlan(
        plan,
        context
      );

      const finalResult = await this.reflect(
        request,
        result,
        context
      );

      await this.storeMemory(
        request,
        understanding,
        finalResult
      );

      return finalResult;
    } finally {
      this.state.running = false;
      this.state.request = null;
      this.state.step = 0;
    }
  }

  async understand(request, memories, context) {
    if (!this.model) {
      return {
        goal: request,
        intent: "general",
        memories,
        context
      };
    }

    return this.generate({
      type: "understand",
      request,
      memories,
      context
    });
  }

  async createPlan(understanding, context) {
    if (!this.config.enablePlanning || !this.model) {
      return {
        goal: understanding.goal,
        steps: [
          {
            id: "1",
            type: "dynamic",
            action: understanding.goal
          }
        ]
      };
    }

    const plan = await this.generate({
      type: "plan",
      understanding,
      tools: this.getAvailableTools(),
      context
    });

    if (!plan || !Array.isArray(plan.steps)) {
      return {
        goal: understanding.goal,
        steps: [
          {
            id: "1",
            type: "dynamic",
            action: understanding.goal
          }
        ]
      };
    }

    return {
      goal: plan.goal || understanding.goal,
      steps: plan.steps.slice(0, this.config.maxSteps)
    };
  }

  async executePlan(plan, context) {
    const results = [];

    for (const step of plan.steps) {
      this.state.step += 1;

      const result = await this.executeStep(
        step,
        context
      );

      results.push({
        step,
        result
      });

      this.state.history.push({
        step,
        result,
        timestamp: Date.now()
      });
    }

    return {
      success: true,
      goal: plan.goal,
      results
    };
  }

  async executeStep(step, context) {
    if (!step) {
      throw new Error("Invalid step.");
    }

    if (step.type === "tool") {
      return this.executeTool(step, context);
    }

    if (step.type === "self_improve") {
      return this.selfImprove(step, context);
    }

    if (step.type === "dynamic") {
      return this.dynamicExecution(step, context);
    }

    if (step.type === "reason") {
      return this.reason(step, context);
    }

    return this.dynamicExecution(step, context);
  }

  async executeTool(step, context) {
    if (!this.tools) {
      throw new Error("EgoTools is not connected.");
    }

    const toolName = step.tool;

    if (!toolName) {
      throw new Error("Tool name is required.");
    }

    if (
      typeof this.tools.getTool !== "function" ||
      typeof this.tools.useTool !== "function"
    ) {
      throw new Error(
        "EgoTools does not expose the required tool interface."
      );
    }

    const tool = this.tools.getTool(toolName);

    if (!tool) {
      if (this.config.enableSelfImprovement) {
        return this.selfImprove(
          {
            type: "self_improve",
            capability: toolName,
            objective: step.action || toolName
          },
          context
        );
      }

      throw new Error(
        `Tool "${toolName}" does not exist.`
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
          toolName,
          step.input || {},
          {
            ...context,
            engine: this,
            model: this.model,
            memory: this.memory,
            sandbox: this.sandbox,
            executor: this.executor
          }
        );
      } catch (error) {
        lastError = error;

        if (
          attempt < this.config.maxRetries &&
          this.model
        ) {
          await this.recover(step, error, context);
        }
      }
    }

    throw lastError;
  }

  async dynamicExecution(step, context) {
    if (!this.model) {
      return {
        success: false,
        error: "AI model is not connected."
      };
    }

    return this.generate({
      type: "execute",
      step,
      tools: this.getAvailableTools(),
      context
    });
  }

  async reason(step, context) {
    if (!this.model) {
      return {
        success: true,
        result: step.action || ""
      };
    }

    return this.generate({
      type: "reason",
      task: step.action || "",
      context
    });
  }

  async selfImprove(step, context = {}) {
    if (!this.config.enableSelfImprovement) {
      return {
        success: false,
        error: "Self-improvement is disabled."
      };
    }

    if (!this.model) {
      return {
        success: false,
        error: "AI model is not connected."
      };
    }

    if (!this.sandbox) {
      return {
        success: false,
        error: "Self-improvement requires a sandbox."
      };
    }

    const capability =
      step.capability ||
      step.tool ||
      "dynamic_capability";

    const specification = await this.generate({
      type: "design_improvement",
      capability,
      objective:
        step.objective ||
        step.action ||
        "",
      currentTools: this.getAvailableTools(),
      context
    });

    if (!specification) {
      return {
        success: false,
        error: "Unable to create improvement specification."
      };
    }

    const implementation = await this.generate({
      type: "implement_improvement",
      specification,
      context
    });

    if (!implementation) {
      return {
        success: false,
        error: "Unable to create improvement implementation."
      };
    }

    const validation = await this.validateImprovement(
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

    const testing = await this.testImprovement(
      implementation,
      context
    );

    if (!testing.passed) {
      return {
        success: false,
        stage: "testing",
        testing
      };
    }

    let installed = false;

    try {
      if (
        typeof this.tools?.buildCapability !==
        "function"
      ) {
        throw new Error(
          "EgoTools.buildCapability is unavailable."
        );
      }

      await this.tools.buildCapability({
        name: capability,
        specification,
        implementation
      });

      installed = true;

      const verification = await this.verifyCapability(
        capability,
        context
      );

      if (!verification.passed) {
        throw new Error(
          verification.error ||
          "Capability verification failed."
        );
      }

      this.state.improvements.push({
        capability,
        timestamp: Date.now(),
        success: true
      });

      return {
        success: true,
        capability,
        validation,
        testing,
        verification
      };
    } catch (error) {
      if (installed && this.config.autoRollback) {
        await this.rollback(capability, context);
      }

      return {
        success: false,
        capability,
        error: error.message,
        rolledBack:
          installed &&
          this.config.autoRollback
      };
    }
  }

  async validateImprovement(implementation, context) {
    try {
      if (
        typeof this.sandbox.validate !==
        "function"
      ) {
        return {
          passed: false,
          error: "Sandbox validation is unavailable."
        };
      }

      const result = await this.sandbox.validate(
        implementation,
        context
      );

      return {
        passed:
          result?.passed === true ||
          result?.success === true,
        result
      };
    } catch (error) {
      return {
        passed: false,
        error: error.message
      };
    }
  }

  async testImprovement(implementation, context) {
    try {
      if (
        typeof this.sandbox.test !==
        "function"
      ) {
        return {
          passed: false,
          error: "Sandbox testing is unavailable."
        };
      }

      const result = await this.sandbox.test(
        implementation,
        context
      );

      return {
        passed:
          result?.passed === true ||
          result?.success === true,
        result
      };
    } catch (error) {
      return {
        passed: false,
        error: error.message
      };
    }
  }

  async verifyCapability(capability, context) {
    try {
      if (
        typeof this.tools?.getTool !==
        "function"
      ) {
        return {
          passed: false,
          error: "Tool registry is unavailable."
        };
      }

      const tool = this.tools.getTool(capability);

      if (!tool) {
        return {
          passed: false,
          error: "Capability was not registered."
        };
      }

      if (
        typeof tool.healthCheck ===
        "function"
      ) {
        const result = await tool.healthCheck(context);

        return {
          passed:
            result?.passed !== false &&
            result?.success !== false,
          result
        };
      }

      return {
        passed: true
      };
    } catch (error) {
      return {
        passed: false,
        error: error.message
      };
    }
  }

  async rollback(capability, context) {
    if (
      typeof this.sandbox.rollback !==
      "function"
    ) {
      return {
        success: false,
        error: "Sandbox rollback is unavailable."
      };
    }

    try {
      return await this.sandbox.rollback(
        capability,
        context
      );
    } catch (error) {
      this.logger.error(
        "Self-improvement rollback failed:",
        error
      );

      return {
        success: false,
        error: error.message
      };
    }
  }

  async recover(step, error, context) {
    if (!this.model) {
      return null;
    }

    return this.generate({
      type: "recover",
      step,
      error:
        error?.message ||
        String(error),
      context
    });
  }

  async reflect(request, result, context) {
    if (
      !this.config.enableReflection ||
      !this.model
    ) {
      return result;
    }

    try {
      const evaluation = await this.generate({
        type: "evaluate",
        request,
        result,
        context
      });

      return {
        ...result,
        evaluation
      };
    } catch {
      return result;
    }
  }

  async retrieveMemory(request) {
    if (
      !this.config.enableMemory ||
      !this.memory ||
      typeof this.memory.searchMemory !==
        "function"
    ) {
      return [];
    }

    try {
      return await this.memory.searchMemory(request);
    } catch {
      return [];
    }
  }

  async storeMemory(
    request,
    understanding,
    result
  ) {
    if (
      !this.config.enableMemory ||
      !this.memory ||
      typeof this.memory.remember !==
        "function"
    ) {
      return;
    }

    try {
      await this.memory.remember({
        request,
        understanding,
        result,
        timestamp: Date.now()
      });
    } catch (error) {
      this.logger.warn(
        "Memory storage failed:",
        error
      );
    }
  }

  async generate(input) {
    if (!this.model) {
      throw new Error("AI model is not connected.");
    }

    if (
      typeof this.model.generate ===
      "function"
    ) {
      return this.model.generate(input);
    }

    if (
      typeof this.model.complete ===
      "function"
    ) {
      return this.model.complete(input);
    }

    if (
      typeof this.model.run ===
      "function"
    ) {
      return this.model.run(input);
    }

    throw new Error(
      "Connected AI model does not expose a supported generation method."
    );
  }

  getAvailableTools() {
    if (
      !this.tools ||
      typeof this.tools.listTools !==
        "function"
    ) {
      return [];
    }

    const tools = this.tools.listTools();

    return Array.isArray(tools)
      ? tools
      : [];
  }

  getState() {
    return {
      ...this.state,
      availableTools:
        this.getAvailableTools()
    };
  }
}

export default EgoAIEngine;
export { EgoAIEngine };
