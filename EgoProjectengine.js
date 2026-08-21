class EgoProjectEngine {
  constructor({
    planner = null,
    actionEngine = null,
    model = null,
    memory = null,
    logger = console,
    config = {}
  } = {}) {
    this.planner = planner;
    this.actionEngine = actionEngine;
    this.model = model;
    this.memory = memory;
    this.logger = logger;

    this.config = {
      maxConcurrentTasks: 8,
      autoRepair: true,
      autoTest: true,
      autoValidate: true,
      preserveSource: true,
      streaming: true,
      ...config
    };

    this.projects = new Map();
    this.listeners = new Map();
  }

  async createProject(request, options = {}) {
    if (!request || typeof request !== "string") {
      throw new Error("Project request is required.");
    }

    const id = this.createId();

    const project = {
      id,
      name: options.name || `EgoProject_${id}`,
      request,
      type: options.type || "application",
      status: "planning",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      files: new Map(),
      tasks: [],
      tests: [],
      errors: [],
      outputs: []
    };

    this.projects.set(id, project);

    this.emit("project_created", project);

    const plan = await this.createPlan(
      request,
      options
    );

    project.plan = plan;
    project.tasks = this.convertPlanToTasks(plan);
    project.status = "building";
    project.updatedAt = Date.now();

    await this.buildProject(project);

    return this.getProject(id);
  }

  async createPlan(request, options) {
    if (this.planner) {
      if (
        typeof this.planner.createPlan ===
        "function"
      ) {
        return this.planner.createPlan(
          request,
          {
            type: options.type,
            requirements:
              options.requirements || {},
            projectMode: true
          }
        );
      }
    }

    return {
      goal: request,
      steps: [
        {
          id: "initial",
          type: "project",
          description: request,
          dependencies: []
        }
      ]
    };
  }

  convertPlanToTasks(plan) {
    return (plan.steps || []).map(
      (step, index) => ({
        id:
          step.id ||
          `task_${index + 1}`,
        type:
          step.type || "task",
        description:
          step.description || "",
        dependencies:
          step.dependencies || [],
        status: "pending",
        result: null,
        error: null
      })
    );
  }

  async buildProject(project) {
    try {
      for (
        let i = 0;
        i < project.tasks.length;
        i += this.config.maxConcurrentTasks
      ) {
        const batch =
          project.tasks.slice(
            i,
            i +
              this.config.maxConcurrentTasks
          );

        await Promise.all(
          batch.map(task =>
            this.executeTask(
              project,
              task
            )
          )
        );
      }

      if (this.config.autoTest) {
        await this.testProject(project);
      }

      if (this.config.autoValidate) {
        await this.validateProject(project);
      }

      if (
        project.errors.length > 0 &&
        this.config.autoRepair
      ) {
        await this.repairProject(project);
      }

      project.status =
        project.errors.length === 0
          ? "completed"
          : "needs_review";

      project.updatedAt = Date.now();

      this.emit(
        "project_completed",
        project
      );
    } catch (error) {
      project.status = "failed";
      project.errors.push({
        message: error.message,
        timestamp: Date.now()
      });

      project.updatedAt = Date.now();

      this.emit(
        "project_failed",
        {
          project,
          error
        }
      );

      throw error;
    }
  }

  async executeTask(project, task) {
    task.status = "running";

    this.emit("task_started", {
      projectId: project.id,
      task
    });

    try {
      const result =
        await this.executeTaskLogic(
          project,
          task
        );

      task.result = result;
      task.status = "completed";

      project.updatedAt = Date.now();

      this.emit("task_completed", {
        projectId: project.id,
        task,
        result
      });

      return result;
    } catch (error) {
      task.status = "failed";
      task.error = error.message;

      project.errors.push({
        taskId: task.id,
        message: error.message,
        timestamp: Date.now()
      });

      this.emit("task_failed", {
        projectId: project.id,
        task,
        error
      });

      if (!this.config.autoRepair) {
        throw error;
      }

      return null;
    }
  }

  async executeTaskLogic(project, task) {
    if (this.actionEngine) {
      if (
        typeof this.actionEngine.execute ===
        "function"
      ) {
        return this.actionEngine.execute({
          id: task.id,
          name:
            task.tool ||
            "project_task",
          parameters: {
            projectId: project.id,
            task: task.description,
            type: task.type,
            files: this.serializeFiles(
              project.files
            )
          }
        });
      }
    }

    if (this.model) {
      if (
        typeof this.model.generate ===
        "function"
      ) {
        const result =
          await this.model.generate({
            type: "project_generation",
            project: {
              id: project.id,
              type: project.type,
              request:
                project.request
            },
            task
          });

        await this.applyModelResult(
          project,
          result
        );

        return result;
      }
    }

    return {
      success: true,
      taskId: task.id
    };
  }

  async applyModelResult(
    project,
    result
  ) {
    if (!result) return;

    const files =
      result.files ||
      result.result?.files;

    if (!Array.isArray(files)) {
      return;
    }

    for (const file of files) {
      if (
        !file.path ||
        typeof file.content !==
          "string"
      ) {
        continue;
      }

      project.files.set(
        file.path,
        {
          path: file.path,
          content: file.content,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      );

      this.emit("file_generated", {
        projectId: project.id,
        file
      });
    }
  }

  async testProject(project) {
    const tests = [];

    for (const file of project.files.values()) {
      if (
        /\.(test|spec)\./i.test(
          file.path
        )
      ) {
        tests.push(file);
      }
    }

    project.tests = tests.map(file => ({
      file: file.path,
      status: "pending"
    }));

    if (!this.model) {
      project.tests.forEach(
        test => {
          test.status = "skipped";
        }
      );

      return;
    }

    if (
      typeof this.model.test ===
      "function"
    ) {
      const result =
        await this.model.test({
          project: this.serializeProject(
            project
          )
        });

      project.testResult = result;
    }
  }

  async validateProject(project) {
    const validation = {
      valid: true,
      errors: [],
      warnings: []
    };

    for (const file of project.files.values()) {
      if (
        !file.path ||
        typeof file.content !==
          "string"
      ) {
        validation.valid = false;

        validation.errors.push({
          file: file.path,
          message:
            "Invalid file structure."
        });
      }
    }

    project.validation =
      validation;

    if (!validation.valid) {
      project.errors.push(
        ...validation.errors
      );
    }

    return validation;
  }

  async repairProject(project) {
    if (!this.model) {
      return project;
    }

    const errors =
      project.errors.slice();

    if (
      typeof this.model.repair ===
      "function"
    ) {
      const result =
        await this.model.repair({
          project:
            this.serializeProject(
              project
            ),
          errors
        });

      await this.applyModelResult(
        project,
        result
      );

      project.errors = [];

      await this.validateProject(
        project
      );
    }

    return project;
  }

  async modifyProject(
    projectId,
    request
  ) {
    const project =
      this.getProject(projectId);

    if (!project) {
      throw new Error(
        "Project not found."
      );
    }

    project.status = "modifying";

    const task = {
      id: this.createId(),
      type: "modification",
      description: request,
      status: "pending",
      dependencies: []
    };

    project.tasks.push(task);

    await this.executeTask(
      project,
      task
    );

    if (this.config.autoTest) {
      await this.testProject(project);
    }

    if (this.config.autoValidate) {
      await this.validateProject(
        project
      );
    }

    project.status = "completed";
    project.updatedAt = Date.now();

    return this.getProject(
      projectId
    );
  }

  async addFile(
    projectId,
    path,
    content
  ) {
    const project =
      this.getProject(projectId);

    if (!project) {
      throw new Error(
        "Project not found."
      );
    }

    project.files.set(path, {
      path,
      content,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    project.updatedAt = Date.now();

    return true;
  }

  async removeFile(
    projectId,
    path
  ) {
    const project =
      this.getProject(projectId);

    if (!project) {
      throw new Error(
        "Project not found."
      );
    }

    const deleted =
      project.files.delete(path);

    project.updatedAt = Date.now();

    return deleted;
  }

  getFile(
    projectId,
    path
  ) {
    const project =
      this.getProject(projectId);

    if (!project) return null;

    return (
      project.files.get(path) ||
      null
    );
  }

  listFiles(projectId) {
    const project =
      this.getProject(projectId);

    if (!project) return [];

    return Array.from(
      project.files.keys()
    );
  }

  serializeFiles(files) {
    return Array.from(
      files.values()
    ).map(file => ({
      path: file.path,
      content: file.content
    }));
  }

  serializeProject(project) {
    return {
      id: project.id,
      name: project.name,
      type: project.type,
      request: project.request,
      status: project.status,
      files:
        this.serializeFiles(
          project.files
        ),
      tasks: project.tasks,
      tests: project.tests,
      errors: project.errors,
      validation:
        project.validation
    };
  }

  getProject(id) {
    const project =
      this.projects.get(id);

    if (!project) return null;

    return this.serializeProject(
      project
    );
  }

  deleteProject(id) {
    return this.projects.delete(id);
  }

  on(event, callback) {
    if (
      typeof callback !==
      "function"
    ) {
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

    this.listeners
      .get(event)
      .add(callback);

    return () => {
      this.listeners
        .get(event)
        ?.delete(callback);
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

  createId() {
    return (
      "project_" +
      Date.now().toString(36) +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 10)
    );
  }
}

export default EgoProjectEngine;
export { EgoProjectEngine };
