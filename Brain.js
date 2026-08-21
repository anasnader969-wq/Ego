// Brain.js
// Ego — Central Intelligence
// Handles intent, context, emotion, memory, task planning,
// tool routing, conversation flow, and ADHD-aware interaction.

const STATES = {
  IDLE: "idle",
  LISTENING: "listening",
  THINKING: "thinking",
  SPEAKING: "speaking",
  ERROR: "error",
};

const INTENTS = {
  CHAT: "chat",
  QUESTION: "question",
  TASK: "task",
  REMINDER: "reminder",
  SEARCH: "search",
  CALCULATE: "calculate",
  MEMORY: "memory",
  SETTINGS: "settings",
  PLANNING: "planning",
  HELP: "help",
  UNKNOWN: "unknown",
};

const EMOTIONS = {
  NEUTRAL: "neutral",
  HAPPY: "happy",
  SAD: "sad",
  STRESSED: "stressed",
  ANGRY: "angry",
  URGENT: "urgent",
  CONFUSED: "confused",
  EXCITED: "excited",
};

const DEFAULT_CONFIG = {
  aiEndpoint: "/api/ai",

  // ADHD-aware defaults
  adhdMode: true,
  conciseByDefault: true,
  proactiveHelp: true,
  stepByStepWhenNeeded: true,
  avoidInformationOverload: true,

  maxHistory: 40,
  maxMemory: 100,

  confidenceThreshold: 0.60,
};

function cleanText(text = "") {
  return String(text)
    .trim()
    .replace(/\s+/g, " ");
}

function includesAny(text, words) {
  const value = text.toLowerCase();

  return words.some((word) =>
    value.includes(word.toLowerCase())
  );
}

function detectEmotion(text) {
  const value = text.toLowerCase();

  if (
    includesAny(value, [
      "مبسوط",
      "فرحان",
      "جامد",
      "رائع",
      "happy",
      "great",
      "awesome",
      "excited",
    ])
  ) {
    return EMOTIONS.HAPPY;
  }

  if (
    includesAny(value, [
      "زعلان",
      "حزين",
      "مش كويس",
      "sad",
      "upset",
      "depressed",
    ])
  ) {
    return EMOTIONS.SAD;
  }

  if (
    includesAny(value, [
      "متوتر",
      "مضغوط",
      "تعبان",
      "مش قادر",
      "مش مركز",
      "stressed",
      "overwhelmed",
      "can't focus",
    ])
  ) {
    return EMOTIONS.STRESSED;
  }

  if (
    includesAny(value, [
      "عصبي",
      "متضايق",
      "غاضب",
      "angry",
      "mad",
    ])
  ) {
    return EMOTIONS.ANGRY;
  }

  if (
    includesAny(value, [
      "بسرعة",
      "حالًا",
      "دلوقتي",
      "ضروري",
      "urgent",
      "now",
      "asap",
    ])
  ) {
    return EMOTIONS.URGENT;
  }

  if (
    includesAny(value, [
      "مش فاهم",
      "مش عارف",
      "محتار",
      "confused",
      "don't understand",
      "not sure",
    ])
  ) {
    return EMOTIONS.CONFUSED;
  }

  return EMOTIONS.NEUTRAL;
}

function detectIntent(text) {
  const value = text.toLowerCase();

  if (
    includesAny(value, [
      "فكرني",
      "ذكرني",
      "تذكير",
      "remind me",
      "reminder",
    ])
  ) {
    return INTENTS.REMINDER;
  }

  if (
    includesAny(value, [
      "احسب",
      "حساب",
      "كام",
      "كم",
      "calculate",
      "calculator",
    ])
  ) {
    return INTENTS.CALCULATE;
  }

  if (
    includesAny(value, [
      "احفظ",
      "افتكر",
      "خلي بالك",
      "انسى",
      "امسح من الذاكرة",
      "remember",
      "forget",
      "memory",
    ])
  ) {
    return INTENTS.MEMORY;
  }

  if (
    includesAny(value, [
      "ابحث",
      "دور",
      "هاتلي معلومات",
      "search",
      "look up",
      "find",
    ])
  ) {
    return INTENTS.SEARCH;
  }

  if (
    includesAny(value, [
      "خطط",
      "خطة",
      "نظم",
      "رتب",
      "schedule",
      "plan",
      "organize",
    ])
  ) {
    return INTENTS.PLANNING;
  }

  if (
    includesAny(value, [
      "إعدادات",
      "اعدادات",
      "settings",
      "theme",
      "لغة",
      "language",
    ])
  ) {
    return INTENTS.SETTINGS;
  }

  if (
    includesAny(value, [
      "ازاي",
      "إزاي",
      "ليه",
      "لماذا",
      "ما هو",
      "ايه",
      "what",
      "why",
      "how",
      "when",
      "where",
    ])
  ) {
    return INTENTS.QUESTION;
  }

  if (
    includesAny(value, [
      "اعمل",
      "نفذ",
      "شغل",
      "افتح",
      "اقفل",
      "create",
      "do",
      "execute",
      "open",
      "close",
    ])
  ) {
    return INTENTS.TASK;
  }

  if (value.length > 0) {
    return INTENTS.CHAT;
  }

  return INTENTS.UNKNOWN;
}

function extractEntities(text) {
  const entities = {
    time: null,
    date: null,
    numbers: [],
  };

  const timeMatch = text.match(
    /(?:الساعة|ساعة|at)\s*(\d{1,2})(?::(\d{2}))?/i
  );

  if (timeMatch) {
    entities.time = {
      hour: Number(timeMatch[1]),
      minute: Number(timeMatch[2] || 0),
    };
  }

  const numbers = text.match(/\b\d+(?:\.\d+)?\b/g);

  if (numbers) {
    entities.numbers = numbers.map(Number);
  }

  if (
    includesAny(text, [
      "بكرة",
      "غدا",
      "غدًا",
      "tomorrow",
    ])
  ) {
    entities.date = "tomorrow";
  }

  if (
    includesAny(text, [
      "النهاردة",
      "اليوم",
      "today",
    ])
  ) {
    entities.date = "today";
  }

  return entities;
}

function calculateComplexity(text) {
  const words = cleanText(text).split(" ").length;

  if (words <= 8) return "simple";
  if (words <= 25) return "medium";

  return "complex";
}

function chooseTool(intent) {
  const tools = {
    [INTENTS.REMINDER]: "reminder",
    [INTENTS.CALCULATE]: "calculator",
    [INTENTS.SEARCH]: "search",
    [INTENTS.MEMORY]: "memory",
    [INTENTS.SETTINGS]: "settings",
    [INTENTS.PLANNING]: "planner",
    [INTENTS.TASK]: "task",
    [INTENTS.QUESTION]: "ai",
    [INTENTS.CHAT]: "ai",
  };

  return tools[intent] || "ai";
}

function createADHDStrategy({
  emotion,
  complexity,
  intent,
  adhdMode,
}) {
  if (!adhdMode) {
    return {
      enabled: false,
      responseStyle: "normal",
      maxSteps: null,
      proactive: false,
    };
  }

  const strategy = {
    enabled: true,
    responseStyle: "natural",
    maxSteps: null,
    proactive: true,
    reduceOverload: true,
    clarifyOnlyWhenNecessary: true,
  };

  if (
    emotion === EMOTIONS.STRESSED ||
    emotion === EMOTIONS.CONFUSED
  ) {
    strategy.responseStyle = "calm_and_clear";
    strategy.maxSteps = 3;
  }

  if (complexity === "complex") {
    strategy.responseStyle = "structured";
    strategy.maxSteps = 5;
  }

  if (intent === INTENTS.TASK) {
    strategy.responseStyle = "action_first";
    strategy.maxSteps = 4;
  }

  if (intent === INTENTS.PLANNING) {
    strategy.responseStyle = "small_steps";
    strategy.maxSteps = 5;
  }

  return strategy;
}

function createConversationContext(history) {
  return history.slice(-12).map((message) => ({
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
  }));
}

export class Brain {
  constructor(config = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.state = STATES.IDLE;

    this.history = [];

    this.memory = [];

    this.listeners = new Set();

    this.currentContext = null;
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
        // Listener errors should never break the brain.
      }
    }
  }

  setState(state) {
    this.state = state;

    this.emit({
      type: "state_change",
      state,
    });
  }

  addMessage(role, content, metadata = {}) {
    const message = {
      id:
        typeof crypto !== "undefined" &&
        crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,

      role,
      content,
      metadata,
      timestamp: Date.now(),
    };

    this.history.push(message);

    if (
      this.history.length >
      this.config.maxHistory
    ) {
      this.history.shift();
    }

    return message;
  }

  remember(key, value, importance = 0.5) {
    const existing = this.memory.find(
      (item) => item.key === key
    );

    if (existing) {
      existing.value = value;
      existing.importance = importance;
      existing.updatedAt = Date.now();

      return existing;
    }

    const item = {
      id:
        typeof crypto !== "undefined" &&
        crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,

      key,
      value,
      importance,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.memory.push(item);

    if (
      this.memory.length >
      this.config.maxMemory
    ) {
      this.memory.sort(
        (a, b) =>
          b.importance - a.importance
      );

      this.memory = this.memory.slice(
        0,
        this.config.maxMemory
      );
    }

    return item;
  }

  forget(key) {
    this.memory = this.memory.filter(
      (item) => item.key !== key
    );
  }

  getMemory() {
    return [...this.memory].sort(
      (a, b) =>
        b.importance - a.importance
    );
  }

  analyze(text) {
    const normalized = cleanText(text);

    const intent =
      detectIntent(normalized);

    const emotion =
      detectEmotion(normalized);

    const entities =
      extractEntities(normalized);

    const complexity =
      calculateComplexity(normalized);

    const tool =
      chooseTool(intent);

    const adhdStrategy =
      createADHDStrategy({
        emotion,
        complexity,
        intent,
        adhdMode:
          this.config.adhdMode,
      });

    const confidence =
      intent === INTENTS.UNKNOWN
        ? 0.25
        : 0.85;

    return {
      text: normalized,
      intent,
      emotion,
      entities,
      complexity,
      tool,
      confidence,
      adhdStrategy,
    };
  }

  buildSystemInstruction(analysis) {
    const conversation =
      createConversationContext(
        this.history
      );

    const memories =
      this.getMemory().slice(0, 20);

    return `
You are Ego, a highly intelligent personal AI assistant.

Your purpose is to understand the PERSON, not merely the sentence.

CORE INTELLIGENCE:

- Understand intent rather than translating words literally.
- Understand context across multiple messages.
- Infer what the user is trying to accomplish.
- Consider emotional tone without pretending to diagnose emotions.
- Remember useful context when appropriate.
- Ask questions only when missing information genuinely matters.
- Never pretend that an action happened if it did not.
- Choose tools when a real action is required.
- Adapt your response naturally to the user's communication style.
- Do not repeat information unnecessarily.
- Do not behave like a rigid command parser.

HUMAN-LIKE CONVERSATION:

The user should feel understood.

If the user says something incomplete,
use context before asking for clarification.

If several interpretations are possible,
choose the most reasonable one when the risk is low.

If the request could cause an important or irreversible action,
confirm before executing it.

ADHD-AWARE INTERACTION:

The user may prefer an ADHD-friendly interaction style.

Do NOT assume a diagnosis from language alone.

When ADHD mode is enabled:

- Reduce unnecessary cognitive load.
- Prefer clear and actionable responses.
- Avoid huge walls of information unless requested.
- Break complicated tasks into manageable steps.
- Give the most useful next action first.
- Preserve context so the user does not need to repeat themselves.
- If the user appears overwhelmed, simplify rather than adding more complexity.
- Do not be patronizing.
- Do not constantly mention ADHD.
- Do not force productivity.
- Allow the user to ask for more detail.
- When planning, prioritize realistic next actions instead of overwhelming lists.
- When the user changes topic, follow naturally unless returning to the previous goal would clearly help.
- Offer gentle redirection only when it is useful, never aggressively.

CURRENT ANALYSIS:

${JSON.stringify(
  analysis,
  null,
  2
)}

RECENT CONVERSATION:

${JSON.stringify(
  conversation,
  null,
  2
)}

RELEVANT MEMORY:

${JSON.stringify(
  memories,
  null,
  2
)}
    `.trim();
  }

  async think(userText) {
    try {
      const analysis =
        this.analyze(userText);

      this.currentContext = analysis;

      this.setState(
        STATES.THINKING
      );

      this.addMessage(
        "user",
        analysis.text,
        {
          analysis,
        }
      );

      this.emit({
        type: "thinking",
        analysis,
      });

      if (
        analysis.confidence <
        this.config.confidenceThreshold
      ) {
        return {
          type: "clarification",
          state: STATES.THINKING,
          analysis,
          message:
            "I want to make sure I understand what you mean.",
        };
      }

      if (analysis.tool !== "ai") {
        return {
          type: "tool_request",
          state: STATES.THINKING,
          tool: analysis.tool,
          analysis,
          entities:
            analysis.entities,
        };
      }

      const response =
        await this.callAI(
          analysis
        );

      this.addMessage(
        "assistant",
        response.text,
        {
          analysis,
        }
      );

      this.setState(
        STATES.SPEAKING
      );

      return {
        type: "response",
        state: STATES.SPEAKING,
        text: response.text,
        analysis,
      };
    } catch (error) {
      this.setState(
        STATES.ERROR
      );

      this.emit({
        type: "error",
        error,
      });

      return {
        type: "error",
        state: STATES.ERROR,
        message:
          "Something went wrong while processing the request.",
        error,
      };
    }
  }

  async callAI(analysis) {
    const payload = {
      message: analysis.text,

      analysis,

      systemInstruction:
        this.buildSystemInstruction(
          analysis
        ),

      history:
        this.history.slice(-20),

      memory:
        this.getMemory().slice(0, 20),

      userPreferences: {
        adhdMode:
          this.config.adhdMode,

        conciseByDefault:
          this.config.conciseByDefault,

        proactiveHelp:
          this.config.proactiveHelp,

        avoidInformationOverload:
          this.config
            .avoidInformationOverload,
      },
    };

    const response =
      await fetch(
        this.config.aiEndpoint,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify(
            payload
          ),
        }
      );

    if (!response.ok) {
      throw new Error(
        `AI request failed: ${response.status}`
      );
    }

    const data =
      await response.json();

    return {
      text:
        data.text ||
        data.message ||
        data.response ||
        "I couldn't generate a response.",
    };
  }

  setADHDMode(enabled) {
    this.config.adhdMode =
      Boolean(enabled);

    this.emit({
      type: "preference_change",
      preference: "adhdMode",
      value:
        this.config.adhdMode,
    });
  }

  getState() {
    return this.state;
  }

  getContext() {
    return this.currentContext;
  }

  clearConversation() {
    this.history = [];
    this.currentContext = null;
    this.setState(STATES.IDLE);
  }

  reset() {
    this.history = [];
    this.memory = [];
    this.currentContext = null;
    this.setState(STATES.IDLE);
  }
}

export const brain =
  new Brain();

export default brain;
