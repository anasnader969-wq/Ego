class EgoCodeEngine {
  constructor({
    model = null,
    memory = null,
    tools = null,
    logger = console,
    config = {}
  } = {}) {
    this.model = model;
    this.memory = memory;
    this.tools = tools;
    this.logger = logger;

    this.config = {
      maxFilesPerOperation: 1000,
      maxIterations: 20,
      autoAnalyze: true,
      autoRepair: true,
      preserveHistory: true,
      validateSyntax: true,
      validateDependencies: true,
      generateTests: true,
      explainChanges: false,
      ...config
    };

    this.projects = new Map();
    this.operations = new Map();
  }

  registerProject(projectId, files = []) {
    const project = {
      id: projectId,
      files: new Map(),
      history: [],
      diagnostics: [],
      dependencies: new Map(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    for (const file of files) {
      if (
        file &&
        typeof file.path === "string" &&
        typeof file.content === "string"
      ) {
        project.files.set(
          file.path,
          {
            path: file.path,
            content: file.content,
            language:
              file.language ||
              this.detectLanguage(file.path),
            version: 1
          }
        );
      }
    }

    this.projects.set(
      projectId,
      project
    );

    return projectId;
  }

  async generateCode({
    projectId,
    request,
    context = {},
    targetFiles = []
  }) {
    const project =
      this.getProject(projectId);

    if (!project) {
      throw new Error(
        "Project is not registered."
      );
    }

    if (!request || typeof request !== "string") {
      throw new Error(
        "Code generation request is required."
      );
    }

    const operation =
      this.createOperation(
        projectId,
        "generate",
        request
      );

    try {
      const result =
        await this.callModel({
          type: "code_generation",
          request,
          context,
          project:
            this.serializeProject(
              project
            ),
          targetFiles
        });

      const changes =
        this.extractFiles(result);

      this.applyChanges(
        project,
        changes
      );

      const diagnostics =
        await this.analyzeProject(
          project
        );

      operation.status = "completed";
      operation.result = {
        changes,
        diagnostics
      };

      await this.saveOperation(
        project,
        operation
      );

      return operation.result;
    } catch (error) {
      operation.status = "failed";
      operation.error = error.message;

      await this.saveOperation(
        project,
        operation
      );

      throw error;
    }
  }

  async modifyCode({
    projectId,
    request,
    files = [],
    context = {}
  }) {
    const project =
      this.getProject(projectId);

    if (!project) {
      throw new Error(
        "Project is not registered."
      );
    }

    const selectedFiles =
      files.length > 0
        ? files
        : Array.from(
            project.files.keys()
          );

    const operation =
      this.createOperation(
        projectId,
        "modify",
        request
      );

    try {
      const result =
        await this.callModel({
          type: "code_modification",
          request,
          context,
          files:
            selectedFiles.map(path =>
              this.serializeFile(
                project.files.get(path)
              )
            )
        });

      const changes =
        this.extractFiles(result);

      this.applyChanges(
        project,
        changes
      );

      const diagnostics =
        await this.analyzeProject(
          project
        );

      operation.status = "completed";
      operation.result = {
        changes,
        diagnostics
      };

      await this.saveOperation(
        project,
        operation
      );

      return operation.result;
    } catch (error) {
      operation.status = "failed";
      operation.error = error.message;

      await this.saveOperation(
        project,
        operation
      );

      throw error;
    }
  }

  async analyzeProject(project) {
    const diagnostics = [];

    for (const file of project.files.values()) {
      const fileDiagnostics =
        this.analyzeFile(file);

      diagnostics.push(
        ...fileDiagnostics
      );
    }

    const dependencyDiagnostics =
      this.analyzeDependencies(project);

    diagnostics.push(
      ...dependencyDiagnostics
    );

    project.diagnostics =
      diagnostics;

    project.updatedAt = Date.now();

    return diagnostics;
  }

  analyzeFile(file) {
    const diagnostics = [];

    if (!file || !file.content) {
      diagnostics.push({
        severity: "error",
        file: file?.path,
        message:
          "File is empty or invalid."
      });

      return diagnostics;
    }

    const language =
      file.language ||
      this.detectLanguage(
        file.path
      );

    const bracketResult =
      this.checkBrackets(
        file.content
      );

    if (!bracketResult.valid) {
      diagnostics.push({
        severity: "error",
        file: file.path,
        message:
          bracketResult.message
      });
    }

    if (
      this.config.validateSyntax
    ) {
      const syntax =
        this.basicSyntaxCheck(
          file.content,
          language
        );

      diagnostics.push(
        ...syntax.map(item => ({
          ...item,
          file: file.path
        }))
      );
    }

    return diagnostics;
  }

  checkBrackets(content) {
    const stack = [];
    const pairs = {
      ")": "(",
      "]": "[",
      "}": "{"
    };

    const openings = new Set([
      "(",
      "[",
      "{"
    ]);

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (openings.has(char)) {
        stack.push(char);
        continue;
      }

      if (pairs[char]) {
        const last =
          stack.pop();

        if (
          last !== pairs[char]
        ) {
          return {
            valid: false,
            message:
              `Mismatched bracket near position ${i}.`
          };
        }
      }
    }

    if (stack.length > 0) {
      return {
        valid: false,
        message:
          "Unclosed bracket detected."
      };
    }

    return {
      valid: true
    };
  }

  basicSyntaxCheck(
    content,
    language
  ) {
    const diagnostics = [];

    if (
      [
        "javascript",
        "typescript",
        "jsx",
        "tsx"
      ].includes(language)
    ) {
      const openBlocks =
        (
          content.match(
            /\b(if|for|while|function|class|switch|try)\b/g
          ) || []
        ).length;

      if (
        openBlocks > 0 &&
        content.trim().length === 0
      ) {
        diagnostics.push({
          severity: "warning",
          message:
            "Code structure may be incomplete."
        });
      }
    }

    if (
      language === "python" &&
      /\t/.test(content) &&
      /    /.test(content)
    ) {
      diagnostics.push({
        severity: "warning",
        message:
          "Mixed indentation detected."
      });
    }

    return diagnostics;
  }

  analyzeDependencies(project) {
    const diagnostics = [];
    const knownFiles =
      new Set(
        project.files.keys()
      );

    project.dependencies.clear();

    for (const file of project.files.values()) {
      const imports =
        this.extractImports(
          file.content,
          file.language
        );

      project.dependencies.set(
        file.path,
        imports
      );

      for (const dependency of imports) {
        const normalized =
          this.normalizeImport(
            dependency,
            file.path
          );

        if (
          normalized &&
          !normalized.external &&
          !knownFiles.has(
            normalized.path
          )
        ) {
          diagnostics.push({
            severity: "warning",
            file: file.path,
            message:
              `Referenced file not found: ${dependency}`
          });
        }
      }
    }

    return diagnostics;
  }

  extractImports(
    content,
    language
  ) {
    const imports = [];

    if (
      [
        "javascript",
        "typescript",
        "jsx",
        "tsx"
      ].includes(language)
    ) {
      const patterns = [
        /import\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
        /require\s*\(\s*["']([^"']+)["']\s*\)/g,
        /import\s*\(\s*["']([^"']+)["']\s*\)/g
      ];

      for (const pattern of patterns) {
        let match;

        while (
          (match =
            pattern.exec(content))
        ) {
          imports.push(match[1]);
        }
      }
    }

    if (language === "python") {
      const patterns = [
        /^\s*import\s+([a-zA-Z0-9_.]+)/gm,
        /^\s*from\s+([a-zA-Z0-9_.]+)\s+import/gm
      ];

      for (const pattern of patterns) {
        let match;

        while (
          (match =
            pattern.exec(content))
        ) {
          imports.push(match[1]);
        }
      }
    }

    return [
      ...new Set(imports)
    ];
  }

  normalizeImport(
    dependency,
    sourceFile
  ) {
    if (
      !dependency.startsWith(".")
    ) {
      return {
        external: true,
        path: dependency
      };
    }

    const parts =
      sourceFile.split("/");

    parts.pop();

    for (
      const part of dependency.split("/")
    ) {
      if (part === ".") continue;

      if (part === "..") {
        parts.pop();
      } else {
        parts.push(part);
      }
    }

    let path =
      parts.join("/");

    if (!/\.[a-zA-Z0-9]+$/.test(path)) {
      path += ".js";
    }

    return {
      external: false,
      path
    };
  }

  async repairProject({
    projectId,
    diagnostics = null,
    context = {}
  }) {
    const project =
      this.getProject(projectId);

    if (!project) {
      throw new Error(
        "Project is not registered."
      );
    }

    const issues =
      diagnostics ||
      project.diagnostics ||
      await this.analyzeProject(
        project
      );

    if (
      issues.length === 0
    ) {
      return {
        repaired: false,
        reason:
          "No detected issues."
      };
    }

    const result =
      await this.callModel({
        type: "code_repair",
        context,
        diagnostics: issues,
        project:
          this.serializeProject(
            project
          )
      });

    const changes =
      this.extractFiles(result);

    this.applyChanges(
      project,
      changes
    );

    const remaining =
      await this.analyzeProject(
        project
      );

    return {
      repaired: true,
      changes,
      remainingDiagnostics:
        remaining
    };
  }

  async refactorProject({
    projectId,
    request,
    files = []
  }) {
    const project =
      this.getProject(projectId);

    if (!project) {
      throw new Error(
        "Project is not registered."
      );
    }

    const selected =
      files.length > 0
        ? files
        : Array.from(
            project.files.keys()
          );

    const result =
      await this.callModel({
        type: "code_refactoring",
        request,
        files:
          selected.map(path =>
            this.serializeFile(
              project.files.get(path)
            )
          )
      });

    const changes =
      this.extractFiles(result);

    this.applyChanges(
      project,
      changes
    );

    return {
      changes,
      diagnostics:
        await this.analyzeProject(
          project
        )
    };
  }

  async generateTests({
    projectId,
    files = []
  }) {
    const project =
      this.getProject(projectId);

    if (!project) {
      throw new Error(
        "Project is not registered."
      );
    }

    const selected =
      files.length > 0
        ? files
        : Array.from(
            project.files.keys()
          );

    const result =
      await this.callModel({
        type: "test_generation",
        project:
          this.serializeProject(
            project
          ),
        files:
          selected.map(path =>
            this.serializeFile(
              project.files.get(path)
            )
          )
      });

    const changes =
      this.extractFiles(result);

    this.applyChanges(
      project,
      changes
    );

    return changes;
  }

  async explainCode({
    projectId,
    file,
    selection = null
  }) {
    const project =
      this.getProject(projectId);

    if (!project) {
      throw new Error(
        "Project is not registered."
      );
    }

    const target =
      project.files.get(file);

    if (!target) {
      throw new Error(
        "File not found."
      );
    }

    return this.callModel({
      type: "code_explanation",
      file:
        this.serializeFile(
          target
        ),
      selection
    });
  }

  async callModel(payload) {
    if (!this.model) {
      throw new Error(
        "Code model is not connected."
      );
    }

    if (
      typeof this.model.generateCode ===
      "function"
    ) {
      return this.model.generateCode(
        payload
      );
    }

    if (
      typeof this.model.generate ===
      "function"
    ) {
      return this.model.generate(
        payload
      );
    }

    throw new Error(
      "Connected model does not support code generation."
    );
  }

  extractFiles(result) {
    if (!result) return [];

    if (Array.isArray(result)) {
      return result.filter(
        item =>
          item &&
          typeof item.path ===
            "string" &&
          typeof item.content ===
            "string"
      );
    }

    if (
      Array.isArray(result.files)
    ) {
      return result.files.filter(
        item =>
          item &&
          typeof item.path ===
            "string" &&
          typeof item.content ===
            "string"
      );
    }

    if (
      result.result &&
      Array.isArray(
        result.result.files
      )
    ) {
      return result.result.files.filter(
        item =>
          item &&
          typeof item.path ===
            "string" &&
          typeof item.content ===
            "string"
      );
    }

    return [];
  }

  applyChanges(
    project,
    changes
  ) {
    if (
      changes.length >
      this.config.maxFilesPerOperation
    ) {
      throw new Error(
        "Operation exceeds maximum file limit."
      );
    }

    for (const change of changes) {
      const existing =
        project.files.get(
          change.path
        );

      if (
        this.config.preserveHistory
      ) {
        project.history.push({
          path: change.path,
          previous:
            existing
              ? existing.content
              : null,
          next: change.content,
          timestamp: Date.now()
        });
      }

      project.files.set(
        change.path,
        {
          path: change.path,
          content: change.content,
          language:
            change.language ||
            this.detectLanguage(
              change.path
            ),
          version:
            existing
              ? existing.version + 1
              : 1,
          updatedAt: Date.now()
        }
      );
    }

    project.updatedAt =
      Date.now();
  }

  detectLanguage(path) {
    const extension =
      path
        .split(".")
        .pop()
        .toLowerCase();

    const languages = {
      js: "javascript",
      jsx: "jsx",
      ts: "typescript",
      tsx: "tsx",
      py: "python",
      java: "java",
      kt: "kotlin",
      swift: "swift",
      dart: "dart",
      cs: "csharp",
      cpp: "cpp",
      c: "c",
      rs: "rust",
      go: "go",
      php: "php",
      rb: "ruby",
      html: "html",
      css: "css",
      scss: "scss",
      json: "json",
      xml: "xml",
      sql: "sql",
      sh: "shell",
      yml: "yaml",
      yaml: "yaml"
    };

    return (
      languages[extension] ||
      "text"
    );
  }

  serializeFile(file) {
    if (!file) return null;

    return {
      path: file.path,
      content: file.content,
      language: file.language,
      version: file.version
    };
  }

  serializeProject(project) {
    return {
      id: project.id,
      files:
        Array.from(
          project.files.values()
        ).map(file =>
          this.serializeFile(file)
        ),
      diagnostics:
        project.diagnostics,
      dependencies:
        Array.from(
          project.dependencies.entries()
        )
    };
  }

  createOperation(
    projectId,
    type,
    request
  ) {
    const operation = {
      id: this.createId(),
      projectId,
      type,
      request,
      status: "running",
      startedAt: Date.now()
    };

    this.operations.set(
      operation.id,
      operation
    );

    return operation;
  }

  async saveOperation(
    project,
    operation
  ) {
    operation.finishedAt =
      Date.now();

    if (
      this.memory &&
      typeof this.memory.remember ===
        "function"
    ) {
      await this.memory.remember(
        operation,
        {
          type:
            "code_engine_operation",
          projectId:
            project.id
        }
      );
    }
  }

  getProject(projectId) {
    return (
      this.projects.get(
        projectId
      ) || null
    );
  }

  getOperation(operationId) {
    return (
      this.operations.get(
        operationId
      ) || null
    );
  }

  getHistory(projectId) {
    const project =
      this.getProject(projectId);

    if (!project) return [];

    return [
      ...project.history
    ];
  }

  rollbackFile(
    projectId,
    filePath,
    version = null
  ) {
    const project =
      this.getProject(projectId);

    if (!project) {
      throw new Error(
        "Project is not registered."
      );
    }

    const history =
      project.history.filter(
        item =>
          item.path ===
          filePath
      );

    if (
      history.length === 0
    ) {
      return false;
    }

    const target =
      version === null
        ? history[
            history.length - 1
          ]
        : history.find(
            item =>
              item.version ===
              version
          );

    if (!target) {
      return false;
    }

    const file =
      project.files.get(
        filePath
      );

    if (!file) {
      return false;
    }

    file.content =
      target.previous;

    file.version += 1;
    file.updatedAt =
      Date.now();

    project.updatedAt =
      Date.now();

    return true;
  }

  createId() {
    return (
      "code_" +
      Date.now().toString(36) +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 10)
    );
  }
}

export default EgoCodeEngine;
export { EgoCodeEngine };
