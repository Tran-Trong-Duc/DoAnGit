function resolveGeminiModel() {
  const preferred = String(process.env.GEMINI_MODEL || "").trim();
  if (preferred) return preferred;
  return "gemini-2.5-flash";
}

const GEMINI_MODEL = resolveGeminiModel();
const AI_DEMO_CONTEXT_MESSAGE_LIMIT = Number(process.env.AI_DEMO_CONTEXT_MESSAGE_LIMIT) || 80;
const AI_DEMO_MAX_MESSAGE_CHARS = Number(process.env.AI_DEMO_MAX_MESSAGE_CHARS) || 4200;
const AI_DEMO_MAX_OUTPUT_TOKENS = Number(process.env.AI_DEMO_MAX_OUTPUT_TOKENS) || 2000;
const AI_ASSISTANT_TIMEOUT_MS = Number(process.env.AI_ASSISTANT_TIMEOUT_MS) || 25000;
const PLANT_ASSISTANT_DB_TIMEOUT_MS = Number(process.env.PLANT_ASSISTANT_DB_TIMEOUT_MS) || 3000;

module.exports = {
  GEMINI_MODEL,
  AI_DEMO_CONTEXT_MESSAGE_LIMIT,
  AI_DEMO_MAX_MESSAGE_CHARS,
  AI_DEMO_MAX_OUTPUT_TOKENS,
  AI_ASSISTANT_TIMEOUT_MS,
  PLANT_ASSISTANT_DB_TIMEOUT_MS,
};
