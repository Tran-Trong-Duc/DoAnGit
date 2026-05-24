const {
  AI_DEMO_CONTEXT_MESSAGE_LIMIT,
  AI_DEMO_MAX_MESSAGE_CHARS,
} = require("./config");
const { assistantInScope, aiDemoInScope, assistantIntent, normalizeAssistantText } = require("./text");
const { createFallbackHelpers } = require("./fallback");
const { createContextBuilder } = require("./context");
const { hasGeminiKey, callGemini, GEMINI_MODEL } = require("./gemini");
const { suggestActionButtons } = require("./actionButtons");
const {
  getKnowledgeStatus,
  splitKnowledgeBullets,
} = require("../../../chatBot/mysqlKnowledge");

function normalizeMessages(messages, question = "") {
  const source = Array.isArray(messages) && messages.length ? messages : [{ role: "user", content: question }];

  const normalized = source
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content || message?.text || "").trim().slice(0, AI_DEMO_MAX_MESSAGE_CHARS),
    }))
    .filter((message) => message.content);

  return AI_DEMO_CONTEXT_MESSAGE_LIMIT > 0 ? normalized.slice(-AI_DEMO_CONTEXT_MESSAGE_LIMIT) : normalized;
}

function formatNumber(value, unit = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const text = Number.isInteger(number) ? String(number) : number.toFixed(1);
  return `${text}${unit}`;
}

function formatRange(min, max, unit = "") {
  const minText = formatNumber(min, unit);
  const maxText = formatNumber(max, unit);
  if (minText && maxText) return `${minText}-${maxText}`;
  if (minText) return `tối thiểu ${minText}`;
  if (maxText) return `tối đa ${maxText}`;
  return "";
}

function formatSoilType(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  return normalizeAssistantText(text).startsWith("dat") ? text : `đất ${text}`;
}

function cleanParagraph(text = "") {
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGardenSystemQuestion(question = "") {
  const normalized = normalizeAssistantText(question);
  return /(cay chinh|cay hien tai|cay dang trong|vuon minh|vuon cua toi|he thong|da luu|danh sach cay|liet ke cay|cac cay|cay trong vuon|trong vuon)/.test(normalized);
}

function isGardenPlantListQuestion(question = "") {
  const normalized = normalizeAssistantText(question);
  return /(danh sach cay|liet ke cay|cac cay|cay trong vuon|trong vuon co cay|vuon co cay)/.test(normalized);
}

function gardenPlantListSentence(gardenData) {
  const plants = gardenData?.plants || [];
  if (!plants.length) return "Trong hệ thống hiện chưa có cây trồng nào được lưu.";
  const names = plants.map((plant) => `${plant.name}${plant.is_main ? " (cây chính)" : ""}`);
  return `Trong hệ thống hiện có ${plants.length} cây: ${names.join(", ")}.`;
}

function questionMentionsGardenPlant(question = "", gardenData) {
  const normalizedQuestion = normalizeAssistantText(question);
  return (gardenData?.plants || []).some((plant) => {
    const name = normalizeAssistantText(plant.name);
    return name && normalizedQuestion.includes(name);
  });
}

function shouldUseGardenPlantData(question = "", gardenData) {
  if (isGardenSystemQuestion(question)) return true;
  if (!questionMentionsGardenPlant(question, gardenData)) return false;
  const intent = assistantIntent(question);
  const normalized = normalizeAssistantText(question);
  return (
    intent.threshold ||
    intent.sensor ||
    intent.soil ||
    intent.water ||
    /(nguong|cam bien|dang luu|he thong|tuoi|dat|ph|nhiet|do am|anh sang)/.test(normalized)
  );
}

function findGardenPlant(question, gardenData, knowledgeMatches = []) {
  const normalizedQuestion = normalizeAssistantText(question);
  const plants = gardenData?.plants || [];
  const direct = plants.find((plant) => {
    const name = normalizeAssistantText(plant.name);
    return name && normalizedQuestion.includes(name);
  });
  if (direct) return direct;

  if (isGardenSystemQuestion(question)) {
    return gardenData?.mainPlant || plants[0] || null;
  }

  const matchedTopic = normalizeAssistantText(knowledgeMatches[0]?.topic || "");
  if (matchedTopic) {
    const byTopic = plants.find((plant) => normalizeAssistantText(plant.name) === matchedTopic);
    if (byTopic) return byTopic;
  }

  return null;
}

function gardenPlantSentence(question, gardenData, knowledgeMatches) {
  const plant = findGardenPlant(question, gardenData, knowledgeMatches);
  if (!plant) return "";

  const intent = assistantIntent(question);
  const systemQuestion = isGardenSystemQuestion(question);
  const details = [];
  const temp = formatRange(plant.temp_min, plant.temp_max, "°C");
  const humidity = formatRange(plant.humidity_min, plant.humidity_max, "%");
  const soil = formatRange(plant.soil_min, plant.soil_max, "%");
  const light = formatNumber(plant.light_max, " lux");
  const addThresholdDetails = () => {
    if (temp) details.push(`nhiệt độ ${temp}`);
    if (humidity) details.push(`ẩm không khí ${humidity}`);
    if (soil) details.push(`ẩm đất ${soil}`);
    if (light) details.push(`ánh sáng tối đa ${light}`);
  };

  if (intent.threshold || intent.sensor || intent.heat) {
    addThresholdDetails();
  }
  if (intent.soil) {
    if (plant.soil_ph) details.push(`pH ${formatNumber(plant.soil_ph) || plant.soil_ph}`);
    if (plant.soil_type) details.push(formatSoilType(plant.soil_type));
    if (plant.soil_drainage) details.push(`thoát nước ${plant.soil_drainage}`);
  }
  if (intent.water && plant.watering_time) {
    details.push(`lịch tưới ${String(plant.watering_time).slice(0, 5)}${plant.watering_duration ? ` trong ${plant.watering_duration} giây` : ""}`);
  }

  if (!details.length && systemQuestion) {
    addThresholdDetails();
    if (plant.soil_ph) details.push(`pH ${formatNumber(plant.soil_ph) || plant.soil_ph}`);
    if (plant.soil_type) details.push(formatSoilType(plant.soil_type));
    if (plant.soil_drainage) details.push(`thoát nước ${plant.soil_drainage}`);
    if (plant.watering_time) {
      details.push(`lịch tưới ${String(plant.watering_time).slice(0, 5)}${plant.watering_duration ? ` trong ${plant.watering_duration} giây` : ""}`);
    }
  }

  if (!details.length) return "";
  return `Trong hệ thống, cây "${plant.name}" đang lưu ${details.join(", ")}.`;
}

function buildLocalKnowledgeAnswer(question, gardenData, knowledgeMatches = []) {
  if (isGardenPlantListQuestion(question)) {
    return cleanParagraph(gardenPlantListSentence(gardenData));
  }

  const plantSentence = gardenPlantSentence(question, gardenData, knowledgeMatches);

  if (plantSentence && shouldUseGardenPlantData(question, gardenData)) {
    return cleanParagraph(plantSentence);
  }

  if (knowledgeMatches.length) {
    const top = knowledgeMatches[0];
    return cleanParagraph(splitKnowledgeBullets(top.answer, 2).join(" ") || top.answer);
  }

  if (plantSentence) return cleanParagraph(plantSentence);

  return "Mình chưa tìm thấy dữ liệu nội bộ phù hợp cho câu hỏi này. Hãy nạp thêm Excel theo mẫu ten_cay, tu_khoa và các cặp truong_khoa/thong_tin hoặc thêm cây/ngưỡng trong hệ thống rồi hỏi lại.";
}

function responsePayload({
  answer,
  suggestions,
  model,
  gardenContext,
  warning = "",
}) {
  const knowledgeMatches = gardenContext?.knowledgeMatches || [];
  return {
    title: "Trợ lý AI cây trồng",
    answer: cleanParagraph(answer),
    sections: [],
    sources: [],
    suggestions: suggestions || [],
    warning,
    mode: "Dữ liệu nội bộ",
    model,
    webSearch: false,
    webRetrievalCount: 0,
    knowledgeMatchCount: knowledgeMatches.length,
    mysqlKnowledge: knowledgeMatches,
    gardenData: gardenContext?.gardenData || null,
  };
}

function createAssistantService(deps) {
  const gasDangerThreshold = deps.gasDangerThreshold ?? 400;
  const fallback = createFallbackHelpers(gasDangerThreshold);
  const { buildGardenContext } = createContextBuilder({ ...deps, gasDangerThreshold });

  async function callConfiguredModel(messages, contextJson) {
    if (!hasGeminiKey()) return null;
    return callGemini(messages, contextJson, () => []);
  }

  async function runInternalKnowledge(messages) {
    const latestQuestion = fallback.aiDemoLatestQuestion(messages);
    if (fallback.aiDemoIsSmallTalk(latestQuestion)) {
      return responsePayload({
        answer: "Mình là ChatBot Smart Garden. Mình trả lời dựa trên dữ liệu MySQL của hệ thống và dữ liệu bạn nạp vào, ưu tiên tên cây trước rồi mới xét bệnh, ngưỡng, đất, tưới hoặc điều kiện sống.",
        suggestions: [],
        model: "SmartGardenAssistant",
        gardenContext: { knowledgeMatches: [], gardenData: null },
      });
    }

    const question = fallback.aiDemoContextQuestion(messages);
    const gardenContext = await buildGardenContext(messages);
    const actionButtons = suggestActionButtons(latestQuestion);
    const gardenPriorityAnswer = isGardenPlantListQuestion(question)
      ? gardenPlantListSentence(gardenContext.gardenData)
      : shouldUseGardenPlantData(question, gardenContext.gardenData)
      ? gardenPlantSentence(question, gardenContext.gardenData, gardenContext.knowledgeMatches || [])
      : "";
    let answer = "";
    let model = "MySQL nội bộ";

    if (gardenPriorityAnswer) {
      answer = gardenPriorityAnswer;
      model = "MySQL hệ thống";
    } else if (hasGeminiKey()) {
      try {
        const modelResponse = await callConfiguredModel(messages, gardenContext.contextJson);
        if (modelResponse?.answer) {
          answer = modelResponse.answer;
          model = GEMINI_MODEL;
        }
      } catch (err) {
        console.log("Assistant Gemini error:", err.message);
      }
    }

    if (!answer) {
      answer = buildLocalKnowledgeAnswer(question, gardenContext.gardenData, gardenContext.knowledgeMatches || []);
    }

    return responsePayload({
      answer,
      suggestions: actionButtons,
      model,
      gardenContext,
    });
  }

  async function chat(rawMessages, options = {}) {
    const messages = normalizeMessages(rawMessages, options.question || "");
    if (!messages.length) {
      const err = new Error("Vui lòng nhập câu hỏi");
      err.statusCode = 400;
      throw err;
    }

    if (!aiDemoInScope(messages)) {
      return responsePayload({
        answer: "Mình chỉ trả lời trong phạm vi cây trồng, bệnh cây, đất, nước, phân bón, ngưỡng cảm biến và điều kiện sống. Bạn hãy hỏi lại bằng tên cây, triệu chứng hoặc chỉ số cảm biến cụ thể.",
        suggestions: [],
        model: "local-scope-guard",
        gardenContext: { knowledgeMatches: [], gardenData: null },
      });
    }

    return runInternalKnowledge(messages);
  }

  async function chatForPlantAssistant(rawMessages, options = {}) {
    const messages = normalizeMessages(rawMessages, options.question || "");
    if (!messages.length) {
      const err = new Error("Vui lòng nhập câu hỏi");
      err.statusCode = 400;
      throw err;
    }

    const latestQuestion = fallback.aiDemoLatestQuestion(messages);
    if (!assistantInScope(latestQuestion) && !aiDemoInScope(messages)) {
      return responsePayload({
        answer: "Mình chỉ trả lời các câu hỏi về cây trồng, bệnh cây, ngưỡng cảm biến, đất, nước, phân bón và điều kiện sống lý tưởng.",
        suggestions: [],
        model: "local-scope-guard",
        gardenContext: { knowledgeMatches: [], gardenData: null },
      });
    }

    return chat(messages, options);
  }

  async function getStatus() {
    const geminiConfigured = hasGeminiKey();
    const knowledgeStatus = await getKnowledgeStatus();
    return {
      configured: geminiConfigured,
      provider: geminiConfigured ? "gemini" : "mysql-knowledge",
      mode: geminiConfigured ? "Gemini + MySQL nội bộ" : "MySQL nội bộ",
      model: geminiConfigured ? GEMINI_MODEL : "MySQL nội bộ",
      webSearch: false,
      webRetrieval: false,
      mysqlKnowledge: true,
      mysqlKnowledgeEntries: knowledgeStatus.entries,
      contextMessageLimit: AI_DEMO_CONTEXT_MESSAGE_LIMIT,
    };
  }

  return {
    chat,
    chatForPlantAssistant,
    getStatus,
    normalizeMessages,
  };
}

module.exports = { createAssistantService };
