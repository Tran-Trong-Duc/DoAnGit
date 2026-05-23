const ExcelJS = require("exceljs");
const {
  insertKnowledgeIfMissing,
  normalizeText,
  extractSearchTerms,
  updateKnowledgeFromExcel,
  warmKnowledgeCache,
} = require("./mysqlKnowledge");

const MAX_FIELD_PAIRS = 20;

const COMMON_FIELD_LABELS = [
  "thông tin",
  "đất",
  "bệnh",
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

const TEMPLATE_ROWS = [
  {
    ten_cay: "Ớt",
    tu_khoa: "ớt; ot; chili; cây ớt; ớt cay; rau gia vị; quả ớt; trồng ớt; ớt chỉ thiên; ớt chuông; ớt hiểm; smart garden; cay ot; pepper; capsicum",
    fields: [
      ["thông tin", "Ớt là cây rau gia vị thu hoạch quả, thường có vị cay, dùng tươi hoặc chế biến. Cây sinh trưởng tốt khi đủ nắng, đất thoát nước và chăm sóc ổn định."],
      ["đất", "Ớt hợp đất tơi xốp, thoát nước tốt, ẩm vừa và pH khoảng 6.0-6.8. Tránh đất úng lâu vì cây dễ thối rễ, vàng lá và giảm đậu quả."],
      ["bệnh", "Ớt thường gặp xoăn lá do bọ trĩ, rệp hoặc virus; cũng có thể bị thán thư, héo xanh và thối rễ. Cần kiểm tra mặt dưới lá và xử lý sớm."],
      ["môi trường sống", "Ớt cần nơi thông thoáng, nắng trực tiếp khoảng 6-8 giờ mỗi ngày, nhiệt độ 20-32°C và đất không bị bí nước. Vườn quá ẩm dễ phát sinh nấm bệnh."],
      ["ngưỡng cảm biến", "Theo dõi độ ẩm đất, nhiệt độ và ánh sáng trước khi bật tưới, quạt hoặc phun mát. Khi đất khô hoặc vườn nóng, ưu tiên kiểm tra cảm biến thực tế."],
      ["chăm sóc", "Giữ ẩm đều, bón phân cân đối, tỉa lá già và giữ tán thoáng. Khi cây mang quả nên chú ý kali và canxi để hạn chế rụng hoa, thối đuôi quả."],
      ["tưới nước", "Tưới khi mặt đất bắt đầu se khô, tránh tưới dồn dập khi đất vẫn ẩm. Nên tưới vào gốc vào sáng sớm hoặc chiều mát để giảm sốc nhiệt."],
      ["phân bón", "Giai đoạn sinh trưởng cần đạm vừa phải; khi ra hoa, đậu quả nên tăng kali, canxi và vi lượng. Không bón quá nhiều đạm vì cây dễ tốt lá, ít quả."],
      ["ánh sáng", "Ớt cần nắng mạnh và ổn định, tối thiểu khoảng 6 giờ mỗi ngày. Thiếu sáng cây dễ vươn cao, yếu thân, rụng hoa và quả nhỏ."],
      ["nhiệt độ", "Nhiệt độ phù hợp cho ớt khoảng 20-32°C. Trên 35°C cây dễ rụng hoa, xoăn lá hoặc cháy mép lá, cần thông gió hoặc phun mát hợp lý."],
      ["độ ẩm", "Độ ẩm đất nên duy trì mức vừa, không quá khô và không úng. Không khí quá ẩm kéo dài làm tăng nguy cơ nấm, thán thư và thối rễ."],
      ["pH", "pH đất phù hợp cho ớt khoảng 6.0-6.8. Nếu đất quá chua hoặc quá kiềm, cây hấp thu dinh dưỡng kém và dễ biểu hiện vàng lá."],
      ["thu hoạch", "Có thể thu hoạch khi quả đạt kích thước mong muốn hoặc chuyển màu tùy giống. Thu đều giúp cây tiếp tục ra hoa và nuôi lứa quả mới."],
      ["sâu hại", "Sâu hại thường gặp gồm bọ trĩ, rệp, nhện đỏ và sâu ăn lá. Cần kiểm tra đọt non, mặt dưới lá và xử lý sớm khi mật độ còn thấp."],
      ["ra hoa", "Khi ớt ra hoa cần giữ nước ổn định, tránh sốc khô ướt và tránh bón thừa đạm. Thiếu nắng hoặc nóng quá mức có thể làm rụng hoa."],
      ["trồng chậu", "Ớt trồng chậu cần chậu thoát nước tốt, giá thể nhẹ và vị trí đủ nắng. Không nên để khay hứng nước ngập lâu vì rễ dễ thiếu oxy."],
      ["nhà kính", "Trong nhà kính hoặc vườn kín cần thông gió đều để giảm nóng, giảm ẩm cao và hạn chế bọ trĩ, rệp. Khi bí khí nên ưu tiên bật quạt hoặc mở thông gió."],
      ["cắt tỉa", "Tỉa lá già, lá sát gốc và cành bệnh để tán thông thoáng. Không tỉa quá mạnh khi cây đang ra hoa, đậu quả vì có thể làm cây bị sốc."],
      ["giống", "Có thể chọn giống ớt chỉ thiên, ớt hiểm, ớt chuông hoặc giống địa phương tùy mục đích. Nên chọn cây con khỏe, thân cứng và không có dấu bệnh."],
      ["lưu ý", "Khi thấy lá xoăn, đất khô, vườn nóng hoặc cây chậm lớn, hãy kiểm tra cảm biến, mặt dưới lá và lịch tưới trước khi tự động bật thiết bị."],
    ],
  },
  {
    ten_cay: "Khế",
    tu_khoa: "khế; cay khe; cây khế; quả khế; cây ăn quả; quả năm cánh; khế chua; khế ngọt; trồng khế; khế sân vườn; cây lâu năm; smart garden; star fruit; carambola; khe",
    fields: [
      ["thông tin", "Khế là cây ăn quả lâu năm, quả có năm cánh rõ, khi chín thường vàng và có vị chua ngọt. Cây phù hợp trồng sân vườn hoặc chậu lớn nếu đủ nắng."],
      ["đất", "Khế cần đất thoát nước, ẩm vừa và không bị úng kéo dài. Đất hơi chua đến trung tính, giàu hữu cơ hoai mục sẽ giúp cây phát triển bền hơn."],
      ["bệnh", "Khế có thể gặp rệp sáp, sâu đục quả, đốm lá và thối rễ khi đất úng. Nên giữ tán thông thoáng, kiểm tra quả non và tránh tưới quá nhiều."],
      ["môi trường sống", "Khế ưa nắng, cần không gian thoáng và đất thoát nước. Cây chịu nóng khá tốt nhưng vẫn cần giữ ẩm ổn định trong thời kỳ ra hoa, nuôi quả."],
      ["ngưỡng cảm biến", "Theo dõi độ ẩm đất và nhiệt độ để tránh úng hoặc khô hạn. Khi vườn nóng hoặc đất khô, kiểm tra cảm biến trước khi bật tưới hay phun mát."],
      ["chăm sóc", "Tưới vừa đủ, tỉa cành sâu bệnh và giữ tán thông thoáng. Sau thu hoạch có thể bón hữu cơ hoai mục kết hợp NPK cân đối để phục hồi cây."],
      ["tưới nước", "Khế cần nước đều trong giai đoạn ra hoa và nuôi quả nhưng không chịu úng. Nên tưới sâu vừa phải, để đất ráo nhẹ trước lần tưới tiếp theo."],
      ["phân bón", "Bón hữu cơ hoai mục định kỳ, kết hợp NPK cân đối. Khi cây ra hoa, nuôi quả nên bổ sung kali và canxi để quả chắc, hạn chế rụng."],
      ["ánh sáng", "Khế cần nắng tốt để ra hoa và đậu quả ổn định. Thiếu sáng cây dễ vươn cành, tán rậm, ít hoa và quả nhỏ."],
      ["nhiệt độ", "Khế sinh trưởng tốt trong điều kiện ấm, khoảng 20-35°C. Nắng gắt kéo dài có thể làm héo lá non nếu đất thiếu ẩm."],
      ["độ ẩm", "Độ ẩm đất nên giữ mức vừa, tránh khô hạn kéo dài khi cây đang nuôi quả. Đất quá ẩm lâu ngày làm tăng nguy cơ thối rễ."],
      ["pH", "Khế phù hợp đất hơi chua đến trung tính, pH tham khảo khoảng 5.5-6.8. Nếu pH lệch quá nhiều, cây hấp thu dinh dưỡng kém."],
      ["thu hoạch", "Thu khi quả chuyển màu vàng tùy giống và đạt độ chua ngọt mong muốn. Nên hái nhẹ tay để tránh dập cánh quả."],
      ["sâu hại", "Sâu đục quả, rệp sáp và côn trùng chích hút có thể làm hư quả non. Cần vệ sinh vườn, bao quả hoặc xử lý sớm khi phát hiện."],
      ["ra hoa", "Giai đoạn ra hoa cần hạn chế sốc nước, giữ cây đủ nắng và tán thoáng. Thiếu dinh dưỡng hoặc úng nước có thể làm rụng hoa, đậu quả kém."],
      ["trồng chậu", "Khế trồng chậu cần chậu lớn, đất thoát nước và tỉa rễ hoặc thay giá thể định kỳ khi cây lớn. Đặt chậu nơi nhiều nắng để cây ra hoa tốt."],
      ["nhà kính", "Nếu trồng trong nhà kính, cần giữ không khí lưu thông và tránh nhiệt tích tụ. Độ ẩm quá cao kéo dài có thể làm tăng bệnh đốm lá, thối rễ."],
      ["cắt tỉa", "Tỉa cành vượt, cành sâu bệnh và cành mọc vào trong tán sau thu hoạch. Tán thoáng giúp cây nhận sáng đều và giảm sâu bệnh."],
      ["giống", "Nên chọn giống khế phù hợp mục đích dùng quả chua hoặc ngọt, cây giống khỏe và bộ rễ tốt. Cây ghép thường cho quả ổn định hơn cây gieo hạt."],
      ["lưu ý", "Khi cây rụng hoa, quả nhỏ, đất khô hoặc vườn nóng, cần kiểm tra nước, nắng và dinh dưỡng trước khi tăng tưới hoặc bón phân."],
    ],
  },
];

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
      };
    })
    .filter(Boolean);

  return entries;
}

function parseLegacyRow(values, headers) {
  const structuredIndex = pickHeader(headers, ["dong_kw", "kw_line", "du_lieu_kw"]);
  const structuredText = structuredIndex >= 0 ? values[structuredIndex] : "";
  if (structuredText) return parseStructuredKnowledgeLine(structuredText);

  const firstCellStructured = parseStructuredKnowledgeLine(values.find((value) => /^KW-/i.test(value)) || "");
  if (firstCellStructured.length) return firstCellStructured;

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

function parseExcelKnowledgeWorkbook(workbook) {
  const entries = [];
  workbook.eachSheet((worksheet) => {
    const sheetName = normalizeText(worksheet.name);
    if (sheetName.includes("huong dan")) return;
    entries.push(...parseWorksheet(worksheet));
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
  ];

  for (let index = 1; index <= MAX_FIELD_PAIRS; index += 1) {
    columns.push(
      { header: `truong_khoa${index}`, key: `truong_khoa${index}`, width: 20 },
      { header: `thong_tin${index}`, key: `thong_tin${index}`, width: 56 }
    );
  }

  return columns;
}

function buildTemplateRows() {
  return TEMPLATE_ROWS.map((row) => {
    const output = {
      ten_cay: row.ten_cay,
      tu_khoa: row.tu_khoa,
    };

    for (let index = 1; index <= MAX_FIELD_PAIRS; index += 1) {
      const field = row.fields[index - 1];
      output[`truong_khoa${index}`] = field?.[0] || "";
      output[`thong_tin${index}`] = field?.[1] || "";
    }

    return output;
  });
}

function formatKnowledgeSheet(sheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F8F55" } };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: 2 + MAX_FIELD_PAIRS * 2 },
  };
  sheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (rowNumber > 1) row.height = 88;
  });

  for (let index = 1; index <= MAX_FIELD_PAIRS; index += 1) {
    const fieldColumn = sheet.getColumn(2 + index * 2 - 1);
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

async function createExcelTemplateBuffer() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Smart Garden";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Nhap lieu");
  sheet.columns = buildTemplateColumns();
  sheet.addRows(buildTemplateRows());
  formatKnowledgeSheet(sheet);

  const guide = workbook.addWorksheet("Huong dan");
  guide.columns = [
    { header: "muc", key: "muc", width: 24 },
    { header: "noi_dung", key: "noi_dung", width: 116 },
  ];
  guide.addRows([
    { muc: "Mỗi dòng", noi_dung: "Một dòng là một loại cây. Cột ten_cay là tên cây, tu_khoa là các tên gọi hoặc từ khóa nhận diện cây." },
    { muc: "Từ khóa cây", noi_dung: "Cột tu_khoa tách bằng dấu ;. Nên nhập 10-20 từ khóa như tên có dấu, không dấu, tên tiếng Anh, giống cây, cách gọi phổ biến." },
    { muc: "Trường khóa", noi_dung: `Nên nhập 15-20 trường khóa cho mỗi cây. Dùng các cặp truong_khoa1/thong_tin1 đến truong_khoa20/thong_tin20; thiếu vài cặp vẫn nạp được.` },
    { muc: "Cách chat chọn dữ liệu", noi_dung: "Chat tìm cây bằng ten_cay và tu_khoa trước, sau đó tìm trường khóa gần nhất trong câu hỏi để trả đúng thong_tin tương ứng." },
    { muc: "Ví dụ", noi_dung: "Nếu ten_cay=Ớt, tu_khoa=ớt;ot;chili và truong_khoa2=đất, khi hỏi 'ớt đất thế nào' chat sẽ trả nội dung trong thong_tin2." },
    { muc: "Nạp mới", noi_dung: "Nút nạp file chỉ thêm cây hoặc trường khóa mới; nếu cây + trường khóa đã có trong MySQL thì bỏ qua để không ghi đè nhầm." },
    { muc: "Sửa nguồn chat", noi_dung: "Nút sửa nguồn chat dùng cùng định dạng Excel này. Nếu cây + trường khóa đã có, hệ thống cập nhật thong_tin bằng nội dung trong Excel; nếu chưa có thì thêm mới." },
  ]);
  guide.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  guide.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF244333" } };
  guide.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
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
  for (const entry of parsedEntries) {
    const result = await insertKnowledgeIfMissing({
      ...entry,
      suggestions: [],
      source_type: "excel",
    });
    if (result.skipped) {
      skipped.push(result.entry);
    } else {
      imported.push(result.entry);
    }
  }
  if (imported.length) await warmKnowledgeCache();

  return {
    fileName: originalName,
    parsedCount: parsedEntries.length,
    importedCount: imported.length,
    skippedCount: skipped.length,
    plantCount,
    entries: imported,
    skippedEntries: skipped.slice(0, 20),
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

  for (const entry of parsedEntries) {
    const result = await updateKnowledgeFromExcel({
      ...entry,
      suggestions: [],
      source_type: "excel_edit",
    });
    if (result.created) {
      created.push(result.entry);
    } else if (result.updated) {
      updated.push(result.entry);
    } else {
      unchanged.push(result.entry);
    }
  }

  if (created.length || updated.length) await warmKnowledgeCache();

  return {
    fileName: originalName,
    parsedCount: parsedEntries.length,
    createdCount: created.length,
    updatedCount: updated.length,
    unchangedCount: unchanged.length,
    plantCount,
    entries: [...created, ...updated].slice(0, 50),
    unchangedEntries: unchanged.slice(0, 20),
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
