const db = require("../db/db");

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

const CATEGORY_INTENTS = [
  {
    category: "thong_tin",
    terms: ["thông tin", "gioi thieu", "la cay gi", "dac diem", "mo ta", "tong quan"],
  },
  {
    category: "benh",
    terms: ["bệnh", "benh", "sau benh", "nam", "vang la", "xoan la", "dom la", "thoi re", "rep", "bo tri"],
  },
  {
    category: "moi_truong",
    terms: ["moi truong", "dieu kien song", "sinh truong", "anh sang", "nhiet do", "do am", "ph", "dat"],
  },
  {
    category: "nguong",
    terms: ["nguong", "cam bien", "sensor", "lux", "bat tuoi", "bat quat", "phun mat", "dat kho", "vuon nong"],
  },
  {
    category: "cham_soc",
    terms: ["cham soc", "tuoi", "bon phan", "cat tia", "dinh duong", "gieo", "trong", "thu hoach"],
  },
].map((intent) => ({
  category: intent.category,
  terms: [intent.category, ...intent.terms].map(normalizeText).filter(Boolean),
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

function cleanOptionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

function cleanOptionalDate(value) {
  const text = cleanOptionalText(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function cleanBoolean(value) {
  if (value === true || value === 1) return 1;
  const text = normalizeText(value);
  return ["1", "true", "yes", "co", "da xac minh", "verified"].includes(text) ? 1 : 0;
}

function sourcePayload(payload = {}, fallbackSourceType = "custom") {
  const sourceType = cleanOptionalText(payload.source_type || payload.sourceType) || fallbackSourceType;
  const sourceUrl = cleanOptionalText(payload.source_url || payload.sourceUrl || payload.url);
  const sourceTitle = cleanOptionalText(payload.source_title || payload.sourceTitle || payload.source || payload.sourceName);
  const sourceAuthor = cleanOptionalText(payload.source_author || payload.sourceAuthor || payload.author);
  const sourceOrganization = cleanOptionalText(
    payload.source_organization || payload.sourceOrganization || payload.organization || payload.publisher
  );
  const sourcePublishedAt = cleanOptionalDate(payload.source_published_at || payload.sourcePublishedAt || payload.publishedAt);
  const isVerified = cleanBoolean(payload.is_verified || payload.isVerified || payload.verified);
  return {
    sourceType,
    sourceTitle,
    sourceUrl,
    sourceAuthor,
    sourceOrganization,
    sourcePublishedAt,
    sourceCheckedAt: isVerified ? new Date() : null,
    isVerified,
    verificationNote: cleanOptionalText(payload.verification_note || payload.verificationNote),
  };
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
      field_label VARCHAR(120) NULL,
      keywords TEXT NOT NULL,
      answer MEDIUMTEXT NOT NULL,
      suggestions TEXT NULL,
      source_type VARCHAR(40) NOT NULL DEFAULT 'custom',
      source_title VARCHAR(255) NULL,
      source_url TEXT NULL,
      source_author VARCHAR(180) NULL,
      source_organization VARCHAR(180) NULL,
      source_published_at DATE NULL,
      source_checked_at TIMESTAMP NULL,
      is_verified TINYINT(1) NOT NULL DEFAULT 0,
      verification_note TEXT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_chatbot_knowledge_topic_category (topic_normalized, category),
      KEY idx_chatbot_knowledge_topic (topic_normalized),
      KEY idx_chatbot_knowledge_category (category),
      KEY idx_chatbot_knowledge_verified (is_verified),
      KEY idx_chatbot_knowledge_active (is_active),
      KEY idx_chatbot_knowledge_updated (updated_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await modifyColumnIfPossible("chatbot_knowledge_entries", "source_type", "VARCHAR(40) NOT NULL DEFAULT 'custom'");
  await addColumnIfMissing("chatbot_knowledge_entries", "field_label", "VARCHAR(120) NULL");
  await addColumnIfMissing("chatbot_knowledge_entries", "source_title", "VARCHAR(255) NULL");
  await addColumnIfMissing("chatbot_knowledge_entries", "source_url", "TEXT NULL");
  await addColumnIfMissing("chatbot_knowledge_entries", "source_author", "VARCHAR(180) NULL");
  await addColumnIfMissing("chatbot_knowledge_entries", "source_organization", "VARCHAR(180) NULL");
  await addColumnIfMissing("chatbot_knowledge_entries", "source_published_at", "DATE NULL");
  await addColumnIfMissing("chatbot_knowledge_entries", "source_checked_at", "TIMESTAMP NULL");
  await addColumnIfMissing("chatbot_knowledge_entries", "is_verified", "TINYINT(1) NOT NULL DEFAULT 0");
  await addColumnIfMissing("chatbot_knowledge_entries", "verification_note", "TEXT NULL");
  await addColumnIfMissing("chatbot_knowledge_entries", "is_active", "TINYINT(1) NOT NULL DEFAULT 1");
}

async function getColumns(tableName) {
  const [rows] = await pool.query(`SHOW COLUMNS FROM ${tableName}`);
  return rows.map((row) => row.Field);
}

async function addColumnIfMissing(tableName, columnName, definition) {
  const columns = await getColumns(tableName);
  if (!columns.includes(columnName)) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function modifyColumnIfPossible(tableName, columnName, definition) {
  try {
    await pool.query(`ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} ${definition}`);
  } catch (err) {
    console.log(`Cannot modify ${tableName}.${columnName}:`, err.message);
  }
}

async function deleteAutoSeedEntries() {
  const [result] = await pool.query("DELETE FROM chatbot_knowledge_entries WHERE source_type = 'seed'");
  if (Number(result?.affectedRows || 0) > 0) invalidateKnowledgeCache();
}

async function migrateMainDiseaseEntries() {
  const [rows] = await pool.query("SELECT * FROM chatbot_knowledge_entries WHERE category = 'benh'");
  for (const row of rows) {
    await saveDiseaseTreatment({
      topic: row.topic,
      fieldLabel: row.field_label || row.category,
      keywords: row.keywords,
      answer: row.answer,
      suggestions: parseSuggestions(row.suggestions),
      source_type: row.source_type || "migrated_main",
      source_title: row.source_title,
      source_url: row.source_url,
      source_author: row.source_author,
      source_organization: row.source_organization,
      source_published_at: row.source_published_at,
      is_verified: row.is_verified,
      verification_note: row.verification_note,
    }, { skipExisting: false });
  }

  if (rows.length) {
    await pool.query("DELETE FROM chatbot_knowledge_entries WHERE category = 'benh'");
    invalidateKnowledgeCache();
  }
}

async function backfillDiseaseNormalizedNames() {
  try {
    const [rows] = await pool.query(
      "SELECT id, ten_cay FROM plant_disease_treatments WHERE ten_cay_normalized IS NULL OR ten_cay_normalized = ''"
    );
    for (const row of rows) {
      await pool.query("UPDATE plant_disease_treatments SET ten_cay_normalized = ? WHERE id = ?", [
        normalizeText(row.ten_cay),
        row.id,
      ]);
    }
  } catch (err) {
    console.log("Cannot backfill plant_disease_treatments.ten_cay_normalized:", err.message);
  }
}

async function ensureKnowledgeStore() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initSchema();
      await deleteAutoSeedEntries();
      await migrateMainDiseaseEntries();
      await backfillDiseaseNormalizedNames();
    })();
  }
  return readyPromise;
}

function rowToKnowledge(row, score = 0, matchedTerms = []) {
  return {
    id: row.id,
    topic: row.topic,
    category: row.category,
    fieldLabel: row.field_label || getKnowledgeCategoryLabel(row.category),
    keywords: row.keywords,
    answer: row.answer,
    suggestions: parseSuggestions(row.suggestions),
    score,
    matchedTerms,
    sourceType: row.source_type,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    sourceAuthor: row.source_author,
    sourceOrganization: row.source_organization,
    sourcePublishedAt: row.source_published_at,
    sourceCheckedAt: row.source_checked_at,
    isVerified: Boolean(row.is_verified),
    verificationNote: row.verification_note,
    source: {
      title: row.source_title || `MySQL: ${row.topic}`,
      source: row.source_organization || row.source_author || "MySQL noi bo",
      url: row.source_url || "",
    },
  };
}

function diseaseAnswer(row = {}) {
  return [
    `${row.ten_cay} - ${row.ten_benh}.`,
    row.trieu_chung ? `Triệu chứng: ${row.trieu_chung}` : "",
    row.nguyen_nhan ? `Nguyên nhân: ${row.nguyen_nhan}` : "",
    row.cach_chua ? `Cách chữa: ${row.cach_chua}` : "",
    row.phong_ngua ? `Phòng ngừa: ${row.phong_ngua}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function rowToDiseaseKnowledge(row, score = 0, matchedTerms = []) {
  const sourceAuthor = row.source_author || row.nguoi_dua_phac_do || "";
  const sourceOrganization = row.source_organization || row.chuc_danh_nguoi_dua || "";
  return {
    id: `disease-${row.id}`,
    topic: row.ten_cay,
    category: "benh",
    fieldLabel: row.ten_benh,
    keywords: row.tu_khoa || "",
    answer: diseaseAnswer(row),
    suggestions: [],
    score,
    matchedTerms,
    sourceType: "plant_disease_treatments",
    sourceTitle: row.source_title || row.nguon_phac_do || "",
    sourceUrl: row.source_url || "",
    sourceAuthor,
    sourceOrganization,
    sourcePublishedAt: row.source_published_at,
    sourceCheckedAt: row.source_checked_at || row.verified_at,
    isVerified: Boolean(row.is_verified),
    verificationNote: row.verification_note,
    source: {
      title: row.source_title || row.nguon_phac_do || `MySQL: ${row.ten_cay}`,
      source: sourceOrganization || sourceAuthor || "MySQL plant_disease_treatments",
      url: row.source_url || "",
    },
  };
}

function diseaseNameFromPayload(payload = {}) {
  const explicit = cleanOptionalText(payload.ten_benh || payload.diseaseName || payload.disease_name);
  if (explicit) return explicit;

  const label = cleanOptionalText(payload.fieldLabel || payload.field_label || payload.category);
  const normalized = normalizeText(label);
  if (!label || ["benh", "sau benh", "benh cay", "phong tri", "nam benh"].includes(normalized)) {
    return "Bệnh tổng hợp";
  }
  return label;
}

async function nextDiseaseSlot(plantName) {
  const [rows] = await pool.query(
    "SELECT benh_so FROM plant_disease_treatments WHERE ten_cay = ? ORDER BY benh_so",
    [plantName]
  );
  const used = new Set(rows.map((row) => Number(row.benh_so)));
  for (let slot = 1; slot <= 10; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  const err = new Error(`Cây "${plantName}" đã đủ 10 bệnh trong bảng plant_disease_treatments.`);
  err.statusCode = 400;
  throw err;
}

async function saveDiseaseTreatment(payload = {}, options = {}) {
  const plantName = cleanOptionalText(payload.ten_cay || payload.topic || payload.title);
  const answer = cleanOptionalText(payload.cach_chua || payload.answer || payload.content);
  if (!plantName || !answer) {
    const err = new Error("Cần có tên cây và nội dung bệnh/cách chữa để lưu vào plant_disease_treatments.");
    err.statusCode = 400;
    throw err;
  }

  const diseaseName = diseaseNameFromPayload(payload);
  const plantNameNormalized = normalizeText(plantName);
  const source = sourcePayload(payload, payload.source_type || payload.sourceType || "excel");
  const existingRows = await pool.query(
    "SELECT * FROM plant_disease_treatments WHERE ten_cay = ? AND ten_benh = ? LIMIT 1",
    [plantName, diseaseName]
  ).then(([rows]) => rows);

  if (options.skipExisting && existingRows.length) {
    return { skipped: true, created: false, updated: false, entry: rowToDiseaseKnowledge(existingRows[0], 0, []) };
  }

  const keywords = expandKnowledgeKeywords(plantName, "benh", [
    diseaseName,
    ...(Array.isArray(payload.keywords) ? payload.keywords : keywordList(payload.keywords)),
  ], answer).join("; ");

  if (!existingRows.length) {
    const slot = Number(payload.benh_so) || await nextDiseaseSlot(plantName);
    await pool.query(
      `INSERT INTO plant_disease_treatments
        (plant_id, ten_cay, ten_cay_normalized, benh_so, ten_benh, tu_khoa, trieu_chung, nguyen_nhan, cach_chua,
         phong_ngua, nguoi_dua_phac_do, chuc_danh_nguoi_dua, nguon_phac_do,
         source_title, source_url, source_author, source_organization, source_published_at,
         source_checked_at, is_verified, verified_at, verification_note, muc_do, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        payload.plant_id || null,
        plantName,
        plantNameNormalized,
        slot,
        diseaseName,
        keywords,
        cleanOptionalText(payload.trieu_chung || payload.symptoms),
        cleanOptionalText(payload.nguyen_nhan || payload.cause),
        answer,
        cleanOptionalText(payload.phong_ngua || payload.prevention),
        source.sourceAuthor,
        source.sourceOrganization,
        source.sourceTitle,
        source.sourceTitle,
        source.sourceUrl,
        source.sourceAuthor,
        source.sourceOrganization,
        source.sourcePublishedAt,
        source.sourceCheckedAt,
        source.isVerified,
        source.sourceCheckedAt,
        source.verificationNote,
        cleanOptionalText(payload.muc_do || payload.severity),
      ]
    );
    const [rows] = await pool.query(
      "SELECT * FROM plant_disease_treatments WHERE ten_cay = ? AND ten_benh = ? LIMIT 1",
      [plantName, diseaseName]
    );
    return { skipped: false, created: true, updated: false, entry: rowToDiseaseKnowledge(rows[0], 0, []) };
  }

  const existing = existingRows[0];
  await pool.query(
    `UPDATE plant_disease_treatments
     SET plant_id = ?,
         ten_cay_normalized = ?,
         tu_khoa = ?,
         trieu_chung = ?,
         nguyen_nhan = ?,
         cach_chua = ?,
         phong_ngua = ?,
         nguoi_dua_phac_do = ?,
         chuc_danh_nguoi_dua = ?,
         nguon_phac_do = ?,
         source_title = ?,
         source_url = ?,
         source_author = ?,
         source_organization = ?,
         source_published_at = ?,
         source_checked_at = ?,
         is_verified = ?,
         verified_at = ?,
         verification_note = ?,
         muc_do = ?,
         is_active = 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      payload.plant_id || existing.plant_id || null,
      plantNameNormalized,
      keywords,
      cleanOptionalText(payload.trieu_chung || payload.symptoms) || existing.trieu_chung,
      cleanOptionalText(payload.nguyen_nhan || payload.cause) || existing.nguyen_nhan,
      answer,
      cleanOptionalText(payload.phong_ngua || payload.prevention) || existing.phong_ngua,
      source.sourceAuthor,
      source.sourceOrganization,
      source.sourceTitle,
      source.sourceTitle,
      source.sourceUrl,
      source.sourceAuthor,
      source.sourceOrganization,
      source.sourcePublishedAt,
      source.sourceCheckedAt,
      source.isVerified,
      source.sourceCheckedAt,
      source.verificationNote,
      cleanOptionalText(payload.muc_do || payload.severity) || existing.muc_do,
      existing.id,
    ]
  );
  const [rows] = await pool.query("SELECT * FROM plant_disease_treatments WHERE id = ? LIMIT 1", [existing.id]);
  return { skipped: false, created: false, updated: true, entry: rowToDiseaseKnowledge(rows[0], 0, []) };
}

async function insertDiseaseIfMissing(payload = {}) {
  await ensureKnowledgeStore();
  return saveDiseaseTreatment(payload, { skipExisting: true });
}

async function updateDiseaseFromExcel(payload = {}) {
  await ensureKnowledgeStore();
  return saveDiseaseTreatment(payload, { skipExisting: false });
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
      "SELECT * FROM chatbot_knowledge_entries WHERE is_active = 1 AND source_type <> 'seed' AND category <> 'benh' ORDER BY updated_at DESC, id DESC LIMIT ?",
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

function scoreDiseaseRow(row, question, terms) {
  const normalizedQuestion = normalizeText(question);
  const fields = [
    row.ten_cay,
    row.ten_benh,
    row.tu_khoa,
    row.trieu_chung,
    row.nguyen_nhan,
    row.cach_chua,
    row.phong_ngua,
  ].map(normalizeText);
  const matchedTerms = [];
  let score = 0;

  if (fields[0] && containsSearchTerm(normalizedQuestion, fields[0])) score += 30;
  if (fields[1] && containsSearchTerm(normalizedQuestion, fields[1])) score += 28;

  terms.forEach((term) => {
    let matched = false;
    fields.forEach((field, index) => {
      if (!containsSearchTerm(field, term)) return;
      score += index <= 1 ? 8 : index === 2 ? 5 : 2;
      matched = true;
    });
    if (matched) matchedTerms.push(term);
  });

  if (normalizeText(row.is_verified) === "1" || Number(row.is_verified) === 1) score += 3;
  return { score, matchedTerms: Array.from(new Set(matchedTerms)) };
}

async function searchDiseaseTreatments(question, terms, limit = 5) {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM plant_disease_treatments WHERE is_active = 1 ORDER BY updated_at DESC, id DESC LIMIT ?",
      [KNOWLEDGE_CACHE_LIMIT]
    );
    return rows
      .map((row) => {
        const rowScore = scoreDiseaseRow(row, question, terms);
        return rowToDiseaseKnowledge(row, rowScore.score, rowScore.matchedTerms);
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Number(limit) || 5));
  } catch (err) {
    console.log("Cannot search plant_disease_treatments:", err.message);
    return [];
  }
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
  const diseaseMatches = await searchDiseaseTreatments(q, terms, limit);
  if (desiredCategory === "benh" && diseaseMatches.length) {
    return diseaseMatches.slice(0, Math.max(1, Number(limit) || 5));
  }

  return scored
    .filter((item) => item.score >= minScore)
    .concat(diseaseMatches)
    .sort((a, b) => b.score - a.score || String(a.topic).localeCompare(String(b.topic), "vi"))
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
  if (category === "benh") {
    return (await saveDiseaseTreatment({ ...payload, topic, answer }, { skipExisting: false })).entry;
  }
  const keywords = expandKnowledgeKeywords(topic, category, payload.keywords || topic, answer);
  const topicNormalized = normalizeText(topic);
  const fieldLabel = cleanOptionalText(payload.fieldLabel || payload.field_label) || getKnowledgeCategoryLabel(category);
  const source = sourcePayload(payload, "custom");

  await pool.query(
    `INSERT INTO chatbot_knowledge_entries
      (topic, topic_normalized, category, field_label, keywords, answer, suggestions,
       source_type, source_title, source_url, source_author, source_organization,
       source_published_at, source_checked_at, is_verified, verification_note, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE
      topic = VALUES(topic),
      field_label = VALUES(field_label),
      keywords = VALUES(keywords),
      answer = VALUES(answer),
      suggestions = VALUES(suggestions),
      source_type = VALUES(source_type),
      source_title = VALUES(source_title),
      source_url = VALUES(source_url),
      source_author = VALUES(source_author),
      source_organization = VALUES(source_organization),
      source_published_at = VALUES(source_published_at),
      source_checked_at = VALUES(source_checked_at),
      is_verified = VALUES(is_verified),
      verification_note = VALUES(verification_note),
      is_active = 1,
      updated_at = CURRENT_TIMESTAMP`,
    [
      topic,
      topicNormalized,
      category,
      fieldLabel,
      keywords.join("; "),
      answer,
      serializeSuggestions(payload.suggestions),
      source.sourceType,
      source.sourceTitle,
      source.sourceUrl,
      source.sourceAuthor,
      source.sourceOrganization,
      source.sourcePublishedAt,
      source.sourceCheckedAt,
      source.isVerified,
      source.verificationNote,
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
  if (category === "benh") {
    const result = await saveDiseaseTreatment({ ...payload, topic, answer }, { skipExisting: false });
    return {
      created: Boolean(result.created),
      updated: Boolean(result.updated),
      unchanged: Boolean(result.skipped),
      entry: result.entry,
    };
  }
  const keywords = expandKnowledgeKeywords(topic, category, payload.keywords || topic, answer);
  const topicNormalized = normalizeText(topic);
  const fieldLabel = cleanOptionalText(payload.fieldLabel || payload.field_label) || getKnowledgeCategoryLabel(category);
  const source = sourcePayload(payload, "excel_edit");

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
      fieldLabel,
      source_type: source.sourceType,
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
    String(existing.field_label || "").trim() === fieldLabel &&
    String(existing.answer || "").trim() === answer &&
    String(existing.keywords || "").trim() === nextKeywords &&
    String(existing.suggestions || "").trim() === nextSuggestions &&
    String(existing.source_type || "").trim() === source.sourceType &&
    String(existing.source_title || "").trim() === String(source.sourceTitle || "") &&
    String(existing.source_url || "").trim() === String(source.sourceUrl || "") &&
    String(existing.source_author || "").trim() === String(source.sourceAuthor || "") &&
    String(existing.source_organization || "").trim() === String(source.sourceOrganization || "") &&
    Number(existing.is_verified || 0) === Number(source.isVerified || 0);

  if (!unchanged) {
    await pool.query(
      `UPDATE chatbot_knowledge_entries
       SET topic = ?,
           field_label = ?,
           keywords = ?,
           answer = ?,
           suggestions = ?,
           source_type = ?,
           source_title = ?,
           source_url = ?,
           source_author = ?,
           source_organization = ?,
           source_published_at = ?,
           source_checked_at = ?,
           is_verified = ?,
           verification_note = ?,
           is_active = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        topic,
        fieldLabel,
        nextKeywords,
        answer,
        nextSuggestions,
        source.sourceType,
        source.sourceTitle,
        source.sourceUrl,
        source.sourceAuthor,
        source.sourceOrganization,
        source.sourcePublishedAt,
        source.sourceCheckedAt,
        source.isVerified,
        source.verificationNote,
        existing.id,
      ]
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
  if (category === "benh") {
    return saveDiseaseTreatment({ ...payload, topic, answer }, { skipExisting: true });
  }
  const keywords = expandKnowledgeKeywords(topic, category, payload.keywords || topic, answer);
  const topicNormalized = normalizeText(topic);
  const fieldLabel = cleanOptionalText(payload.fieldLabel || payload.field_label) || getKnowledgeCategoryLabel(category);
  const source = sourcePayload(payload, "custom");

  const [result] = await pool.query(
    `INSERT IGNORE INTO chatbot_knowledge_entries
      (topic, topic_normalized, category, field_label, keywords, answer, suggestions,
       source_type, source_title, source_url, source_author, source_organization,
       source_published_at, source_checked_at, is_verified, verification_note, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
    [
      topic,
      topicNormalized,
      category,
      fieldLabel,
      keywords.join("; "),
      answer,
      serializeSuggestions(payload.suggestions),
      source.sourceType,
      source.sourceTitle,
      source.sourceUrl,
      source.sourceAuthor,
      source.sourceOrganization,
      source.sourcePublishedAt,
      source.sourceCheckedAt,
      source.isVerified,
      source.verificationNote,
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
  const [rows] = await pool.query(`
    SELECT
      COUNT(*) AS count,
      SUM(is_active = 1) AS active_count,
      SUM(is_verified = 1 AND is_active = 1) AS verified_count,
      SUM(is_verified = 0 AND is_active = 1) AS unverified_count
    FROM chatbot_knowledge_entries
    WHERE source_type <> 'seed' AND category <> 'benh'
  `);
  let diseaseRows = [{ count: 0, verified_count: 0 }];
  try {
    [diseaseRows] = await pool.query(`
      SELECT COUNT(*) AS count, SUM(is_verified = 1 AND is_active = 1) AS verified_count
      FROM plant_disease_treatments
      WHERE is_active = 1
    `);
  } catch (err) {
    console.log("Cannot read plant_disease_treatments status:", err.message);
  }
  return {
    configured: true,
    provider: "MySQL knowledge",
    table: "chatbot_knowledge_entries",
    diseaseTable: "plant_disease_treatments",
    entries: Number(rows[0]?.count) || 0,
    activeEntries: Number(rows[0]?.active_count) || 0,
    verifiedEntries: Number(rows[0]?.verified_count) || 0,
    unverifiedEntries: Number(rows[0]?.unverified_count) || 0,
    diseaseEntries: Number(diseaseRows[0]?.count) || 0,
    verifiedDiseaseEntries: Number(diseaseRows[0]?.verified_count) || 0,
  };
}

module.exports = {
  normalizeText,
  extractSearchTerms,
  expandKnowledgeKeywords,
  getKnowledgeCategoryLabel,
  searchKnowledge,
  splitKnowledgeBullets,
  insertDiseaseIfMissing,
  insertKnowledgeIfMissing,
  listKnowledgeEntries,
  updateDiseaseFromExcel,
  updateKnowledgeFromExcel,
  upsertKnowledge,
  warmKnowledgeCache,
  getKnowledgeStatus,
};
