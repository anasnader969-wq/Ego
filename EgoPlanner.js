// EgoPlanner.js

class EgoPlanner {
  constructor({
    model = null,
    tools = null,
    memory = null,
    logger = console,
    config = {}
  } = {}) {
    this.model = model;
    this.tools = tools;
    this.memory = memory;
    this.logger = logger;

    this.config = {
      maxSteps: 100,
      parallelPlanning: true,
      validatePlan: true,
      adaptivePlanning: true,
      preserveUserIntent: true,
      maxRetries: 2,
      ...config
    };

    this.activePlans = new Map();
    this.history = [];
  }

  async createPlan(request, context = {}) {
    if (!request || typeof request !== "string") {
      throw new Error("A valid request is required.");
    }

    const planId = this.createId();

    const availableTools = this.getAvailableTools();

    const payload = {
      request,
      context,
      availableTools,
      constraints: {
        maxSteps: this.config.maxSteps,
        preserveUserIntent: this.config.preserveUserIntent
      }
    };

    let plan = await this.generatePlan(payload);

    if (!plan) {
      throw new Error("Unable to generate a plan.");
    }

    plan = this.normalizePlan(plan, planId, request);

    if (this.config.validatePlan) {
      plan = await this.validatePlan(plan);
    }

    this.activePlans.set(planId, plan);
    this.history.push(plan);

    return plan;
  }

  async generatePlan(payload) {
    if (!this.model) {
      return this.createFallbackPlan(payload.request);
    }

    if (typeof this.model.plan === "function") {
      return this.model.plan(payload);
    }

    if (typeof this.model.generate === "function") {
      return this.model.generate({
        type: "planning",
        ...payload
      });
    }

    return this.createFallbackPlan(payload.request);
  }

  createFallbackPlan(request) {
    return {
      goal: request,
      steps: [
        {
          id: "step_1",
          type: "reason",
          description: request,
          dependencies: []
        }
      ]
    };
  }

  normalizePlan(plan, planId, request) {
    const source =
      typeof plan === "string"
        ? {
            goal: request,
            steps: [
              {
                id: "step_1",
                type: "task",
                description: plan,
                dependencies: []
              }
            ]
          }
        : plan;

    const steps = Array.isArray(source.steps)
      ? source.steps
      : [];

    return {
      id: planId,
      goal: source.goal || request,
      createdAt: Date.now(),
      status: "ready",
      steps: steps
        .slice(0, this.config.maxSteps)
        .map((step, index) => ({
          id: step.id || `step_${index + 1}`,
          type: step.type || "task",
          description:
            step.description ||
            step.task ||
            "",
          tool: step.tool || null,
          parameters:
            step.parameters || {},
          dependencies:
            Array.isArray(step.dependencies)
              ? step.dependencies
              : [],
          priority:
            typeof step.priority === "number"
              ? step.priority
              : 0,
          optional:
            step.optional === true,
          status: "pending"
        }))
    };
  }

  async validatePlan(plan) {
    const ids = new Set();

    for (const step of plan.steps) {
      if (ids.has(step.id)) {
        step.id = this.createId();
      }

      ids.add(step.id);

      step.dependencies =
        step.dependencies.filter(
          dependency =>
            dependency !== step.id &&
            ids.has(dependency)
        );
    }

    const ordered =
      this.topologicalSort(plan.steps);

    if (!ordered) {
      throw new Error(
        "Plan contains an invalid dependency graph."
      );
    }

    plan.steps = ordered;

    return plan;
  }

  topologicalSort(steps) {
    const map = new Map(
      steps.map(step => [step.id, step])
    );

    const visited = new Set();
    const visiting = new Set();
    const result = [];

    const visit = id => {
      if (visiting.has(id)) {
        return false;
      }

      if (visited.has(id)) {
        return true;
      }

      const step = map.get(id);

      if (!step) {
        return false;
      }

      visiting.add(id);

      for (const dependency of step.dependencies) {
        if (!visit(dependency)) {
          return false;
        }
      }

      visiting.delete(id);
      visited.add(id);
      result.push(step);

      return true;
    };

    for (const step of steps) {
      if (!visit(step.id)) {
        return null;
      }
    }

    return result;
  }

  getNextSteps(planId) {
    const plan = this.getPlan(planId);

    if (!plan) return [];

    const completed = new Set(
      plan.steps
        .filter(step => step.status === "completed")
        .map(step => step.id)
    );

    return plan.steps.filter(step => {
      if (step.status !== "pending") {
        return false;
      }

      return step.dependencies.every(
        dependency =>
          completed.has(dependency)
      );
    });
  }

  markStepRunning(planId, stepId) {
    const step = this.getStep(planId, stepId);

    if (!step) return false;

    step.status = "running";
    step.startedAt = Date.now();

    return true;
  }

  markStepCompleted(
    planId,
    stepId,
    result = null
  ) {
    const step = this.getStep(planId, stepId);

    if (!step) return false;

    step.status = "completed";
    step.result = result;
    step.finishedAt = Date.now();

    this.updatePlanStatus(planId);

    return true;
  }

  markStepFailed(
    planId,
    stepId,
    error
  ) {
    const step = this.getStep(planId, stepId);

    if (!step) return false;

    step.status = "failed";
    step.error =
      error?.message || String(error);
    step.finishedAt = Date.now();

    this.updatePlanStatus(planId);

    return true;
  }

  updatePlanStatus(planId) {
    const plan = this.getPlan(planId);

    if (!plan) return;

    const steps = plan.steps;

    if (
      steps.some(step => step.status === "failed")
    ) {
      plan.status = "failed";
      return;
    }

    if (
      steps.length > 0 &&
      steps.every(
        step => step.status === "completed"
      )
    ) {
      plan.status = "completed";
      plan.finishedAt = Date.now();
      return;
    }

    if (
      steps.some(step => step.status === "running")
    ) {
      plan.status = "running";
      return;
    }

    plan.status = "ready";
  }

  async replan(
    planId,
    feedback = {}
  ) {
    const plan = this.getPlan(planId);

    if (!plan) {
      throw new Error("Plan not found.");
    }

    if (!this.config.adaptivePlanning) {
      return plan;
    }

    const request = {
      originalGoal: plan.goal,
      currentPlan: plan,
      feedback
    };

    const generated =
      await this.generatePlan({
        request: JSON.stringify(request),
        context: feedback,
        availableTools:
          this.getAvailableTools()
      });

    const updated = this.normalizePlan(
      generated,
      plan.id,
      plan.goal
    );

    updated.revision =
      (plan.revision || 0) + 1;

    this.activePlans.set(
      planId,
      updated
    );

    return updated;
  }

  getAvailableTools() {
    if (!this.tools) return [];

    if (
      typeof this.tools.listTools ===
      "function"
    ) {
      return this.tools.listTools().map(tool => ({
        name: tool.name,
        description:
          tool.description || "",
        category:
          tool.category || "general"
      }));
    }

    return [];
  }

  getPlan(planId) {
    return this.activePlans.get(planId) || null;
  }

  getStep(planId, stepId) {
    const plan = this.getPlan(planId);

    if (!plan) return null;

    return (
      plan.steps.find(
        step => step.id === stepId
      ) || null
    );
  }

  getHistory(limit = 50) {
    return this.history.slice(-limit);
  }

  deletePlan(planId) {
    return this.activePlans.delete(planId);
  }

  createId() {
    return (
      "plan_" +
      Date.now().toString(36) +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 10)
    );
  }
}

export default EgoPlanner;
export { EgoPlanner };
