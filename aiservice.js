// aiService.js
// Ego — AI Service Layer
// Responsible for communicating with the real AI backend.
// The API key must NEVER be stored in this frontend file.

const DEFAULT_ENDPOINT = "/api/ai";

const DEFAULT_OPTIONS = {
  endpoint: DEFAULT_ENDPOINT,
  timeout: 60000,
};

function createTimeoutSignal(timeout) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function normalizeResponse(data) {
  if (!data) {
    return {
      text: "",
      raw: data,
    };
  }

  const text =
    data.text ??
    data.message ??
    data.response ??
    data.output ??
    "";

  return {
    text: String(text),
    raw: data,
  };
}

export class AIService {
  constructor(options = {}) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };

    this.connected = false;
  }

  async send({
    message,
    analysis = null,
    history = [],
    memory = [],
    systemInstruction = "",
    preferences = {},
  }) {
    if (!message || !String(message).trim()) {
      throw new Error(
        "AIService: message is required."
      );
    }

    const timeout =
      createTimeoutSignal(
        this.options.timeout
      );

    try {
      const payload = {
        message: String(message).trim(),

        analysis,

        history,

        memory,

        systemInstruction,

        preferences,
      };

      const response =
        await fetch(
          this.options.endpoint,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify(
              payload
            ),

            signal:
              timeout.signal,
          }
        );

      if (!response.ok) {
        const errorText =
          await response.text();

        throw new Error(
          `AI server error (${response.status}): ${errorText}`
        );
      }

      const data =
        await response.json();

      this.connected = true;

      return normalizeResponse(
        data
      );
    } catch (error) {
      this.connected = false;

      if (
        error?.name ===
        "AbortError"
      ) {
        throw new Error(
          "The AI request timed out."
        );
      }

      throw error;
    } finally {
      timeout.clear();
    }
  }

  async checkConnection() {
    try {
      const response =
        await fetch(
          this.options.endpoint,
          {
            method: "GET",
          }
        );

      this.connected =
        response.ok;

      return this.connected;
    } catch {
      this.connected = false;

      return false;
    }
  }

  isConnected() {
    return this.connected;
  }

  setEndpoint(endpoint) {
    if (
      !endpoint ||
      typeof endpoint !== "string"
    ) {
      throw new Error(
        "AIService: invalid endpoint."
      );
    }

    this.options.endpoint =
      endpoint;
  }

  getEndpoint() {
    return this.options.endpoint;
  }
}

export const aiService =
  new AIService();

export default aiService;
