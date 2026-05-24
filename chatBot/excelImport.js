const ExcelJS = require("exceljs");
const {
  insertDiseaseIfMissing,
  insertKnowledgeIfMissing,
  listKnowledgeEntries,
  normalizeText,
  extractSearchTerms,
  updateDiseaseFromExcel,
  updateKnowledgeFromExcel,
  warmKnowledgeCache,
} = require("./mysqlKnowledge");

const MAX_FIELD_PAIRS = 20;
const SOURCE_COLUMN_COUNT = 7;
const FIXED_TEMPLATE_COLUMNS = 2 + SOURCE_COLUMN_COUNT;

const COMMON_FIELD_LABELS = [
  "thông tin",
  "đất",
  "môi trường sống",
  "ngưỡng cảm biến",
  "chăm sóc",
  "tưới nước",
  "phân bón",
  "ánh sáng",
  "nhiệt độ",
  "độ ẩm",
  "pH",
  "thu hoạch",
  "sâu hại",
  "ra hoa",
  "trồng chậu",
  "nhà kính",
  "cắt tỉa",
  "giống",
  "lưu ý",
];

const TEMPLATE_ROWS = [];

const CATEGORY_KEYWORD_BANK = {
  thong_tin: ["thông tin", "giới thiệu", "đặc điểm", "là cây gì", "mô tả", "tổng quan"],
  benh: ["bệnh", "sâu bệnh", "vàng lá", "xoăn lá", "đốm lá", "thối rễ", "rệp", "bọ trĩ", "nấm", "phòng trị"],
  moi_truong: ["môi trường", "điều kiện sống", "ánh sáng", "nhiệt độ", "độ ẩm", "giá thể", "nắng", "thoát nước"],
  nguong: ["ngưỡng", "cảm biến", "sensor", "độ ẩm đất", "nhiệt độ", "ánh sáng", "lux", "bật tưới", "bật quạt", "đất khô", "bị nóng"],
  cham_soc: ["chăm sóc", "tưới nước", "bón phân", "cắt tỉa", "dinh dưỡng", "kali", "đạm", "gieo trồng", "ra hoa", "thu hoạch"],
  dat: ["đất", "loại đất", "pH", "độ ẩm đất", "tơi xốp", "thoát nước", "đất khô", "đất úng", "giá thể", "đất phù hợp"],
  tuoi_nuoc: ["tưới", "tưới nước", "bật tưới", "độ ẩm đất", "nước", "đất khô", "lịch tưới", "ẩm thấp"],
  phan_bon: ["phân", "phân bón", "bón phân", "dinh dưỡng", "NPK", "đạm", "kali", "canxi", "hữu cơ"],
  anh_sang: ["ánh sáng", "nắng", "lux", "cường độ sáng", "thiếu sáng", "nắng gắt", "che nắng"],
  nhiet_do: ["nhiệt độ", "nóng", "lạnh", "vườn nóng", "bị nóng", "bật quạt", "phun mát"],
  do_am: ["độ ẩm", "ẩm", "khô", "ẩm đất", "độ ẩm đất", "độ ẩm không khí", "bí khí"],
  ph: ["pH", "độ pH", "đất chua", "đất kiềm", "trung tính"],
  thu_hoach: ["thu hoạch", "hái quả", "quả chín", "năng suất", "lứa quả"],
  sau_hai: ["sâu hại", "côn trùng", "rệp", "bọ trĩ", "sâu ăn lá", "sâu đục quả", "nhện đỏ"],
  ra_hoa: ["ra hoa", "đậu quả", "rụng hoa", "nuôi quả", "hoa", "quả non"],
  trong_chau: ["trồng chậu", "chậu", "giá thể", "thoát nước", "ban công"],
  nha_kinh: ["nhà kính", "vườn kín", "bí khí", "thông gió", "độ ẩm không khí"],
  cat_tia: ["cắt tỉa", "tỉa cành", "tỉa lá", "tán cây", "lá già", "cành bệnh"],
  giong: ["giống", "giống cây", "chọn giống", "hạt giống", "cây con"],
  luu_y: ["lưu ý", "chú ý", "cảnh báo", "rủi ro", "khuyến nghị"],
};

function fieldCategory(label = "") {
  const normalized = normalizeText(label);
  if (!normalized) return "custom";
  if (/^(thong tin|gioi thieu|tong quan|dac diem|mo ta|la cay gi)$/.test(normalized)) return "thong_tin";
  if (/^(benh|sau benh|benh cay|phong tri|nam benh)$/.test(normalized)) return "benh";
  if (/^(moi truong|moi truong song|dieu kien song|dieu kien|sinh truong)$/.test(normalized)) return "moi_truong";
  if (/^(nguong|nguong cam bien|cam bien|sensor)$/.test(normalized)) return "nguong";
  if (/^(cham soc|ky thuat cham soc|cach cham soc)$/.test(normalized)) return "cham_soc";
  if (/^(dat|loai dat|dat trong|gia the)$/.test(normalized)) return "dat";
  if (/^(tuoi|tuoi nuoc|nuoc|lich tuoi)$/.test(normalized)) return "tuoi_nuoc";
  if (/^(phan|phan bon|bon phan|dinh duong)$/.test(normalized)) return "phan_bon";
  if (/^(anh sang|nang|lux)$/.test(normalized)) return "anh_sang";
  if (/^(nhiet do|nong lanh)$/.test(normalized)) return "nhiet_do";
  if (/^(do am|am do|do am dat|do am khong khi)$/.test(normalized)) return "do_am";
  if (/^(ph|do ph)$/.test(normalized)) return "ph";
  if (/^(thu hoach|hai qua|nang suat)$/.test(normalized)) return "thu_hoach";
  if (/^(sau hai|con trung|sau|rep|bo tri|nhen do)$/.test(normalized)) return "sau_hai";
  if (/^(ra hoa|dau qua|hoa|qua non)$/.test(normalized)) return "ra_hoa";
  if (/^(trong chau|chau|ban cong)$/.test(normalized)) return "trong_chau";
  if (/^(nha kinh|vuon kin|thong gio)$/.test(normalized)) return "nha_kinh";
  if (/^(cat tia|tia canh|tia la)$/.test(normalized)) return "cat_tia";
  if (/^(giong|chon giong|hat giong|cay con)$/.test(normalized)) return "giong";
  if (/^(luu y|chu y|canh bao|khuyen nghi)$/.test(normalized)) return "luu_y";
  return normalized.replace(/\s+/g, "_").slice(0, 64) || "custom";
}

function splitKeywords(value = "") {
  if (Array.isArray(value)) return value.flatMap(splitKeywords);
  return String(value || "")
    .split(/[;\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueKeywords(items = [], max = 20) {
  const seen = new Set();
  const output = [];
  items.forEach((item) => {
    const value = String(item || "").trim();
    const key = normalizeText(value);
    if (!value || !key || seen.has(key)) return;
    seen.add(key);
    output.push(value);
  });
  return output.slice(0, max);
}

function buildStructuredKeywords(topic = "", fieldLabel = "", content = "", providedKeywords = []) {
  const topicText = String(topic || "").trim();
  const labelText = String(fieldLabel || "").trim();
  const topicNoAccent = normalizeText(topicText);
  const labelNoAccent = normalizeText(labelText);
  const category = fieldCategory(labelText);
  const bank = CATEGORY_KEYWORD_BANK[category] || [];
  const contentTerms = extractSearchTerms(content).slice(0, 8);

  return uniqueKeywords([
    ...splitKeywords(providedKeywords),
    topicText,
    topicNoAccent,
    topicText ? `cây ${topicText}` : "",
    topicNoAccent ? `cay ${topicNoAccent}` : "",
    labelText,
    labelNoAccent,
    topicText && labelText ? `${topicText} ${labelText}` : "",
    topicNoAccent && labelNoAccent ? `${topicNoAccent} ${labelNoAccent}` : "",
    ...bank,
    ...bank.map(normalizeText),
    ...contentTerms,
  ], 20);
}

function parseStructuredKnowledgeLine(text = "") {
  const match = String(text || "").trim().match(/^KW-([^:]+)::(.+)$/i);
  if (!match) return [];

  const topic = match[1].trim();
  const body = match[2].trim();
  return body
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const itemMatch = part.match(/^kw\d+\s*[-–]\s*([^:：]+)\s*[:：]\s*"?(.+?)"?$/i);
      if (!itemMatch) return null;
      const label = itemMatch[1].trim();
      const answer = itemMatch[2].trim();
      return {
        topic,
        fieldLabel: label,
        category: fieldCategory(label),
        keywords: buildStructuredKeywords(topic, label, answer),
        answer,
      };
    })
    .filter((entry) => entry && entry.topic && entry.answer);
}

function cellText(cellValue) {
  if (cellValue == null) return "";
  if (typeof cellValue === "string" || typeof cellValue === "number" || typeof cellValue === "boolean") {
    return String(cellValue).trim();
  }
  if (cellValue instanceof Date) return cellValue.toISOString().slice(0, 10);
  if (Array.isArray(cellValue.richText)) {
    return cellValue.richText.map((part) => part.text || "").join("").trim();
  }
  if (cellValue.text) return String(cellValue.text).trim();
  if (cellValue.result != null) return cellText(cellValue.result);
  if (cellValue.formula) return String(cellValue.result || "").trim();
  return String(cellValue).trim();
}

function normalizeHeader(value = "") {
  return normalizeText(value).replace(/\s+/g, "_");
}

function pickHeader(headers, names) {
  const normalizedNames = names.map(normalizeHeader);
  for (const [index, header] of headers.entries()) {
    if (normalizedNames.includes(header)) return index;
  }
  return -1;
}

function readSourceMeta(values, headers) {
  const sourceTitleIndex = pickHeader(headers, ["nguon", "nguon_tai_lieu", "ten_nguon", "source", "source_title"]);
  const sourceUrlIndex = pickHeader(headers, ["source_url", "nguon_url", "url", "link", "duong_dan"]);
  const sourceAuthorIndex = pickHeader(headers, ["tac_gia", "nguoi_viet", "source_author", "author"]);
  const sourceOrganizationIndex = pickHeader(headers, ["to_chuc", "don_vi", "co_quan", "source_organization", "publisher"]);
  const sourcePublishedAtIndex = pickHeader(headers, ["ngay_cong_bo", "ngay_xuat_ban", "source_published_at", "published_at"]);
  const isVerifiedIndex = pickHeader(headers, ["da_xac_minh", "xac_minh", "is_verified", "verified"]);
  const verificationNoteIndex = pickHeader(headers, ["ghi_chu_xac_minh", "verification_note"]);

  return {
    source_title: sourceTitleIndex >= 0 ? values[sourceTitleIndex] : "",
    source_url: sourceUrlIndex >= 0 ? values[sourceUrlIndex] : "",
    source_author: sourceAuthorIndex >= 0 ? values[sourceAuthorIndex] : "",
    source_organization: sourceOrganizationIndex >= 0 ? values[sourceOrganizationIndex] : "",
    source_published_at: sourcePublishedAtIndex >= 0 ? values[sourcePublishedAtIndex] : "",
    is_verified: isVerifiedIndex >= 0 ? values[isVerifiedIndex] : "",
    verification_note: verificationNoteIndex >= 0 ? values[verificationNoteIndex] : "",
  };
}

function getRowValues(row) {
  const values = [];
  for (let index = 1; index <= row.cellCount; index += 1) {
    values.push(cellText(row.getCell(index).value));
  }
  return values;
}

function wideFieldPairIndexes(headers) {
  const pairs = [];
  for (let index = 1; index <= MAX_FIELD_PAIRS; index += 1) {
    const fieldIndex = pickHeader(headers, [
      `truong_khoa${index}`,
      `truong_khoa_${index}`,
      `truong${index}`,
      `khoa${index}`,
      `field${index}`,
      `field_key${index}`,
    ]);
    const infoIndex = pickHeader(headers, [
      `thong_tin${index}`,
      `thong_tin_${index}`,
      `thongtin${index}`,
      `noi_dung${index}`,
      `noi_dung_${index}`,
      `info${index}`,
      `content${index}`,
    ]);
    if (fieldIndex >= 0 || infoIndex >= 0) {
      pairs.push({ index, fieldIndex, infoIndex });
    }
  }
  return pairs;
}

function findHeaderRow(worksheet) {
  const maxRow = Math.min(worksheet.rowCount, 10);
  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const headers = getRowValues(worksheet.getRow(rowNumber)).map(normalizeHeader);
    const topicIndex = pickHeader(headers, ["ten_cay", "ten", "cay", "topic", "plant", "chu_de"]);
    const keywordsIndex = pickHeader(headers, ["tu_khoa", "keywords", "keyword", "key", "tu_khoa_phu"]);
    const answerIndex = pickHeader(headers, ["noi_dung", "cau_tra_loi", "answer", "content"]);
    const structuredIndex = pickHeader(headers, ["dong_kw", "kw_line", "du_lieu_kw"]);
    const widePairs = wideFieldPairIndexes(headers);

    if ((topicIndex >= 0 && keywordsIndex >= 0 && widePairs.length) || (topicIndex >= 0 && answerIndex >= 0) || structuredIndex >= 0) {
      return { rowNumber, headers, topicIndex, keywordsIndex, answerIndex, structuredIndex, widePairs };
    }
  }
  return null;
}

function buildImportError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function parseWideRow(values, header, rowNumber = 0) {
  const topic = header.topicIndex >= 0 ? values[header.topicIndex] : "";
  const sharedKeywords = header.keywordsIndex >= 0 ? values[header.keywordsIndex] : "";
  if (!topic) return [];
  const sourceMeta = readSourceMeta(values, header.headers);

  const entries = header.widePairs
    .map(({ index, fieldIndex, infoIndex }) => {
      const label = fieldIndex >= 0 ? values[fieldIndex] : "";
      const answer = infoIndex >= 0 ? values[infoIndex] : "";
      if (!label || !answer) return null;
      return {
        topic,
        fieldLabel: label,
        category: fieldCategory(label),
        keywords: buildStructuredKeywords(topic, label, answer, [
          ...splitKeywords(sharedKeywords),
          label,
          `truong_khoa${index}`,
        ]),
        answer,
        ...sourceMeta,
      };
    })
    .filter(Boolean);

  return entries;
}

function parseLegacyRow(values, headers) {
  const sourceMeta = readSourceMeta(values, headers);
  const structuredIndex = pickHeader(headers, ["dong_kw", "kw_line", "du_lieu_kw"]);
  const structuredText = structuredIndex >= 0 ? values[structuredIndex] : "";
  if (structuredText) return parseStructuredKnowledgeLine(structuredText).map((entry) => ({ ...entry, ...sourceMeta }));

  const firstCellStructured = parseStructuredKnowledgeLine(values.find((value) => /^KW-/i.test(value)) || "");
  if (firstCellStructured.length) return firstCellStructured.map((entry) => ({ ...entry, ...sourceMeta }));

  const topicIndex = pickHeader(headers, ["ten_cay", "ten", "cay", "topic", "plant", "chu_de"]);
  const categoryIndex = pickHeader(headers, ["nhom_khoa", "truong_khoa", "nhom", "loai", "category", "phan_loai"]);
  const keywordsIndex = pickHeader(headers, ["tu_khoa", "keywords", "keyword", "key", "tu_khoa_phu"]);
  const answerIndex = pickHeader(headers, ["noi_dung", "thong_tin", "cau_tra_loi", "answer", "content"]);

  const topic = topicIndex >= 0 ? values[topicIndex] : "";
  const label = categoryIndex >= 0 ? values[categoryIndex] : "custom";
  const answer = answerIndex >= 0 ? values[answerIndex] : "";
  const keywords = keywordsIndex >= 0 ? values[keywordsIndex] : "";

  if (!topic || !answer) return [];

  return [{
    topic,
    fieldLabel: label,
    category: fieldCategory(label),
    keywords: buildStructuredKeywords(topic, label, answer, keywords),
    answer,
    ...sourceMeta,
  }];
}

function parseRowWithHeaders(values, header, rowNumber) {
  const wideEntries = parseWideRow(values, header, rowNumber);
  if (wideEntries.length) return wideEntries;
  return parseLegacyRow(values, header.headers);
}

function parseLooseRow(values) {
  const nonEmpty = values.map((value) => String(value || "").trim()).filter(Boolean);
  if (!nonEmpty.length) return [];

  const structured = parseStructuredKnowledgeLine(nonEmpty.find((value) => /^KW-/i.test(value)) || "");
  if (structured.length) return structured;

  if (nonEmpty.length >= 4) {
    const [topic, sharedKeywords, label, ...answerParts] = nonEmpty;
    const answer = answerParts.join(" ").trim();
    return [{
      topic,
      fieldLabel: label,
      category: fieldCategory(label),
      keywords: buildStructuredKeywords(topic, label, answer, sharedKeywords),
      answer,
    }].filter((entry) => entry.topic && entry.answer);
  }

  return [];
}

function parseWorksheet(worksheet) {
  const entries = [];
  const header = findHeaderRow(worksheet);
  const startRow = header ? header.rowNumber + 1 : 1;

  for (let rowNumber = startRow; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values = getRowValues(row);
    const parsed = header ? parseRowWithHeaders(values, header, rowNumber) : parseLooseRow(values);
    entries.push(...parsed);
  }

  return entries;
}

function parseDiseaseWorksheet(worksheet) {
  let header = null;
  const maxRow = Math.min(worksheet.rowCount, 10);
  for (let rowNumber = 1; rowNumber <= maxRow; rowNumber += 1) {
    const headers = getRowValues(worksheet.getRow(rowNumber)).map(normalizeHeader);
    const topicIndex = pickHeader(headers, ["ten_cay", "ten", "cay", "topic", "plant", "chu_de"]);
    const diseaseIndex = pickHeader(headers, ["ten_benh", "benh", "benh_cay", "disease", "disease_name"]);
    const treatmentIndex = pickHeader(headers, ["cach_chua", "cach_tri", "phac_do", "phac_do_dieu_tri", "treatment"]);
    if (topicIndex >= 0 && diseaseIndex >= 0 && treatmentIndex >= 0) {
      header = { rowNumber, headers, topicIndex, diseaseIndex, treatmentIndex };
      break;
    }
  }
  if (!header) return [];

  const authorIndex = pickHeader(header.headers, ["nguoi_dua_phac_do", "nguoi_phac_do", "tac_gia_phac_do", "bac_si", "chuyen_gia"]);

  const entries = [];
  for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const values = getRowValues(worksheet.getRow(rowNumber));
    const topic = header.topicIndex >= 0 ? values[header.topicIndex] : "";
    const diseaseName = values[header.diseaseIndex] || "";
    const treatment = values[header.treatmentIndex] || "";
    if (!topic || !diseaseName || !treatment) continue;

    entries.push({
      topic,
      ten_benh: diseaseName,
      fieldLabel: diseaseName,
      category: "benh",
      keywords: buildStructuredKeywords(topic, diseaseName, treatment, diseaseName),
      answer: treatment,
      ...readSourceMeta(values, header.headers),
      source_author: authorIndex >= 0 ? values[authorIndex] : "",
    });
  }
  return entries;
}

function parseExcelKnowledgeWorkbook(workbook) {
  const entries = [];
  workbook.eachSheet((worksheet) => {
    const sheetName = normalizeText(worksheet.name);
    if (sheetName.includes("huong dan")) return;
    if (sheetName.includes("benh") || sheetName.includes("disease")) {
      entries.push(...parseDiseaseWorksheet(worksheet));
    } else {
      entries.push(...parseWorksheet(worksheet));
    }
  });
  return entries.filter((entry) => entry.topic && entry.answer);
}

function groupEntriesByPlant(entries = []) {
  const groups = new Map();

  entries.forEach((entry) => {
    const topic = String(entry.topic || "").trim();
    const key = normalizeText(topic);
    if (!key) return;

    if (!groups.has(key)) {
      groups.set(key, {
        topic,
        keywords: [],
        fields: [],
      });
    }

    const group = groups.get(key);
    group.keywords.push(...splitKeywords(entry.keywords || []));
    group.fields.push({
      label: entry.fieldLabel || entry.category || "thong_tin",
      answer: entry.answer,
    });
  });

  return [...groups.values()].map((group) => ({
    ...group,
    keywords: uniqueKeywords(group.keywords, 80),
  }));
}

function buildTemplateColumns() {
  const columns = [
    { header: "ten_cay", key: "ten_cay", width: 18 },
    { header: "tu_khoa", key: "tu_khoa", width: 48 },
    { header: "nguon", key: "nguon", width: 34 },
    { header: "source_url", key: "source_url", width: 48 },
    { header: "tac_gia", key: "tac_gia", width: 24 },
    { header: "to_chuc", key: "to_chuc", width: 28 },
    { header: "ngay_cong_bo", key: "ngay_cong_bo", width: 18 },
    { header: "da_xac_minh", key: "da_xac_minh", width: 16 },
    { header: "ghi_chu_xac_minh", key: "ghi_chu_xac_minh", width: 34 },
  ];

  for (let index = 1; index <= MAX_FIELD_PAIRS; index += 1) {
    columns.push(
      { header: `truong_khoa${index}`, key: `truong_khoa${index}`, width: 20 },
      { header: `thong_tin${index}`, key: `thong_tin${index}`, width: 56 }
    );
  }

  return columns;
}

function firstText(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

async function buildTemplateRows() {
  const entries = await listKnowledgeEntries();
  const groups = new Map();

  entries.forEach((entry) => {
    const topic = String(entry.topic || "").trim();
    const key = normalizeText(topic);
    if (!key) return;

    if (!groups.has(key)) {
      groups.set(key, {
        ten_cay: topic,
        tu_khoa: "",
        nguon: "",
        source_url: "",
        tac_gia: "",
        to_chuc: "",
        ngay_cong_bo: "",
        da_xac_minh: "",
        ghi_chu_xac_minh: "",
        fields: [],
      });
    }

    const group = groups.get(key);
    group.tu_khoa = group.tu_khoa || entry.keywords || "";
    group.nguon = group.nguon || entry.source_title || "";
    group.source_url = group.source_url || entry.source_url || "";
    group.tac_gia = group.tac_gia || entry.source_author || "";
    group.to_chuc = group.to_chuc || entry.source_organization || "";
    group.ngay_cong_bo = group.ngay_cong_bo || (entry.source_published_at ? String(entry.source_published_at).slice(0, 10) : "");
    group.da_xac_minh = group.da_xac_minh || (entry.is_verified ? "1" : "");
    group.ghi_chu_xac_minh = group.ghi_chu_xac_minh || entry.verification_note || "";
    group.fields.push({
      label: firstText(entry.field_label, entry.category),
      answer: entry.answer || "",
    });
  });

  return [...groups.values()].map((group) => {
    const output = {
      ten_cay: group.ten_cay,
      tu_khoa: group.tu_khoa,
      nguon: group.nguon,
      source_url: group.source_url,
      tac_gia: group.tac_gia,
      to_chuc: group.to_chuc,
      ngay_cong_bo: group.ngay_cong_bo,
      da_xac_minh: group.da_xac_minh,
      ghi_chu_xac_minh: group.ghi_chu_xac_minh,
    };

    group.fields.slice(0, MAX_FIELD_PAIRS).forEach((field, index) => {
      output[`truong_khoa${index + 1}`] = field.label;
      output[`thong_tin${index + 1}`] = field.answer;
    });
    return output;
  });
}

function buildDiseaseTemplateColumns() {
  return [
    { header: "ten_cay", key: "ten_cay", width: 22 },
    { header: "ten_benh", key: "ten_benh", width: 28 },
    { header: "cach_tri", key: "cach_tri", width: 74 },
    { header: "nguoi_dua_phac_do", key: "nguoi_dua_phac_do", width: 28 },
  ];
}

async function buildDiseaseTemplateRows(knowledgeRows = []) {
  const seen = new Set();
  return knowledgeRows
    .map((row) => String(row.ten_cay || "").trim())
    .filter((name) => {
      const key = normalizeText(name);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((name) => ({
      ten_cay: name,
      ten_benh: "",
      cach_tri: "",
      nguoi_dua_phac_do: "",
    }));
}

function formatKnowledgeSheet(sheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F8F55" } };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: FIXED_TEMPLATE_COLUMNS + MAX_FIELD_PAIRS * 2 },
  };
  sheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (rowNumber > 1) row.height = 88;
  });

  for (let index = 1; index <= MAX_FIELD_PAIRS; index += 1) {
    const fieldColumn = sheet.getColumn(FIXED_TEMPLATE_COLUMNS + index * 2 - 1);
    fieldColumn.eachCell((cell, rowNumber) => {
      if (rowNumber === 1) return;
      cell.dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${COMMON_FIELD_LABELS.join(",")}"`],
      };
    });
  }
}

function formatDiseaseSheet(sheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB45309" } };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: buildDiseaseTemplateColumns().length },
  };
  sheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (rowNumber > 1) row.height = 70;
  });
}

async function createExcelTemplateBuffer() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Smart Garden";
  workbook.created = new Date();

  const knowledgeRows = await buildTemplateRows();
  const sheet = workbook.addWorksheet("Tri thuc");
  sheet.columns = buildTemplateColumns();
  sheet.addRows(knowledgeRows);
  formatKnowledgeSheet(sheet);

  const diseaseSheet = workbook.addWorksheet("Benh");
  diseaseSheet.columns = buildDiseaseTemplateColumns();
  diseaseSheet.addRows(await buildDiseaseTemplateRows(knowledgeRows));
  formatDiseaseSheet(diseaseSheet);

  const templateBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(templateBuffer);
}

async function importExcelKnowledge(buffer, originalName = "") {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw buildImportError("File Excel không hợp lệ. Hãy dùng file .xlsx theo mẫu của hệ thống.");
  }

  const parsedEntries = parseExcelKnowledgeWorkbook(workbook);
  if (!parsedEntries.length) {
    throw buildImportError("Không tìm thấy dữ liệu hợp lệ. Excel cần có cột ten_cay, tu_khoa và các cặp truong_khoa1/thong_tin1 đến truong_khoa20/thong_tin20.");
  }

  const plantCount = groupEntriesByPlant(parsedEntries).length;
  const imported = [];
  const skipped = [];
  const diseaseImported = [];
  const diseaseSkipped = [];
  for (const entry of parsedEntries) {
    const isDisease = entry.category === "benh";
    const result = isDisease
      ? await insertDiseaseIfMissing({ ...entry, suggestions: [], source_type: "excel" })
      : await insertKnowledgeIfMissing({ ...entry, suggestions: [], source_type: "excel" });
    if (result.skipped) {
      if (isDisease) diseaseSkipped.push(result.entry);
      else skipped.push(result.entry);
    } else {
      if (isDisease) diseaseImported.push(result.entry);
      else imported.push(result.entry);
    }
  }
  if (imported.length || diseaseImported.length) await warmKnowledgeCache();

  return {
    fileName: originalName,
    parsedCount: parsedEntries.length,
    importedCount: imported.length + diseaseImported.length,
    skippedCount: skipped.length + diseaseSkipped.length,
    mainImportedCount: imported.length,
    diseaseImportedCount: diseaseImported.length,
    mainSkippedCount: skipped.length,
    diseaseSkippedCount: diseaseSkipped.length,
    plantCount,
    entries: [...imported, ...diseaseImported].slice(0, 50),
    skippedEntries: [...skipped, ...diseaseSkipped].slice(0, 20),
  };
}

async function updateExcelKnowledge(buffer, originalName = "") {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw buildImportError("File Excel không hợp lệ. Hãy dùng file .xlsx theo mẫu của hệ thống.");
  }

  const parsedEntries = parseExcelKnowledgeWorkbook(workbook);
  if (!parsedEntries.length) {
    throw buildImportError("Không tìm thấy dữ liệu hợp lệ. Excel cần có cột ten_cay, tu_khoa và các cặp truong_khoa1/thong_tin1 đến truong_khoa20/thong_tin20.");
  }

  const plantCount = groupEntriesByPlant(parsedEntries).length;
  const created = [];
  const updated = [];
  const unchanged = [];
  const diseaseCreated = [];
  const diseaseUpdated = [];
  const diseaseUnchanged = [];

  for (const entry of parsedEntries) {
    const isDisease = entry.category === "benh";
    const result = isDisease
      ? await updateDiseaseFromExcel({ ...entry, suggestions: [], source_type: "excel_edit" })
      : await updateKnowledgeFromExcel({ ...entry, suggestions: [], source_type: "excel_edit" });
    if (result.created) {
      if (isDisease) diseaseCreated.push(result.entry);
      else created.push(result.entry);
    } else if (result.updated) {
      if (isDisease) diseaseUpdated.push(result.entry);
      else updated.push(result.entry);
    } else {
      if (isDisease) diseaseUnchanged.push(result.entry);
      else unchanged.push(result.entry);
    }
  }

  if (created.length || updated.length || diseaseCreated.length || diseaseUpdated.length) await warmKnowledgeCache();

  return {
    fileName: originalName,
    parsedCount: parsedEntries.length,
    createdCount: created.length + diseaseCreated.length,
    updatedCount: updated.length + diseaseUpdated.length,
    unchangedCount: unchanged.length + diseaseUnchanged.length,
    mainCreatedCount: created.length,
    mainUpdatedCount: updated.length,
    mainUnchangedCount: unchanged.length,
    diseaseCreatedCount: diseaseCreated.length,
    diseaseUpdatedCount: diseaseUpdated.length,
    diseaseUnchangedCount: diseaseUnchanged.length,
    plantCount,
    entries: [...created, ...updated, ...diseaseCreated, ...diseaseUpdated].slice(0, 50),
    unchangedEntries: [...unchanged, ...diseaseUnchanged].slice(0, 20),
  };
}

module.exports = {
  MAX_FIELD_PAIRS,
  TEMPLATE_ROWS,
  buildStructuredKeywords,
  createExcelTemplateBuffer,
  fieldCategory,
  importExcelKnowledge,
  updateExcelKnowledge,
  parseExcelKnowledgeWorkbook,
  parseStructuredKnowledgeLine,
  groupEntriesByPlant,
};
