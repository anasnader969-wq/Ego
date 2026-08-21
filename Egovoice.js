class EgoVoiceEngine {
  constructor({
    speechRecognizer = null,
    speechSynthesizer = null,
    aiEngine = null,
    memory = null,
    logger = console,
    config = {}
  } = {}) {
    this.speechRecognizer = speechRecognizer;
    this.speechSynthesizer = speechSynthesizer;
    this.aiEngine = aiEngine;
    this.memory = memory;
    this.logger = logger;

    this.config = {
      streaming: true,
      continuousListening: true,
      interruptible: true,
      autoRestart: true,
      language: "auto",
      responseTimeoutMs: 3000,
      maxConversationTurns: 100,
      defaultVoice: {
        pitch: 0.62,
        rate: 0.92,
        volume: 1,
        style: "deep",
        presence: "strong"
      },
      ...config
    };

    this.running = false;
    this.listening = false;
    this.speaking = false;
    this.interrupted = false;
    this.processing = false;
    this.currentTranscript = "";
    this.currentSpeech = null;
    this.conversation = [];
    this.listeners = new Map();
    this.recognizerBound = false;
  }

  async start() {
    if (this.running) return;

    if (!this.speechRecognizer) {
      throw new Error("Speech recognizer is required.");
    }

    if (!this.speechSynthesizer) {
      throw new Error("Speech synthesizer is required.");
    }

    this.running = true;

    this.bindRecognizer();

    await this.startListening();

    this.emit("started");
  }

  async stop() {
    this.running = false;

    await this.stopListening();
    await this.stopSpeaking();

    this.emit("stopped");
  }

  bindRecognizer() {
    if (
      this.recognizerBound ||
      !this.speechRecognizer ||
      typeof this.speechRecognizer.on !== "function"
    ) {
      return;
    }

    this.recognizerBound = true;

    this.speechRecognizer.on("partial", text => {
      this.currentTranscript = text || "";

      this.emit("partial_transcript", {
        text: this.currentTranscript
      });
    });

    this.speechRecognizer.on("final", async text => {
      await this.handleSpeech(text);
    });

    this.speechRecognizer.on("speech_start", async () => {
      if (
        this.config.interruptible &&
        this.speaking
      ) {
        await this.interrupt();
      }

      this.emit("user_started_speaking");
    });

    this.speechRecognizer.on("speech_end", () => {
      this.emit("user_stopped_speaking");
    });

    this.speechRecognizer.on("error", error => {
      this.emit("error", { error });

      if (
        this.running &&
        this.config.autoRestart
      ) {
        this.restartListening();
      }
    });
  }

  async startListening() {
    if (!this.running || this.listening) {
      return;
    }

    this.listening = true;
    this.currentTranscript = "";

    if (
      typeof this.speechRecognizer.start ===
      "function"
    ) {
      await this.speechRecognizer.start({
        streaming: this.config.streaming,
        continuous: this.config.continuousListening,
        interimResults: true,
        language: this.config.language
      });
    }

    this.emit("listening_started");
  }

  async stopListening() {
    if (!this.listening) return;

    this.listening = false;

    if (
      this.speechRecognizer &&
      typeof this.speechRecognizer.stop ===
      "function"
    ) {
      await this.speechRecognizer.stop();
    }

    this.emit("listening_stopped");
  }

  async restartListening() {
    if (!this.running) return;

    try {
      await this.stopListening();
      await this.startListening();
    } catch (error) {
      this.emit("error", { error });
    }
  }

  async handleSpeech(text) {
    if (
      !text ||
      typeof text !== "string" ||
      !text.trim() ||
      !this.running
    ) {
      return;
    }

    const message = text.trim();

    this.currentTranscript = message;

    this.conversation.push({
      role: "user",
      content: message,
      timestamp: Date.now()
    });

    this.trimConversation();

    this.emit("user_message", {
      text: message
    });

    if (this.memory) {
      await this.saveMemory("user", message);
    }

    if (!this.aiEngine) {
      throw new Error("AI engine is required.");
    }

    this.processing = true;

    try {
      const response = await this.generateResponse(message);

      const answer = this.extractResponse(response);

      if (!answer) return;

      this.conversation.push({
        role: "assistant",
        content: answer,
        timestamp: Date.now()
      });

      this.trimConversation();

      if (this.memory) {
        await this.saveMemory(
          "assistant",
          answer
        );
      }

      await this.speak(answer);
    } catch (error) {
      this.emit("error", { error });
    } finally {
      this.processing = false;

      if (
        this.running &&
        this.config.autoRestart &&
        !this.listening
      ) {
        await this.startListening();
      }
    }
  }

  async generateResponse(message) {
    const context = {
      source: "voice",
      realtime: true,
      conversation: [...this.conversation]
    };

    if (
      typeof this.aiEngine.run === "function"
    ) {
      return this.aiEngine.run(
        message,
        context
      );
    }

    if (
      typeof this.aiEngine.generate ===
      "function"
    ) {
      return this.aiEngine.generate({
        request: message,
        ...context
      });
    }

    throw new Error(
      "AI engine does not support run() or generate()."
    );
  }

  extractResponse(response) {
    if (!response) return "";

    if (typeof response === "string") {
      return response;
    }

    if (typeof response.response === "string") {
      return response.response;
    }

    if (typeof response.text === "string") {
      return response.text;
    }

    if (typeof response.result === "string") {
      return response.result;
    }

    if (
      response.result &&
      typeof response.result.response === "string"
    ) {
      return response.result.response;
    }

    if (
      response.result &&
      typeof response.result.text === "string"
    ) {
      return response.result.text;
    }

    return "";
  }

  async speak(
    text,
    voice = {}
  ) {
    if (!text || !this.speechSynthesizer) {
      return;
    }

    if (this.speaking) {
      await this.stopSpeaking();
    }

    this.speaking = true;
    this.interrupted = false;

    const voiceConfig = {
      ...this.config.defaultVoice,
      ...voice
    };

    this.emit("speech_started", {
      text,
      voice: voiceConfig
    });

    try {
      if (
        typeof this.speechSynthesizer.stream ===
        "function"
      ) {
        this.currentSpeech =
          await this.speechSynthesizer.stream(
            {
              text,
              voice: voiceConfig,
              streaming: true
            },
            chunk => {
              if (!this.interrupted) {
                this.emit("audio_chunk", {
                  chunk
                });
              }
            }
          );
      } else if (
        typeof this.speechSynthesizer.speak ===
        "function"
      ) {
        this.currentSpeech =
          await this.speechSynthesizer.speak(
            text,
            voiceConfig
          );
      }
    } finally {
      this.speaking = false;
      this.currentSpeech = null;

      this.emit("speech_finished", {
        text
      });
    }
  }

  async speakWithVoice(text, voice) {
    return this.speak(text, {
      ...this.config.defaultVoice,
      ...(voice || {})
    });
  }

  async setVoice(voice) {
    if (!voice) return;

    this.config.defaultVoice = {
      ...this.config.defaultVoice,
      ...voice
    };

    this.emit("voice_changed", {
      voice: this.config.defaultVoice
    });
  }

  getVoice() {
    return {
      ...this.config.defaultVoice
    };
  }

  async interrupt() {
    this.interrupted = true;
    await this.stopSpeaking();

    this.emit("speech_interrupted");
  }

  async stopSpeaking() {
    if (
      this.speechSynthesizer &&
      typeof this.speechSynthesizer.stop ===
      "function"
    ) {
      await this.speechSynthesizer.stop();
    }

    this.speaking = false;
    this.currentSpeech = null;
  }

  async saveMemory(role, content) {
    if (
      !this.memory ||
      typeof this.memory.remember !== "function"
    ) {
      return;
    }

    await this.memory.remember(
      {
        role,
        content,
        timestamp: Date.now()
      },
      {
        type: "voice_message"
      }
    );
  }

  trimConversation() {
    const max =
      this.config.maxConversationTurns;

    if (this.conversation.length > max) {
      this.conversation =
        this.conversation.slice(-max);
    }
  }

  getConversation() {
    return [...this.conversation];
  }

  clearConversation() {
    this.conversation = [];
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

  getStatus() {
    return {
      running: this.running,
      listening: this.listening,
      speaking: this.speaking,
      processing: this.processing,
      recognizerConnected:
        !!this.speechRecognizer,
      synthesizerConnected:
        !!this.speechSynthesizer,
      aiConnected:
        !!this.aiEngine,
      memoryConnected:
        !!this.memory,
      conversationLength:
        this.conversation.length,
      voice:
        this.config.defaultVoice
    };
  }
}

export default EgoVoiceEngine;
export { EgoVoiceEngine };
