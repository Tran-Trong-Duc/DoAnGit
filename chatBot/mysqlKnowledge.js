const db = require("../db/db");
const { buildDefaultPlantKnowledge, CATEGORY_CONFIGS } = require("./defaultPlantKnowledge");

const pool = db.promise();
const KNOWLEDGE_CACHE_TTL_MS = 30000;
const KNOWLEDGE_CACHE_LIMIT = 20000;

const STOP_WORDS = new Set([
  "cay", "trong", "la", "thi", "nen", "lam", "gi", "nhu", "the", "nao", "cho", "voi",
  "cua", "va", "hay", "neu", "khi", "bi", "co", "khong", "duoc", "can", "hoi", "tra",
  "loi", "thong", "tin", "ve", "toi", "minh", "nay", "do", "mot", "cac", "kiem",
  "du", "lieu", "noi", "bo", "he", "thong", "vuon",
]);

const IMPORTANT_SHORT_TERMS = new Set(["ot", "ph"]);

const CATEGORY_LABELS = {
  thong_tin: "thông tin",
  benh: "bệnh",
  moi_truong: "môi trường sống",
  nguong: "ngưỡng cảm biến",
  cham_soc: "chăm sóc",
  plant: "thông tin",
  disease: "bệnh",
  care: "chăm sóc",
  threshold: "ngưỡng cảm biến",
  soil: "đất và pH",
  fertilizer: "bón phân",
  excel: "dữ liệu nạp",
  word: "dữ liệu nạp",
  dat: "đất",
  tuoi_nuoc: "tưới nước",
  phan_bon: "phân bón",
  anh_sang: "ánh sáng",
  nhiet_do: "nhiệt độ",
  do_am: "độ ẩm",
  ph: "pH",
  custom: "dữ liệu nạp",
};

const CATEGORY_KEYWORD_BANK = {
  thong_tin: ["thông tin", "giới thiệu", "đặc điểm", "là cây gì", "thu hoạch", "quả", "lá", "mô tả", "nguồn gốc"],
  benh: ["bệnh", "sâu bệnh", "vàng lá", "xoăn lá", "đốm lá", "thối rễ", "rệp", "bọ trĩ", "nấm", "phòng trị", "héo"],
  moi_truong: ["môi trường", "điều kiện sống", "ánh sáng", "nhiệt độ", "độ ẩm", "pH", "đất", "giá thể", "nắng", "thoát nước"],
  nguong: ["ngưỡng", "cảm biến", "sensor", "độ ẩm đất", "nhiệt độ", "ánh sáng", "lux", "bật tưới", "bật quạt", "đất khô", "vườn nóng"],
  cham_soc: ["chăm sóc", "tưới nước", "bón phân", "cắt tỉa", "dinh dưỡng", "kali", "đạm", "gieo trồng", "ra hoa", "thu hoạch"],
  soil: ["đất", "pH", "tơi xốp", "thoát nước", "giá thể", "đất bí", "đất khô"],
  fertilizer: ["phân", "bón phân", "NPK", "dinh dưỡng", "kali", "đạm", "canxi"],
  custom: ["dữ liệu nạp", "tri thức nội bộ", "thông tin nội bộ"],
  excel: ["dữ liệu Excel", "tri thức nội bộ", "thông tin đã nạp"],
  word: ["dữ liệu nạp", "tri thức nội bộ", "thông tin đã nạp"],
  dat: ["đất", "loại đất", "đất trồng", "pH", "tơi xốp", "thoát nước", "đất khô", "đất úng", "giá thể"],
  tuoi_nuoc: ["tưới", "tưới nước", "bật tưới", "lịch tưới", "độ ẩm đất", "đất khô", "nước"],
  phan_bon: ["phân", "phân bón", "bón phân", "dinh dưỡng", "NPK", "đạm", "kali", "canxi"],
  anh_sang: ["ánh sáng", "nắng", "lux", "thiếu sáng", "nắng gắt", "che nắng"],
  nhiet_do: ["nhiệt độ", "nóng", "lạnh", "vườn nóng", "bị nóng", "bật quạt", "phun mát"],
  do_am: ["độ ẩm", "ẩm", "khô", "độ ẩm đất", "độ ẩm không khí", "bí khí"],
  ph: ["pH", "độ pH", "đất chua", "đất kiềm", "trung tính"],
};

const DEFAULT_ENTRIES = buildDefaultPlantKnowledge().map((entry) => ({
  ...entry,
  source_type: "seed",
}));

const CATEGORY_INTENTS = CATEGORY_CONFIGS.map((config) => ({
  category: config.category,
  terms: [config.label, config.category, ...(config.intent || [])].map(normalizeText).filter(Boolean),
}));

const CATEGORY_STRONG_INTENTS = [
  {
    category: "benh",
    terms: ["benh", "sau", "nam", "rep", "bo tri", "vang la", "xoan la", "la xoan", "xoan", "dom la", "thoi re", "heo"],
  },
  {
    category: "moi_truong",
    terms: ["moi truong", "dieu kien song", "dieu kien", "sinh truong", "gia the", "thoat nuoc"],
  },
  {
    category: "nguong",
    terms: ["nguong", "cam bien", "sensor", "bat tuoi", "bat quat", "phun mat", "dat kho", "vuon nong", "bi nong", "tuoi"],
  },
  {
    category: "cham_soc",
    terms: ["cham soc", "bon phan", "cat tia", "gieo", "trong", "dinh duong", "kali", "dam", "thu hoach"],
  },
  {
    category: "thong_tin",
    terms: ["la cay gi", "gioi thieu", "dac diem", "thong tin", "mo ta"],
  },
].map((intent) => ({
  category: intent.category,
  terms: intent.terms.map(normalizeText).filter(Boolean),
}));

let readyPromise = null;
let knowledgeRowsCache = {
  rows: null,
  expiresAt: 0,
  loading: null,
};

function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSearchTerms(text = "") {
  return normalizeText(text)
    .split(" ")
    .filter((term) => (term.length > 2 || IMPORTANT_SHORT_TERMS.has(term)) && !STOP_WORDS.has(term));
}

function escapeRegExp(text = "") {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsSearchTerm(haystack = "", term = "") {
  if (!haystack || !term) return false;
  if (IMPORTANT_SHORT_TERMS.has(term)) {
    return new RegExp(`(^|\\s)${escapeRegExp(term)}(\\s|$)`).test(haystack);
  }
  return haystack.includes(term);
}

function uniqueKeywords(items = [], min = 10, max = 20) {
  const seen = new Set();
  const output = [];

  items.forEach((item) => {
    const value = String(item || "").trim();
    const key = normalizeText(value);
    if (!value || !key || seen.has(key)) return;
    seen.add(key);
    output.push(value);
  });

  return output.slice(0, Math.max(min, Math.min(max, output.length || max)));
}

function serializeSuggestions(suggestions) {
  if (Array.isArray(suggestions)) {
    return JSON.stringify(suggestions.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6));
  }
  if (typeof suggestions === "string" && suggestions.trim()) {
    try {
      const parsed = JSON.parse(suggestions);
      if (Array.isArray(parsed)) return serializeSuggestions(parsed);
    } catch {
      return JSON.stringify([suggestions.trim()]);
    }
  }
  return "[]";
}

function parseSuggestions(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function keywordList(value = "") {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function expandKnowledgeKeywords(topic = "", category = "custom", keywords = [], answer = "") {
  const topicText = String(topic || "").trim();
  const categoryText = String(category || "custom").trim() || "custom";
  const categoryLabel = CATEGORY_LABELS[categoryText] || categoryText.replace(/_/g, " ");
  const topicNoAccent = normalizeText(topicText);
  const labelNoAccent = normalizeText(categoryLabel);
  const bank = CATEGORY_KEYWORD_BANK[categoryText] || CATEGORY_KEYWORD_BANK.custom;
  const answerTerms = extractSearchTerms(answer).slice(0, 10);

  const expanded = uniqueKeywords([
    ...keywordList(keywords),
    topicText,
    topicNoAccent,
    topicText ? `cây ${topicText}` : "",
    topicNoAccent ? `cay ${topicNoAccent}` : "",
    categoryLabel,
    labelNoAccent,
    topicText && categoryLabel ? `${topicText} ${categoryLabel}` : "",
    topicNoAccent && labelNoAccent ? `${topicNoAccent} ${labelNoAccent}` : "",
    ...bank,
    ...bank.map(normalizeText),
    ...answerTerms,
  ], 10, 20);

  if (expanded.length >= 10) return expanded;

  return uniqueKeywords([
    ...expanded,
    "cây trồng",
    "smart garden",
    "điều kiện sống",
    "chăm sóc",
    "ngưỡng cảm biến",
    "dữ liệu nội bộ",
  ], 10, 20);
}

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chatbot_knowledge_entries (
      id INT NOT NULL AUTO_INCREMENT,
      topic VARCHAR(180) NOT NULL,
      topic_normalized VARCHAR(180) NOT NULL,
      category VARCHAR(64) NOT NULL DEFAULT 'custom',
      keywords TEXT NOT NULL,
      answer MEDIUMTEXT NOT NULL,
      suggestions TEXT NULL,
      source_type VARCHAR(40) NOT NULL DEFAULT 'seed',
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_chatbot_knowledge_topic_category (topic_normalized, category),
      KEY idx_chatbot_knowledge_topic (topic_normalized),
      KEY idx_chatbot_knowledge_category (category),
      KEY idx_chatbot_knowledge_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function seedDefaultEntries() {
  const sql = `
    INSERT IGNORE INTO chatbot_knowledge_entries
      (topic, topic_normalized, category, keywords, answer, suggestions, source_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  for (const entry of DEFAULT_ENTRIES) {
    const category = entry.category || "custom";
    const keywords = expandKnowledgeKeywords(entry.topic, category, entry.keywords, entry.answer);
    await pool.query(sql, [
      entry.topic,
      normalizeText(entry.topic),
      category,
      keywords.join("; "),
      entry.answer,
      serializeSuggestions(entry.suggestions),
      entry.source_type || "seed",
    ]);
  }
}

async function ensureKnowledgeStore() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initSchema();
      await seedDefaultEntries();
    })();
  }
  return readyPromise;
}

function rowToKnowledge(row, score = 0, matchedTerms = []) {
  return {
    id: row.id,
    topic: row.topic,
    category: row.category,
    keywords: row.keywords,
    answer: row.answer,
    suggestions: parseSuggestions(row.suggestions),
    score,
    matchedTerms,
    sourceType: row.source_type,
    source: {
      title: `MySQL: ${row.topic}`,
      source: "MySQL nội bộ",
      url: "",
    },
  };
}

function scoreTopic(row, question, terms) {
  const normalizedQuestion = normalizeText(question);
  const normalizedTopic = normalizeText(row.topic);
  const normalizedKeywords = normalizeText(row.keywords);
  const topicParts = normalizedTopic.split(" ").filter((part) => part && !STOP_WORDS.has(part));
  let score = 0;

  if (normalizedTopic && containsSearchTerm(normalizedQuestion, normalizedTopic)) score += normalizedTopic.includes(" ") ? 34 : 28;
  if (topicParts.length && topicParts.every((part) => terms.includes(part))) score += 18 + topicParts.length * 2;

  terms.forEach((term) => {
    if (containsSearchTerm(normalizedTopic, term)) score += 10;
    if (containsSearchTerm(normalizedKeywords, `${normalizedTopic} ${term}`)) score += 4;
  });

  keywordList(row.keywords).forEach((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    if (!normalizedKeyword) return;
    if (containsSearchTerm(normalizedQuestion, normalizedKeyword)) {
      score += normalizedKeyword.includes(" ") ? 8 : 3;
    }
  });

  return score;
}

function scoreRow(row, question, terms) {
  const normalizedTopic = normalizeText(row.topic);
  const normalizedCategory = normalizeText(row.category);
  const normalizedKeywords = normalizeText(row.keywords);
  const normalizedAnswer = normalizeText(row.answer);
  const normalizedQuestion = normalizeText(question);
  const matchedTerms = [];

  let score = 0;
  if (normalizedTopic && terms.includes(normalizedTopic)) score += 20;
  if (normalizedQuestion && normalizedTopic && containsSearchTerm(normalizedQuestion, normalizedTopic)) score += 12;
  if (normalizedQuestion && normalizedKeywords.includes(normalizedQuestion)) score += 8;
  if (normalizedCategory && terms.includes(normalizedCategory)) score += 30;

  const categoryParts = normalizedCategory.split(" ").filter((part) => part && !STOP_WORDS.has(part));
  if (categoryParts.length > 1 && categoryParts.every((part) => terms.includes(part))) {
    score += 22;
  }

  terms.forEach((term) => {
    let matched = false;
    if (containsSearchTerm(normalizedTopic, term)) {
      score += 7;
      matched = true;
    }
    if (containsSearchTerm(normalizedKeywords, term)) {
      score += 4;
      matched = true;
    }
    if (containsSearchTerm(normalizedCategory, term)) {
      score += 2;
      matched = true;
    }
    if (containsSearchTerm(normalizedAnswer, term)) {
      score += 1;
      matched = true;
    }
    if (matched) matchedTerms.push(term);
  });

  keywordList(row.keywords).forEach((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    if (normalizedKeyword && terms.includes(normalizedKeyword)) {
      score += normalizedKeyword.includes(" ") ? 12 : 8;
    }
    if (normalizedKeyword && normalizedKeyword.includes(" ") && containsSearchTerm(normalizedQuestion, normalizedKeyword)) {
      score += 18;
    }
  });

  return { score, matchedTerms: Array.from(new Set(matchedTerms)) };
}

function detectCategoryIntent(question = "", terms = []) {
  const normalizedQuestion = normalizeText(question);
  let best = { category: "", score: 0 };

  CATEGORY_STRONG_INTENTS.forEach((intent) => {
    let score = 0;
    intent.terms.forEach((term) => {
      if (!term || (term.length <= 2 && !IMPORTANT_SHORT_TERMS.has(term))) return;
      if (containsSearchTerm(normalizedQuestion, term)) score += term.includes(" ") ? 12 : 8;
      if (terms.includes(term)) score += 5;
    });
    if (score > best.score) best = { category: intent.category, score };
  });

  CATEGORY_INTENTS.forEach((intent) => {
    let score = 0;
    intent.terms.forEach((term) => {
      if (!term || (term.length <= 2 && !IMPORTANT_SHORT_TERMS.has(term))) return;
      if (containsSearchTerm(normalizedQuestion, term)) score += term.includes(" ") ? 7 : 3;
      if (terms.includes(term)) score += 2;
      if (term.includes(" ")) {
        term.split(" ").forEach((part) => {
          if (part.length > 2 && terms.includes(part)) score += 2;
        });
      }
    });
    if (score > best.score) best = { category: intent.category, score };
  });

  return best.score > 0 ? best.category : "";
}

function getTopicScores(rows = [], question = "", terms = []) {
  const topicScores = new Map();
  rows.forEach((row) => {
    const key = normalizeText(row.topic);
    if (!key) return;
    const current = topicScores.get(key) || { topic: row.topic, score: 0, rows: 0 };
    current.score += scoreTopic(row, question, terms);
    current.rows += 1;
    topicScores.set(key, current);
  });
  return [...topicScores.values()].sort((a, b) => b.score - a.score || b.rows - a.rows);
}

function invalidateKnowledgeCache() {
  knowledgeRowsCache = {
    rows: null,
    expiresAt: 0,
    loading: null,
  };
}

async function loadKnowledgeRows(force = false) {
  const now = Date.now();
  if (!force && knowledgeRowsCache.rows && knowledgeRowsCache.expiresAt > now) {
    return knowledgeRowsCache.rows;
  }

  if (!force && knowledgeRowsCache.loading) {
    return knowledgeRowsCache.loading;
  }

  knowledgeRowsCache.loading = (async () => {
    const [rows] = await pool.query(
      "SELECT * FROM chatbot_knowledge_entries ORDER BY updated_at DESC, id DESC LIMIT ?",
      [KNOWLEDGE_CACHE_LIMIT]
    );
    knowledgeRowsCache = {
      rows,
      expiresAt: Date.now() + KNOWLEDGE_CACHE_TTL_MS,
      loading: null,
    };
    return rows;
  })().catch((err) => {
    knowledgeRowsCache.loading = null;
    throw err;
  });

  return knowledgeRowsCache.loading;
}

async function warmKnowledgeCache() {
  await ensureKnowledgeStore();
  await loadKnowledgeRows(true);
  return true;
}

async function searchKnowledge(question, limit = 5) {
  const q = String(question || "").trim();
  const terms = extractSearchTerms(q);
  if (!q || !terms.length) return [];

  await ensureKnowledgeStore();
  const rows = await loadKnowledgeRows();

  const topicScores = getTopicScores(rows, q, terms);
  const bestTopic = topicScores[0];
  const secondTopic = topicScores[1];
  const hasPrimaryTopic =
    bestTopic &&
    bestTopic.score >= 12 &&
    (!secondTopic || bestTopic.score >= secondTopic.score * 1.2 || bestTopic.score - secondTopic.score >= 8);

  const desiredCategory = detectCategoryIntent(q, terms);
  const bestTopicKey = hasPrimaryTopic ? normalizeText(bestTopic.topic) : "";

  let scored = rows
    .filter((row) => !bestTopicKey || normalizeText(row.topic) === bestTopicKey)
    .map((row) => {
      const rowScore = scoreRow(row, q, terms);
      const categoryBoost = desiredCategory && row.category === desiredCategory ? 18 : 0;
      const defaultInfoBoost = !desiredCategory && ["thong_tin", "plant"].includes(row.category) ? 4 : 0;
      const topicBoost = bestTopicKey && normalizeText(row.topic) === bestTopicKey ? 16 : 0;
      return rowToKnowledge(row, rowScore.score + categoryBoost + defaultInfoBoost + topicBoost, rowScore.matchedTerms);
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.topic.localeCompare(b.topic, "vi"));

  const topScore = scored[0]?.score || 0;
  const minScore = topScore >= 14 ? Math.max(8, Math.ceil(topScore * 0.3)) : 2;

  return scored
    .filter((item) => item.score >= minScore)
    .slice(0, Math.max(1, Number(limit) || 5));
}

function getKnowledgeCategoryLabel(category = "") {
  return CATEGORY_LABELS[category] || String(category || "thông tin").replace(/_/g, " ");
}

function splitKnowledgeBullets(answer = "", maxBullets = 5) {
  return String(answer || "")
    .split(/\n+|(?:^|\s)-\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxBullets);
}

async function upsertKnowledge(payload = {}) {
  const topic = String(payload.topic || payload.title || "").trim();
  const answer = String(payload.answer || payload.content || "").trim();
  if (!topic || !answer) {
    const err = new Error("Cần có topic/title và answer/content để nạp vào tri thức MySQL.");
    err.statusCode = 400;
    throw err;
  }

  await ensureKnowledgeStore();

  const category = String(payload.category || "custom").trim() || "custom";
  const keywords = expandKnowledgeKeywords(topic, category, payload.keywords || topic, answer);
  const topicNormalized = normalizeText(topic);

  await pool.query(
    `INSERT INTO chatbot_knowledge_entries
      (topic, topic_normalized, category, keywords, answer, suggestions, source_type, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE
      topic = VALUES(topic),
      keywords = VALUES(keywords),
      answer = VALUES(answer),
      suggestions = VALUES(suggestions),
      source_type = VALUES(source_type),
      updated_at = CURRENT_TIMESTAMP`,
    [
      topic,
      topicNormalized,
      category,
      keywords.join("; "),
      answer,
      serializeSuggestions(payload.suggestions),
      payload.source_type || payload.sourceType || "custom",
    ]
  );
  invalidateKnowledgeCache();

  const [rows] = await pool.query(
    "SELECT * FROM chatbot_knowledge_entries WHERE topic_normalized = ? AND category = ? LIMIT 1",
    [topicNormalized, category]
  );
  return rowToKnowledge(rows[0], 0, []);
}

async function updateKnowledgeFromExcel(payload = {}) {
  const topic = String(payload.topic || payload.title || "").trim();
  const answer = String(payload.answer || payload.content || "").trim();
  if (!topic || !answer) {
    const err = new Error("Cần có topic/title và answer/content để sửa nguồn chat.");
    err.statusCode = 400;
    throw err;
  }

  await ensureKnowledgeStore();

  const category = String(payload.category || "custom").trim() || "custom";
  const keywords = expandKnowledgeKeywords(topic, category, payload.keywords || topic, answer);
  const topicNormalized = normalizeText(topic);
  const sourceType = payload.source_type || payload.sourceType || "excel_edit";

  const [existingRows] = await pool.query(
    "SELECT * FROM chatbot_knowledge_entries WHERE topic_normalized = ? AND category = ? LIMIT 1",
    [topicNormalized, category]
  );

  if (!existingRows.length) {
    const inserted = await insertKnowledgeIfMissing({
      ...payload,
      topic,
      answer,
      category,
      keywords,
      source_type: sourceType,
    });
    return {
      created: true,
      updated: false,
      unchanged: false,
      entry: inserted.entry,
    };
  }

  const existing = existingRows[0];
  const nextKeywords = keywords.join("; ");
  const nextSuggestions = serializeSuggestions(payload.suggestions);
  const unchanged =
    String(existing.topic || "").trim() === topic &&
    String(existing.answer || "").trim() === answer &&
    String(existing.keywords || "").trim() === nextKeywords &&
    String(existing.suggestions || "").trim() === nextSuggestions;

  if (!unchanged) {
    await pool.query(
      `UPDATE chatbot_knowledge_entries
       SET topic = ?,
           keywords = ?,
           answer = ?,
           suggestions = ?,
           source_type = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [topic, nextKeywords, answer, nextSuggestions, sourceType, existing.id]
    );
    invalidateKnowledgeCache();
  }

  const [rows] = await pool.query(
    "SELECT * FROM chatbot_knowledge_entries WHERE topic_normalized = ? AND category = ? LIMIT 1",
    [topicNormalized, category]
  );

  return {
    created: false,
    updated: !unchanged,
    unchanged,
    entry: rowToKnowledge(rows[0], 0, []),
  };
}

async function insertKnowledgeIfMissing(payload = {}) {
  const topic = String(payload.topic || payload.title || "").trim();
  const answer = String(payload.answer || payload.content || "").trim();
  if (!topic || !answer) {
    const err = new Error("Cần có topic/title và answer/content để nạp vào tri thức MySQL.");
    err.statusCode = 400;
    throw err;
  }

  await ensureKnowledgeStore();

  const category = String(payload.category || "custom").trim() || "custom";
  const keywords = expandKnowledgeKeywords(topic, category, payload.keywords || topic, answer);
  const topicNormalized = normalizeText(topic);

  const [result] = await pool.query(
    `INSERT IGNORE INTO chatbot_knowledge_entries
      (topic, topic_normalized, category, keywords, answer, suggestions, source_type, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      topic,
      topicNormalized,
      category,
      keywords.join("; "),
      answer,
      serializeSuggestions(payload.suggestions),
      payload.source_type || payload.sourceType || "custom",
    ]
  );
  if (Number(result?.affectedRows || 0) > 0) invalidateKnowledgeCache();

  const [rows] = await pool.query(
    "SELECT * FROM chatbot_knowledge_entries WHERE topic_normalized = ? AND category = ? LIMIT 1",
    [topicNormalized, category]
  );

  return {
    skipped: Number(result?.affectedRows || 0) === 0,
    entry: rowToKnowledge(rows[0], 0, []),
  };
}

async function listKnowledgeEntries(limit = KNOWLEDGE_CACHE_LIMIT) {
  await ensureKnowledgeStore();
  const safeLimit = Math.max(1, Math.min(Number(limit) || KNOWLEDGE_CACHE_LIMIT, KNOWLEDGE_CACHE_LIMIT));
  const rows = await loadKnowledgeRows(true);
  return rows.slice(0, safeLimit);
}

async function getKnowledgeStatus() {
  await ensureKnowledgeStore();
  const [rows] = await pool.query("SELECT COUNT(*) AS count FROM chatbot_knowledge_entries");
  return {
    configured: true,
    provider: "MySQL knowledge",
    table: "chatbot_knowledge_entries",
    entries: Number(rows[0]?.count) || 0,
  };
}

module.exports = {
  normalizeText,
  extractSearchTerms,
  expandKnowledgeKeywords,
  getKnowledgeCategoryLabel,
  searchKnowledge,
  splitKnowledgeBullets,
  insertKnowledgeIfMissing,
  listKnowledgeEntries,
  updateKnowledgeFromExcel,
  upsertKnowledge,
  warmKnowledgeCache,
  getKnowledgeStatus,
};
