const { normalizeAssistantText } = require("./text");

const ACTION_RULES = [
  {
    id: "delete_plant",
    label: "Xóa cây",
    description: "Mở danh sách cây để xóa cây đang chọn hoặc cây chính.",
    priority: 100,
    terms: ["xoa cay", "xoa bo cay", "bo cay", "xoa khoi vuon", "remove plant", "delete plant"],
  },
  {
    id: "edit_plant",
    label: "Sửa cây",
    description: "Mở form sửa cây, ngưỡng và thông tin chăm sóc.",
    priority: 95,
    terms: ["sua cay", "chinh sua cay", "cap nhat cay", "doi nguong cay", "sua nguong", "cap nhat nguong"],
  },
  {
    id: "irrigation_control",
    label: "Mở điều khiển tưới",
    description: "Mở khu điều khiển bơm tưới để kiểm tra trước khi bật.",
    priority: 88,
    terms: ["bat tuoi", "tuoi nuoc", "bom tuoi", "dat kho", "kho dat", "thieu nuoc", "do am dat thap", "am dat thap"],
  },
  {
    id: "fan_control",
    label: "Mở điều khiển quạt",
    description: "Mở khu điều khiển quạt/làm mát khi vườn nóng hoặc bí khí.",
    priority: 84,
    terms: ["vuon nong", "bi nong", "qua nong", "nhiet do cao", "soc nhiet", "bi khi", "ngot khi", "thong gio kem", "bat quat"],
  },
  {
    id: "spray_control",
    label: "Mở phun mát",
    description: "Mở khu phun mát khi không khí khô hoặc cần hạ nhiệt nhẹ.",
    priority: 80,
    terms: ["phun mat", "phun suong", "khong khi kho", "do am thap", "bat phun", "lam mat"],
  },
  {
    id: "fire_alerts",
    label: "Xem cảnh báo PCCC",
    description: "Mở cảnh báo khói, khí độc, lửa và trạng thái PCCC.",
    priority: 90,
    terms: ["co khoi", "khoi", "gas", "khi doc", "mui khet", "lua", "pccc", "chay", "bao chay"],
  },
  {
    id: "soil_check",
    label: "Kiểm tra đất",
    description: "Mở phần theo dõi đất để xem pH, độ tơi xốp và thoát nước.",
    priority: 70,
    terms: ["dat kho", "dat bi", "dat chat", "thoat nuoc kem", "ph dat", "gia the", "toi xop"],
  },
  {
    id: "automation_irrigation",
    label: "Cài tưới tự động",
    description: "Mở lịch và ngưỡng tưới tự động.",
    priority: 66,
    terms: ["tu dong tuoi", "lich tuoi", "hen gio tuoi", "nguong tuoi", "bat tu dong"],
  },
  {
    id: "sensor_report",
    label: "Xem cảm biến",
    description: "Mở báo cáo cảm biến và lịch sử điều khiển.",
    priority: 55,
    terms: ["cam bien", "chi so", "bao cao", "nhiet do hien tai", "do am hien tai", "lich su"],
  },
];

function phraseMatches(normalizedQuestion, phrase) {
  if (!phrase) return false;
  if (phrase.includes(" ")) return normalizedQuestion.includes(phrase);
  return new RegExp(`(^|\\s)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(normalizedQuestion);
}

function suggestActionButtons(question = "") {
  const normalized = normalizeAssistantText(question);
  if (!normalized) return [];

  const matches = ACTION_RULES.map((rule) => {
    const hitCount = rule.terms.reduce((sum, term) => sum + (phraseMatches(normalized, normalizeAssistantText(term)) ? 1 : 0), 0);
    return hitCount > 0 ? { ...rule, score: rule.priority + hitCount * 6 } : null;
  })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.priority - a.priority);

  if (!matches.length) return [];

  const best = matches[0];
  const close = matches
    .filter((item) => item.id !== best.id && item.score >= best.score - 8)
    .slice(0, 1);

  return [best, ...close].map(({ id, label, description }) => ({ id, label, description }));
}

module.exports = { suggestActionButtons };
