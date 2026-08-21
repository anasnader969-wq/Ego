// EgoAI.js
// Ego — Autonomous Agent Core
//
// Purpose:
// - Turn natural-language goals into executable plans.
// - Handle complex software/project tasks.
// - Manage tools and capabilities.
// - Generate and validate execution plans.
// - Support self-extension through isolated capabilities.
// - Keep task state and recover from failures.
//
// IMPORTANT:
// This module is an orchestration layer.
// It does not contain an AI model itself.
// It must use a trusted AI backend through aiService.js.

import brain from "./Brain.js";
import aiService from "./aiService.js";

const STATUS = {
  IDLE: "idle",
  ANALYZING: "analyzing",
  PLANNING: "planning",
  EXECUTING: "executing",
  VERIFYING: "verifying",
  COMPLETED: "completed",
  FAILED: "failed",
  WAITING: "waiting",
};

const TASK_TYPES = {
  SOFTWARE: "software",
  WEBSITE: "website",
  MOBILE_APP: "mobile_app",
  DESKTOP_APP: "desktop_app",
  GAME: "game",
  AI_MODEL: "ai_model",
  MEDIA: "media",
  AUTOMATION: "automation",
  RESEARCH: "research",
  GENERAL: "general",
};

const CAPABILITY_STATUS = {
  AVAILABLE: "available",
  MISSING: "missing",
  BUILDING: "building",
  TESTING: "testing",
  READY: "ready",
  FAILED: "failed",
};

function id() {
  if (
    typeof crypto !== "undefined" &&
    crypto.randomUUID
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()}`;
}

function clean(value) {
  return String(value ?? "").trim();
}

function now() {
  return Date.now();
}

function inferTaskType(text) {
  const value = text.toLowerCase();

  if (
    /تطبيق|app|application|mobile|android|ios/.test(
      value
    )
  ) {
    return TASK_TYPES.MOBILE_APP;
  }

  if (
    /موقع|website|web app|web/.test(value)
  ) {
    return TASK_TYPES.WEBSITE;
  }

  if (
    /لعبة|game|gaming/.test(value)
  ) {
    return TASK_TYPES.GAME;
  }

  if (
    /نموذج ai|نموذج ذكاء|ai model|machine learning|ml model/.test(
      value
    )
  ) {
    return TASK_TYPES.AI_MODEL;
  }

  if (
    /فيديو|مونتاج|video|editing|image|صورة|تصميم/.test(
      value
    )
  ) {
    return TASK_TYPES.MEDIA;
  }

  if (
    /أتمتة|automation|automate/.test(
      value
    )
  ) {
    return TASK_TYPES.AUTOMATION;
  }

  if (
    /بحث|research|تحليل|analyze/.test(
      value
    ) ||
    value.startsWith("ابحث")
  ) {
    return TASK_TYPES.RESEARCH;
  }

  if (
    /برنامج|software|desktop/.test(
      value
    )
  ) {
    return TASK_TYPES.SOFTWARE;
  }

  return TASK_TYPES.GENERAL;
}

function createDefaultCapabilities() {
  return new Map([
    [
      "reasoning",
      {
        name: "reasoning",
        status: CAPABILITY_STATUS.AVAILABLE,
      },
    ],
    [
      "planning",
      {
        name: "planning",
        status: CAPABILITY_STATUS.AVAILABLE,
      },
    ],
    [
      "memory",
      {
        name: "memory",
        status: CAPABILITY_STATUS.AVAILABLE,
      },
    ],
    [
      "software_generation",
      {
        name: "software_generation",
        status: CAPABILITY_STATUS.MISSING,
      },
    ],
    [
      "web_generation",
      {
        name: "web_generation",
        status: CAPABILITY_STATUS.MISSING,
      },
    ],
    [
      "mobile_generation",
      {
        name: "mobile_generation",
        status: CAPABILITY_STATUS.MISSING,
      },
    ],
    [
      "game_generation",
      {
        name: "game_generation",
        status: CAPABILITY_STATUS.MISSING,
      },
    ],
    [
      "ai_model_generation",
      {
        name: "ai_model_generation",
        status: CAPABILITY_STATUS.MISSING,
      },
    ],
    [
      "media_generation",
      {
        name: "media_generation",
        status: CAPABILITY_STATUS.MISSING,
      },
    ],
    [
      "testing",
      {
        name: "testing",
        status: CAPABILITY_STATUS.MISSING,
      },
    ],
  ]);
}

export class EgoAI {
  constructor(options = {}) {
    this.options = {
      autonomousPlanning: true,
      adaptiveCapabilities: true,
      verificationRequired: true,
      maxRetries: 3,
      ...options,
    };

    this.status = STATUS.IDLE;

    this.currentTask = null;

    this.tasks = [];

    this.capabilities =
      createDefaultCapabilities();

    this.tools = new Map();

    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors must not stop Ego.
      }
    }
  }

  setStatus(status) {
    this.status = status;

    this.emit({
      type: "status",
      status,
    });
  }

  registerTool(name, handler, metadata = {}) {
    if (
      !name ||
      typeof handler !== "function"
    ) {
      throw new Error(
        "Invalid tool registration."
      );
    }

    this.tools.set(name, {
      name,
      handler,
      metadata,
    });

    this.emit({
      type: "tool_registered",
      name,
    });
  }

  registerCapability(
    name,
    metadata = {}
  ) {
    this.capabilities.set(name, {
      name,
      status:
        metadata.status ||
        CAPABILITY_STATUS.AVAILABLE,
      ...metadata,
    });

    this.emit({
      type: "capability_registered",
      name,
    });
  }

  getCapability(name) {
    return this.capabilities.get(name);
  }

  hasCapability(name) {
    const capability =
      this.getCapability(name);

    return (
      capability &&
      (
        capability.status ===
          CAPABILITY_STATUS.AVAILABLE ||
        capability.status ===
          CAPABILITY_STATUS.READY
      )
    );
  }

  listCapabilities() {
    return Array.from(
      this.capabilities.values()
    );
  }

  listTools() {
    return Array.from(
      this.tools.values()
    ).map((tool) => ({
      name: tool.name,
      metadata: tool.metadata,
    }));
  }

  async analyzeGoal(goal) {
    this.setStatus(
      STATUS.ANALYZING
    );

    const analysis =
      brain.analyze(goal);

    const taskType =
      inferTaskType(goal);

    const requiredCapabilities =
      this.getRequiredCapabilities(
        taskType
      );

    const missingCapabilities =
      requiredCapabilities.filter(
        (name) =>
          !this.hasCapability(name)
      );

    const result = {
      id: id(),
      goal: clean(goal),
      taskType,
      brainAnalysis: analysis,
      requiredCapabilities,
      missingCapabilities,
      complexity:
        analysis.complexity,
      createdAt: now(),
    };

    this.emit({
      type: "goal_analyzed",
      result,
    });

    return result;
  }

  getRequiredCapabilities(
    taskType
  ) {
    const map = {
      [TASK_TYPES.SOFTWARE]: [
        "software_generation",
        "testing",
      ],

      [TASK_TYPES.WEBSITE]: [
        "web_generation",
        "testing",
      ],

      [TASK_TYPES.MOBILE_APP]: [
        "mobile_generation",
        "testing",
      ],

      [TASK_TYPES.DESKTOP_APP]: [
        "software_generation",
        "testing",
      ],

      [TASK_TYPES.GAME]: [
        "game_generation",
        "testing",
      ],

      [TASK_TYPES.AI_MODEL]: [
        "ai_model_generation",
        "testing",
      ],

      [TASK_TYPES.MEDIA]: [
        "media_generation",
      ],

      [TASK_TYPES.AUTOMATION]: [
        "software_generation",
        "testing",
      ],

      [TASK_TYPES.RESEARCH]: [
        "reasoning",
        "planning",
      ],

      [TASK_TYPES.GENERAL]: [
        "reasoning",
        "planning",
      ],
    };

    return map[taskType] || [
      "reasoning",
      "planning",
    ];
  }

  async createPlan(analysis) {
    this.setStatus(
      STATUS.PLANNING
    );

    const systemInstruction = `
You are the planning engine of Ego.

Transform the user's goal into a professional,
testable execution plan.

The plan may contain:
- requirements
- architecture
- components
- files
- implementation
- testing
- debugging
- verification
- delivery

For software projects, think in terms of a COMPLETE
production-quality project, not a toy example.

For complex tasks:
- divide the task into logical phases
- identify dependencies
- identify missing capabilities
- define validation criteria
- define a recovery strategy

Do not claim that something was executed.
You are creating a plan only.

Return structured JSON with:

{
  "objective": "...",
  "phases": [
    {
      "id": "...",
      "name": "...",
      "description": "...",
      "dependencies": [],
      "requiredCapabilities": [],
      "successCriteria": []
    }
  ],
  "finalSuccessCriteria": []
}
`;

    const response =
      await aiService.send({
        message: analysis.goal,

        analysis,

        history:
          brain.history.slice(-20),

        memory:
          brain.getMemory().slice(0, 20),

        systemInstruction,

        preferences: {
          autonomousPlanning:
            this.options
              .autonomousPlanning,
        },
      });

    let plan;

    try {
      plan = JSON.parse(
        response.text
      );
    } catch {
      plan = {
        objective: analysis.goal,
        phases: [
          {
            id: id(),
            name: "AI generated plan",
            description:
              response.text,
            dependencies: [],
            requiredCapabilities:
              analysis.requiredCapabilities,
            successCriteria: [],
          },
        ],
        finalSuccessCriteria: [],
      };
    }

    const normalizedPlan = {
      id: id(),
      objective:
        plan.objective ||
        analysis.goal,

      phases: Array.isArray(
        plan.phases
      )
        ? plan.phases
        : [],

      finalSuccessCriteria:
        Array.isArray(
          plan.finalSuccessCriteria
        )
          ? plan.finalSuccessCriteria
          : [],

      createdAt: now(),
    };

    this.emit({
      type: "plan_created",
      plan: normalizedPlan,
    });

    return normalizedPlan;
  }

  async buildMissingCapability(
    capabilityName
  ) {
    if (
      !this.options
        .adaptiveCapabilities
    ) {
      throw new Error(
        `Capability "${capabilityName}" is not available.`
      );
    }

    const existing =
      this.getCapability(
        capabilityName
      );

    if (
      existing &&
      (
        existing.status ===
          CAPABILITY_STATUS.AVAILABLE ||
        existing.status ===
          CAPABILITY_STATUS.READY
      )
    ) {
      return existing;
    }

    this.capabilities.set(
      capabilityName,
      {
        name: capabilityName,
        status:
          CAPABILITY_STATUS.BUILDING,
        createdAt: now(),
      }
    );

    this.emit({
      type: "capability_building",
      name: capabilityName,
    });

    /*
     * IMPORTANT:
     * The actual generated capability must be created
     * through a sandboxed tool/build service.
     *
     * EgoAI does not execute arbitrary generated code
     * directly inside the main application.
     */

    const capability = {
      name: capabilityName,
      status:
        CAPABILITY_STATUS.TESTING,
      version: "0.1.0",
      generatedAt: now(),
    };

    this.capabilities.set(
      capabilityName,
      capability
    );

    this.emit({
      type: "capability_testing",
      capability,
    });

    return capability;
  }

  async prepareCapabilities(
    analysis
  ) {
    const results = [];

    for (const capability of
      analysis.missingCapabilities) {
      const result =
        await this.buildMissingCapability(
          capability
        );

      results.push(result);
    }

    return results;
  }

  async executeTool(
    toolName,
    input,
    context = {}
  ) {
    const tool =
      this.tools.get(toolName);

    if (!tool) {
      throw new Error(
        `Tool "${toolName}" is not registered.`
      );
    }

    this.emit({
      type: "tool_execution_started",
      tool: toolName,
    });

    const result =
      await tool.handler(
        input,
        context
      );

    this.emit({
      type: "tool_execution_finished",
      tool: toolName,
      result,
    });

    return result;
  }

  async executePhase(
    phase,
    task
  ) {
    this.setStatus(
      STATUS.EXECUTING
    );

    const toolName =
      phase.tool ||
      this.findToolForPhase(
        phase
      );

    if (!toolName) {
      return {
        phaseId: phase.id,
        status: "waiting",
        reason:
          "No execution tool is currently registered.",
      };
    }

    return this.executeTool(
      toolName,
      {
        task,
        phase,
      },
      {
        ego: this,
      }
    );
  }

  findToolForPhase(phase) {
    const name =
      String(
        phase.name ||
          ""
      ).toLowerCase();

    const description =
      String(
        phase.description ||
          ""
      ).toLowerCase();

    const text =
      `${name} ${description}`;

    for (const [
      toolName,
      tool,
    ] of this.tools) {
      const keywords =
        tool.metadata
          ?.keywords || [];

      if (
        keywords.some((keyword) =>
          text.includes(
            String(
              keyword
            ).toLowerCase()
          )
        )
      ) {
        return toolName;
      }
    }

    return null;
  }

  async verifyResult(
    result,
    phase,
    task
  ) {
    this.setStatus(
      STATUS.VERIFYING
    );

    const verificationPrompt = `
You are Ego's verification engine.

Determine whether the completed phase actually
satisfies its success criteria.

Do not assume success.

Check:
- correctness
- completeness
- consistency
- obvious errors
- missing requirements
- regressions

Return JSON:

{
  "passed": true,
  "score": 0,
  "issues": [],
  "nextAction": "..."
}
`;

    const response =
      await aiService.send({
        message: JSON.stringify({
          phase,
          result,
          task,
        }),

        systemInstruction:
          verificationPrompt,

        history: [],

        memory: [],
      });

    try {
      return JSON.parse(
        response.text
      );
    } catch {
      return {
        passed: false,
        score: 0,
        issues: [
          "Verification response was not valid JSON.",
        ],
        nextAction:
          "Retry verification.",
      };
    }
  }

  async run(goal) {
    if (!clean(goal)) {
      throw new Error(
        "EgoAI requires a goal."
      );
    }

    const task = {
      id: id(),
      goal: clean(goal),
      status: STATUS.ANALYZING,
      createdAt: now(),
      phases: [],
      results: [],
    };

    this.currentTask = task;
    this.tasks.push(task);

    try {
      const analysis =
        await this.analyzeGoal(
          goal
        );

      task.analysis =
        analysis;

      /*
       * Missing capabilities are identified here.
       * They are NOT silently executed.
       */

      if (
        analysis.missingCapabilities
          .length > 0
      ) {
        task.capabilities =
          await this.prepareCapabilities(
            analysis
          );
      }

      const plan =
        await this.createPlan(
          analysis
        );

      task.plan = plan;
      task.phases =
        plan.phases;

      for (const phase of
        plan.phases) {
        const result =
          await this.executePhase(
            phase,
            task
          );

        task.results.push({
          phase,
          result,
        });

        if (
          this.options
            .verificationRequired
        ) {
          const verification =
            await this.verifyResult(
              result,
              phase,
              task
            );

          task.results[
            task.results.length - 1
          ].verification =
            verification;

          if (
            !verification.passed
          ) {
            this.emit({
              type: "phase_failed",
              phase,
              verification,
            });

            return {
              ...task,
              status:
                STATUS.WAITING,
              reason:
                verification
                  .nextAction ||
                "Verification failed.",
            };
          }
        }
      }

      task.status =
        STATUS.COMPLETED;

      this.setStatus(
        STATUS.COMPLETED
      );

      this.emit({
        type: "task_completed",
        task,
      });

      return task;
    } catch (error) {
      task.status =
        STATUS.FAILED;

      task.error =
        error?.message ||
        String(error);

      this.setStatus(
        STATUS.FAILED
      );

      this.emit({
        type: "task_failed",
        task,
      });

      throw error;
    } finally {
      this.currentTask =
        null;
    }
  }

  getCurrentTask() {
    return this.currentTask;
  }

  getTaskHistory() {
    return [...this.tasks];
  }

  cancelCurrentTask() {
    if (!this.currentTask) {
      return false;
    }

    this.currentTask.status =
      STATUS.WAITING;

    this.currentTask.cancelled =
      true;

    this.setStatus(
      STATUS.IDLE
    );

    this.emit({
      type: "task_cancelled",
      task: this.currentTask,
    });

    this.currentTask =
      null;

    return true;
  }
}

export const egoAI =
  new EgoAI();

export default egoAI;
