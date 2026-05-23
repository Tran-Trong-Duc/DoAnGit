const {
  GEMINI_MODEL,
  AI_DEMO_MAX_OUTPUT_TOKENS,
  AI_ASSISTANT_TIMEOUT_MS,
} = require("./config");
const { buildInstructionsWithGardenContext } = require("./prompts");
const { aiDemoLatestQuestion } = require("./text");

let geminiCooldownUntil = 0;

function getGeminiApiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

function hasGeminiKey() {
  const key = getGeminiApiKey();
  return key.length > 10 && !/^your_|^paste_|^xxx/i.test(key);
}

function friendlyGeminiWarning(err) {
  const message = String(err?.message || "");
  if (/quota|billing|resource_exhausted|exceeded|limit/i.test(message)) {
    return "Gemini API đang hết quota hoặc vượt giới hạn; mình đã dùng fallback nội bộ để trả lời tạm thời.";
  }
  if (/api_key|api key|invalid|authentication|401|403|permission/i.test(message)) {
    return "Gemini API key chưa hợp lệ hoặc chưa bật Generative Language API; mình đã dùng fallback nội bộ.";
  }
  if (/rate limit|429/i.test(message)) {
    return "Gemini API đang bị giới hạn tốc độ; mình đã dùng fallback nội bộ để trả lời tạm thời.";
  }
  return "Gemini API chưa phản hồi ổn định; mình đã dùng fallback nội bộ để trả lời tạm thời.";
}

function buildGeminiContents(messages) {
  const contents = [];

  for (const message of messages) {
    const role = message.role === "assistant" ? "model" : "user";
    const text = String(message.content || "").trim();
    if (!text) continue;

    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts[0].text = `${last.parts[0].text}\n\n${text}`;
    } else {
      contents.push({ role, parts: [{ text }] });
    }
  }

  if (!contents.length) {
    contents.push({ role: "user", parts: [{ text: "Xin chào" }] });
  } else if (contents[0].role !== "user") {
    contents.unshift({ role: "user", parts: [{ text: "(tiếp tục hội thoại trước đó)" }] });
  }

  return contents;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function requestGeminiGenerate(payload, apiKey) {
  const model = encodeURIComponent(GEMINI_MODEL);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_ASSISTANT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }

    if (!res.ok) {
      const message =
        data?.error?.message ||
        data?.error?.status ||
        (Array.isArray(data?.error?.details) && data.error.details[0]?.message) ||
        `Gemini API lỗi ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(messages, contextJson, getSuggestions) {
  if (!hasGeminiKey()) return null;
  if (Date.now() < geminiCooldownUntil) return null;
  const apiKey = getGeminiApiKey();

  const payload = {
    systemInstruction: {
      parts: [{ text: buildInstructionsWithGardenContext(contextJson) }],
    },
    contents: buildGeminiContents(messages),
    generationConfig: {
      maxOutputTokens: AI_DEMO_MAX_OUTPUT_TOKENS,
      temperature: 0.25,
    },
  };

  let data;
  try {
    data = await requestGeminiGenerate(payload, apiKey);
  } catch (err) {
    if (/quota|rate limit|429|resource_exhausted|exceeded/i.test(String(err.message || ""))) {
      geminiCooldownUntil = Date.now() + 60 * 1000;
    }
    throw err;
  }

  return {
    answer: extractGeminiText(data) || "Mình chưa tạo được câu trả lời rõ ràng cho câu hỏi này.",
    suggestions: getSuggestions(aiDemoLatestQuestion(messages)),
    warning: "",
    mode: "Gemini API",
    model: GEMINI_MODEL,
    webSearch: false,
  };
}

module.exports = {
  hasGeminiKey,
  friendlyGeminiWarning,
  callGemini,
  GEMINI_MODEL,
};
