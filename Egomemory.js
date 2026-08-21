class EgoMemory {
  constructor({
    storage,
    maxStorageBytes = 1024 ** 4,
    autoExpand = true
  } = {}) {
    this.storage = storage;
    this.maxStorageBytes = maxStorageBytes;
    this.autoExpand = autoExpand;

    this.index = new Map();
    this.initialized = false;
  }

  async init() {
    if (!this.storage) {
      throw new Error("Storage provider is required.");
    }

    if (typeof this.storage.init === "function") {
      await this.storage.init({
        maxBytes: this.maxStorageBytes,
        autoExpand: this.autoExpand
      });
    }

    this.initialized = true;
    return true;
  }

  async remember(data, metadata = {}) {
    await this.ensureReady();

    const record = {
      id: this.createId(),
      type: metadata.type || "memory",
      createdAt: Date.now(),

      // حفظ المحتوى الأصلي بالكامل
      original: data,

      metadata: {
        ...metadata
      }
    };

    await this.storage.write(
      record.id,
      record
    );

    this.indexRecord(record);

    await this.checkCapacity();

    return record.id;
  }

  async rememberConversation({
    sessionId,
    messages,
    metadata = {}
  }) {
    await this.ensureReady();

    if (!Array.isArray(messages)) {
      throw new Error(
        "Messages must be an array."
      );
    }

    return this.remember(
      {
        sessionId,
        messages: messages.map(message => ({
          ...message,
          // لا يتم اختصار الرسالة الأصلية
          content: message.content
        }))
      },
      {
        type: "conversation",
        sessionId,
        messageCount:
          messages.length,
        ...metadata
      }
    );
  }

  async get(id) {
    await this.ensureReady();

    return this.storage.read(id);
  }

  async getConversation(sessionId) {
    await this.ensureReady();

    const records =
      await this.storage.query({
        type: "conversation",
        sessionId
      });

    return records.sort(
      (a, b) =>
        a.createdAt - b.createdAt
    );
  }

  async searchMemory(
    query,
    limit = 20
  ) {
    await this.ensureReady();

    if (
      !query ||
      typeof query !== "string"
    ) {
      return [];
    }

    // البحث في السجل الكامل.
    // لا يتم استبدال النص الأصلي بملخص.
    const results =
      await this.storage.search({
        query,
        limit,
        exactContent: true
      });

    return results.map(record => ({
      ...record,

      // إرجاع الأصل كاملًا
      original: record.original
    }));
  }

  async getExactConversation(
    sessionId
  ) {
    const records =
      await this.getConversation(
        sessionId
      );

    return records.map(record => ({
      id: record.id,
      createdAt: record.createdAt,
      messages:
        record.original.messages
    }));
  }

  async getAllConversationData(
    sessionId
  ) {
    await this.ensureReady();

    const records =
      await this.getConversation(
        sessionId
      );

    return records.map(
      record => record.original
    );
  }

  async delete(id) {
    await this.ensureReady();

    await this.storage.delete(id);

    this.index.delete(id);

    return true;
  }

  async deleteConversation(
    sessionId
  ) {
    await this.ensureReady();

    const records =
      await this.getConversation(
        sessionId
      );

    for (const record of records) {
      await this.delete(record.id);
    }

    return records.length;
  }

  async getStorageInfo() {
    await this.ensureReady();

    if (
      typeof this.storage.getStorageInfo ===
      "function"
    ) {
      return this.storage.getStorageInfo();
    }

    return {
      configuredLimit:
        this.maxStorageBytes,

      configuredLimitGB:
        this.maxStorageBytes /
        1024 ** 3,

      configuredLimitTB:
        this.maxStorageBytes /
        1024 ** 4,

      autoExpand:
        this.autoExpand
    };
  }

  async checkCapacity() {
    if (
      typeof this.storage.getStorageInfo !==
      "function"
    ) {
      return;
    }

    const info =
      await this.storage.getStorageInfo();

    if (
      info.usedBytes >=
      info.maxBytes
    ) {
      if (
        this.autoExpand &&
        typeof this.storage.expand ===
          "function"
      ) {
        await this.storage.expand();
      }
    }
  }

  indexRecord(record) {
    const text =
      JSON.stringify(
        record.original
      ).toLowerCase();

    this.index.set(
      record.id,
      {
        id: record.id,
        text,
        createdAt:
          record.createdAt,
        type:
          record.type,
        sessionId:
          record.metadata?.sessionId
      }
    );
  }

  async exportConversation(
    sessionId
  ) {
    const conversation =
      await this.getExactConversation(
        sessionId
      );

    return JSON.stringify(
      conversation,
      null,
      2
    );
  }

  async exportAll() {
    await this.ensureReady();

    if (
      typeof this.storage.exportAll ===
      "function"
    ) {
      return this.storage.exportAll();
    }

    throw new Error(
      "Storage provider does not support full export."
    );
  }

  async ensureReady() {
    if (!this.initialized) {
      await this.init();
    }
  }

  createId() {
    return (
      "mem_" +
      Date.now().toString(36) +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 12)
    );
  }

  async clear() {
    await this.ensureReady();

    if (
      typeof this.storage.clear ===
      "function"
    ) {
      await this.storage.clear();
    }

    this.index.clear();
  }
}

export default EgoMemory;
export { EgoMemory };
