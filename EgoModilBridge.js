class EgoModelBridge {
  constructor({
    provider = null,
    model = null,
    tools = null,
    config = {}
  } = {}) {
    this.provider = provider;
    this.model = model;
    this.tools = tools;

    this.config = {
      streaming: true,
      parallel: true,
      cache: true,
      maxConcurrentRequests: 12,
      timeoutMs: 3000,
      contextWindow: 128000,
      maxOutputTokens: 16384,
      temperature: 0.2,
      retries: 2,
      ...config
    };

    this.cache = new Map();
    this.activeRequests = 0;
    this.queue = [];
    this.sessions = new Map();
  }

  async generate(input = {}) {
    return this.execute({
      ...input,
      stream: false
    });
  }

  async stream(input = {}, onToken = () => {}) {
    return this.execute({
      ...input,
      stream: true,
      onToken
    });
  }

  async execute(input) {
    const request = this.normalizeRequest(input);

    const cacheKey = this.createCacheKey(request);

    if (this.config.cache && !request.stream) {
      const cached = this.cache.get(cacheKey);

      if (cached && Date.now() - cached.time < 300000) {
        return cached.value;
      }
    }

    const result = await this.enqueue(
      () => this.executeWithRetry(request)
    );

    if (this.config.cache && !request.stream) {
      this.cache.set(cacheKey, {
        value: result,
        time: Date.now()
      });
    }

    return result;
  }

  normalizeRequest(input) {
    return {
      type: input.type || "general",
      request: input.request || input.prompt || "",
      messages: Array.isArray(input.messages)
        ? input.messages
        : [],
      context: input.context || {},
      memories: input.memories || [],
      tools: input.tools || this.getTools(),
      stream: input.stream === true,
      onToken:
        typeof input.onToken === "function"
          ? input.onToken
          : () => {},
      temperature:
        typeof input.temperature === "number"
          ? input.temperature
          : this.config.temperature,
      maxOutputTokens:
        input.maxOutputTokens ||
        this.config.maxOutputTokens,
      sessionId:
        input.sessionId || "default"
    };
  }

  async executeWithRetry(request) {
    let lastError = null;

    for (
      let attempt = 0;
      attempt <= this.config.retries;
      attempt++
    ) {
      try {
        return await this.executeOnce(request);
      } catch (error) {
        lastError = error;

        if (attempt < this.config.retries) {
          await this.sleep(
            Math.min(
              100 * 2 ** attempt,
              500
            )
          );
        }
      }
    }

    throw lastError;
  }

  async executeOnce(request) {
    const startedAt = performance.now();

    const payload = this.buildPayload(request);

    if (!this.provider) {
      return {
        success: false,
        error:
          "No AI provider is connected.",
        elapsedMs:
          performance.now() - startedAt
      };
    }

    if (
      request.stream &&
      typeof this.provider.stream === "function"
    ) {
      return this.streamProvider(
        payload,
        request.onToken,
        startedAt
      );
    }

    if (
      typeof this.provider.generate === "function"
    ) {
      const result =
        await this.withTimeout(
          this.provider.generate(payload),
          this.config.timeoutMs
        );

      return {
        success: true,
        result,
        elapsedMs:
          performance.now() - startedAt
      };
    }

    if (
      typeof this.provider.complete === "function"
    ) {
      const result =
        await this.withTimeout(
          this.provider.complete(payload),
          this.config.timeoutMs
        );

      return {
        success: true,
        result,
        elapsedMs:
          performance.now() - startedAt
      };
    }

    throw new Error(
      "Provider does not implement generate(), complete(), or stream()."
    );
  }

  async streamProvider(
    payload,
    onToken,
    startedAt
  ) {
    let text = "";

    const stream =
      await this.provider.stream(payload);

    for await (const chunk of stream) {
      const token =
        this.extractToken(chunk);

      if (!token) continue;

      text += token;

      try {
        onToken(token);
      } catch {}
    }

    return {
      success: true,
      result: text,
      streamed: true,
      elapsedMs:
        performance.now() - startedAt
    };
  }

  extractToken(chunk) {
    if (typeof chunk === "string") {
      return chunk;
    }

    if (!chunk) {
      return "";
    }

    return (
      chunk.token ||
      chunk.text ||
      chunk.content ||
      chunk.delta ||
      ""
    );
  }

  buildPayload(request) {
    const messages = [
      ...request.messages
    ];

    if (request.request) {
      messages.push({
        role: "user",
        content: request.request
      });
    }

    return {
      model: this.model,
      type: request.type,
      messages,
      context: this.optimizeContext(
        request.context
      ),
      memories: this.optimizeMemories(
        request.memories
      ),
      tools: request.tools,
      temperature: request.temperature,
      maxOutputTokens:
        request.maxOutputTokens,
      stream: request.stream,
      sessionId:
        request.sessionId
    };
  }

  optimizeContext(context) {
    const serialized =
      JSON.stringify(context || {});

    if (
      serialized.length <=
      this.config.contextWindow
    ) {
      return context;
    }

    return {
      summary:
        serialized.slice(
          0,
          this.config.contextWindow
        )
    };
  }

  optimizeMemories(memories) {
    if (!Array.isArray(memories)) {
      return [];
    }

    return memories
      .slice()
      .sort(
        (a, b) =>
          (b.importance || 0) -
          (a.importance || 0)
      )
      .slice(0, 50);
  }

  getTools() {
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
        description:
          tool.description || "",
        category:
          tool.category || "general"
      }));
  }

  async parallel(requests = []) {
    if (!Array.isArray(requests)) {
      throw new Error(
        "Requests must be an array."
      );
    }

    if (!this.config.parallel) {
      const results = [];

      for (const request of requests) {
        results.push(
          await this.generate(request)
        );
      }

      return results;
    }

    return Promise.all(
      requests.map(request =>
        this.generate(request)
      )
    );
  }

  async parallelStream(
    requests = [],
    onResult = () => {}
  ) {
    const jobs = requests.map(
      async (request, index) => {
        const result =
          await this.stream(
            request,
            token => {
              try {
                onResult({
                  index,
                  token
                });
              } catch {}
            }
          );

        return {
          index,
          result
        };
      }
    );

    return Promise.all(jobs);
  }

  async enqueue(job) {
    if (
      this.activeRequests <
      this.config.maxConcurrentRequests
    ) {
      this.activeRequests++;

      try {
        return await job();
      } finally {
        this.activeRequests--;
        this.processQueue();
      }
    }

    return new Promise(
      (resolve, reject) => {
        this.queue.push({
          job,
          resolve,
          reject
        });
      }
    );
  }

  processQueue() {
    while (
      this.queue.length > 0 &&
      this.activeRequests <
        this.config.maxConcurrentRequests
    ) {
      const item =
        this.queue.shift();

      this.activeRequests++;

      item
        .job()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this.activeRequests--;
          this.processQueue();
        });
    }
  }

  createSession(id = "default") {
    if (!this.sessions.has(id)) {
      this.sessions.set(id, {
        id,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    return this.sessions.get(id);
  }

  addMessage(
    sessionId,
    role,
    content
  ) {
    const session =
      this.createSession(sessionId);

    session.messages.push({
      role,
      content,
      timestamp: Date.now()
    });

    session.updatedAt = Date.now();

    return session;
  }

  getSession(sessionId) {
    return (
      this.sessions.get(sessionId) ||
      this.createSession(sessionId)
    );
  }

  clearSession(sessionId) {
    return this.sessions.delete(
      sessionId
    );
  }

  createCacheKey(request) {
    const clean = {
      type: request.type,
      request: request.request,
      messages: request.messages,
      context: request.context,
      memories: request.memories,
      model: this.model,
      temperature:
        request.temperature,
      maxOutputTokens:
        request.maxOutputTokens
    };

    return this.hash(
      JSON.stringify(clean)
    );
  }

  hash(value) {
    let hash = 0;

    for (
      let i = 0;
      i < value.length;
      i++
    ) {
      hash =
        (hash << 5) -
        hash +
        value.charCodeAt(i);

      hash |= 0;
    }

    return String(hash);
  }

  clearCache() {
    this.cache.clear();
  }

  async withTimeout(
    promise,
    timeout
  ) {
    let timer;

    const timeoutPromise =
      new Promise(
        (_, reject) => {
          timer = setTimeout(() => {
            reject(
              new Error(
                "AI request timeout."
              )
            );
          }, timeout);
        }
      );

    try {
      return await Promise.race([
        promise,
        timeoutPromise
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  sleep(ms) {
    return new Promise(resolve =>
      setTimeout(resolve, ms)
    );
  }

  getStatus() {
    return {
      providerConnected:
        !!this.provider,
      model:
        this.model,
      activeRequests:
        this.activeRequests,
      queuedRequests:
        this.queue.length,
      cachedResponses:
        this.cache.size,
      sessions:
        this.sessions.size,
      streaming:
        this.config.streaming,
      parallel:
        this.config.parallel
    };
  }

  setProvider(provider) {
    this.provider = provider;
  }

  setModel(model) {
    this.model = model;
  }

  setTools(tools) {
    this.tools = tools;
  }

  configure(config = {}) {
    this.config = {
      ...this.config,
      ...config
    };
  }
}

export default EgoModelBridge;
export { EgoModelBridge };
