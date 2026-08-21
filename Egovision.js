// EgoVisionEngine.js

class EgoVisionEngine {
  constructor({
    visionModel = null,
    camera = null,
    memory = null,
    logger = console,
    config = {}
  } = {}) {
    this.visionModel = visionModel;
    this.camera = camera;
    this.memory = memory;
    this.logger = logger;

    this.config = {
      streaming: true,
      frameRate: 5,
      maxHistoryFrames: 12,
      analysisIntervalMs: 200,
      enableOCR: true,
      enableObjectDetection: true,
      enableSceneUnderstanding: true,
      enableTemporalUnderstanding: true,
      enableConversationContext: true,
      maxConcurrentAnalyses: 3,
      ...config
    };

    this.running = false;
    this.processing = 0;
    this.frameHistory = [];
    this.lastAnalysis = null;
    this.listeners = new Map();
    this.frameQueue = [];
  }

  async start() {
    if (this.running) return;

    if (!this.camera) {
      throw new Error(
        "Camera provider is required."
      );
    }

    if (
      typeof this.camera.requestPermission ===
      "function"
    ) {
      const granted =
        await this.camera.requestPermission();

      if (!granted) {
        throw new Error(
          "Camera permission was not granted."
        );
      }
    }

    this.running = true;

    this.emit("vision_started");

    if (
      typeof this.camera.startStream ===
      "function"
    ) {
      await this.camera.startStream(
        frame => this.receiveFrame(frame)
      );
    }
  }

  async stop() {
    this.running = false;

    if (
      this.camera &&
      typeof this.camera.stopStream ===
        "function"
    ) {
      await this.camera.stopStream();
    }

    this.frameQueue = [];
    this.emit("vision_stopped");
  }

  async receiveFrame(frame) {
    if (!this.running || !frame) {
      return;
    }

    this.frameQueue.push({
      frame,
      timestamp: Date.now()
    });

    if (
      this.frameQueue.length >
      this.config.maxHistoryFrames
    ) {
      this.frameQueue.shift();
    }

    if (
      this.processing >=
      this.config.maxConcurrentAnalyses
    ) {
      return;
    }

    const next =
      this.frameQueue.shift();

    if (next) {
      await this.processFrame(
        next.frame,
        next.timestamp
      );
    }
  }

  async processFrame(
    frame,
    timestamp
  ) {
    if (!this.visionModel) {
      return {
        success: false,
        error:
          "No vision model is connected."
      };
    }

    this.processing++;

    try {
      const context =
        this.buildVisualContext();

      const result =
        await this.analyzeFrame(
          frame,
          context
        );

      this.lastAnalysis = {
        ...result,
        timestamp
      };

      this.frameHistory.push({
        timestamp,
        analysis: result
      });

      if (
        this.frameHistory.length >
        this.config.maxHistoryFrames
      ) {
        this.frameHistory.shift();
      }

      this.emit(
        "vision_analysis",
        this.lastAnalysis
      );

      return result;
    } finally {
      this.processing--;
    }
  }

  async analyzeFrame(
    frame,
    context = {}
  ) {
    const payload = {
      image: frame,

      task: `
Analyze the current visual scene with high
semantic detail.

Understand:
- objects
- people as visible subjects without identifying them
- environment
- text
- spatial relationships
- movement
- changes from previous frames
- important visual events
- relevant context

Return structured information suitable for
a conversational AI that can discuss what the
user is currently seeing.
      `,

      context,

      options: {
        ocr:
          this.config.enableOCR,

        objectDetection:
          this.config.enableObjectDetection,

        sceneUnderstanding:
          this.config.enableSceneUnderstanding,

        temporalUnderstanding:
          this.config.enableTemporalUnderstanding
      }
    };

    if (
      typeof this.visionModel.analyze ===
      "function"
    ) {
      return this.visionModel.analyze(
        payload
      );
    }

    if (
      typeof this.visionModel.generate ===
      "function"
    ) {
      return this.visionModel.generate(
        payload
      );
    }

    throw new Error(
      "Vision model does not support analyze() or generate()."
    );
  }

  buildVisualContext() {
    return {
      latest:
        this.lastAnalysis,

      recentFrames:
        this.frameHistory.slice(
          -this.config.maxHistoryFrames
        ),

      temporalState:
        this.getTemporalState()
    };
  }

  getTemporalState() {
    if (
      this.frameHistory.length < 2
    ) {
      return {
        changed: false,
        changes: []
      };
    }

    const previous =
      this.frameHistory[
        this.frameHistory.length - 2
      ];

    const current =
      this.frameHistory[
        this.frameHistory.length - 1
      ];

    return {
      changed:
        JSON.stringify(
          previous.analysis
        ) !==
        JSON.stringify(
          current.analysis
        ),

      previous:
        previous.analysis,

      current:
        current.analysis
    };
  }

  async ask(question) {
    if (!question) {
      throw new Error(
        "Question is required."
      );
    }

    if (!this.lastAnalysis) {
      return {
        success: false,
        error:
          "No visual information is currently available."
      };
    }

    const payload = {
      type: "visual_question",

      question,

      currentVision:
        this.lastAnalysis,

      recentVision:
        this.frameHistory,

      context:
        this.buildVisualContext()
    };

    if (
      typeof this.visionModel.answer ===
      "function"
    ) {
      return this.visionModel.answer(
        payload
      );
    }

    if (
      typeof this.visionModel.generate ===
      "function"
    ) {
      return this.visionModel.generate(
        payload
      );
    }

    throw new Error(
      "Vision model cannot answer visual questions."
    );
  }

  async describeScene() {
    return this.ask(
      "Describe the current scene and the important details relevant to the user."
    );
  }

  async compareWithPrevious() {
    if (
      this.frameHistory.length < 2
    ) {
      return {
        success: false,
        error:
          "Not enough visual history."
      };
    }

    const current =
      this.frameHistory[
        this.frameHistory.length - 1
      ];

    const previous =
      this.frameHistory[
        this.frameHistory.length - 2
      ];

    const payload = {
      type: "visual_comparison",
      previous:
        previous.analysis,
      current:
        current.analysis
    };

    if (
      typeof this.visionModel.generate ===
      "function"
    ) {
      return this.visionModel.generate(
        payload
      );
    }

    return {
      previous:
        previous.analysis,
      current:
        current.analysis
    };
  }

  async detectText(frame = null) {
    const target =
      frame ||
      this.getLatestFrame();

    if (!target) {
      return [];
    }

    if (
      typeof this.visionModel.ocr ===
      "function"
    ) {
      return this.visionModel.ocr(
        target
      );
    }

    const result =
      await this.analyzeFrame(
        target,
        {
          mode: "ocr"
        }
      );

    return result?.text || [];
  }

  async detectObjects(frame = null) {
    const target =
      frame ||
      this.getLatestFrame();

    if (!target) {
      return [];
    }

    if (
      typeof this.visionModel.detectObjects ===
      "function"
    ) {
      return this.visionModel.detectObjects(
        target
      );
    }

    const result =
      await this.analyzeFrame(
        target,
        {
          mode: "object_detection"
        }
      );

    return result?.objects || [];
  }

  getLatestFrame() {
    const latest =
      this.frameQueue[
        this.frameQueue.length - 1
      ];

    return latest?.frame || null;
  }

  getCurrentVision() {
    return this.lastAnalysis;
  }

  getHistory() {
    return [...this.frameHistory];
  }

  clearHistory() {
    this.frameHistory = [];
    this.frameQueue = [];
    this.lastAnalysis = null;
  }

  on(event, callback) {
    if (
      typeof callback !== "function"
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
        this.logger.error(
          error
        );
      }
    }
  }

  getStatus() {
    return {
      running: this.running,
      processing:
        this.processing,
      queuedFrames:
        this.frameQueue.length,
      historyFrames:
        this.frameHistory.length,
      visionConnected:
        !!this.visionModel,
      cameraConnected:
        !!this.camera,
      lastAnalysis:
        !!this.lastAnalysis
    };
  }
}

export default EgoVisionEngine;
export { EgoVisionEngine };
