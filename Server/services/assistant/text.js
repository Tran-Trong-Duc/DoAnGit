const {
  PLANT_ASSISTANT_SCOPE_TERMS,
  PLANT_ASSISTANT_STOP_TERMS,
  PLANT_ASSISTANT_KNOWN_SUBJECTS,
  PLANT_ASSISTANT_SUBJECT_PROFILES,
  AI_DEMO_SMALLTALK_TERMS,
  AI_DEMO_FOLLOW_UP_TERMS,
  AI_DEMO_CLEAR_OUT_OF_SCOPE_TERMS,
} = require("./constants");

function normalizeAssistantText(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assistantInScope(question) {
  const normalized = normalizeAssistantText(question);
  const words = new Set(normalized.split(" ").filter(Boolean));
  return PLANT_ASSISTANT_SCOPE_TERMS.some((term) => (term.includes(" ") ? normalized.includes(term) : words.has(term)));
}

function assistantIntent(question) {
  const normalized = normalizeAssistantText(question);
  const words = new Set(normalized.split(" ").filter(Boolean));
  const hasAny = (terms) => terms.some((term) => (term.includes(" ") ? normalized.includes(term) : words.has(term)));
  const heat = hasAny(["nong", "bi nong", "qua nong", "nhiet do cao", "tang nhiet", "soc nhiet", "nang gat", "lam mat"]);
  const dry = hasAny(["dat kho", "kho dat", "thieu nuoc", "kho han", "am dat thap", "do am dat thap", "dat thap"]);
  const control = hasAny(["bat", "tat", "mo", "kich hoat", "dung", "bom", "quat", "phun", "lam mat", "tu dong", "dieu khien"]);
  const alert = hasAny(["canh bao", "bao dong", "nguy hiem", "vuot nguong", "khi doc", "gas", "lua", "pccc"]);
  return {
    disease: hasAny(["benh", "nam", "sau", "rep", "bo tri", "dom", "vang la", "heo", "thoi re", "thoi goc", "thoi nhun", "phan trang", "suong mai"]),
    threshold: heat || dry || hasAny(["nguong", "nhiet", "do am", "anh sang", "lux", "ph", "cao", "thap", "toi da", "toi thieu"]),
    sensor: heat || dry || alert || hasAny(["hien tai", "cam bien", "vuot", "canh bao", "chi so", "do duoc", "on khong"]),
    water: dry || hasAny(["tuoi", "nuoc", "kho", "ung", "am dat"]),
    fertilizer: hasAny(["phan", "dinh duong", "npk", "kali", "dam", "lan", "canxi"]),
    soil: dry || hasAny(["dat", "ph", "toi xop", "thoat nuoc", "gia the"]),
    system: control || alert || hasAny(["cay chinh", "he thong", "vuon minh", "vuon cua toi", "da luu", "cam bien"]),
    control,
    heat,
    dry,
    alert,
  };
}

function assistantQueryTerms(question) {
  return normalizeAssistantText(question)
    .split(" ")
    .filter((term) => term.length > 2 && !PLANT_ASSISTANT_STOP_TERMS.has(term));
}

function assistantSubjects(question) {
  const normalized = normalizeAssistantText(question);
  return PLANT_ASSISTANT_KNOWN_SUBJECTS.filter((subject) =>
    subject.aliases.some((alias) => normalized.includes(alias))
  );
}

function assistantSubjectProfile(question) {
  const normalized = normalizeAssistantText(question);
  return (
    PLANT_ASSISTANT_SUBJECT_PROFILES.find((profile) =>
      profile.aliases.some((alias) => normalized.includes(alias))
    ) || null
  );
}

function aiDemoLatestQuestion(messages) {
  return [...messages].reverse().find((message) => message.role === "user")?.content || "";
}

function aiDemoIsSmallTalk(text) {
  const normalized = normalizeAssistantText(text);
  const words = new Set(normalized.split(" ").filter(Boolean));
  return (
    normalized === "hi" ||
    normalized === "hello" ||
    words.has("chao") ||
    words.has("help") ||
    AI_DEMO_SMALLTALK_TERMS.some((term) => normalized.includes(term))
  );
}

function aiDemoInScope(messages) {
  const latestQuestion = aiDemoLatestQuestion(messages);
  const latestNormalized = normalizeAssistantText(latestQuestion);
  if (aiDemoIsSmallTalk(latestQuestion)) return true;
  if (assistantInScope(latestQuestion) || assistantSubjects(latestQuestion).length > 0) return true;
  if (AI_DEMO_CLEAR_OUT_OF_SCOPE_TERMS.some((term) => latestNormalized.includes(term))) return false;

  const priorText = messages
    .filter((message) => message.content !== latestQuestion)
    .map((message) => message.content)
    .join(" ");
  const hasPlantContext = assistantInScope(priorText) || assistantSubjects(priorText).length > 0;
  const looksLikeFollowUp = AI_DEMO_FOLLOW_UP_TERMS.some((term) => latestNormalized.includes(term));
  return hasPlantContext && looksLikeFollowUp;
}

function aiDemoContextQuestion(messages) {
  const latestQuestion = aiDemoLatestQuestion(messages);
  if (assistantInScope(latestQuestion) || assistantSubjects(latestQuestion).length > 0) {
    return latestQuestion;
  }

  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .filter(Boolean);

  if (userMessages.length <= 1) return latestQuestion;
  return [
    "Ngữ cảnh người dùng đã cung cấp trước đó:",
    ...userMessages.slice(0, -1).map((content) => `- ${content}`),
    `Câu hỏi mới nhất: ${latestQuestion}`,
  ].join("\n");
}

module.exports = {
  normalizeAssistantText,
  assistantInScope,
  assistantIntent,
  assistantQueryTerms,
  assistantSubjects,
  assistantSubjectProfile,
  aiDemoLatestQuestion,
  aiDemoIsSmallTalk,
  aiDemoInScope,
  aiDemoContextQuestion,
};
