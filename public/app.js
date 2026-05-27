const initialAppParams = new URLSearchParams(window.location.search);
const initialAppToken = initialAppParams.get("token");
if (initialAppToken) {
  localStorage.setItem("token", initialAppToken);
  document.cookie = "sg_token=" + encodeURIComponent(initialAppToken) + "; path=/; max-age=604800";
}

if (!localStorage.getItem("token")) {
  window.location = "/login.html";
}

const API = window.location.origin;
const DATA_REFRESH_INTERVAL_MS = 2000;
const CHART_DEFAULT_RANGE_DAYS = 7;
const CHART_MAX_POINTS = 900;
const MAX_PLANT_IMAGE_BYTES = 5 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const COUNTDOWN_SYNC_DRIFT_MS = 2500;
const PLANT_CHAT_HISTORY_LIMIT = 16;
const IRRIGATION_FLOW_RATE_STORAGE_KEY = "sg_irrigation_flow_rate_lpm";

// Cache du lieu tren trinh duyet de form sua/chon co the dung lai ma khong goi API lap lai.
let plantsCache = [];
let gardensCache = [];
let devicesCache = [];
let fertilizersCache = [];
let soilRecordsCache = [];
let autoSchedulesCache = [];
let autoScheduleEditId = null;
let mainPlant = null;
let autoDisabledState = {
  irrigation: false,
  fan: false,
  spray: false,
  cooling: false,
};
let autoIrrigationModeState = "sensor";
const AUTO_RULE_DEVICE_OPTIONS = {
  irrigation: { label: "Tưới tự động", buttonId: "autoSetupIrrigationButton" },
  fan: { label: "Điều khiển quạt tự động", buttonId: "autoSetupFanButton" },
  spray: { label: "Phun làm mát tự động", buttonId: "autoSetupSprayButton" },
};
const AUTO_SCHEDULE_DEVICE_OPTIONS = {
  irrigation: { label: "Bơm tưới", buttonId: "autoScheduleIrrigationButton" },
  fan: { label: "Quạt", buttonId: "autoScheduleFanButton" },
  spray: { label: "Phun làm mát", buttonId: "autoScheduleSprayButton" },
};
const AUTO_RULE_SENSOR_OPTIONS = [
  { key: "temperature", label: "Nhiệt độ", unit: "°C" },
  { key: "humidity", label: "Độ ẩm không khí", unit: "%" },
  { key: "soil_moisture", label: "Độ ẩm đất", unit: "%" },
  { key: "light", label: "Ánh sáng", unit: " lux" },
  { key: "gas", label: "Khí độc", unit: " ppm", noBelow: true },
  { key: "flame", label: "Cảm biến lửa", fireOnly: true },
];
const AUTO_RULE_DIRECTIONS = [
  { key: "below", label: "Dưới ngưỡng" },
  { key: "inside", label: "Trong ngưỡng" },
  { key: "above", label: "Trên ngưỡng" },
];
const DEFAULT_AUTO_RULE_STATE = {
  irrigation: { soil_moisture: { below: true, above: false } },
  fan: { temperature: { below: false, above: true }, humidity: { below: false, above: true }, gas: { below: false, above: true } },
  spray: { temperature: { below: false, above: true }, humidity: { below: true, above: false } },
};
let activeAutoSetupDevice = "irrigation";
let activeAutoScheduleDevice = "irrigation";
let autoRulesState = createDefaultAutoRules();
let currentAlert = null;
let alertStream = null;
let alertStreamReconnectTimer = null;
let alertMutedState = false;
let alertSettingsState = {
  popup_enabled: true,
  temp_enabled: true,
  humidity_enabled: true,
  soil_enabled: true,
  light_enabled: true,
  gas_enabled: true,
  action_enabled: true,
};
let systemStatusState = {
  mqttConnected: false,
  simulateSensor: true,
  emergencyActive: false,
  fireProtectionActive: false,
  fireSimulationActive: false,
};
let controlStatusState = {};
let deviceCountdownEndState = {};
let chartDataSignature = "";
let chartRangeDays = CHART_DEFAULT_RANGE_DAYS;
let chartSensorsCache = [];
let chartLatestCache = null;
let chartCustomStartMs = null;
let chartCustomEndMs = null;
let activeConfirmResolve = null;
let internalSearchQuery = "";
let currentSystemSearchMatches = [];
let plantChatMessages = [];
let plantChatRequestId = 0;
const savedIrrigationFlowRateRaw = localStorage.getItem(IRRIGATION_FLOW_RATE_STORAGE_KEY);
const savedIrrigationFlowRate = savedIrrigationFlowRateRaw === null ? NaN : Number(savedIrrigationFlowRateRaw);
let irrigationFlowRateLitersPerMinute = Number.isFinite(savedIrrigationFlowRate) && savedIrrigationFlowRate >= 0
  ? savedIrrigationFlowRate
  : 1;
let cseElementReadyPromise = null;
let cseElementCx = "";
let cseRenderCounter = 0;

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  document.cookie = "sg_token=; Max-Age=0; path=/";
  window.location.href = "/login.html";
}

function normalizeSearchText(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function navButtonForPage(pageId) {
  return Array.from(document.querySelectorAll(".nav")).find((button) =>
    (button.getAttribute("onclick") || "").includes(`'${pageId}'`)
  );
}

function openSystemPage(pageId) {
  showPage(pageId, navButtonForPage(pageId));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openSystemForm(pageId, formAction) {
  openSystemPage(pageId);
  window.setTimeout(() => {
    if (typeof formAction === "function") formAction();
  }, 80);
}

function formatWaterAmount(liters) {
  const number = Number(liters);
  if (!Number.isFinite(number) || number <= 0) return "0 L";
  const rounded = number >= 10 ? Math.round(number) : Math.round(number * 10) / 10;
  return `${rounded} L`;
}

function formatWaterFlowRate(litersPerMinute) {
  const number = Number(litersPerMinute);
  if (!Number.isFinite(number) || number <= 0) return "0 Lít/phút";
  const rounded = Math.round(number * 10) / 10;
  return `${rounded} Lít/phút`;
}

function updateWaterFlowEstimate() {
  const durationInput = document.getElementById("manualIrrigationDuration");
  const flowInput = document.getElementById("waterFlowRate");
  const estimate = document.getElementById("irrigationWaterEstimate");
  const saveButton = document.getElementById("saveWaterFlowRateButton");
  if (!durationInput || !flowInput || !estimate) return;

  const flowRate = Number(flowInput.value);
  const previewFlowRate = Number.isFinite(flowRate) && flowRate >= 0 ? flowRate : 0;
  const durationSeconds = Number(durationInput.value);
  const waterLiters = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? previewFlowRate * durationSeconds / 60
    : 0;
  estimate.innerText = formatWaterFlowRate(previewFlowRate);
  estimate.title = `Lượng nước theo thời gian tưới hiện tại: ${formatWaterAmount(waterLiters)}`;

  if (saveButton) {
    const changed = previewFlowRate !== irrigationFlowRateLitersPerMinute;
    saveButton.innerText = changed ? "Gán lưu lượng" : "Đã gán";
    saveButton.classList.toggle("is-saved", !changed);
  }
}

function saveWaterFlowRate() {
  const flowInput = document.getElementById("waterFlowRate");
  const saveButton = document.getElementById("saveWaterFlowRateButton");
  const flowRate = Number(flowInput?.value);

  if (!Number.isFinite(flowRate) || flowRate < 0) {
    if (saveButton) {
      saveButton.innerText = "Nhập lại";
      saveButton.classList.remove("is-saved");
    }
    flowInput?.focus();
    return;
  }

  irrigationFlowRateLitersPerMinute = flowRate;
  localStorage.setItem(IRRIGATION_FLOW_RATE_STORAGE_KEY, String(flowRate));
  updateWaterFlowEstimate();
  setWaterFlowEditorOpen(false);
}

function setWaterFlowEditorOpen(open) {
  const editor = document.getElementById("waterFlowEditor");
  const toggle = document.getElementById("waterFlowToggle");
  const card = editor?.closest(".irrigation-control-card");
  if (!editor || !toggle) return;

  if (!open) {
    const flowInput = document.getElementById("waterFlowRate");
    if (flowInput) flowInput.value = String(irrigationFlowRateLitersPerMinute);
  }
  editor.classList.toggle("hidden", !open);
  toggle.setAttribute("aria-expanded", String(open));
  card?.classList.toggle("flow-editor-open", open);
  updateWaterFlowEstimate();
  if (open) document.getElementById("waterFlowRate")?.focus();
}

function toggleWaterFlowEditor() {
  const editor = document.getElementById("waterFlowEditor");
  if (!editor) return;
  setWaterFlowEditorOpen(editor.classList.contains("hidden"));
}

function initWaterFlowControls() {
  const durationInput = document.getElementById("manualIrrigationDuration");
  const flowInput = document.getElementById("waterFlowRate");
  if (flowInput) flowInput.value = String(irrigationFlowRateLitersPerMinute);
  durationInput?.addEventListener("input", updateWaterFlowEstimate);
  flowInput?.addEventListener("input", updateWaterFlowEstimate);
  updateWaterFlowEstimate();
}

function focusSystemElement(selector) {
  const target = document.querySelector(selector);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  if (typeof target.focus === "function") target.focus();
  if (target.tagName === "INPUT" && typeof target.select === "function") target.select();
}

function openSystemTarget(pageId, selector, beforeFocus) {
  openSystemPage(pageId);
  window.setTimeout(async () => {
    if (typeof beforeFocus === "function") await beforeFocus();
    window.setTimeout(() => focusSystemElement(selector), 80);
  }, 80);
}

function openAutoSetupTarget(device) {
  openSystemTarget("automation", "#autoRuleGrid", async () => {
    await setAutoIrrigationMode("sensor");
    setAutoSetupDevice(device);
  });
}

function openAutoScheduleTarget(device) {
  openSystemTarget("automation", "#autoScheduleArea", async () => {
    await setAutoIrrigationMode("schedule");
    setAutoScheduleDevice(device);
  });
}

function getCurrentSearchQuery() {
  return (document.getElementById("globalPlantSearch")?.value || internalSearchQuery || "").trim();
}

function openAiDemoChat(query = "") {
  const params = new URLSearchParams();
  const token = localStorage.getItem("token") || "";
  const prompt = String(query || "").trim();
  if (token) params.set("token", token);
  if (prompt) params.set("q", prompt);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  window.location.href = `/chatBot${suffix}`;
}

const plantAssistantScopeTerms = [
  "cay", "trong", "rau", "hoa", "qua", "la", "re", "than", "hat",
  "benh", "nam", "sau", "rep", "dom", "vang la", "heo", "thoi re", "thoi goc", "thoi nhun", "suong", "phan trang",
  "nguong", "nhiet", "do am", "dat", "ph", "anh sang", "lux", "khi doc", "gas",
  "tuoi", "nuoc", "phan bon", "dinh duong", "song", "ly tuong", "sinh truong", "cam bien",
  "ca chua", "dua leo", "dua chuot", "ot", "xa lach", "rau cai", "rau muong", "hung que",
];

const plantAssistantExamples = [
  "Ngưỡng nhiệt độ của cây chính là bao nhiêu?",
  "Cà chua cần điều kiện sống thế nào?",
  "Lá bị đốm vàng là bệnh gì?",
];

const plantKnowledgeBase = [
  {
    name: "Cà chua",
    aliases: ["ca chua", "tomato"],
    thresholds: ["Nhiệt độ phù hợp 18-30°C, giai đoạn ra hoa đậu quả thường ổn ở 20-26°C.", "Độ ẩm không khí nên vừa phải khoảng 60-75%, tránh ẩm kéo dài trên lá.", "Đất tơi xốp, thoát nước tốt, pH khoảng 6.0-6.8.", "Cần nắng trực tiếp 6-8 giờ mỗi ngày."],
    ideal: ["Giữ đất ẩm đều nhưng không úng; tưới vào gốc, hạn chế làm ướt lá buổi tối.", "Tỉa lá già sát gốc để thông thoáng và giảm nấm bệnh.", "Bón cân đối, tránh dư đạm vì cây dễ tốt lá nhưng yếu hoa."],
    diseases: ["Sương mai: đốm nâu hoặc mảng úa trên lá, lan nhanh khi ẩm lạnh.", "Héo rũ: cây héo cả cành dù đất còn ẩm, thường liên quan nấm hoặc vi khuẩn trong đất.", "Thối rễ: rễ nâu đen, cây chậm lớn khi đất úng."],
  },
  {
    name: "Dưa leo",
    aliases: ["dua leo", "dua chuot", "cucumber"],
    thresholds: ["Nhiệt độ hợp 22-30°C, dưới 16°C cây sinh trưởng chậm.", "Độ ẩm đất nên ổn định 65-85%, thiếu nước dễ đắng quả.", "pH đất khoảng 6.0-7.0, đất cần thoát nước nhanh.", "Cần ánh sáng mạnh 6-8 giờ mỗi ngày."],
    ideal: ["Làm giàn để lá thông thoáng và quả ít chạm đất.", "Tưới đều vào sáng sớm hoặc chiều mát, tránh khô hạn rồi tưới dồn.", "Theo dõi phấn trắng khi thời tiết ẩm và tán lá dày."],
    diseases: ["Phấn trắng: lớp bột trắng trên lá, làm lá vàng và khô dần.", "Sương mai: mảng vàng góc cạnh trên lá, mặt dưới có mốc xám.", "Thối gốc: thường gặp khi giá thể ẩm bí."],
  },
  {
    name: "Ớt",
    aliases: ["ot", "chili", "pepper"],
    thresholds: ["Nhiệt độ phù hợp 20-32°C, đậu quả kém khi quá nóng hoặc quá lạnh.", "Độ ẩm không khí khoảng 60-75%; tán quá ẩm dễ phát sinh nấm.", "Đất pH khoảng 6.0-6.8, thoát nước tốt.", "Cần nắng 6 giờ trở lên mỗi ngày."],
    ideal: ["Giữ ẩm vừa phải, để mặt đất se nhẹ rồi tưới lại.", "Bổ sung kali và canxi khi cây mang quả để hạn chế rụng hoa, thối đuôi quả.", "Không trồng quá dày để giảm rệp, bọ trĩ và nấm lá."],
    diseases: ["Thán thư: đốm lõm trên quả, thường nặng khi mưa ẩm.", "Héo xanh: cây héo nhanh, thân có thể còn xanh.", "Xoăn lá: thường liên quan bọ trĩ, rệp hoặc virus."],
  },
  {
    name: "Xà lách",
    aliases: ["xa lach", "lettuce"],
    thresholds: ["Nhiệt độ mát 15-24°C; nóng kéo dài cây dễ đắng và vươn ngồng.", "Độ ẩm đất khoảng 60-75%, cần ẩm đều nhưng không úng.", "pH đất khoảng 6.0-7.0, giá thể sạch và tơi.", "Ánh sáng vừa đến mạnh; nắng gắt cần che nhẹ."],
    ideal: ["Tưới nhẹ và đều, ưu tiên sáng sớm.", "Giữ luống thông thoáng để hạn chế thối nhũn.", "Thu hoạch khi lá đủ lớn, tránh để cây già trong thời tiết nóng."],
    diseases: ["Thối nhũn: lá mềm nhũn, mùi khó chịu khi ẩm bí.", "Cháy mép lá: thường do nóng, thiếu canxi hoặc tưới thất thường.", "Đốm lá: xuất hiện khi lá ướt lâu và mật độ dày."],
  },
  {
    name: "Rau cải",
    aliases: ["rau cai", "cai xanh", "cai ngot", "brassica"],
    thresholds: ["Nhiệt độ phù hợp 18-28°C.", "Độ ẩm đất khoảng 60-80%, tránh để khô héo giữa trưa.", "pH đất khoảng 6.0-7.0.", "Ánh sáng 4-6 giờ nắng hoặc sáng tán xạ mạnh."],
    ideal: ["Bón hữu cơ hoai mục và bổ sung đạm vừa phải sau khi cây bén rễ.", "Che lưới nếu sâu tơ, bọ nhảy xuất hiện nhiều.", "Luân canh để giảm bệnh đất và sâu họ cải."],
    diseases: ["Sâu tơ, bọ nhảy: lá thủng lỗ nhỏ, cây con yếu nhanh.", "Thối nhũn: gốc và bẹ lá mềm nhũn khi ẩm bí.", "Sương mai: vệt vàng trên lá, mặt dưới có mốc."],
  },
];

const diseaseKnowledgeBase = [
  { name: "Sương mai", aliases: ["suong mai", "downy mildew"], signs: "Vệt vàng hoặc nâu lan theo gân lá, mặt dưới có mốc xám khi ẩm.", actions: "Tăng thông gió, giảm tưới lên lá, tỉa lá bệnh và cách ly cây nặng." },
  { name: "Phấn trắng", aliases: ["phan trang", "powdery mildew"], signs: "Lớp bột trắng trên mặt lá, lá vàng và khô dần.", actions: "Giảm mật độ tán, tăng nắng sáng, loại bỏ lá bệnh và tránh dư đạm." },
  { name: "Thối rễ", aliases: ["thoi re", "ung re", "root rot"], signs: "Cây héo dù đất ẩm, rễ nâu đen và có mùi khó chịu.", actions: "Ngưng tưới dồn, cải thiện thoát nước, thay giá thể nhiễm nặng." },
  { name: "Đốm lá", aliases: ["dom la", "la dom", "leaf spot"], signs: "Đốm tròn nâu, vàng hoặc đen trên lá, nặng thì lá khô rụng.", actions: "Tỉa lá bệnh, tưới vào gốc, giữ lá khô và dọn tàn dư cây." },
  { name: "Héo rũ", aliases: ["heo ru", "heo xanh", "wilt"], signs: "Cây héo nhanh từng nhánh hoặc toàn cây, đôi khi đất vẫn ẩm.", actions: "Kiểm tra rễ và gốc, cách ly cây bệnh, tránh dùng lại đất nghi nhiễm." },
  { name: "Rệp và bọ trĩ", aliases: ["rep", "bo tri", "con trung", "sau hai"], signs: "Lá xoăn, chồi non biến dạng, có chấm bạc hoặc dịch dính.", actions: "Rửa mặt dưới lá, cắt bỏ chồi nặng, dùng bẫy dính và kiểm soát kiến." },
];

function runInternalSearchFromSuggestion() {
  const query = getCurrentSearchQuery();
  if (!query) return;
  hideSystemSearchSuggestions();
  openInternalSearch(query);
}

const systemSearchActions = [
  { label: "Tổng quan hệ thống", description: "Xem cây chính, biểu đồ, cảm biến và trạng thái hệ thống.", keywords: "tong quan dashboard bieu do cam bien trang thai he thong cay chinh", run: () => openSystemPage("dashboard") },
  { label: "Quản lý cây trồng", description: "Mở danh sách cây trồng và thông tin cây chính.", keywords: "cay trong cay chinh danh sach cay nguong cay mo ta ph dat ly tuong", run: () => openSystemPage("plants") },
  { label: "Thêm/Sửa/Xóa cây trồng", description: "Mở khu cây trồng để thêm, sửa hoặc xóa cây.", keywords: "them sua xoa cay trong crud cay danh sach cay quan ly cay", run: () => openSystemTarget("plants", "#plantList") },
  { label: "Thêm cây trồng mới", description: "Mở form thêm cây, ngưỡng môi trường và đất lý tưởng.", keywords: "them cay tao cay trong moi nguong anh sang nhiet do do am dat ly tuong", run: () => openSystemForm("plants", () => showPlantForm()) },
  { label: "Điều khiển hệ thống", description: "Mở điều khiển tưới, quạt, phun mát và làm mát.", keywords: "dieu khien tuoi bom tuoi quat phun mat lam mat thu cong thiet bi", run: () => openSystemPage("controls") },
  { label: "Điều khiển tưới thủ công", description: "Mở ô nhập thời gian tưới và nút bật/dừng bơm tưới.", keywords: "tuoi thu cong bom tuoi bat tuoi dung tuoi thoi gian tuoi manual irrigation dat kho can tuoi", run: () => openSystemTarget("controls", "#manualIrrigationDuration") },
  { label: "Điều khiển quạt thủ công", description: "Mở ô thời gian quạt, bật hoặc dừng quạt.", keywords: "quat thu cong bat quat dung quat tat quat thoi gian quat fan nong vuon nong bi nong khi nong", run: () => openSystemTarget("controls", "#fanDuration") },
  { label: "Điều khiển phun nước làm mát", description: "Mở ô thời gian phun nước/phun mát.", keywords: "phun nuoc phun mat phun suong bat phun dung phun spray lam mat vuon nong kho nong", run: () => openSystemTarget("controls", "#sprayDuration") },
  { label: "Làm mát theo thời gian", description: "Mở chức năng chạy quạt và phun mát trong số giây đã nhập.", keywords: "lam mat theo thoi gian quat phun nuoc cooling timer bat lam mat dung lam mat", run: () => openSystemTarget("controls", "#coolingDuration") },
  { label: "Làm mát tới nhiệt độ", description: "Mở chức năng làm mát liên tục tới nhiệt độ mục tiêu.", keywords: "lam mat den nhiet do muc tieu nhiet do mong muon target temp cooling target vuon nong giam nhiet", run: () => openSystemTarget("controls", "#targetTemp") },
  { label: "Bật/dừng bơm tưới ngay", description: "Chạy hoặc dừng bơm tưới theo trạng thái hiện tại.", keywords: "bat tuoi ngay dung tuoi ngay tat bom tuoi bat bom tuoi tuoi cay dat kho", run: () => openSystemForm("controls", () => irrigate()) },
  { label: "Bật/dừng quạt ngay", description: "Chạy hoặc dừng quạt theo trạng thái hiện tại.", keywords: "bat quat ngay dung quat ngay tat quat vuon nong bi nong fan", run: () => openSystemForm("controls", () => fanTimer()) },
  { label: "Bật/dừng phun mát ngay", description: "Chạy hoặc dừng phun nước theo trạng thái hiện tại.", keywords: "bat phun ngay dung phun ngay tat phun phun nuoc phun mat spray", run: () => openSystemForm("controls", () => sprayTimer()) },
  { label: "Điều khiển tự động", description: "Mở setup tự động và lịch điều khiển tự động.", keywords: "tu dong auto lich tuoi hen gio tuoi theo lich cam bien", run: () => openSystemPage("automation") },
  { label: "Setup tự động theo cảm biến", description: "Mở vùng chọn ngưỡng/cảm biến để điều khiển thiết bị tự động.", keywords: "setup tu dong cam bien nguong tren nguong duoi nguong trong nguong khong su dung", run: () => openSystemTarget("automation", "#autoSetupArea", () => setAutoIrrigationMode("sensor")) },
  { label: "Setup tưới tự động", description: "Mở cấu hình ngưỡng cảm biến cho bơm tưới tự động.", keywords: "setup tuoi tu dong bom tuoi cam bien do am dat dat kho tren nguong duoi nguong", run: () => openAutoSetupTarget("irrigation") },
  { label: "Setup quạt tự động", description: "Mở cấu hình ngưỡng cảm biến cho quạt tự động.", keywords: "setup quat tu dong fan nhiet do do am khi doc bi nong vuon nong", run: () => openAutoSetupTarget("fan") },
  { label: "Setup phun mát tự động", description: "Mở cấu hình ngưỡng cảm biến cho phun mát tự động.", keywords: "setup phun mat tu dong spray phun nuoc nhiet do do am vuon nong", run: () => openAutoSetupTarget("spray") },
  { label: "Điều khiển tự động theo lịch", description: "Mở vùng lịch điều khiển tự động theo thời gian.", keywords: "dieu khien tu dong theo lich lich tu dong hen gio theo gio schedule", run: () => openSystemTarget("automation", "#autoScheduleArea", () => setAutoIrrigationMode("schedule")) },
  { label: "Thêm/Sửa/Xóa lịch tự động", description: "Mở danh sách lịch để thêm, sửa hoặc xóa lịch điều khiển tự động.", keywords: "them sua xoa lich tu dong crud lich hen gio auto schedule", run: () => openSystemTarget("automation", "#autoScheduleList", () => setAutoIrrigationMode("schedule")) },
  { label: "Thêm lịch tự động", description: "Mở form nhập giờ, phút và thời gian chạy cho lịch mới.", keywords: "them lich tu dong tao lich moi hen gio them hen gio auto schedule", run: () => openSystemTarget("automation", "#autoHour", () => setAutoIrrigationMode("schedule")) },
  { label: "Lịch bơm tưới tự động", description: "Mở danh sách và form lịch riêng cho bơm tưới.", keywords: "lich bom tuoi lich tuoi hen gio tuoi gio tuoi tu dong irrigation schedule", run: () => openAutoScheduleTarget("irrigation") },
  { label: "Lịch quạt tự động", description: "Mở danh sách và form lịch riêng cho quạt.", keywords: "lich quat hen gio quat gio chay quat fan schedule tu dong", run: () => openAutoScheduleTarget("fan") },
  { label: "Lịch phun mát tự động", description: "Mở danh sách và form lịch riêng cho phun mát.", keywords: "lich phun mat lich phun nuoc hen gio phun spray schedule", run: () => openAutoScheduleTarget("spray") },
  { label: "Lưu lịch tự động", description: "Mở vùng lịch để nhập giờ, phút và thời gian chạy.", keywords: "luu lich tu dong them lich cap nhat lich gio phut thoi gian chay", run: () => openSystemTarget("automation", "#autoHour", () => setAutoIrrigationMode("schedule")) },
  { label: "Bật/tắt toàn bộ tự động", description: "Đổi trạng thái tự động cho toàn bộ thiết bị.", keywords: "bat tat tu dong auto toan bo che do tu dong tat auto bat auto thiet bi", run: () => openSystemForm("automation", () => toggleAllDeviceAuto()) },
  { label: "Bật/tắt bơm tưới tự động", description: "Đổi trạng thái tự động riêng cho bơm tưới.", keywords: "bat tat bom tuoi tu dong auto irrigation tuoi cay bom nuoc", run: () => openSystemForm("automation", () => toggleDeviceAuto("irrigation")) },
  { label: "Bật/tắt quạt tự động", description: "Đổi trạng thái tự động riêng cho quạt.", keywords: "bat tat quat tu dong auto fan lam mat khong khi", run: () => openSystemForm("automation", () => toggleDeviceAuto("fan")) },
  { label: "Bật/tắt phun mát tự động", description: "Đổi trạng thái tự động riêng cho phun mát.", keywords: "bat tat phun mat tu dong auto spray phun nuoc lam mat", run: () => openSystemForm("automation", () => toggleDeviceAuto("spray")) },
  { label: "Bật/tắt làm mát tự động", description: "Đổi trạng thái tự động riêng cho chế độ làm mát.", keywords: "bat tat lam mat tu dong auto cooling nhiet do muc tieu", run: () => openSystemForm("automation", () => toggleDeviceAuto("cooling")) },
  { label: "Bật/tắt mô phỏng cảm biến", description: "Đổi trạng thái mô phỏng dữ liệu cảm biến.", keywords: "bat tat mo phong gia lap cam bien du lieu simulation sensor", run: () => openSystemForm("dashboard", () => toggleSimulation()) },
  { label: "Bật/tắt giả lập PCCC", description: "Đổi trạng thái giả lập phòng cháy chữa cháy.", keywords: "bat tat gia lap pccc phong chay chua chay lua fire simulation", run: () => openSystemForm("alerts", () => toggleFireSimulation()) },
  { label: "Bật/tắt cảnh báo", description: "Tạm tắt hoặc bật lại thông báo cảnh báo mới.", keywords: "bat tat canh bao thong bao alert mute an hien popup", run: () => openSystemForm("alerts", () => toggleAlertMute()) },
  { label: "Dừng khẩn cấp", description: "Tắt toàn bộ thiết bị theo chế độ khẩn cấp.", keywords: "dung khan cap emergency stop tat tat ca thiet bi tat toan bo", run: () => openSystemForm("dashboard", () => toggleEmergency()) },
  { label: "Quản lý bón phân", description: "Xem và ghi nhận lịch sử bón phân.", keywords: "bon phan phan bon lich su bon phan so luong phuong phap", run: () => openSystemPage("fertilizers") },
  { label: "Thêm/Sửa/Xóa bón phân", description: "Mở danh sách bón phân để thêm, sửa hoặc xóa lần bón.", keywords: "them sua xoa bon phan crud phan bon lich su bon phan", run: () => openSystemTarget("fertilizers", "#fertilizerList") },
  { label: "Thêm bón phân mới", description: "Mở form thêm thông tin bón phân.", keywords: "them bon phan tao lan bon phan moi ghi nhan phan bon", run: () => openSystemForm("fertilizers", () => showFertilizerForm()) },
  { label: "Theo dõi đất", description: "Xem pH, loại đất, độ tơi xốp và thoát nước thực tế.", keywords: "theo doi dat ph dat loai dat toi xop thoat nuoc dat thuc te", run: () => openSystemPage("soil") },
  { label: "Thêm/Sửa/Xóa thông tin đất", description: "Mở danh sách đất để thêm, sửa hoặc xóa bản ghi đất.", keywords: "them sua xoa thong tin dat crud dat ph loai dat soil", run: () => openSystemTarget("soil", "#soilRecordList") },
  { label: "Thêm thông tin đất", description: "Mở form thêm bản ghi đất thực tế trong vườn.", keywords: "them thong tin dat ban ghi dat ph loai dat do toi xop kha nang thoat nuoc", run: () => openSystemForm("soil", () => showSoilRecordForm()) },
  { label: "Quản lý vườn", description: "Mở danh sách vườn và thông tin thiết bị trong vườn.", keywords: "quan ly vuon danh sach vuon vi tri thiet bi trong vuon", run: () => openSystemPage("gardens") },
  { label: "Thêm/Sửa/Xóa vườn", description: "Mở danh sách vườn để thêm, sửa hoặc xóa vườn.", keywords: "them sua xoa vuon crud quan ly vuon danh sach vuon", run: () => openSystemTarget("gardens", "#gardenList") },
  { label: "Thêm vườn mới", description: "Mở form thêm vườn.", keywords: "them vuon tao vuon moi vi tri user id thong tin thiet bi", run: () => openSystemForm("gardens", () => showGardenForm()) },
  { label: "Quản lý thiết bị", description: "Mở danh sách thiết bị, trạng thái và MQTT topic.", keywords: "thiet bi cam bien bom quat coi relay mqtt topic online offline", run: () => openSystemPage("devices") },
  { label: "Thêm/Sửa/Xóa thiết bị", description: "Mở danh sách thiết bị để thêm, sửa hoặc xóa thiết bị.", keywords: "them sua xoa thiet bi crud cam bien bom quat phun coi mqtt", run: () => openSystemTarget("devices", "#deviceList") },
  { label: "Thêm thiết bị mới", description: "Mở form thêm thiết bị.", keywords: "them thiet bi tao thiet bi moi cam bien bom quat phun coi mqtt", run: () => openSystemForm("devices", () => showDeviceForm()) },
  { label: "Xem báo cáo", description: "Mở dữ liệu cảm biến, log thiết bị và lịch sử tưới.", keywords: "bao cao report du lieu cam bien log thiet bi lich su tuoi excel", run: () => openSystemPage("reports") },
  { label: "Xuất Excel", description: "Xuất báo cáo dữ liệu ra file Excel.", keywords: "xuat excel tai excel bao cao du lieu", run: () => openSystemForm("reports", () => exportExcel()) },
  { label: "Cảnh báo", description: "Mở danh sách cảnh báo và trạng thái phòng cháy chữa cháy.", keywords: "canh bao alert pccc phong chay chua chay khi doc lua nhiet do vuot nguong", run: () => openSystemPage("alerts") },
  { label: "Tải lại cảnh báo", description: "Mở cảnh báo và tải lại danh sách mới nhất.", keywords: "tai lai canh bao refresh alert danh sach canh bao moi nhat", run: () => openSystemForm("alerts", () => loadAlerts(document.getElementById("alertRefreshButton"))) },
  { label: "Đã xem cảnh báo hiện tại", description: "Xác nhận cảnh báo đang mở để ẩn thông báo.", keywords: "da xem canh bao xac nhan canh bao dong canh bao ack alert", run: () => openSystemForm("alerts", () => acknowledgeCurrentAlert()) },
  { label: "Danh sách cảnh báo PCCC", description: "Mở khu phòng cháy chữa cháy và cảnh báo lửa/khói.", keywords: "pccc lua khoi khi doc phong chay chua chay canh bao chay fire", run: () => openSystemTarget("alerts", ".fire-safety-panel") },
  { label: "Trợ lý AI cây trồng", description: "Mở khung chat nhanh với trợ lý cây trồng trong hệ thống.", keywords: "tro ly ai chatbot chat cay trong hoi cay benh nguong dieu kien song gemini mysql", run: () => openPlantChatbotModal() },
  { label: "Mở ChatBot đầy đủ", description: "Chuyển sang trang ChatBot đầy đủ để hỏi và nạp dữ liệu.", keywords: "chatbot day du ai demo ai_demo chat bot nap du lieu excel sua nguon chat mau excel", run: (query) => openAiDemoChat(query) },
  { label: "Nạp dữ liệu ChatBot bằng Excel", description: "Mở trang ChatBot để nạp file Excel tri thức cây trồng.", keywords: "nap du lieu chatbot excel file excel import knowledge tu khoa truong khoa thong tin", run: () => openAiDemoChat("nạp dữ liệu bằng file excel") },
  { label: "Sửa nguồn chat bằng Excel", description: "Mở trang ChatBot để sửa/cập nhật nguồn tri thức bằng Excel.", keywords: "sua nguon chat sua du lieu chatbot update excel cap nhat thong tin sai", run: () => openAiDemoChat("sửa nguồn chat bằng excel") },
  { label: "Tải mẫu Excel ChatBot", description: "Mở trang ChatBot tới phần mẫu Excel nạp dữ liệu.", keywords: "tai mau excel chatbot mau nap du lieu template excel ten cay tu khoa truong khoa", run: () => openAiDemoChat("mẫu excel chatbot") },
  { label: "Sửa cây chính", description: "Mở form sửa cây chính hiện tại.", keywords: "sua cay chinh chinh sua thong tin cay nguong cay dat anh sang", run: () => openSystemForm("plants", () => showPlantForm(mainPlant?.id || null)) },
  { label: "Xóa cây trồng", description: "Mở danh sách cây trồng để chọn cây cần xóa.", keywords: "xoa cay xoa cay trong delete plant remove plant danh sach cay", run: () => openSystemTarget("plants", "#plantList") },
  { label: "Chọn cây chính", description: "Mở danh sách cây để chọn cây chính trong vườn.", keywords: "chon cay chinh dat cay chinh danh sach cay trong vuon", run: () => openSystemPage("plants") },
  { label: "Sửa thiết bị", description: "Mở danh sách thiết bị để chọn thiết bị cần sửa.", keywords: "sua thiet bi sua mqtt topic trang thai thiet bi cam bien bom quat", run: () => openSystemPage("devices") },
  { label: "Xóa thiết bị", description: "Mở danh sách thiết bị để chọn thiết bị cần xóa.", keywords: "xoa thiet bi delete device remove device cam bien bom quat mqtt", run: () => openSystemTarget("devices", "#deviceList") },
  { label: "Sửa vườn", description: "Mở danh sách vườn để chọn vườn cần sửa.", keywords: "sua vuon chinh sua vuon vi tri thong tin thiet bi trong vuon", run: () => openSystemPage("gardens") },
  { label: "Xóa vườn", description: "Mở danh sách vườn để chọn vườn cần xóa.", keywords: "xoa vuon delete garden remove garden danh sach vuon", run: () => openSystemTarget("gardens", "#gardenList") },
  { label: "Sửa thông tin đất", description: "Mở danh sách bản ghi đất để chọn mục cần sửa.", keywords: "sua thong tin dat sua ph loai dat toi xop thoat nuoc", run: () => openSystemPage("soil") },
  { label: "Xóa thông tin đất", description: "Mở danh sách bản ghi đất để chọn mục cần xóa.", keywords: "xoa thong tin dat xoa dat delete soil remove soil ph loai dat", run: () => openSystemTarget("soil", "#soilRecordList") },
  { label: "Sửa bón phân", description: "Mở danh sách bón phân để chọn lần bón cần sửa.", keywords: "sua bon phan chinh sua phan bon so luong phuong phap", run: () => openSystemPage("fertilizers") },
  { label: "Xóa bón phân", description: "Mở danh sách bón phân để chọn lần bón cần xóa.", keywords: "xoa bon phan delete fertilizer remove fertilizer lich su bon phan", run: () => openSystemTarget("fertilizers", "#fertilizerList") },
  { label: "Sửa lịch tự động", description: "Mở danh sách lịch để chọn lịch điều khiển tự động cần sửa.", keywords: "sua lich tu dong sua hen gio edit schedule auto", run: () => openSystemTarget("automation", "#autoScheduleList", () => setAutoIrrigationMode("schedule")) },
  { label: "Xóa lịch tự động", description: "Mở danh sách lịch để chọn lịch điều khiển tự động cần xóa.", keywords: "xoa lich tu dong delete schedule remove schedule auto hen gio", run: () => openSystemTarget("automation", "#autoScheduleList", () => setAutoIrrigationMode("schedule")) },
];

function findSystemSearchMatches(query) {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];

  const terms = normalizedQuery.split(" ").filter((term) => term.length > 1);
  return systemSearchActions
    .map((action, index) => {
      const haystack = normalizeSearchText(`${action.label} ${action.description} ${action.keywords}`);
      let score = haystack.includes(normalizedQuery) ? 8 : 0;
      terms.forEach((term) => {
        if (haystack.includes(term)) score += 2;
      });
      if (normalizeSearchText(action.label).includes(normalizedQuery)) score += 6;
      return { action, index, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 14);
}

function hideSystemSearchSuggestions() {
  const box = document.getElementById("systemSearchSuggestions");
  if (!box) return;
  box.classList.add("hidden");
  box.innerHTML = "";
  currentSystemSearchMatches = [];
}

function renderSystemSearchSuggestions(query) {
  const box = document.getElementById("systemSearchSuggestions");
  if (!box) return [];

  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    hideSystemSearchSuggestions();
    return [];
  }

  const matches = findSystemSearchMatches(query);
  currentSystemSearchMatches = matches;
  box.innerHTML = "";

  const assistantButton = document.createElement("button");
  assistantButton.type = "button";
  assistantButton.className = "system-suggestion-button assistant";

  const assistantIcon = document.createElement("span");
  assistantIcon.className = "system-assistant-icon";
  assistantIcon.textContent = "🔍";

  const assistantCopy = document.createElement("span");
  assistantCopy.className = "system-suggestion-copy";
  const assistantTitle = document.createElement("strong");
  assistantTitle.textContent = "Tìm bằng Google CSE";
  const assistantQuery = document.createElement("span");
  assistantQuery.className = "system-assistant-query";
  assistantQuery.textContent = trimmedQuery;
  assistantCopy.append(assistantTitle, assistantQuery);
  assistantButton.append(assistantIcon, assistantCopy);
  assistantButton.dataset.internalSiteSearch = "true";
  box.appendChild(assistantButton);

  if (matches.length > 0) {
    const title = document.createElement("div");
    title.className = "system-search-title";
    title.textContent = "Chức năng";
    box.appendChild(title);

    matches.forEach(({ action }, index) => {
      const row = document.createElement("div");
      row.className = "system-suggestion-row";
      row.dataset.suggestionIndex = String(index);

      const copy = document.createElement("div");
      copy.className = "system-suggestion-copy";
      const label = document.createElement("strong");
      label.textContent = action.label;
      const description = document.createElement("span");
      description.textContent = action.description;
      copy.append(label, description);

      const enterButton = document.createElement("button");
      enterButton.type = "button";
      enterButton.className = "system-suggestion-enter";
      enterButton.dataset.suggestionIndex = String(index);
      enterButton.textContent = "→";

      row.append(copy, enterButton);
      box.appendChild(row);
    });

  }
  box.classList.remove("hidden");
  return matches;
}

function executeSystemSuggestion(index) {
  const item = currentSystemSearchMatches[index];
  if (!item) return;
  const currentQuery = getCurrentSearchQuery();
  hideSystemSearchSuggestions();
  const input = document.getElementById("globalPlantSearch");
  if (input) input.value = "";
  item.action.run(currentQuery);
}

function setInternalSearchStatus(message = "") {
  const status = document.getElementById("internalSearchStatus");
  if (status) status.innerText = message;
}

function setPlantChatStatus(message = "") {
  const status = document.getElementById("plantChatStatus");
  if (status) status.innerText = message;
}

function getGoogleCseElementApi() {
  return window.google?.search?.cse?.element || null;
}

function waitForGoogleCseElement(timeoutMs = 8000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const api = getGoogleCseElementApi();
      if (api?.render && api?.getElement) {
        resolve(api);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Không tải được Google CSE nhúng."));
        return;
      }
      window.setTimeout(check, 100);
    };
    check();
  });
}

function loadGoogleCseElement(cx) {
  const safeCx = String(cx || "").trim();
  if (!safeCx) {
    return Promise.reject(new Error("Thiếu GOOGLE_CSE_CX."));
  }

  const api = getGoogleCseElementApi();
  if (api?.render && cseElementCx === safeCx) {
    return Promise.resolve(api);
  }

  if (cseElementReadyPromise && cseElementCx === safeCx) {
    return cseElementReadyPromise;
  }

  cseElementCx = safeCx;
  window.__gcse = window.__gcse || {};
  window.__gcse.parsetags = "explicit";

  cseElementReadyPromise = new Promise((resolve, reject) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      waitForGoogleCseElement().then(resolve).catch(reject);
    };

    const previousInit = window.__gcse.initializationCallback;
    window.__gcse.initializationCallback = () => {
      if (typeof previousInit === "function") previousInit();
      done();
    };

    const existing = document.querySelector("script[data-internal-cse-script='true']");
    if (existing?.dataset.cx === safeCx) {
      existing.addEventListener("load", done, { once: true });
      existing.addEventListener("error", () => reject(new Error("Không tải được Google CSE nhúng.")), { once: true });
      waitForGoogleCseElement().then(resolve).catch(() => {});
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://cse.google.com/cse.js?cx=${encodeURIComponent(safeCx)}`;
    script.dataset.internalCseScript = "true";
    script.dataset.cx = safeCx;
    script.onload = done;
    script.onerror = () => reject(new Error("Không tải được Google CSE nhúng."));
    document.head.appendChild(script);
  });

  return cseElementReadyPromise;
}

async function renderCxOnlySearchResults(data, query) {
  const results = document.getElementById("internalSearchResults");
  const setup = document.getElementById("internalSearchSetup");
  const fallback = document.getElementById("internalSearchFallbackText");
  if (!results) return;

  const cx = String(data?.cx || "").trim();
  if (!cx) {
    setup?.classList.remove("hidden");
    const msg = document.getElementById("internalSearchSetupMessage");
    if (msg) msg.textContent = "Thiếu GOOGLE_CSE_CX trong file .env.";
    results.innerHTML = "";
    return;
  }

  setup?.classList.add("hidden");
  fallback?.classList.add("hidden");
  closeInternalSearchPreview();
  const containerId = `internalGoogleCseResults${++cseRenderCounter}`;
  const info = data?.message || "";
  results.innerHTML = `
    <p class="site-search-meta">${escapeHtml(info)}</p>
    <div id="${containerId}" class="cse-container"></div>
  `;
  setInternalSearchStatus("Đang tải kết quả");

  try {
    const api = await loadGoogleCseElement(cx);
    const target = document.getElementById(containerId);
    if (!target) return;

    target.innerHTML = "";
    const gname = `internalCseResults${Date.now()}${cseRenderCounter}`;
    api.render({
      div: target,
      tag: "searchresults-only",
      gname,
      attributes: {
        linkTarget: "_blank",
      },
    });

    const element = api.getElement(gname);
    if (!element?.execute) {
      throw new Error("Google CSE chưa sẵn sàng.");
    }
    element.execute(query);
    setInternalSearchStatus("Kết quả");
  } catch (err) {
    const hostedUrl = `https://cse.google.com/cse?cx=${encodeURIComponent(cx)}#gsc.tab=0&gsc.q=${encodeURIComponent(query)}&gsc.sort=`;
    results.innerHTML = `
      <p class="site-search-empty">Không tải được CSE nhúng: ${escapeHtml(err.message || "lỗi kết nối")}.</p>
      <p class="site-search-empty"><a href="${hostedUrl}" target="_blank" rel="noopener noreferrer">Mở kết quả Google CSE</a></p>
    `;
    setInternalSearchStatus("Lỗi CSE nhúng");
  }
}

function getSafePreviewUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ""), window.location.href);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url;
  } catch {
    return null;
  }
}

function closeInternalSearchPreview() {
  const dialog = document.querySelector(".internal-search-dialog--site");
  const preview = document.getElementById("internalSearchPreview");
  const frame = document.getElementById("internalSearchPreviewFrame");
  const external = document.getElementById("internalSearchPreviewExternal");

  if (frame) frame.removeAttribute("src");
  if (external) external.removeAttribute("href");
  preview?.classList.add("hidden");
  dialog?.classList.remove("has-preview");
}

function openInternalSearchPreview(rawUrl, title = "") {
  const url = getSafePreviewUrl(rawUrl);
  if (!url) return false;

  const dialog = document.querySelector(".internal-search-dialog--site");
  const preview = document.getElementById("internalSearchPreview");
  const frame = document.getElementById("internalSearchPreviewFrame");
  const titleEl = document.getElementById("internalSearchPreviewTitle");
  const urlEl = document.getElementById("internalSearchPreviewUrl");
  const external = document.getElementById("internalSearchPreviewExternal");
  if (!preview || !frame) return false;

  const cleanTitle = String(title || "").replace(/\s+/g, " ").trim();
  if (titleEl) titleEl.textContent = cleanTitle || url.hostname;
  if (urlEl) urlEl.textContent = url.href;
  if (external) external.href = url.href;

  dialog?.classList.add("has-preview");
  preview.classList.remove("hidden");
  frame.removeAttribute("src");
  window.setTimeout(() => {
    frame.src = url.href;
  }, 0);
  preview.scrollIntoView({ block: "nearest" });
  setInternalSearchStatus(`Đang xem trong hệ thống: ${url.hostname}`);
  return true;
}

function handleInternalSearchResultLink(event) {
  const link = event.target.closest?.("a[href]");
  if (!link || !document.getElementById("internalSearchResults")?.contains(link)) return;

  const url = getSafePreviewUrl(link.getAttribute("href"));
  if (!url) return;

  event.preventDefault();
  event.stopPropagation();
  openInternalSearchPreview(url.href, link.textContent);
}

function renderSiteSearchResults(data, query) {
  const results = document.getElementById("internalSearchResults");
  const setup = document.getElementById("internalSearchSetup");
  const fallback = document.getElementById("internalSearchFallbackText");
  if (!results) return;

  if (!data?.configured) {
    setup?.classList.remove("hidden");
    if (setup && data?.message) {
      const msg = document.getElementById("internalSearchSetupMessage");
      if (msg) msg.textContent = data.message;
    }
    fallback?.classList.add("hidden");
    results.innerHTML = "";
    return;
  }

  renderCxOnlySearchResults(data, query);
}

async function runSiteSearch(query) {
  const q = String(query || "").trim();
  if (!q) return null;

  const results = document.getElementById("internalSearchResults");
  if (!results) return null;

  setInternalSearchStatus("Đang tìm bằng Google CSE (CX)...");
  results.innerHTML = `<p class="site-search-empty">Đang tải Google CSE cho “${escapeHtml(q)}”...</p>`;

  try {
    const params = new URLSearchParams({ q });
    const res = await fetch(`${API}/site-search?${params.toString()}`, {
      headers: { Authorization: localStorage.getItem("token") || "" },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Không tải được Google CSE");

    renderSiteSearchResults(data, q);
  } catch (err) {
    results.innerHTML = `
      <p class="site-search-empty">Google CSE chưa trả kết quả: ${escapeHtml(err.message || "lỗi kết nối")}.</p>
    `;
    setInternalSearchStatus("Lỗi tìm kiếm Google CSE");
  }
}

function chatNumber(value, fractionDigits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number.isInteger(number) ? String(number) : number.toFixed(fractionDigits);
}

function chatValue(value, unit = "") {
  const text = chatNumber(value);
  return text === null ? null : `${text}${unit}`;
}

function chatRange(min, max, unit = "") {
  const minText = chatValue(min, unit);
  const maxText = chatValue(max, unit);
  if (minText && maxText) return `${minText} - ${maxText}`;
  if (minText) return `tối thiểu ${minText}`;
  if (maxText) return `tối đa ${maxText}`;
  return null;
}

function normalizedIncludesAny(normalizedText, terms) {
  return terms.some((term) => normalizedText.includes(term));
}

function findKnownPlantForQuery(query) {
  const normalizedQuery = normalizeSearchText(query);
  return plantKnowledgeBase.find((plant) =>
    plant.aliases.some((alias) => normalizedQuery.includes(alias))
  ) || null;
}

function findDiseaseForQuery(query) {
  const normalizedQuery = normalizeSearchText(query);
  return diseaseKnowledgeBase.find((disease) =>
    disease.aliases.some((alias) => normalizedQuery.includes(alias))
  ) || null;
}

function findSavedPlantForQuery(query, plants = []) {
  const normalizedQuery = normalizeSearchText(query);
  return plants.find((plant) => {
    const normalizedName = normalizeSearchText(plant.name);
    return normalizedName && (normalizedQuery.includes(normalizedName) || normalizedName.includes(normalizedQuery));
  }) || null;
}

function detectPlantAssistantIntent(query) {
  const normalizedQuery = normalizeSearchText(query);
  return {
    disease: normalizedIncludesAny(normalizedQuery, ["benh", "nam", "sau", "rep", "bo tri", "dom", "vang la", "heo", "thoi re", "thoi goc", "thoi nhun", "suong", "phan trang", "xoan la"]),
    threshold: normalizedIncludesAny(normalizedQuery, ["nguong", "nhiet", "do am", "dat", "ph", "anh sang", "lux", "cao", "thap", "toi da", "toi thieu"]),
    ideal: normalizedIncludesAny(normalizedQuery, ["ly tuong", "song", "cham soc", "trong", "tuoi", "nuoc", "phan", "dinh duong", "dat", "anh sang"]),
    sensor: normalizedIncludesAny(normalizedQuery, ["hien tai", "cam bien", "on khong", "vuot", "canh bao", "chi so", "do duoc"]),
    mainPlant: normalizedIncludesAny(normalizedQuery, ["cay chinh", "cay hien tai", "trong he thong", "vuon minh", "vuon cua toi"]),
  };
}

function questionIsInPlantScope(query, context = {}) {
  const normalizedQuery = normalizeSearchText(query);
  return Boolean(
    normalizedIncludesAny(normalizedQuery, plantAssistantScopeTerms) ||
    findKnownPlantForQuery(query) ||
    findDiseaseForQuery(query) ||
    findSavedPlantForQuery(query, context.plants || [])
  );
}

function plantThresholdBullets(plant) {
  if (!plant) return [];

  const bullets = [];
  const temp = chatRange(plant.temp_min, plant.temp_max, "°C");
  const humidity = chatRange(plant.humidity_min, plant.humidity_max, "%");
  const soil = chatRange(plant.soil_min, plant.soil_max, "%");
  const lightMax = chatValue(plant.light_max, " lux");

  if (temp) bullets.push(`Nhiệt độ: ${temp}.`);
  if (humidity) bullets.push(`Độ ẩm không khí: ${humidity}.`);
  if (soil) bullets.push(`Độ ẩm đất: ${soil}.`);
  if (lightMax) bullets.push(`Ánh sáng: tối đa ${lightMax}.`);
  if (plant.soil_ph) bullets.push(`pH đất lý tưởng: ${chatValue(plant.soil_ph) || plant.soil_ph}.`);
  if (plant.soil_type) bullets.push(`Loại đất: ${plant.soil_type}.`);
  if (plant.soil_looseness) bullets.push(`Độ tơi xốp: ${plant.soil_looseness}.`);
  if (plant.soil_drainage) bullets.push(`Thoát nước: ${plant.soil_drainage}.`);
  if (plant.watering_time) bullets.push(`Lịch tưới đã lưu: ${formatTimeValue(plant.watering_time)}${plant.watering_duration ? ` trong ${plant.watering_duration} giây` : ""}.`);
  if (plant.description) bullets.push(`Ghi chú cây: ${plant.description}.`);

  return bullets;
}

function compareSensorMetric(label, value, min, max, unit = "") {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  const minNumber = Number(min);
  const maxNumber = Number(max);
  const valueText = chatValue(number, unit);
  if (Number.isFinite(minNumber) && number < minNumber) {
    return `${label}: ${valueText}, thấp hơn ngưỡng ${chatValue(minNumber, unit)}.`;
  }
  if (Number.isFinite(maxNumber) && number > maxNumber) {
    return `${label}: ${valueText}, cao hơn ngưỡng ${chatValue(maxNumber, unit)}.`;
  }
  if (Number.isFinite(minNumber) || Number.isFinite(maxNumber)) {
    return `${label}: ${valueText}, đang trong ngưỡng đã lưu.`;
  }
  return `${label}: ${valueText}.`;
}

function sensorInsightBullets(plant, sensor) {
  if (!sensor) return [];

  const bullets = [
    compareSensorMetric("Nhiệt độ hiện tại", sensor.temperature, plant?.temp_min, plant?.temp_max, "°C"),
    compareSensorMetric("Độ ẩm không khí hiện tại", sensor.humidity, plant?.humidity_min, plant?.humidity_max, "%"),
    compareSensorMetric("Độ ẩm đất hiện tại", sensor.soil_moisture, plant?.soil_min, plant?.soil_max, "%"),
  ].filter(Boolean);

  const light = Number(sensor.light);
  const lightMax = Number(plant?.light_max);
  if (Number.isFinite(light)) {
    if (Number.isFinite(lightMax) && light > lightMax) {
      bullets.push(`Ánh sáng hiện tại: ${chatValue(light, " lux")}, cao hơn mức tối đa ${chatValue(lightMax, " lux")}.`);
    } else if (Number.isFinite(lightMax)) {
      bullets.push(`Ánh sáng hiện tại: ${chatValue(light, " lux")}, không vượt mức tối đa đã lưu.`);
    } else {
      bullets.push(`Ánh sáng hiện tại: ${chatValue(light, " lux")}.`);
    }
  }

  const gas = Number(sensor.gas);
  if (Number.isFinite(gas)) {
    bullets.push(gas >= 400
      ? `Khí độc: ${chatValue(gas, " ppm")}, đã chạm vùng nguy hiểm của hệ thống.`
      : `Khí độc: ${chatValue(gas, " ppm")}, dưới ngưỡng cảnh báo 400 ppm.`
    );
  }

  return bullets;
}

async function getPlantAssistantContext(query = "") {
  const intents = detectPlantAssistantIntent(query);
  const normalizedQuery = normalizeSearchText(query);
  const knownPlant = findKnownPlantForQuery(query);
  const disease = findDiseaseForQuery(query);
  const asksForSystemData = intents.mainPlant || intents.sensor || normalizedIncludesAny(normalizedQuery, ["he thong", "vuon minh", "vuon cua toi", "da luu", "cay chinh"]);

  if (!asksForSystemData && (knownPlant || disease)) {
    return {
      plants: plantsCache,
      mainPlant,
      latestSensor: chartLatestCache,
    };
  }

  if (plantsCache.length === 0) await loadPlants();

  let latestSensor = chartLatestCache;
  try {
    const report = await request("/report");
    if (report && !report.isError && !report.message) {
      if (report.main_plant) mainPlant = report.main_plant;
      if (Array.isArray(report.saved_sensor_data)) {
        chartSensorsCache = report.saved_sensor_data;
        chartLatestCache = chartSensorsCache[chartSensorsCache.length - 1] || chartLatestCache;
      }
      latestSensor = report.latest_sensor || chartLatestCache || latestSensor;
    }
  } catch (err) {
    console.log("Plant assistant context error:", err);
  }

  return {
    plants: plantsCache,
    mainPlant,
    latestSensor,
  };
}

function outOfScopeReply() {
  return {
    title: "Mình chỉ trả lời trong phạm vi cây trồng",
    lead: "Câu hỏi này có vẻ nằm ngoài phạm vi cây trồng, bệnh cây, ngưỡng cảm biến hoặc điều kiện sống lý tưởng.",
    sections: [
      { title: "Bạn có thể hỏi", bullets: plantAssistantExamples },
    ],
  };
}

const plantAssistantActionHandlers = {
  dashboard: () => openSystemPage("dashboard"),
  plants: () => openSystemPage("plants"),
  add_plant: () => openSystemForm("plants", () => showPlantForm()),
  edit_plant: () => openSystemForm("plants", () => showPlantForm(mainPlant?.id || null)),
  delete_plant: () => openSystemForm("plants", () => {
    if (mainPlant?.id) deletePlantById(mainPlant.id);
  }),
  controls: () => openSystemPage("controls"),
  irrigation_control: () => openSystemPage("controls"),
  fan_control: () => openSystemPage("controls"),
  spray_control: () => openSystemPage("controls"),
  devices: () => openSystemPage("devices"),
  automation: () => openSystemPage("automation"),
  automation_irrigation: () => openSystemPage("automation"),
  soil: () => openSystemPage("soil"),
  soil_check: () => openSystemPage("soil"),
  add_soil: () => openSystemForm("soil", () => showSoilRecordForm()),
  fertilizers: () => openSystemPage("fertilizers"),
  add_fertilizer: () => openSystemForm("fertilizers", () => showFertilizerForm()),
  alerts: () => openSystemPage("alerts"),
  fire_alerts: () => openSystemPage("alerts"),
  reports: () => openSystemPage("reports"),
  sensor_report: () => openSystemPage("reports"),
};

function runPlantAssistantAction(actionId) {
  const handler = plantAssistantActionHandlers[actionId];
  if (!handler) return;
  closeInternalSearch();
  handler();
}

function buildPlantAssistantReply(query, context) {
  const normalizedQuery = normalizeSearchText(query);
  const intents = detectPlantAssistantIntent(query);
  const savedPlant = findSavedPlantForQuery(query, context.plants);
  const knownPlant = findKnownPlantForQuery(query);
  const disease = findDiseaseForQuery(query);
  const focusPlant = savedPlant || ((intents.threshold || intents.sensor || intents.mainPlant) ? context.mainPlant : null);

  if (!questionIsInPlantScope(query, context)) return outOfScopeReply();

  const sections = [];
  if (focusPlant) {
    const thresholdBullets = plantThresholdBullets(focusPlant);
    if (thresholdBullets.length > 0) {
      sections.push({
        title: `${savedPlant ? "Dữ liệu đã lưu" : "Cây chính trong hệ thống"}: ${focusPlant.name}`,
        bullets: thresholdBullets,
      });
    }

    if (intents.sensor || normalizedIncludesAny(normalizedQuery, ["on khong", "vuot nguong", "hien tai"])) {
      const sensorBullets = sensorInsightBullets(focusPlant, context.latestSensor);
      sections.push({
        title: "So sánh cảm biến hiện tại",
        bullets: sensorBullets.length > 0 ? sensorBullets : ["Chưa có dữ liệu cảm biến mới để so sánh."],
      });
    }
  }

  if (knownPlant) {
    if (intents.threshold || sections.length === 0) {
      sections.push({ title: `Ngưỡng tham khảo cho ${knownPlant.name}`, bullets: knownPlant.thresholds });
    }
    if (intents.ideal || sections.length === 0) {
      sections.push({ title: `Điều kiện sống lý tưởng cho ${knownPlant.name}`, bullets: knownPlant.ideal });
    }
    if (intents.disease || normalizedIncludesAny(normalizedQuery, ["benh", "la", "sau"])) {
      sections.push({ title: `Bệnh thường gặp ở ${knownPlant.name}`, bullets: knownPlant.diseases });
    }
  }

  if (disease) {
    sections.push({
      title: disease.name,
      bullets: [`Dấu hiệu: ${disease.signs}`, `Xử lý ban đầu: ${disease.actions}`],
    });
  }

  if (sections.length === 0) {
    sections.push({
      title: "Gợi ý chăm sóc nhanh",
      bullets: [
        "Kiểm tra cây theo 4 nhóm chính: nhiệt độ, độ ẩm không khí, độ ẩm đất và ánh sáng.",
        "Nếu thấy lá vàng, đốm lá, héo rũ hoặc thối rễ, hãy đối chiếu với điều kiện ẩm, thoát nước và thông gió.",
        context.mainPlant ? `Bạn đang đặt cây chính là ${context.mainPlant.name}; có thể hỏi trực tiếp về ngưỡng của cây này.` : "Hãy thêm cây và ngưỡng để trợ lý trả lời sát dữ liệu vườn hơn.",
      ],
    });
  }

  return {
    title: savedPlant ? `Trả lời về ${savedPlant.name}` : knownPlant ? `Trả lời về ${knownPlant.name}` : disease ? `Nhận diện ${disease.name}` : "Trợ lý cây trồng",
    lead: focusPlant ? "Mình kết hợp dữ liệu đã lưu trong hệ thống với kiến thức chăm sóc cây phổ biến." : "Mình trả lời trong phạm vi cây trồng, bệnh cây, ngưỡng và điều kiện sống.",
    sections,
    warning: "Thông tin bệnh cây là gợi ý nhận diện ban đầu; nếu bệnh lan nhanh, nên cách ly cây và kiểm tra trực tiếp lá, thân, rễ.",
  };
}

function renderAssistantMarkdown(text = "") {
  const escaped = escapeHtml(String(text || ""));
  const withLists = escaped.replace(/(?:^|\n)- (.+)(?=\n|$)/g, "<li>$1</li>");
  return withLists
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/(?:<li>.*?<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`)
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/\n/g, "<br>");
}

function plantAssistantReplyHtml(reply) {
  const answerBlock = reply.answer
    ? `<div class="plant-chat-answer">${renderAssistantMarkdown(reply.answer)}</div>`
    : reply.lead
      ? `<p>${escapeHtml(reply.lead)}</p>`
      : "";
  const suggestions = (reply.suggestions || []).length
    ? `
      <div class="plant-chat-actions">
        ${(reply.suggestions || []).map((action) => `
          <button type="button" class="plant-chat-action" data-assistant-action="${escapeHtml(action.id)}" title="${escapeHtml(action.description || "")}">
            ${escapeHtml(action.label || "Mở chức năng")}
          </button>
        `).join("")}
      </div>
    `
    : "";
  return `
    ${answerBlock}
    ${suggestions}
  `;
}

function buildPlantChatApiMessages() {
  return plantChatMessages
    .filter((message) => !message.loading && message.role)
    .map((message) => ({
      role: message.role,
      content: String(message.content || message.text || "").trim(),
    }))
    .filter((message) => message.content);
}

function ensurePlantChatModal() {
  if (document.getElementById("plantChatModal")) return;

  const modal = document.createElement("section");
  modal.id = "plantChatModal";
  modal.className = "internal-search-modal hidden";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = [
    '<motion class="internal-search-dialog">',
    '  <motion class="internal-search-head">',
    '    <motion>',
    '      <span class="eyebrow">Trợ lý</span>',
    '      <h2 id="plantChatTitle">Trợ lý cây trồng</h2>',
    "    </motion>",
    '    <div class="plant-chat-head-actions">',
    '      <button class="plant-chat-open-full" type="button" data-open-ai-demo>Trang ChatBot</button>',
    '      <button class="secondary" type="button" data-close-plant-chat>Đóng</button>',
    "    </div>",
    "  </motion>",
    '  <motion id="plantChatScope" class="plant-chat-scope">',
    "    <span>Dữ liệu vườn</span>",
    "    <span>Cây trồng</span>",
    "    <span>Bệnh cây</span>",
    "    <span>Ngưỡng cảm biến</span>",
    "  </motion>",
    '  <motion id="plantChatStatus" class="internal-search-status"></motion>',
    '  <motion id="plantChatResults" class="internal-search-results"></motion>',
    '  <form id="plantChatForm" class="plant-chat-form">',
    '    <input id="plantChatInput" type="search" autocomplete="off" placeholder="Hỏi tiếp về cây, bệnh, ngưỡng hoặc điều kiện sống..." />',
    '    <button type="submit">Hỏi</button>',
    "  </form>",
    "</motion>",
    "</motion>",
  ].join("\n");

  modal.innerHTML = modal.innerHTML.replace(/motion/g, "div");

  document.body.appendChild(modal);
  modal.querySelector("[data-close-plant-chat]")?.addEventListener("click", closePlantChat);
  modal.querySelector("[data-open-ai-demo]")?.addEventListener("click", () => {
    const prompt = document.getElementById("plantChatInput")?.value || getCurrentSearchQuery();
    openAiDemoChat(prompt);
  });
}

function renderPlantChatMessages() {
  const results = document.getElementById("plantChatResults");
  if (!results) return;

  results.innerHTML = plantChatMessages.map((message) => {
    const classes = ["plant-chat-message", message.role];
    if (message.loading) classes.push("loading");
    const body = message.html || `<p>${escapeHtml(message.text || "")}</p>`;
    return `<div class="${classes.join(" ")}">${body}</div>`;
  }).join("");
  results.scrollTop = results.scrollHeight;
}

function appendPlantChatMessage(message) {
  plantChatMessages.push(message);
  if (plantChatMessages.length > PLANT_CHAT_HISTORY_LIMIT) {
    plantChatMessages = plantChatMessages.slice(-PLANT_CHAT_HISTORY_LIMIT);
  }
  renderPlantChatMessages();
}

async function askPlantAssistant(query, { reset = false } = {}) {
  const trimmedQuery = String(query || "").trim();
  if (!trimmedQuery) return;

  ensurePlantChatModal();
  document.getElementById("plantChatModal")?.classList.remove("hidden");

  if (reset) plantChatMessages = [];
  appendPlantChatMessage({ role: "user", content: trimmedQuery, text: trimmedQuery });

  const requestId = ++plantChatRequestId;
  appendPlantChatMessage({
    role: "assistant",
    loading: true,
    requestId,
    html: '<p class="plant-chat-muted">AI đang phân tích với dữ liệu vườn và tri thức MySQL...</p>',
  });
  setPlantChatStatus("AI đang phân tích (Gemini/MySQL + dữ liệu vườn)...");

  try {
    const data = await request("/plant-assistant", "POST", { messages: buildPlantChatApiMessages() });
    const reply = data?.isError
      ? buildPlantAssistantReply(trimmedQuery, await getPlantAssistantContext(trimmedQuery))
      : data;
    const index = plantChatMessages.findIndex((message) => message.requestId === requestId);
    if (index !== -1) {
      plantChatMessages[index] = {
        role: "assistant",
        content: reply.answer || "",
        html: plantAssistantReplyHtml(reply),
      };
      renderPlantChatMessages();
    }
    if (requestId === plantChatRequestId) {
      const modeLabel = reply.mode || "Trợ lý AI";
      setPlantChatStatus(`Đang dùng: ${modeLabel}.`);
    }
  } catch (err) {
    const index = plantChatMessages.findIndex((message) => message.requestId === requestId);
    if (index !== -1) {
      plantChatMessages[index] = {
        role: "assistant",
        html: `<h3>Chưa thể trả lời</h3><p>${escapeHtml(err.message || "Không đọc được dữ liệu hệ thống.")}</p>`,
      };
      renderPlantChatMessages();
    }
    setPlantChatStatus("Không đọc được dữ liệu hệ thống.");
  }
}

async function openInternalSearch(query) {
  const modal = document.getElementById("internalSearchModal");
  const title = document.getElementById("internalSearchTitle");
  const results = document.getElementById("internalSearchResults");
  const setup = document.getElementById("internalSearchSetup");
  const fallback = document.getElementById("internalSearchFallbackText");

  internalSearchQuery = String(query || "").trim();
  if (!internalSearchQuery) return;

  if (title) title.textContent = `“${internalSearchQuery}”`;
  if (modal) modal.classList.remove("hidden");
  if (results) results.innerHTML = "";
  closeInternalSearchPreview();
  setup?.classList.add("hidden");
  fallback?.classList.add("hidden");

  const input = document.getElementById("globalPlantSearch");
  if (input) input.value = internalSearchQuery;

  await runSiteSearch(internalSearchQuery, 1);
}

function closeInternalSearch() {
  closeInternalSearchPreview();
  document.getElementById("internalSearchModal")?.classList.add("hidden");
}

function closePlantChat() {
  document.getElementById("plantChatModal")?.classList.add("hidden");
}

function openPlantChatbotModal() {
  ensurePlantChatModal();
  const modal = document.getElementById("plantChatModal");
  const results = document.getElementById("plantChatResults");
  const chatInput = document.getElementById("plantChatInput");

  plantChatMessages = [];
  internalSearchQuery = "";

  if (modal) modal.classList.remove("hidden");
  if (chatInput) chatInput.value = "";
  setPlantChatStatus("Nhập câu hỏi hoặc chọn một gợi ý bên dưới.");

  const exampleButtons = plantAssistantExamples
    .map(
      (example) =>
        `<button type="button" class="plant-chat-action plant-chat-welcome-prompt" data-prompt="${escapeHtml(example)}">${escapeHtml(example)}</button>`
    )
    .join("");

  if (results) {
    results.innerHTML = `
      <div class="plant-chat-message assistant">
        <div class="plant-chat-actions plant-chat-welcome-actions">${exampleButtons}</div>
      </div>
    `;
  }

  window.setTimeout(() => chatInput?.focus(), 80);
}

function initInternalSearch() {
  ensurePlantChatModal();
  const form = document.getElementById("siteSearchForm");
  const input = document.getElementById("globalPlantSearch");
  const suggestions = document.getElementById("systemSearchSuggestions");
  const chatForm = document.getElementById("plantChatForm");
  const chatInput = document.getElementById("plantChatInput");
  if (!form || form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  const submitButton = form.querySelector(".site-search-submit");
  if (submitButton) {
    submitButton.title = "Tìm bằng Google CSE trong nội bộ";
  }
  input?.addEventListener("input", () => {
    renderSystemSearchSuggestions(input.value);
  });

  input?.addEventListener("focus", () => {
    renderSystemSearchSuggestions(input.value);
  });

  input?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hideSystemSearchSuggestions();
      return;
    }
  });

  suggestions?.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button?.dataset.internalSiteSearch === "true") {
      runInternalSearchFromSuggestion();
      return;
    }
    const target = button || event.target.closest("[data-suggestion-index]");
    if (!target) return;
    executeSystemSuggestion(Number(target.dataset.suggestionIndex));
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input?.value.trim();
    if (!query) {
      input?.focus();
      return;
    }

    hideSystemSearchSuggestions();
    openInternalSearch(query);
  });

  chatForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = chatInput?.value.trim();
    if (!query) {
      chatInput?.focus();
      return;
    }

    internalSearchQuery = query;
    if (chatInput) chatInput.value = "";
    askPlantAssistant(query);
  });

  document.getElementById("internalSearchResults")?.addEventListener("click", (event) => {
    const more = event.target.closest("[data-site-search-more]");
    if (more) {
      runSiteSearch(internalSearchQuery, Number(more.dataset.siteSearchMore) || 1);
      return;
    }
  });

  document.getElementById("plantChatResults")?.addEventListener("click", (event) => {
    const openDemo = event.target.closest("[data-open-ai-demo]");
    if (openDemo) {
      event.preventDefault();
      openAiDemoChat("");
      return;
    }
    const promptButton = event.target.closest("[data-prompt]");
    if (promptButton) {
      askPlantAssistant(promptButton.getAttribute("data-prompt"));
      return;
    }
    const actionButton = event.target.closest("[data-assistant-action]");
    if (!actionButton) return;
    runPlantAssistantAction(actionButton.dataset.assistantAction);
  });
}

document.addEventListener("DOMContentLoaded", initInternalSearch);
document.addEventListener("click", (event) => {
  if (!event.target.closest(".topbar-title")) hideSystemSearchSuggestions();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeInternalSearch();
    closePlantChat();
  }
});
initInternalSearch();

// Danh sach trang dung de doi tieu de va tai lai dung du lieu khi nguoi dung chuyen menu.
const pages = {
  dashboard: "Tổng quan hệ thống",
  gardens: "Quản lý vườn",
  devices: "Quản lý thiết bị",
  plants: "Quản lý cây trồng",
  controls: "Điều khiển hệ thống",
  automation: "Điều khiển tự động",
  fertilizers: "Quản lý bón phân",
  soil: "Theo dõi đất",
  reports: "Xem báo cáo",
  alerts: "Cảnh báo",
};

function showPage(id, el) {
  Object.keys(pages).forEach((pageId) => {
    document.getElementById(pageId).classList.remove("active-page");
  });
  document.getElementById(id).classList.add("active-page");
  document.getElementById("pageTitle").innerText = pages[id];

  document.querySelectorAll(".nav").forEach((nav) => nav.classList.remove("active"));
  if (el) el.classList.add("active");

  if (id === "plants") {
    showPlantOverview();
    loadPlants();
  }
  if (id === "gardens") {
    showGardenOverview();
    loadGardens();
  }
  if (id === "devices") {
    showDeviceOverview();
    loadDevices();
  }
  if (id === "controls") loadPlants();
  if (id === "automation") {
    loadPlants();
    loadAutoIrrigationSchedules();
  }
  if (id === "fertilizers") {
    showFertilizerOverview();
    loadPlants();
    loadFertilizers();
  }
  if (id === "soil") {
    showSoilRecordOverview();
    loadPlants();
    loadGardens();
    loadSoilRecords();
  }
  if (id === "reports") loadReportTables();
  if (id === "alerts") {
    loadAlerts();
  }
}

function runStartupActionFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("open") || window.location.hash.replace(/^#/, "");
  if (!requested) return;

  window.setTimeout(() => {
    if (plantAssistantActionHandlers[requested]) {
      runPlantAssistantAction(requested);
      return;
    }
    if (pages[requested]) openSystemPage(requested);
  }, 250);
}

function updateClock() {
  document.getElementById("clock").innerText = new Date().toLocaleTimeString("vi-VN");
}
setInterval(updateClock, 1000);
updateClock();

// Cau hinh cac duong du lieu tren bieu do, gom mau sac va nguong so sanh cua cay chinh.
const LIGHT_DEFAULT_MAX_LUX = 40000;
const chartSeriesMeta = [
  { key: "temperature", label: "Nhiệt độ", unit: "°C", color: "#f97316", minKey: "temp_min", maxKey: "temp_max", chartMin: 0, chartMax: 50 },
  { key: "humidity", label: "Độ ẩm KK", unit: "%", color: "#38bdf8", minKey: "humidity_min", maxKey: "humidity_max", chartMin: 0, chartMax: 100 },
  { key: "soil_moisture", label: "Độ ẩm đất", unit: "%", color: "#22c55e", minKey: "soil_min", maxKey: "soil_max", chartMin: 0, chartMax: 100 },
  { key: "light", label: "Ánh sáng", unit: " lux", color: "#facc15", maxKey: "light_max", defaultMax: LIGHT_DEFAULT_MAX_LUX, chartMin: 0, chartMax: LIGHT_DEFAULT_MAX_LUX },
  { key: "gas", label: "Khí độc", unit: " ppm", color: "#a78bfa", max: 400, chartMin: 0, chartMax: 500 },
];
const lightSeriesMeta = chartSeriesMeta.find((meta) => meta.key === "light");
const CHART_LANE_HEIGHT = 0.68;
let chartScaleMaxByKey = {};

function normalizeMetricValue(value, meta = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  const min = Number(meta.chartMin);
  return Number.isFinite(min) ? Math.max(min, number) : number;
}

function maxThresholdForMeta(meta) {
  const plantMax = meta.maxKey ? Number(mainPlant?.[meta.maxKey]) : Number(meta.max);
  const defaultMax = Number(meta.defaultMax);
  const max = Number.isFinite(plantMax) ? plantMax : defaultMax;
  return normalizeMetricValue(max, meta);
}

function chartMaxForMeta(meta) {
  const dynamicMax = Number(chartScaleMaxByKey[meta.key]);
  if (Number.isFinite(dynamicMax)) return dynamicMax;
  return Number(meta.chartMax);
}

function lightMaxForPlant(plant) {
  const plantMax = Number(plant?.light_max);
  const max = Number.isFinite(plantMax) ? plantMax : LIGHT_DEFAULT_MAX_LUX;
  return normalizeMetricValue(max, lightSeriesMeta);
}

function formatLightRange(plant) {
  return `Tối đa ${formatValue(lightMaxForPlant(plant), " lux")}`;
}

function latestPointRadius(context) {
  return context.dataIndex === context.dataset.data.length - 1 ? 4 : 0;
}

function averageOf(rows, meta) {
  const values = rows.map((item) => normalizeMetricValue(item[meta.key], meta)).filter(Number.isFinite);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function chartLaneCenter(index) {
  return chartSeriesMeta.length - index - 0.5;
}

function normalizeChartValue(value, meta) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  const min = Number(meta.chartMin);
  const max = chartMaxForMeta(meta);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;

  return Math.max(0, Math.min(1, (number - min) / (max - min)));
}

function chartLanePoint(item, meta, index) {
  const value = normalizeMetricValue(item?.[meta.key], meta);
  const normalized = normalizeChartValue(value, meta);
  if (normalized === null) {
    return { x: item._chartTime, y: null, value: null };
  }

  return {
    x: item._chartTime,
    y: chartLaneCenter(index) - CHART_LANE_HEIGHT / 2 + normalized * CHART_LANE_HEIGHT,
    value,
  };
}

function chartLaneValue(value, meta, index) {
  const normalized = normalizeChartValue(normalizeMetricValue(value, meta), meta);
  if (normalized === null) return null;
  return chartLaneCenter(index) - CHART_LANE_HEIGHT / 2 + normalized * CHART_LANE_HEIGHT;
}

function formatThresholdValue(value, meta) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const text = Number.isInteger(number) ? String(number) : number.toFixed(1);
  return `${text}${meta.unit || ""}`;
}

function chartThresholdsForMeta(meta) {
  const thresholds = [];
  const min = meta.minKey ? normalizeMetricValue(mainPlant?.[meta.minKey], meta) : null;
  const max = maxThresholdForMeta(meta);

  if (Number.isFinite(min)) thresholds.push({ value: min, label: `Min ${formatThresholdValue(min, meta)}`, side: "below" });
  if (Number.isFinite(max)) {
    thresholds.push({
      value: max,
      label: `${meta.maxKey ? "Max" : "Ngưỡng"} ${formatThresholdValue(max, meta)}`,
      side: "above",
    });
  }

  return thresholds;
}

function updateChartScaleMaxes(rows) {
  const nextScaleMaxByKey = {};

  chartSeriesMeta.forEach((meta) => {
    const min = Number(meta.chartMin);
    const baseMax = Number(meta.chartMax);
    const values = Number.isFinite(baseMax) ? [baseMax] : [];

    rows.forEach((row) => {
      const value = normalizeMetricValue(row?.[meta.key], meta);
      if (Number.isFinite(value)) values.push(value);
    });

    chartThresholdsForMeta(meta).forEach((threshold) => {
      const value = normalizeMetricValue(threshold.value, meta);
      if (Number.isFinite(value)) values.push(value);
    });

    const highest = values.length ? Math.max(...values) : baseMax;
    if (!Number.isFinite(highest) || !Number.isFinite(baseMax)) return;

    const rangeMin = Number.isFinite(min) ? min : 0;
    nextScaleMaxByKey[meta.key] = highest > baseMax
      ? rangeMin + (highest - rangeMin) * 1.08
      : baseMax;
  });

  chartScaleMaxByKey = nextScaleMaxByKey;
}

function sensorStatus(value, meta) {
  const currentValue = normalizeMetricValue(value, meta);
  if (!Number.isFinite(currentValue)) return { text: "Chưa có dữ liệu", className: "" };
  const min = meta.minKey ? normalizeMetricValue(mainPlant?.[meta.minKey], meta) : null;
  const max = maxThresholdForMeta(meta);

  if (Number.isFinite(min) && currentValue < min) return { text: "Thấp", className: "low" };
  if (Number.isFinite(max) && currentValue > max) return { text: "Cao", className: "high" };
  return { text: "Trong ngưỡng", className: "good" };
}

function renderChartSummary(rows, latest) {
  const panel = document.getElementById("chartSummary");
  if (!panel) return;

  if (!latest) {
    panel.innerHTML = `<div class="empty-state">Chưa có dữ liệu cảm biến.</div>`;
    return;
  }

  panel.innerHTML = chartSeriesMeta.map((meta) => {
    const value = normalizeMetricValue(latest[meta.key], meta);
    const average = averageOf(rows, meta);
    const status = sensorStatus(value, meta);

    return `
      <div class="chart-metric" style="--series:${meta.color}">
        <span>${meta.label}</span>
        <strong>${Number.isFinite(value) ? value : "--"}${meta.unit}</strong>
        <p>TB ${average === null ? "--" : average.toFixed(1)}${meta.unit}</p>
        <em class="${status.className}">${status.text}</em>
      </div>
    `;
  }).join("");
}

function sensorTimeMs(item) {
  const date = item?.created_at ? new Date(item.created_at) : null;
  const time = date?.getTime();
  return Number.isFinite(time) ? time : null;
}

function chartRangeLabel(days = chartRangeDays) {
  if (days < 7) return `${days} ngày`;
  if (days === 7) return "1 tuần";
  if (days < 30) return `${days} ngày`;
  if (days < 365) return `${Math.round(days / 30)} tháng`;
  return "1 năm";
}

function formatDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateRangeFromInput(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  if (!year || !month || !day) return null;

  const start = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  const end = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

function getChartWindow() {
  if (Number.isFinite(chartCustomStartMs) && Number.isFinite(chartCustomEndMs)) {
    const date = new Date(chartCustomStartMs);
    return {
      minTime: chartCustomStartMs,
      maxTime: chartCustomEndMs,
      days: Math.max(1, Math.ceil((chartCustomEndMs - chartCustomStartMs) / DAY_MS)),
      label: `Ngày ${date.toLocaleDateString("vi-VN")}`,
      isCustom: true,
    };
  }

  const maxTime = Date.now();
  return {
    minTime: maxTime - chartRangeDays * DAY_MS,
    maxTime,
    days: chartRangeDays,
    label: chartRangeLabel(),
    isCustom: false,
  };
}

function formatChartTick(value) {
  const date = new Date(Number(value));
  if (isNaN(date)) return "";
  const days = getChartWindow().days;
  if (days <= 1) {
    return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  }
  if (days <= 14) {
    return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  }
  if (days <= 90) {
    return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  }
  return date.toLocaleDateString("vi-VN", { month: "2-digit", year: "2-digit" });
}

function formatChartTooltipDate(value) {
  const date = new Date(Number(value));
  return isNaN(date)
    ? "--"
    : date.toLocaleString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function filteredSensorsByChartRange(sensors) {
  const { minTime, maxTime } = getChartWindow();
  return sensors
    .map((item) => ({ ...item, _chartTime: sensorTimeMs(item) }))
    .filter((item) => item._chartTime && item._chartTime >= minTime && item._chartTime <= maxTime);
}

function downsampleSensors(rows, maxPoints = CHART_MAX_POINTS) {
  if (rows.length <= maxPoints) return rows;
  const sampled = [];
  const step = Math.ceil(rows.length / maxPoints);
  for (let index = 0; index < rows.length; index += step) {
    sampled.push(rows[index]);
  }
  const last = rows[rows.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

function updateChartRangeInfo(rowCount = 0) {
  const value = document.getElementById("chartRangeValue");
  const hint = document.getElementById("chartRangeHint");
  const windowInfo = getChartWindow();
  if (value) value.innerText = windowInfo.label;
  if (hint) hint.innerText = `${rowCount} điểm dữ liệu trong ${windowInfo.label}`;
}

const sensorLanePlugin = {
  id: "sensorLanes",
  beforeDatasetsDraw(chart, args, options) {
    const { ctx, chartArea, scales } = chart;
    const yScale = scales.yLane;
    if (!chartArea || !yScale) return;

    ctx.save();
    chartSeriesMeta.forEach((meta, index) => {
      const laneTopValue = chartSeriesMeta.length - index;
      const laneBottomValue = chartSeriesMeta.length - index - 1;
      const top = yScale.getPixelForValue(laneTopValue);
      const bottom = yScale.getPixelForValue(laneBottomValue);
      const y = Math.min(top, bottom);
      const height = Math.abs(bottom - top);

      ctx.fillStyle = index % 2 === 0 ? "rgba(15,23,42,.64)" : "rgba(30,41,59,.46)";
      ctx.fillRect(chartArea.left, y, chartArea.right - chartArea.left, height);
      ctx.fillStyle = `${meta.color}1f`;
      ctx.fillRect(chartArea.left, y, chartArea.right - chartArea.left, height);

      ctx.strokeStyle = "rgba(148,163,184,.14)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, y + height);
      ctx.lineTo(chartArea.right, y + height);
      ctx.stroke();

      ctx.fillStyle = meta.color;
      ctx.fillRect(chartArea.left + 12, y + 14, 8, 8);
      ctx.fillStyle = "rgba(226,232,240,.86)";
      ctx.font = "700 12px Inter, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(meta.label, chartArea.left + 28, y + 18);
    });
    ctx.restore();
  },
  afterDatasetsDraw(chart, args, options) {
    const { ctx, chartArea, scales } = chart;
    const yScale = scales.yLane;
    if (!chartArea || !yScale) return;

    ctx.save();
    chartSeriesMeta.forEach((meta, index) => {
      chartThresholdsForMeta(meta).forEach((threshold) => {
        const laneValue = chartLaneValue(threshold.value, meta, index);
        if (laneValue === null) return;

        const y = yScale.getPixelForValue(laneValue);
        if (y < chartArea.top || y > chartArea.bottom) return;

        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 1.6;
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left + 8, y);
        ctx.lineTo(chartArea.right - 8, y);
        ctx.stroke();
        ctx.setLineDash([]);

        const label = threshold.label;
        ctx.font = "700 11px Inter, sans-serif";
        const labelWidth = ctx.measureText(label).width + 14;
        const labelHeight = 20;
        const labelX = chartArea.right - labelWidth - 12;
        const preferredLabelY = threshold.side === "below" ? y + 4 : y - labelHeight - 4;
        const labelY = Math.max(chartArea.top + 6, Math.min(chartArea.bottom - labelHeight - 6, preferredLabelY));

        ctx.fillStyle = "rgba(2,6,23,.86)";
        ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
        ctx.strokeStyle = `${meta.color}cc`;
        ctx.lineWidth = 1;
        ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);
        ctx.fillStyle = "#f8fafc";
        ctx.textBaseline = "middle";
        ctx.fillText(label, labelX + 7, labelY + labelHeight / 2);
      });
    });
    ctx.restore();
  },
};

const sensorChart = new Chart(document.getElementById("sensorChart"), {
  type: "line",
  plugins: [sensorLanePlugin],
  data: {
    labels: [],
    datasets: [
      {
        label: "Nhiệt độ",
        data: [],
        borderColor: "#f97316",
        backgroundColor: "rgba(249,115,22,.12)",
        tension: 0.35,
        cubicInterpolationMode: "monotone",
        pointRadius: latestPointRadius,
        pointHoverRadius: 5,
        borderWidth: 2.5,
        yAxisID: "yLane",
      },
      {
        label: "Độ ẩm không khí",
        data: [],
        borderColor: "#38bdf8",
        backgroundColor: "rgba(56,189,248,.12)",
        tension: 0.35,
        cubicInterpolationMode: "monotone",
        pointRadius: latestPointRadius,
        pointHoverRadius: 5,
        borderWidth: 2.5,
        yAxisID: "yLane",
      },
      {
        label: "Độ ẩm đất",
        data: [],
        borderColor: "#22c55e",
        backgroundColor: "rgba(34,197,94,.12)",
        tension: 0.35,
        cubicInterpolationMode: "monotone",
        pointRadius: latestPointRadius,
        pointHoverRadius: 5,
        borderWidth: 2.5,
        yAxisID: "yLane",
      },
      {
        label: "Ánh sáng",
        data: [],
        borderColor: "#facc15",
        backgroundColor: "rgba(250,204,21,.12)",
        tension: 0.3,
        cubicInterpolationMode: "monotone",
        pointRadius: latestPointRadius,
        pointHoverRadius: 5,
        borderWidth: 2.5,
        yAxisID: "yLane",
      },
      {
        label: "Khí độc",
        data: [],
        borderColor: "#a78bfa",
        backgroundColor: "rgba(167,139,250,.12)",
        tension: 0.3,
        cubicInterpolationMode: "monotone",
        pointRadius: latestPointRadius,
        pointHoverRadius: 5,
        borderWidth: 2.5,
        yAxisID: "yLane",
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 450, easing: "easeOutQuart" },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: "#020617",
        borderColor: "rgba(148,163,184,.22)",
        borderWidth: 1,
        padding: 12,
        cornerRadius: 10,
        callbacks: {
          title(context) {
            const raw = context[0]?.raw;
            return formatChartTooltipDate(raw?.x ?? context[0]?.parsed?.x);
          },
          label(context) {
            const meta = chartSeriesMeta[context.datasetIndex] || {};
            const unit = meta.unit || "";
            const value = Number(context.raw?.value);
            return `${context.dataset.label}: ${Number.isFinite(value) ? value : "--"}${unit}`;
          },
        },
      },
      sensorLanes: {},
    },
    scales: {
      x: {
        type: "linear",
        ticks: {
          color: "#9fb1ca",
          maxTicksLimit: 9,
          maxRotation: 0,
          callback: (value) => formatChartTick(value),
        },
        grid: { color: "rgba(148,163,184,.07)" },
      },
      yLane: {
        display: false,
        min: 0,
        max: chartSeriesMeta.length,
        grid: { display: false },
        ticks: { display: false },
      },
    },
  },
});

function chartThresholdSignature() {
  if (!mainPlant) return "";
  return chartSeriesMeta.map((meta) => [
    meta.key,
    meta.minKey ? mainPlant?.[meta.minKey] : "",
    meta.maxKey ? mainPlant?.[meta.maxKey] : meta.max ?? "",
  ].join(":")).join("|");
}

function chartSignatureFor(rows, latest) {
  const first = rows[0] || {};
  const last = rows[rows.length - 1] || {};
  return [
    rows.length,
    first.id ?? "",
    first.created_at ?? "",
    last.id ?? "",
    last.created_at ?? "",
    latest?.id ?? "",
    latest?.created_at ?? "",
    chartThresholdSignature(),
  ].join("|");
}

function updateSensorChart(sensors, latest, force = false) {
  chartSensorsCache = Array.isArray(sensors) ? sensors : [];
  chartLatestCache = latest || null;

  // Bieu do chi ve lai khi du lieu lich su trong MySQL thay doi hoac nguoi dung doi khoang xem.
  const nextSignature = chartSignatureFor(chartSensorsCache, chartLatestCache);
  if (!force && nextSignature === chartDataSignature) return;
  chartDataSignature = nextSignature;

  if (!chartSensorsCache.length || !chartLatestCache) {
    renderChartSummary([], null);
    chartScaleMaxByKey = {};
    sensorChart.data.labels = [];
    sensorChart.data.datasets.forEach((dataset) => {
      dataset.data = [];
    });
    updateChartRangeInfo(0);
    sensorChart.update();
    return;
  }

  const ranged = filteredSensorsByChartRange(chartSensorsCache);
  const visibleRows = downsampleSensors(ranged);
  updateChartScaleMaxes(visibleRows);
  const latestInRange = ranged[ranged.length - 1] || null;
  const chartWindow = getChartWindow();
  renderChartSummary(ranged, latestInRange);
  sensorChart.options.scales.x.min = chartWindow.minTime;
  sensorChart.options.scales.x.max = chartWindow.maxTime;
  sensorChart.data.labels = [];
  chartSeriesMeta.forEach((meta, index) => {
    sensorChart.data.datasets[index].data = visibleRows.map((item) => chartLanePoint(item, meta, index));
  });
  updateChartRangeInfo(ranged.length);
  sensorChart.update();
}

function initChartRangeControl() {
  const slider = document.getElementById("chartRangeSlider");
  const datePicker = document.getElementById("chartDatePicker");
  if (!slider) return;

  slider.value = String(chartRangeDays);
  if (datePicker) {
    datePicker.min = formatDateInputValue(new Date(Date.now() - 365 * DAY_MS));
    datePicker.max = formatDateInputValue(new Date());
    datePicker.addEventListener("change", () => {
      const range = localDateRangeFromInput(datePicker.value);
      if (!range) return;
      chartCustomStartMs = range.start;
      chartCustomEndMs = range.end;
      updateSensorChart(chartSensorsCache, chartLatestCache, true);
    });
  }

  updateChartRangeInfo();
  slider.addEventListener("input", () => {
    chartRangeDays = Number(slider.value) || CHART_DEFAULT_RANGE_DAYS;
    chartCustomStartMs = null;
    chartCustomEndMs = null;
    if (datePicker) datePicker.value = "";
    updateSensorChart(chartSensorsCache, chartLatestCache, true);
  });
}

function clearChartDateFilter() {
  chartCustomStartMs = null;
  chartCustomEndMs = null;
  const datePicker = document.getElementById("chartDatePicker");
  if (datePicker) datePicker.value = "";
  updateSensorChart(chartSensorsCache, chartLatestCache, true);
}

async function request(url, method = "GET", body = null) {
  try {
    const token = localStorage.getItem("token");
    const options = {
      method,
      headers: { "Content-Type": "application/json" },
    };

    if (token) options.headers.Authorization = token;
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(API + url, options);
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (res.status === 401) {
      localStorage.removeItem("token");
      window.location = "/login.html";
      return { message: "Chưa đăng nhập" };
    }

    if (!res.ok) {
      return { message: data.message || "Lỗi server", isError: true };
    }

    return data;
  } catch (err) {
    console.log("Request error:", err);
    return { message: "Không kết nối được server", isError: true };
  }
}

async function requestForm(url, method, formData) {
  try {
    const token = localStorage.getItem("token");
    const options = { method, headers: {} };

    if (token) options.headers.Authorization = token;
    options.body = formData;

    const res = await fetch(API + url, options);
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (res.status === 401) {
      localStorage.removeItem("token");
      window.location = "/login.html";
      return { message: "Chưa đăng nhập" };
    }

    if (!res.ok) {
      return { message: data.message || "Lỗi server", isError: true };
    }

    return data;
  } catch (err) {
    console.log("Upload error:", err);
    return { message: "Không tải ảnh lên được", isError: true };
  }
}

function alertMsg(data) {
  showToast(data?.message || "Thực hiện thành công", data?.isError ? "error" : "success");
}

function showToast(message, type = "info", timeout = 2200) {
  const text = String(message || "Đã cập nhật").trim();
  let container = document.getElementById("toastStack");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastStack";
    container.className = "toast-stack";
    document.body.appendChild(container);
  }

  Array.from(container.children).forEach((item) => {
    if (item.dataset.message === text && !item.classList.contains("hide")) item.remove();
  });
  while (container.children.length >= 4) {
    container.lastElementChild?.remove();
  }

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.dataset.message = text;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
  toast.textContent = text;
  container.prepend(toast);

  window.setTimeout(() => {
    toast.classList.add("hide");
    window.setTimeout(() => toast.remove(), 260);
  }, timeout);
}

function confirmAction({
  title = "Xác nhận thao tác",
  message = "Bạn có chắc muốn tiếp tục?",
  confirmText = "Xóa",
  cancelText = "Hủy",
} = {}) {
  const modal = document.getElementById("confirmModal");
  if (!modal) return Promise.resolve(false);

  const titleEl = document.getElementById("confirmModalTitle");
  const messageEl = document.getElementById("confirmModalMessage");
  const confirmButton = document.getElementById("confirmModalAccept");
  const cancelButton = document.getElementById("confirmModalCancel");
  if (!titleEl || !messageEl || !confirmButton || !cancelButton) return Promise.resolve(false);

  titleEl.textContent = title;
  messageEl.textContent = message;
  confirmButton.textContent = confirmText;
  cancelButton.textContent = cancelText;

  if (activeConfirmResolve) activeConfirmResolve(false);

  return new Promise((resolve) => {
    activeConfirmResolve = resolve;

    const close = (result) => {
      modal.classList.add("hidden");
      confirmButton.onclick = null;
      cancelButton.onclick = null;
      modal.onclick = null;
      window.removeEventListener("keydown", onKeydown);
      const resolver = activeConfirmResolve;
      activeConfirmResolve = null;
      if (resolver) resolver(result);
    };

    const onKeydown = (event) => {
      if (event.key === "Escape") close(false);
    };

    confirmButton.onclick = () => close(true);
    cancelButton.onclick = () => close(false);
    modal.onclick = (event) => {
      if (event.target === modal) close(false);
    };

    window.addEventListener("keydown", onKeydown);
    modal.classList.remove("hidden");
    cancelButton.focus();
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatValue(value, unit = "") {
  return value === null || value === undefined || value === "" ? "--" : `${value}${unit}`;
}

function formatRange(min, max, unit = "") {
  if ((min === null || min === undefined || min === "") && (max === null || max === undefined || max === "")) {
    return "--";
  }
  return `${formatValue(min, unit)} - ${formatValue(max, unit)}`;
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  return date && !isNaN(date) ? date.toLocaleString("vi-VN") : "--";
}

function formatTimeValue(value) {
  return value ? String(value).slice(0, 5) : "--";
}

function formatTextValue(value) {
  const text = String(value || "").trim();
  return text ? escapeHtml(text) : "--";
}

function formatSoilPh(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function wateringHtml(plant) {
  return `
    <div class="threshold-item"><span>Giờ tưới</span><strong>${formatTimeValue(plant.watering_time)}</strong></div>
    <div class="threshold-item"><span>Thời gian tưới</span><strong>${formatValue(plant.watering_duration, " giây")}</strong></div>
  `;
}

function thresholdItemHtml(label, value, className = "") {
  return `<div class="threshold-item ${className}"><span>${label}</span><strong>${value}</strong></div>`;
}

function thresholdGridHtml(items) {
  return `<div class="threshold-grid">${items.join("")}</div>`;
}

function plantDescriptionHtml(plant) {
  const description = String(plant?.description || "").trim();

  return `
    <div class="plant-description">
      <div class="section-title">Mô tả cây trồng</div>
      <p>${description ? escapeHtml(description) : "Chưa có mô tả cây trồng"}</p>
    </div>
  `;
}

function soilProfileHtml(plant) {
  return `
    <div class="soil-profile">
      <div class="section-title">Đất lý tưởng</div>
      <div class="threshold-grid">
        <div class="threshold-item"><span>pH lý tưởng</span><strong>${formatSoilPh(plant.soil_ph)}</strong></div>
        <div class="threshold-item"><span>Loại đất</span><strong>${formatTextValue(plant.soil_type)}</strong></div>
        <div class="threshold-item"><span>Độ tơi xốp</span><strong>${formatTextValue(plant.soil_looseness)}</strong></div>
        <div class="threshold-item"><span>Thoát nước</span><strong>${formatTextValue(plant.soil_drainage)}</strong></div>
        <div class="threshold-item soil-note"><span>Ghi chú đất</span><strong>${formatTextValue(plant.soil_note)}</strong></div>
      </div>
    </div>
  `;
}

function imageUrl(path) {
  return path ? `${API}${path}` : "";
}

function plantHasImage(plant) {
  return Boolean(plant?.has_image || plant?.image_path);
}

function plantImageSrc(plant) {
  if (!plantHasImage(plant)) return "";
  return plant?.id ? `${API}/plants/${plant.id}/image` : imageUrl(plant.image_path);
}

function gardenNameById(gardenId) {
  const garden = gardensCache.find((item) => Number(item.id) === Number(gardenId));
  return garden?.name || (gardenId ? `ID ${gardenId}` : "--");
}

function gardenOptionsHtml(selectedValue = "") {
  // Cac o chon Garden ID hien ten vuon de nguoi dung khong phai nho so id.
  if (gardensCache.length === 0) {
    return `<option value="">Chưa có vườn</option>`;
  }

  return [
    `<option value="">Chọn vườn</option>`,
    ...gardensCache.map((garden) => `
      <option value="${garden.id}" ${Number(selectedValue) === Number(garden.id) ? "selected" : ""}>
        ${escapeHtml(garden.name || `Vườn ${garden.id}`)}
      </option>
    `),
  ].join("");
}

function renderGardenSelectors() {
  ["plantGardenId", "deviceGardenId", "soilGardenId"].forEach((elementId) => {
    const select = document.getElementById(elementId);
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = gardenOptionsHtml(currentValue);
  });
}

function plantOptionsHtml(selectedValue = "") {
  if (plantsCache.length === 0) {
    return `<option value="">Chưa có cây trồng</option>`;
  }

  return [
    `<option value="">Chọn cây trồng</option>`,
    ...plantsCache.map((plant) => `
      <option value="${plant.id}" ${Number(selectedValue) === Number(plant.id) ? "selected" : ""}>
        ${escapeHtml(plant.name || `Cây ${plant.id}`)}
      </option>
    `),
  ].join("");
}

function renderPlantSelectors() {
  ["fertPlantId"].forEach((elementId) => {
    const select = document.getElementById(elementId);
    if (!select) return;

    const currentValue = select.value;
    select.innerHTML = plantOptionsHtml(currentValue);
  });
}

async function ensureGardensLoaded() {
  if (gardensCache.length === 0) {
    await loadGardens();
  } else {
    renderGardenSelectors();
  }
}

async function ensurePlantsLoaded() {
  if (plantsCache.length === 0) {
    await loadPlants();
  } else {
    renderPlantSelectors();
  }
}

function plantImageMarkup(plant, className = "main-plant-image") {
  if (!plantHasImage(plant)) {
    return `<div class="${className} placeholder"><span>🌱</span></div>`;
  }
  return `<img class="${className}" src="${plantImageSrc(plant)}" alt="${escapeHtml(plant.name || "Cây trồng")}" />`;
}

function thresholdHtml(plant, context = "plants") {
  const temperature = thresholdItemHtml("Nhiệt độ", formatRange(plant.temp_min, plant.temp_max, "°C"));
  const humidity = thresholdItemHtml("Độ ẩm không khí", formatRange(plant.humidity_min, plant.humidity_max, "%"));
  const soilMoisture = thresholdItemHtml("Độ ẩm đất", formatRange(plant.soil_min, plant.soil_max, "%"));
  const light = thresholdItemHtml("Ánh sáng", formatLightRange(plant));
  const ph = thresholdItemHtml("pH lý tưởng", formatSoilPh(plant.soil_ph));

  if (context === "dashboard" || context === "soil") {
    return thresholdGridHtml([temperature, humidity, soilMoisture, light, ph]);
  }

  if (context === "controls") {
    return thresholdGridHtml([temperature, humidity, soilMoisture, wateringHtml(plant)]);
  }

  if (context === "automation") {
    return thresholdGridHtml([temperature, humidity, soilMoisture, light, wateringHtml(plant)]);
  }

  return `
    ${plantDescriptionHtml(plant)}
    ${thresholdGridHtml([temperature, humidity, soilMoisture, light, wateringHtml(plant)])}
    ${soilProfileHtml(plant)}
  `;
}

function renderMainPlantPanels() {
  // Moi trang chi hien phan thong tin cay chinh can cho chuc nang cua trang do.
  document.querySelectorAll("[data-main-plant-panel]").forEach((panel) => {
    const context = panel.dataset.mainPlantPanel || "plants";
    if (!mainPlant) {
      panel.innerHTML = `
        <div class="main-plant-head">
          <div class="main-plant-profile">
            <div class="main-plant-image placeholder"><span>🌱</span></div>
            <div><span class="eyebrow">Cây chính</span><h2>Chưa có cây chính</h2><p>Thêm cây trồng để thiết lập ngưỡng tự động.</p></div>
          </div>
        </div>
      `;
      return;
    }

    panel.innerHTML = `
      <div class="main-plant-head">
        <div class="main-plant-profile">
          ${plantImageMarkup(mainPlant)}
          <div>
            <span class="eyebrow">Cây chính</span>
            <h2>${escapeHtml(mainPlant.name)}</h2>
            <p>Vườn: ${escapeHtml(gardenNameById(mainPlant.garden_id))} · Plant ID: ${mainPlant.id}</p>
          </div>
        </div>
        <span class="badge">Đang dùng cho Auto</span>
      </div>
      ${thresholdHtml(mainPlant, context)}
    `;
  });
}

function renderLatestFertilizer(fertilizer) {
  const panel = document.getElementById("latestFertilizerPanel");
  if (!panel) return;

  if (!fertilizer) {
    panel.innerHTML = `
      <div class="panel-head">
        <div><h2>Bón phân gần nhất</h2><p>Chưa có lịch sử bón phân.</p></div>
        <span class="badge">Bón phân</span>
      </div>
    `;
    return;
  }

  // Trang chính chỉ hiển thị các thông tin gọn nhất của lần bón mới nhất.
  panel.innerHTML = `
    <div class="panel-head">
      <div>
        <h2>Bón phân gần nhất</h2>
        <p>${formatDateTime(fertilizer.created_at)}</p>
      </div>
      <span class="badge">Bón phân</span>
    </div>
    <div class="fertilizer-summary">
      <div><span>Cây</span><strong>${escapeHtml(fertilizer.plant_name || `Plant ${fertilizer.plant_id || "--"}`)}</strong></div>
      <div><span>Loại phân</span><strong>${escapeHtml(fertilizer.type || "--")}</strong></div>
      <div><span>Số lượng</span><strong>${escapeHtml(fertilizer.quantity || "--")}</strong></div>
      <div><span>Phương pháp</span><strong>${escapeHtml(fertilizer.method || "--")}</strong></div>
    </div>
  `;
}

function renderSystemStatus(status = {}, deviceSummary = {}) {
  const panel = document.getElementById("systemStatusPanel");
  if (!panel) return;

  systemStatusState = { ...systemStatusState, ...status };
  const mqttOnline = Boolean(status.mqttConnected);
  const simulateEnabled = Boolean(status.simulateSensor);
  const lastSensorText = status.lastSensorAt ? formatDateTime(status.lastSensorAt) : "Chưa nhận trong phiên chạy này";
  const lastSavedText = status.lastSensorSaveAt ? formatDateTime(status.lastSensorSaveAt) : "Chưa lưu";
  const saveIntervalText = status.sensorSaveIntervalSeconds
    ? `${Math.round(status.sensorSaveIntervalSeconds / 60)} phút/lần`
    : "--";
  const sourceText = status.lastSensorSource === "simulated" ? "Dữ liệu mô phỏng" : "MQTT / thiết bị thật";
  const latestCommand = status.latestDeviceCommand;
  const latestCommandText = latestCommand
    ? `${latestCommand.payload?.state?.toUpperCase() || "--"} ${latestCommand.payload?.device || "--"} · ${latestCommand.topic || "--"}`
    : "Chưa có lệnh";

  panel.innerHTML = `
    <div class="panel-head">
      <div><h2>Trạng thái hệ thống</h2><p>Nguồn dữ liệu cảm biến và thiết bị đang khai báo trong vườn.</p></div>
      <button class="${simulateEnabled ? "secondary" : ""}" onclick="toggleSimulation()">
        ${simulateEnabled ? "Tắt mô phỏng" : "Bật mô phỏng"}
      </button>
    </div>
    <div class="system-status-grid">
      <div><span>MQTT</span><strong class="${mqttOnline ? "status-good" : "status-bad"}">${mqttOnline ? "Đã kết nối" : "Chưa kết nối"}</strong></div>
      <div><span>Nguồn dữ liệu</span><strong>${sourceText}</strong></div>
      <div><span>Lần nhận gần nhất</span><strong>${lastSensorText}</strong></div>
      <div><span>Lưu MySQL</span><strong>${saveIntervalText} · ${lastSavedText}</strong></div>
      <div><span>Thiết bị</span><strong>${deviceSummary.online || 0}/${deviceSummary.total || 0} online</strong></div>
      <div><span>Lệnh MQTT gần nhất</span><strong>${escapeHtml(latestCommandText)}</strong></div>
    </div>
  `;
}

function renderControlSensorPanel(sensor) {
  const panels = document.querySelectorAll("[data-realtime-sensor-panel]");
  if (panels.length === 0) return;

  if (!sensor) {
    panels.forEach((panel) => {
      panel.innerHTML = `
      <div class="panel-head">
        <div><h2>Cảm biến thời gian thực</h2><p>Chưa có dữ liệu cảm biến.</p></div>
      </div>
    `;
    });
    return;
  }

  // Khoi nay nam duoi thong tin cay chinh trong trang dieu khien va tu dong.
  const lightValue = normalizeMetricValue(sensor.light, lightSeriesMeta);
  panels.forEach((panel) => {
    panel.innerHTML = `
    <div class="panel-head">
      <div><h2>Cảm biến thời gian thực</h2><p>${formatDateTime(sensor.created_at)}</p></div>
      <span class="badge">Live</span>
    </div>
    <div class="realtime-grid">
      <div><span>Nhiệt độ</span><strong>${formatValue(sensor.temperature, "°C")}</strong></div>
      <div><span>Độ ẩm không khí</span><strong>${formatValue(sensor.humidity, "%")}</strong></div>
      <div><span>Độ ẩm đất</span><strong>${formatValue(sensor.soil_moisture, "%")}</strong></div>
      <div><span>Ánh sáng</span><strong>${formatValue(lightValue, " lux")}</strong></div>
      <div><span>Khí độc</span><strong>${formatValue(sensor.gas, " ppm")}</strong></div>
    </div>
  `;
  });
}

function renderAutoToggleButtons() {
  const buttons = document.querySelectorAll("[data-auto-toggle]");
  if (buttons.length === 0) return;

  const disabled = Object.values(autoDisabledState).every(Boolean);
  buttons.forEach((button) => {
    setStateButton(
      button,
      !disabled,
      "Đã bật chế độ tự động",
      "Đã tắt chế độ tự động",
      "Chức năng tự động đang bật",
      "Chức năng tự động đang tắt"
    );
  });
  renderAutoIrrigationModeControls();
}

function setStateButton(button, active, onText = "Đang bật", offText = "Tắt", onTitle = onText, offTitle = offText) {
  if (!button) return;
  button.innerText = active ? onText : offText;
  button.classList.toggle("state-on", active);
  button.classList.toggle("state-off", !active);
  button.classList.toggle("secondary", !active);
  button.classList.remove("danger");
  button.title = active ? onTitle : offTitle;
}

function isAutoModeDisabled() {
  return Object.values(autoDisabledState).every(Boolean);
}

function createDefaultAutoRules(source = DEFAULT_AUTO_RULE_STATE) {
  const normalized = {};
  Object.keys(AUTO_RULE_DEVICE_OPTIONS).forEach((device) => {
    normalized[device] = {};
    AUTO_RULE_SENSOR_OPTIONS.forEach((sensor) => {
      normalized[device][sensor.key] = {};
      AUTO_RULE_DIRECTIONS.forEach((direction) => {
        const fallback = Boolean(DEFAULT_AUTO_RULE_STATE?.[device]?.[sensor.key]?.[direction.key]);
        const value = source?.[device]?.[sensor.key]?.[direction.key];
        normalized[device][sensor.key][direction.key] =
          value === undefined || value === null ? fallback : Boolean(value);
      });
    });
  });
  return normalized;
}

function isAutoRuleEnabled(device, sensorKey, direction) {
  return Boolean(autoRulesState?.[device]?.[sensorKey]?.[direction]);
}

function isAutoRuleUnused(device, sensorKey) {
  return !AUTO_RULE_DIRECTIONS.some((direction) => isAutoRuleEnabled(device, sensorKey, direction.key));
}

function isAutoRuleDirectionDisabled(sensor, direction) {
  if (direction === "unused") return false;
  return Boolean(sensor.fireOnly || (sensor.noBelow && direction === "below"));
}

function renderAutoRuleSetup() {
  Object.entries(AUTO_RULE_DEVICE_OPTIONS).forEach(([device, option]) => {
    const button = document.getElementById(option.buttonId);
    if (!button) return;
    const active = activeAutoSetupDevice === device;
    button.classList.toggle("state-on", active);
    button.classList.toggle("state-off", !active);
    button.classList.toggle("secondary", !active);
  });

  const grid = document.getElementById("autoRuleGrid");
  if (!grid) return;

  const deviceLabel = AUTO_RULE_DEVICE_OPTIONS[activeAutoSetupDevice]?.label || "Setup tự động";
  grid.innerHTML = AUTO_RULE_SENSOR_OPTIONS.map((sensor) => {
    if (sensor.fireOnly) {
      return `
        <div class="auto-rule-card fire">
          <div class="auto-rule-fire-content">
            <strong>${escapeHtml(sensor.label)}</strong>
            <span class="auto-rule-fire-label">Phục vụ PCCC</span>
          </div>
          <div class="auto-rule-note">Không dùng</div>
        </div>
      `;
    }

    const buttons = AUTO_RULE_DIRECTIONS.map((direction) => {
      const disabled = isAutoRuleDirectionDisabled(sensor, direction.key);
      const active = isAutoRuleEnabled(activeAutoSetupDevice, sensor.key, direction.key);
      const classes = active ? "state-on" : "secondary state-off";
      return `
        <button
          type="button"
          class="mini auto-rule-button ${classes}"
          ${disabled ? "disabled" : ""}
          onclick="toggleAutoRule('${activeAutoSetupDevice}', '${sensor.key}', '${direction.key}')"
          title="${disabled ? "Cảm biến này không có ngưỡng dưới" : `${deviceLabel}: ${direction.label.toLowerCase()} ${sensor.label.toLowerCase()}`}"
        >${escapeHtml(direction.label)}</button>
      `;
    }).join("");
    const unusedActive = isAutoRuleUnused(activeAutoSetupDevice, sensor.key);
    const unusedButton = `
      <button
        type="button"
        class="mini auto-rule-button auto-rule-unused ${unusedActive ? "state-unused" : "secondary state-off"}"
        onclick="toggleAutoRule('${activeAutoSetupDevice}', '${sensor.key}', 'unused')"
        title="${deviceLabel}: không dùng ${sensor.label.toLowerCase()} để điều khiển tự động"
      >Không sử dụng</button>
    `;

    return `
      <div class="auto-rule-card">
        <div>
          <strong>${escapeHtml(sensor.label)}</strong>
          <span>${escapeHtml(deviceLabel)}</span>
        </div>
        <div class="auto-rule-buttons">${buttons}${unusedButton}</div>
      </div>
    `;
  }).join("");
}

function setAutoSetupDevice(device) {
  if (!AUTO_RULE_DEVICE_OPTIONS[device]) return;
  activeAutoSetupDevice = device;
  renderAutoRuleSetup();
}

function normalizeAutoScheduleDevice(device) {
  return AUTO_SCHEDULE_DEVICE_OPTIONS[device] ? device : "irrigation";
}

function getAutoScheduleDeviceLabel(device) {
  return AUTO_SCHEDULE_DEVICE_OPTIONS[normalizeAutoScheduleDevice(device)]?.label || "Bơm tưới";
}

function renderAutoScheduleDeviceButtons() {
  Object.entries(AUTO_SCHEDULE_DEVICE_OPTIONS).forEach(([device, option]) => {
    const button = document.getElementById(option.buttonId);
    if (!button) return;
    const active = activeAutoScheduleDevice === device;
    button.classList.toggle("state-on", active);
    button.classList.toggle("state-off", !active);
    button.classList.toggle("secondary", !active);
  });
}

function setAutoScheduleDevice(device) {
  if (!AUTO_SCHEDULE_DEVICE_OPTIONS[device]) return;
  const changedDevice = activeAutoScheduleDevice !== device;
  if (changedDevice) {
    autoScheduleEditId = null;
    setAutoScheduleTimeInputs("");
    const durationInput = document.getElementById("autoDuration");
    if (durationInput) durationInput.value = "";
  }
  activeAutoScheduleDevice = device;
  if (changedDevice && device === "irrigation") prefillAutoScheduleFromMainPlant();
  renderAutoScheduleDeviceButtons();
  renderAutoScheduleList();
  renderAutoScheduleSummary();
  updateAutoScheduleFormButtons();
}

function renderAutoIrrigationModeControls() {
  const controls = document.getElementById("autoIrrigationModeControls");
  const scheduleArea = document.getElementById("autoScheduleArea");
  const setupArea = document.getElementById("autoSetupArea");
  const sensorButton = document.getElementById("sensorIrrigationModeButton");
  const scheduleButton = document.getElementById("scheduleIrrigationModeButton");
  const autoOff = isAutoModeDisabled();
  const scheduleMode = autoIrrigationModeState === "schedule";
  const setupMode = !scheduleMode;

  if (controls) controls.classList.toggle("hidden", autoOff);
  if (scheduleArea) scheduleArea.classList.toggle("hidden", autoOff || !scheduleMode);
  if (setupArea) setupArea.classList.toggle("hidden", autoOff || !setupMode);

  if (sensorButton) {
    sensorButton.classList.toggle("state-on", !scheduleMode);
    sensorButton.classList.toggle("state-off", scheduleMode);
    sensorButton.classList.toggle("secondary", scheduleMode);
  }
  if (scheduleButton) {
    scheduleButton.classList.toggle("state-on", scheduleMode);
    scheduleButton.classList.toggle("state-off", !scheduleMode);
    scheduleButton.classList.toggle("secondary", !scheduleMode);
  }

  renderAutoRuleSetup();
  renderAutoScheduleDeviceButtons();
}

function formatCountdown(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function syncDeviceCountdowns(countdowns = {}) {
  const now = Date.now();
  Object.keys(deviceCountdownEndState).forEach((key) => {
    if (!Number(countdowns[key])) delete deviceCountdownEndState[key];
  });

  Object.entries(countdowns).forEach(([key, seconds]) => {
    const value = Number(seconds);
    if (Number.isFinite(value) && value > 0) {
      const serverEndAt = now + value * 1000;
      const localEndAt = deviceCountdownEndState[key];
      if (!localEndAt || Math.abs(localEndAt - serverEndAt) > COUNTDOWN_SYNC_DRIFT_MS) {
        deviceCountdownEndState[key] = serverEndAt;
      }
    }
  });
}

function countdownSecondsLeft(key) {
  const endAt = deviceCountdownEndState[key];
  if (!endAt) return 0;
  const seconds = Math.ceil((endAt - Date.now()) / 1000);
  if (seconds <= 0) {
    delete deviceCountdownEndState[key];
    return 0;
  }
  return seconds;
}

function renderDeviceCountdowns() {
  document.querySelectorAll("[data-countdown]").forEach((item) => {
    const key = item.dataset.countdown;
    const seconds = countdownSecondsLeft(key);
    const activeWithoutCountdown = Boolean(controlStatusState[key]);
    item.classList.toggle("active", seconds > 0 || activeWithoutCountdown);
    item.innerText = seconds > 0 ? `Còn ${formatCountdown(seconds)}` : activeWithoutCountdown ? "Đang bật" : "Đang tắt";
  });
}

function renderControlButtons(status = systemStatusState) {
  const stateMap = {
    irrigation: Boolean(status.irrigationStatus),
    fan: Boolean(status.fanStatus),
    spray: Boolean(status.sprayStatus),
    cooling: Boolean(status.coolingStatus),
  };
  controlStatusState = { ...controlStatusState, ...stateMap };

  document.querySelectorAll("[data-device-control]").forEach((button) => {
    const key = button.dataset.deviceControl;
    const active = Boolean(controlStatusState[key]);
    button.innerText = active ? "Dừng" : "Bật";
    button.classList.toggle("control-running", active);
    button.classList.toggle("control-ready", !active);
    button.classList.toggle("danger", active);
    button.classList.toggle("state-on", !active);
    button.classList.toggle("state-off", false);
    button.classList.remove("secondary");
    button.setAttribute("aria-pressed", String(active));
    button.title = active ? "Bấm để dừng thiết bị đang chạy" : "Bấm để bật thiết bị";
  });

  syncDeviceCountdowns(status.deviceCountdowns || {});
  renderDeviceCountdowns();
}

function isManualControlActive(device) {
  if (Boolean(controlStatusState[device])) return true;
  return Array.from(document.querySelectorAll(`[data-device-control="${device}"]`)).some((button) =>
    button.classList.contains("control-running") || button.getAttribute("aria-pressed") === "true"
  );
}

function renderEmergencyButton(status = systemStatusState) {
  const buttons = document.querySelectorAll("[data-emergency-toggle]");
  if (buttons.length === 0) return;

  systemStatusState = { ...systemStatusState, ...status };
  buttons.forEach((button) => {
    button.innerText = "Dừng khẩn cấp";
    button.classList.add("danger");
    button.classList.remove("secondary");
    button.title = "Tắt ngay bơm tưới, quạt, phun mát và còi";
  });
}

function autoSchedulesForDevice(device = activeAutoScheduleDevice) {
  const normalized = normalizeAutoScheduleDevice(device);
  return autoSchedulesCache.filter((item) => normalizeAutoScheduleDevice(item.device_type) === normalized);
}

function renderAutoScheduleSummary(setting = null) {
  const panel = document.getElementById("autoScheduleSummary");
  if (!panel) return;

  const device = activeAutoScheduleDevice;
  const deviceLabel = getAutoScheduleDeviceLabel(device);
  const schedule =
    setting && normalizeAutoScheduleDevice(setting.device_type) === device
      ? setting
      : autoSchedulesForDevice(device).find((item) => Boolean(item.is_active)) || autoSchedulesForDevice(device)[0] || null;

  if (!schedule) {
    panel.innerHTML = `
      <div><span>Thiết bị</span><strong>${escapeHtml(deviceLabel)}</strong></div>
      <div><span>Lịch tự động</span><strong>Chưa cài đặt</strong></div>
      <div><span>Thời gian chạy</span><strong>--</strong></div>
    `;
    return;
  }

  panel.innerHTML = `
    <div><span>Thiết bị</span><strong>${escapeHtml(deviceLabel)}</strong></div>
    <div><span>Giờ chạy lịch</span><strong>${escapeHtml(String(schedule.irrigation_time || "--").slice(0, 5))}</strong></div>
    <div><span>Thời gian chạy</span><strong>${formatValue(schedule.irrigation_duration, " giây")}</strong></div>
  `;
}

function renderAutoScheduleList() {
  const list = document.getElementById("autoScheduleList");
  if (!list) return;

  const schedules = autoSchedulesForDevice();
  const deviceLabel = getAutoScheduleDeviceLabel(activeAutoScheduleDevice);
  if (schedules.length === 0) {
    list.innerHTML = `<div class="empty-state">Chưa có lịch cho ${escapeHtml(deviceLabel.toLowerCase())}.</div>`;
    renderAutoScheduleSummary();
    return;
  }

  list.innerHTML = schedules.map((item) => {
    const isActive = Boolean(item.is_active);
    return `
      <div class="auto-row ${isActive ? "active" : ""} ${Number(item.id) === Number(autoScheduleEditId) ? "editing" : ""}">
        <div>
          <strong>${escapeHtml(String(item.irrigation_time || "--").slice(0, 5))} · ${escapeHtml(deviceLabel)}</strong>
          <p>${escapeHtml(item.plant_name || `Plant ${item.plant_id || "--"}`)} · ${formatValue(item.irrigation_duration, " giây")} · ${isActive ? "Đang bật" : "Đang tắt"}</p>
        </div>
        <div class="plant-actions">
          <button class="mini" onclick="editAutoSchedule(${item.id})">Sửa</button>
          <button class="mini ${isActive ? "state-on" : "secondary state-off"}" title="${isActive ? "Bấm để tắt lịch" : "Bấm để bật lịch"}" onclick="toggleAutoSchedule(${item.id}, ${isActive ? "false" : "true"})">${isActive ? "Đang bật" : "Tắt"}</button>
          <button class="mini danger" onclick="deleteAutoSchedule(${item.id})">Xóa</button>
        </div>
      </div>
    `;
  }).join("");
  renderAutoScheduleSummary();
}

function renderAlertMuteButton() {
  const button = document.getElementById("alertMuteToggle");
  const status = document.getElementById("alertMuteStatus");

  if (button) {
    setStateButton(
      button,
      !alertMutedState,
      "Cảnh báo đang bật",
      "Cảnh báo tắt",
      "Bấm để tắt cảnh báo",
      "Bấm để bật cảnh báo"
    );
  }

  if (status) {
    status.innerText = alertMutedState
      ? "Cảnh báo đang tắt, hệ thống chỉ lưu lịch sử"
      : "Cảnh báo đang bật";
  }
}

function renderFireSafetyStatus(status = systemStatusState) {
  const panel = document.getElementById("fireSafetyStatus");
  const button = document.getElementById("fireSimulationToggle");
  if (!panel && !button) return;

  systemStatusState = { ...systemStatusState, ...status };
  const active = Boolean(systemStatusState.fireProtectionActive);
  const simulation = Boolean(systemStatusState.fireSimulationActive);
  const responseUntil = systemStatusState.fireResponseUntil
    ? formatDateTime(systemStatusState.fireResponseUntil)
    : "--";

  if (button) {
    setStateButton(
      button,
      simulation,
      "Giả lập đang bật",
      "Giả lập tắt",
      "Bấm để tắt giả lập PCCC",
      "Bấm để bật giả lập PCCC"
    );
  }

  if (panel) {
    panel.innerHTML = `
      <div><span>Trạng thái PCCC</span><strong class="${active ? "danger-text" : "status-good"}">${active ? "Đang kích hoạt" : "Sẵn sàng"}</strong></div>
      <div><span>Giả lập</span><strong>${simulation ? "Đang bật" : "Đang tắt"}</strong></div>
      <div><span>Cảm biến lửa</span><strong class="${systemStatusState.fireFlameDetected ? "danger-text" : "status-good"}">${systemStatusState.fireFlameDetected ? "Phát hiện" : "Không"}</strong></div>
      <div><span>Kết thúc dự kiến</span><strong>${responseUntil}</strong></div>
      <div><span>Ngưỡng cháy</span><strong>Khói ${systemStatusState.fireSmokeThreshold ?? "--"} / ${systemStatusState.fireCriticalTemp ?? "--"}°C</strong></div>
    `;
  }
}

function renderAlertSettings() {
  // Dong bo trang thai checkbox voi cau hinh canh bao luu tren server.
  const map = {
    alertSettingPopup: "popup_enabled",
    alertSettingTemp: "temp_enabled",
    alertSettingHumidity: "humidity_enabled",
    alertSettingSoil: "soil_enabled",
    alertSettingGas: "gas_enabled",
    alertSettingAction: "action_enabled",
  };

  Object.entries(map).forEach(([elementId, key]) => {
    const input = document.getElementById(elementId);
    if (input) input.checked = alertSettingsState[key] !== false;
  });
}

function collectAlertSettings() {
  return {
    popup_enabled: Boolean(document.getElementById("alertSettingPopup")?.checked),
    temp_enabled: Boolean(document.getElementById("alertSettingTemp")?.checked),
    humidity_enabled: Boolean(document.getElementById("alertSettingHumidity")?.checked),
    soil_enabled: Boolean(document.getElementById("alertSettingSoil")?.checked),
    gas_enabled: Boolean(document.getElementById("alertSettingGas")?.checked),
    action_enabled: Boolean(document.getElementById("alertSettingAction")?.checked),
  };
}

function hasActiveFireResponse() {
  return Boolean(systemStatusState.fireProtectionActive || systemStatusState.fireSimulationActive);
}

function isFireResponseAlert(alertRow) {
  const message = String(alertRow?.message || "");
  return alertRow?.alert_type === "fire" || hasActiveFireResponse() || /PCCC|CANH BAO CHAY|GIA LAP/i.test(message);
}

function isFireSimulationAlert(alertRow) {
  const message = String(alertRow?.message || "");
  return Boolean(systemStatusState.fireSimulationActive || /GIA LAP|gia lap|giả lập/i.test(message));
}

function compactActionMessage(message) {
  const text = String(message || "");
  const normalized = text.toLowerCase();
  const isOffCommand = /(^|[\s"'{}:,>_-])(off|false|0|tat|tắt)($|[\s"',}<:_-])|lệnh mqtt\s+off|state["']?\s*:\s*["']?off/.test(normalized);
  const isOnCommand = /(^|[\s"'{}:,>_-])(on|true|1|bat|bật)($|[\s"',}<:_-])|lệnh mqtt\s+on|state["']?\s*:\s*["']?on/.test(normalized);

  if (/dừng khẩn cấp|khẩn cấp.*tắt|emergency_stop/.test(normalized)) {
    return "Dừng khẩn cấp: tắt tất cả thiết bị";
  }

  if (/làm mát|quạt.*phun|phun.*quạt|đạt nhiệt độ|cooling/.test(normalized)) {
    if (isOffCommand || /tắt|tự tắt/.test(normalized)) return "Tắt quạt và phun mát";
    if (isOnCommand || /bật|nhiệt độ.*vượt/.test(normalized)) return "Bật quạt và phun mát";
  }

  if (/phun|spray/.test(normalized)) {
    if (isOffCommand || /tắt.*phun|spray.*off/.test(normalized)) return "Tắt phun mát";
    if (isOnCommand || /bật.*phun|phun nước|phun sương|spray.*on/.test(normalized)) return "Bật phun mát";
  }

  if (/quạt|fan/.test(normalized)) {
    if (isOffCommand || /tắt.*quạt|fan.*off/.test(normalized)) return "Tắt quạt";
    if (isOnCommand || /bật.*quạt|fan.*on/.test(normalized)) return "Bật quạt";
  }

  if (/còi|buzzer/.test(normalized)) {
    if (isOffCommand || /tắt.*còi|buzzer.*off/.test(normalized)) return "Tắt còi báo động";
    if (isOnCommand || /bật.*còi|buzzer.*on/.test(normalized)) return "Bật còi báo động";
  }

  if (/tưới|bơm|irrigation|pump/.test(normalized)) {
    if (isOffCommand || /tắt.*tưới|tắt.*bơm|irrigation.*off|pump.*off/.test(normalized)) return "Tắt bơm tưới";
    if (isOnCommand || /bật.*tưới|bật.*bơm|tự động tưới|irrigation.*on|pump.*on/.test(normalized)) return "Bật bơm tưới";
  }

  return text;
}

function showAlertModal(alertRow) {
  // Popup chi hien canh bao chua xac nhan; rieng PCCC luon uu tien nut khac phuc su co.
  if (!alertRow) return;
  const modal = document.getElementById("alertModal");
  if (!modal) return;
  if (currentAlert?.id === alertRow.id && !modal.classList.contains("hidden")) return;
  if (currentAlert?.id === alertRow.id && !modal.classList.contains("hidden") && !hasActiveFireResponse()) return;

  currentAlert = alertRow;
  const isActionNotice = alertRow.level === "info";
  const isFireAlert = isFireResponseAlert(alertRow);
  const isFireSimulation = isFireSimulationAlert(alertRow);
  const level = alertRow.level === "danger" ? "Cảnh báo nguy hiểm" : alertRow.level === "info" ? "Thông báo tự động" : "Cảnh báo";
  const icon = document.getElementById("alertModalIcon") || modal.querySelector(".alert-icon");
  const actionButton = document.getElementById("alertModalAction") || modal.querySelector("button");

  modal.classList.remove("info", "danger", "warning", "fire");
  modal.classList.add(isActionNotice ? "info" : alertRow.level === "danger" ? "danger" : "warning");
  if (icon) icon.innerText = isActionNotice ? "✓" : "!";
  if (document.getElementById("alertModalLevel")) document.getElementById("alertModalLevel").innerText = level;
  if (document.getElementById("alertModalTitle")) document.getElementById("alertModalTitle").innerText = isActionNotice ? "Hành động đã làm" : "Ngưỡng bị vượt qua";
  if (isFireAlert) {
    modal.classList.remove("info", "warning");
    modal.classList.add("danger", "fire");
    if (icon) icon.innerText = "PCCC";
    if (document.getElementById("alertModalLevel")) document.getElementById("alertModalLevel").innerText = isFireSimulation ? "GIẢ LẬP PCCC" : "CẢNH BÁO PCCC";
    if (document.getElementById("alertModalTitle")) document.getElementById("alertModalTitle").innerText = isFireSimulation ? "Giả lập phòng cháy chữa cháy" : "Phát hiện nguy cơ cháy";
  }
  const fallbackFireMessage = isFireSimulation
    ? "Giả lập PCCC đang kích hoạt: còi báo động, phun nước làm mát và bơm tưới đang chạy. Bấm nút bên dưới để tắt chế độ giả lập."
    : "Cảnh báo PCCC đang kích hoạt: hệ thống đã bật còi, phun nước làm mát và bơm tưới. Bấm nút bên dưới khi đã khắc phục sự cố.";
  const alertMessage = String(alertRow.message || "");
  const shouldUseFireMessage = isFireAlert && (hasActiveFireResponse() || /GIA LAP|CANH BAO CHAY/i.test(alertMessage));
  const displayMessage = isActionNotice && !isFireAlert ? compactActionMessage(alertMessage) : alertRow.message;
  if (document.getElementById("alertModalMessage")) document.getElementById("alertModalMessage").innerText = shouldUseFireMessage ? fallbackFireMessage : displayMessage || "Có ngưỡng cảm biến vượt giới hạn của cây chính.";
  if (document.getElementById("alertModalTime")) document.getElementById("alertModalTime").innerText = formatDateTime(alertRow.created_at);
  if (actionButton) actionButton.innerText = isFireAlert ? "Đã khắc phục sự cố" : "Đã xem";
  modal.classList.remove("hidden");
}

function hideAlertModal() {
  const modal = document.getElementById("alertModal");
  if (modal) modal.classList.add("hidden");
  currentAlert = null;
}

async function acknowledgeCurrentAlert() {
  if (!currentAlert) {
    hideAlertModal();
    return;
  }

  const alertId = currentAlert.id;
  const isFireAlert = isFireResponseAlert(currentAlert);
  const data = isFireAlert
    ? await request("/fire-response/resolve", "POST", { alert_id: alertId })
    : await request(`/alerts/${alertId}/ack`, "POST", {});
  if (data.isError) {
    alertMsg(data);
    return;
  }

  hideAlertModal();
  if (isFireAlert) {
    systemStatusState.fireSimulationActive = Boolean(data.fireSimulationActive);
    systemStatusState.fireProtectionActive = Boolean(data.fireProtectionActive);
    systemStatusState.fireResponseUntil = data.fireResponseUntil || null;
    renderFireSafetyStatus();
  }
  await loadAlerts();
  await loadData();
}

function initAlertStream() {
  if (!window.EventSource || alertStream) return;

  const token = encodeURIComponent(localStorage.getItem("token") || "");
  alertStream = new EventSource(`${API}/alert-stream?token=${token}`);

  alertStream.addEventListener("alert", async (event) => {
    try {
      const alertRow = JSON.parse(event.data);
      if (!alertMutedState || isFireResponseAlert(alertRow)) {
        showAlertModal(alertRow);
      }
      await loadData();
    } catch (err) {
      console.log("Khong doc duoc canh bao tuc thoi:", err);
    }
  });

  alertStream.onerror = () => {
    if (alertStream) {
      alertStream.close();
      alertStream = null;
    }
    clearTimeout(alertStreamReconnectTimer);
    alertStreamReconnectTimer = setTimeout(initAlertStream, 3000);
  };
}

async function loadData() {
  // Ham nay la vong cap nhat 2 giay: dong bo dashboard, canh bao va trang thai thiet bi.
  try {
    const data = await request("/report");
    if (!data || data.message) return;

    if (data.main_plant) {
      mainPlant = data.main_plant;
      renderMainPlantPanels();
      prefillAutoScheduleFromMainPlant();
    }
    renderLatestFertilizer(data.latest_fertilizer || null);
    renderSystemStatus(data.status || {}, data.device_summary || {});
    if (Array.isArray(data.devices)) {
      devicesCache = data.devices;
      renderDeviceList();
    }
    autoDisabledState = data.status?.autoDisabled || autoDisabledState;
    autoIrrigationModeState = data.status?.autoIrrigationMode || autoIrrigationModeState;
    autoRulesState = createDefaultAutoRules(data.status?.autoRules || autoRulesState);
    alertMutedState = Boolean(data.status?.alertMuted);
    alertSettingsState = data.status?.alertPreferences || alertSettingsState;
    renderAlertSettings();
    renderAutoToggleButtons();
    renderEmergencyButton(data.status || {});
    renderControlButtons(data.status || {});
    renderAlertMuteButton();
    renderFireSafetyStatus(data.status || {});
    if (Array.isArray(data.auto_settings)) {
      autoSchedulesCache = data.auto_settings;
      renderAutoScheduleList();
    }
    renderAutoScheduleSummary();
    const latestUnreadAlert = data.latest_unread_alert || null;
    const latestUnreadIsFire = isFireResponseAlert(latestUnreadAlert);
    if (latestUnreadAlert && (!alertMutedState || latestUnreadIsFire)) {
      showAlertModal(latestUnreadAlert);
    } else if (currentAlert && !(isFireResponseAlert(currentAlert) && hasActiveFireResponse())) {
      hideAlertModal();
    }

    const sensors = data.sensor_data || [];
    const chartSensors = Array.isArray(data.saved_sensor_data) ? data.saved_sensor_data : [];
    const chartLatest = chartSensors[chartSensors.length - 1] || null;
    if (sensors.length > 0) {
      const last = sensors[sensors.length - 1];
      renderControlSensorPanel(last);

      document.getElementById("statTemp").innerText = `${last.temperature ?? "--"} °C`;
      document.getElementById("statHumidity").innerText = `${last.humidity ?? "--"} %`;
      document.getElementById("statSoil").innerText = `${last.soil_moisture ?? "--"} %`;
      if (document.getElementById("statLight")) {
        const lightValue = normalizeMetricValue(last.light, lightSeriesMeta);
        document.getElementById("statLight").innerText = `${lightValue ?? "--"} lux`;
      }
      document.getElementById("statGas").innerText = `${last.gas ?? "--"} ppm`;
      if (document.getElementById("statFlame")) {
        document.getElementById("statFlame").innerText = Number(last.flame) === 1 ? "Phát hiện" : "Không";
      }

      updateSensorChart(chartSensors, chartLatest);
      fillSensorTable(chartSensors.slice(-20).reverse());
    } else {
      updateSensorChart(chartSensors, chartLatest);
      fillSensorTable(chartSensors.slice(-20).reverse());
      renderControlSensorPanel(null);
    }

    document.getElementById("fanStatus").innerText = data.status?.fanStatus ? "Đang bật" : "Đang tắt";
    document.getElementById("sprayStatus").innerText = data.status?.sprayStatus ? "Đang bật" : "Đang tắt";
    document.getElementById("irrigationStatus").innerText = data.status?.irrigationStatus ? "Đang tưới" : "Đang tắt";
    if (document.getElementById("buzzerStatus")) {
      document.getElementById("buzzerStatus").innerText = data.status?.buzzerStatus ? "Đang báo động" : "Đang tắt";
    }

    fillDeviceLogTable((data.device_logs || []).slice(0, 30));
    fillIrrigationLogTable((data.irrigation_logs || []).slice(0, 30));
    fillFertilizerLogTable((data.fertilizer_logs || []).slice(0, 30));
  } catch (err) {
    console.log("Không tải được report:", err);
  }
}

setInterval(loadData, DATA_REFRESH_INTERVAL_MS);
setInterval(renderDeviceCountdowns, 1000);
initChartRangeControl();
initAlertStream();
initWaterFlowControls();
loadData();
loadPlants();
loadGardens();
runStartupActionFromUrl();

function showGardenOverview() {
  document.getElementById("gardenOverview").classList.remove("hidden");
  document.getElementById("gardenFormPage").classList.add("hidden");
}

function showGardenForm(gardenId = null) {
  const garden = gardenId ? gardensCache.find((item) => Number(item.id) === Number(gardenId)) : null;
  document.getElementById("gardenOverview").classList.add("hidden");
  document.getElementById("gardenFormPage").classList.remove("hidden");
  document.getElementById("gardenFormTitle").innerText = garden ? "Sửa thông tin vườn" : "Thêm vườn mới";

  gardenEditId.value = garden?.id || "";
  gardenName.value = garden?.name || "";
  gardenLocation.value = garden?.location || "";
  gardenUserId.value = garden?.user_id || 1;
  gardenDeviceInfo.value = garden?.device_info || "";
}

function gardenPayload() {
  return {
    name: gardenName.value.trim(),
    location: gardenLocation.value.trim(),
    user_id: gardenUserId.value,
    device_info: gardenDeviceInfo.value.trim(),
  };
}

async function saveGarden() {
  const payload = gardenPayload();
  if (!payload.name) {
    showToast("Vui lòng nhập tên vườn", "warning");
    return;
  }

  const id = gardenEditId.value;
  const data = id
    ? await request(`/gardens/${id}`, "PUT", payload)
    : await request("/gardens", "POST", payload);

  alertMsg(data);
  showGardenOverview();
  await loadGardens();
}

async function loadGardens() {
  const data = await request("/gardens");
  if (!Array.isArray(data)) return alertMsg(data);

  gardensCache = data;
  renderGardenList();
  renderGardenSelectors();
  renderMainPlantPanels();
  renderPlantList();
  renderDeviceList();
}

function renderGardenList() {
  const list = document.getElementById("gardenList");
  if (!list) return;

  document.getElementById("gardenCount").innerText = `${gardensCache.length} vườn`;

  if (gardensCache.length === 0) {
    list.innerHTML = `<div class="empty-state">Chưa có vườn.</div>`;
    return;
  }

  list.innerHTML = gardensCache.map((garden) => `
    <div class="garden-row">
      <div class="garden-icon">🌿</div>
      <div class="garden-info">
        <div class="plant-title">
          <strong>${escapeHtml(garden.name)}</strong>
          <span class="badge small">ID ${garden.id}</span>
        </div>
        <p><strong>Vị trí:</strong> ${escapeHtml(garden.location || "--")} · <strong>User ID:</strong> ${formatValue(garden.user_id)}</p>
        <p><strong>Thiết bị:</strong> ${escapeHtml(garden.device_info || "Chưa có thông tin thiết bị")}</p>
      </div>
      <div class="plant-actions">
        <button class="mini secondary" onclick="showGardenForm(${garden.id})">Sửa</button>
        <button class="mini danger" onclick="deleteGardenById(${garden.id})">Xóa</button>
      </div>
    </div>
  `).join("");
}

async function deleteGardenById(id) {
  const garden = gardensCache.find((item) => Number(item.id) === Number(id));
  if (!(await confirmAction({
    title: "Xóa vườn?",
    message: `Bạn muốn xóa vườn "${garden?.name || id}"?`,
    confirmText: "Xóa vườn",
  }))) return;
  const data = await request(`/gardens/${id}`, "DELETE");
  alertMsg(data);
  await loadGardens();
}

async function addGarden() {
  await saveGarden();
}

async function updateGarden() {
  await saveGarden();
}

async function deleteGarden() {
  await deleteGardenById(gardenEditId.value);
}

function deviceTypeLabel(type) {
  const labels = {
    irrigation: "Bơm tưới",
    fan: "Quạt",
    spray: "Phun sương",
    sensor: "Cảm biến",
    other: "Khác",
  };
  return labels[type] || type || "--";
}

function deviceStatusLabel(status) {
  const labels = {
    online: "Online",
    offline: "Offline",
    maintenance: "Bảo trì",
    error: "Lỗi",
  };
  return labels[status] || status || "--";
}

function showDeviceOverview() {
  document.getElementById("deviceOverview")?.classList.remove("hidden");
  document.getElementById("deviceFormPage")?.classList.add("hidden");
}

async function showDeviceForm(deviceId = null) {
  await ensureGardensLoaded();
  const device = deviceId ? devicesCache.find((item) => Number(item.id) === Number(deviceId)) : null;
  document.getElementById("deviceOverview").classList.add("hidden");
  document.getElementById("deviceFormPage").classList.remove("hidden");
  document.getElementById("deviceFormTitle").innerText = device ? "Sửa thiết bị" : "Thêm thiết bị mới";

  deviceEditId.value = device?.id || "";
  deviceName.value = device?.name || "";
  deviceType.value = device?.device_type || "irrigation";
  deviceGardenId.value = device?.garden_id || "";
  deviceStatus.value = device?.status || "offline";
  deviceTopic.value = device?.mqtt_topic || "";
  deviceNote.value = device?.note || "";
}

function devicePayload() {
  return {
    name: deviceName.value.trim(),
    device_type: deviceType.value,
    garden_id: deviceGardenId.value || null,
    status: deviceStatus.value,
    mqtt_topic: deviceTopic.value.trim(),
    note: deviceNote.value.trim(),
  };
}

async function saveDevice() {
  const payload = devicePayload();
  if (!payload.name) {
    showToast("Vui lòng nhập tên thiết bị", "warning");
    return;
  }

  const id = deviceEditId.value;
  const data = id
    ? await request(`/devices/${id}`, "PUT", payload)
    : await request("/devices", "POST", payload);

  alertMsg(data);
  if (data.isError) return;
  showDeviceOverview();
  await loadDevices();
  await loadData();
}

async function loadDevices() {
  const data = await request("/devices");
  if (!Array.isArray(data)) return alertMsg(data);

  devicesCache = data;
  renderDeviceList();
}

function renderDeviceList() {
  const list = document.getElementById("deviceList");
  if (!list) return;

  document.getElementById("deviceCount").innerText = `${devicesCache.length} thiết bị`;

  if (devicesCache.length === 0) {
    list.innerHTML = `<div class="empty-state">Chưa có thiết bị.</div>`;
    return;
  }

  list.innerHTML = devicesCache.map((device) => `
    <div class="device-row">
      <div class="device-inventory-icon">${device.device_type === "sensor" ? "📡" : "⚙"}</div>
      <div class="device-info">
        <div class="plant-title">
          <strong>${escapeHtml(device.name)}</strong>
          <span class="badge small">${escapeHtml(deviceStatusLabel(device.status))}</span>
        </div>
        <p><strong>Loại:</strong> ${escapeHtml(deviceTypeLabel(device.device_type))} · <strong>Vườn:</strong> ${escapeHtml(device.garden_name || gardenNameById(device.garden_id))}</p>
        <p><strong>Topic:</strong> ${escapeHtml(device.mqtt_topic || "--")}${device.note ? ` · <strong>Ghi chú:</strong> ${escapeHtml(device.note)}` : ""}</p>
      </div>
      <div class="plant-actions">
        <button class="mini secondary" onclick="showDeviceForm(${device.id})">Sửa</button>
        <button class="mini danger" onclick="deleteDeviceById(${device.id})">Xóa</button>
      </div>
    </div>
  `).join("");
}

async function deleteDeviceById(id) {
  const device = devicesCache.find((item) => Number(item.id) === Number(id));
  if (!(await confirmAction({
    title: "Xóa thiết bị?",
    message: `Bạn muốn xóa thiết bị "${device?.name || id}"?`,
    confirmText: "Xóa thiết bị",
  }))) return;
  const data = await request(`/devices/${id}`, "DELETE");
  alertMsg(data);
  if (!data.isError) {
    await loadDevices();
    await loadData();
  }
}

async function addDevice() {
  await saveDevice();
}

async function updateDevice() {
  await saveDevice();
}

async function deleteDevice() {
  await deleteDeviceById(deviceEditId.value);
}

function showPlantOverview() {
  document.getElementById("plantOverview").classList.remove("hidden");
  document.getElementById("plantFormPage").classList.add("hidden");
}

function setPlantWateringTimeInputs(timeValue = "") {
  const [hour = "", minute = ""] = String(timeValue || "").split(":");
  if (document.getElementById("plantWateringHour")) plantWateringHour.value = hour;
  if (document.getElementById("plantWateringMinute")) plantWateringMinute.value = minute;
}

function readPlantWateringTime() {
  const hourValue = document.getElementById("plantWateringHour")?.value;
  const minuteValue = document.getElementById("plantWateringMinute")?.value;
  if (hourValue === "" && minuteValue === "") return "";

  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

async function showPlantForm(plantId = null) {
  await ensureGardensLoaded();
  const plant = plantId ? plantsCache.find((item) => Number(item.id) === Number(plantId)) : null;
  document.getElementById("plantOverview").classList.add("hidden");
  document.getElementById("plantFormPage").classList.remove("hidden");
  document.getElementById("plantFormTitle").innerText = plant ? "Sửa cây trồng" : "Thêm cây trồng mới";

  plantEditId.value = plant?.id || "";
  plantName.value = plant?.name || "";
  plantGardenId.value = plant?.garden_id || "";
  plantDescription.value = plant?.description || "";
  plantTempMin.value = plant?.temp_min ?? "";
  plantTempMax.value = plant?.temp_max ?? "";
  plantHumidityMin.value = plant?.humidity_min ?? "";
  plantHumidityMax.value = plant?.humidity_max ?? "";
  plantSoilMin.value = plant?.soil_min ?? "";
  plantSoilMax.value = plant?.soil_max ?? "";
  plantLightMax.value = lightMaxForPlant(plant) ?? "";
  plantSoilPh.value = plant?.soil_ph ?? "";
  plantSoilType.value = plant?.soil_type ?? "";
  plantSoilLooseness.value = plant?.soil_looseness ?? "";
  plantSoilDrainage.value = plant?.soil_drainage ?? "";
  plantSoilNote.value = plant?.soil_note ?? "";
  setPlantWateringTimeInputs(plant?.watering_time || "");
  plantWateringDuration.value = plant?.watering_duration ?? "";
  plantImage.value = "";
  setPlantImagePreview(plantImageSrc(plant));
}

function setPlantImagePreview(path = "") {
  const preview = document.getElementById("plantImagePreview");
  if (!preview) return;

  if (!path) {
    preview.innerHTML = "<span>Chưa chọn ảnh</span>";
    return;
  }

  const src = path.startsWith("blob:") || path.startsWith("http") ? path : imageUrl(path);
  preview.innerHTML = `<img src="${src}" alt="Ảnh cây trồng" />`;
}

function previewPlantImage() {
  const file = plantImage.files?.[0];
  if (!file) {
    const currentPlant = plantsCache.find((item) => Number(item.id) === Number(plantEditId.value));
    setPlantImagePreview(plantImageSrc(currentPlant));
    return;
  }

  if (file.size > MAX_PLANT_IMAGE_BYTES) {
    plantImage.value = "";
    showToast("Ảnh cây tối đa 5MB", "warning");
    setPlantImagePreview("");
    return;
  }

  setPlantImagePreview(URL.createObjectURL(file));
}

function plantFormData() {
  // Dung FormData de gui duoc ca anh cay trong va cac nguong cam bien trong mot request.
  const wateringTime = readPlantWateringTime();
  if (wateringTime === null) {
    showToast("Giờ tưới của cây phải có giờ từ 0-23 và phút từ 0-59", "warning");
    return null;
  }
  const idealSoilPh = plantSoilPh.value === "" ? null : Number(plantSoilPh.value);
  if (idealSoilPh !== null && (!Number.isFinite(idealSoilPh) || idealSoilPh < 0 || idealSoilPh > 14)) {
    showToast("pH đất lý tưởng phải nằm trong khoảng 0-14", "warning");
    return null;
  }

  const formData = new FormData();
  formData.append("name", plantName.value.trim());
  formData.append("garden_id", plantGardenId.value);
  formData.append("description", plantDescription.value);
  formData.append("temp_min", plantTempMin.value);
  formData.append("temp_max", plantTempMax.value);
  formData.append("humidity_min", plantHumidityMin.value);
  formData.append("humidity_max", plantHumidityMax.value);
  formData.append("soil_min", plantSoilMin.value);
  formData.append("soil_max", plantSoilMax.value);
  formData.append("light_max", normalizeMetricValue(plantLightMax.value || LIGHT_DEFAULT_MAX_LUX, lightSeriesMeta) ?? "");
  formData.append("soil_ph", plantSoilPh.value);
  formData.append("soil_type", plantSoilType.value);
  formData.append("soil_looseness", plantSoilLooseness.value);
  formData.append("soil_drainage", plantSoilDrainage.value);
  formData.append("soil_note", plantSoilNote.value);
  formData.append("watering_time", wateringTime || "");
  formData.append("watering_duration", plantWateringDuration.value);

  const imageFile = plantImage.files?.[0];
  if (imageFile) {
    if (imageFile.size > MAX_PLANT_IMAGE_BYTES) {
      showToast("Ảnh cây tối đa 5MB", "warning");
      return null;
    }
    formData.append("image", imageFile);
  }

  return formData;
}

async function savePlant() {
  // Mot ham dung chung cho them va sua cay, phan biet bang plantEditId.
  if (!plantName.value.trim()) {
    showToast("Vui lòng nhập tên cây trồng", "warning");
    return;
  }
  if (!plantGardenId.value) {
    showToast("Vui lòng chọn vườn cho cây trồng", "warning");
    return;
  }

  const id = plantEditId.value;
  const formData = plantFormData();
  if (!formData) return;

  const data = id
    ? await requestForm(`/plants/${id}`, "PUT", formData)
    : await requestForm("/plants", "POST", formData);

  alertMsg(data);
  if (data.isError) return;
  showPlantOverview();
  await loadPlants();
  await loadData();
}

async function loadPlants() {
  const data = await request("/plants");
  if (!Array.isArray(data)) return;

  plantsCache = data;
  mainPlant = data.find((plant) => plant.is_main) || data[0] || mainPlant;
  renderMainPlantPanels();
  renderPlantList();
  renderPlantSelectors();
  prefillAutoScheduleFromMainPlant();
}

function renderPlantList() {
  const list = document.getElementById("plantList");
  if (!list) return;

  document.getElementById("plantCount").innerText = `${plantsCache.length} cây`;

  if (plantsCache.length === 0) {
    list.innerHTML = `<div class="empty-state">Chưa có cây trồng.</div>`;
    return;
  }

  list.innerHTML = plantsCache.map((plant) => `
    <div class="plant-row ${plant.is_main ? "selected" : ""}">
      ${plantImageMarkup(plant, "plant-thumb")}
      <div class="plant-info">
        <div class="plant-title">
          <strong>${escapeHtml(plant.name)}</strong>
          ${plant.is_main ? `<span class="badge small">Cây chính</span>` : ""}
        </div>
        ${plant.description ? `<p><strong>Mô tả:</strong> ${formatTextValue(plant.description)}</p>` : ""}
        <p>Vườn: ${escapeHtml(gardenNameById(plant.garden_id))} · Nhiệt ${formatRange(plant.temp_min, plant.temp_max, "°C")} · KK ${formatRange(plant.humidity_min, plant.humidity_max, "%")} · Đất ${formatRange(plant.soil_min, plant.soil_max, "%")} · Ánh sáng ${formatLightRange(plant)}</p>
        <p><strong>Giờ tưới:</strong> ${formatTimeValue(plant.watering_time)} · <strong>Thời gian:</strong> ${formatValue(plant.watering_duration, " giây")}</p>
      </div>
      <div class="plant-actions">
        <button class="mini" onclick="selectMainPlant(${plant.id})">Chọn</button>
        <button class="mini secondary" onclick="showPlantForm(${plant.id})">Sửa</button>
        <button class="mini danger" onclick="deletePlantById(${plant.id})">Xóa</button>
      </div>
    </div>
  `).join("");
}

async function selectMainPlant(id) {
  const data = await request(`/plants/${id}/main`, "POST");
  alertMsg(data);
  await loadPlants();
  await loadData();
  prefillAutoScheduleFromMainPlant(true);
}

async function deletePlantById(id) {
  const plant = plantsCache.find((item) => Number(item.id) === Number(id));
  if (!(await confirmAction({
    title: "Xóa cây trồng?",
    message: `Bạn muốn xóa cây "${plant?.name || id}"?`,
    confirmText: "Xóa cây",
  }))) return;
  const data = await request(`/plants/${id}`, "DELETE");
  alertMsg(data);
  await loadPlants();
  await loadData();
}

async function addPlant() {
  await savePlant();
}

async function setMainPlant(id) {
  await selectMainPlant(id || plantEditId.value);
}

async function updatePlant() {
  await savePlant();
}

async function deletePlant() {
  await deletePlantById(plantEditId.value);
}

async function runManualDevice(device, endpoint, payload = {}) {
  const active = isManualControlActive(device);
  const partialCoolingDevice = ["fan", "spray"].includes(device) && systemStatusState.coolingTargetTemp !== null;
  const data = active
    ? await request(`/manual-device/${device}/stop`, "POST")
    : partialCoolingDevice
      ? await request(`/manual-device/${device}/start`, "POST")
      : await request(endpoint, "POST", payload);
  if (!data.isError) {
    if (data.status) {
      systemStatusState = { ...systemStatusState, ...data.status };
      renderControlButtons(data.status);
      if (data.info) alertMsg(data);
    } else {
      const statusKeyByDevice = {
        irrigation: "irrigationStatus",
        fan: "fanStatus",
        spray: "sprayStatus",
        cooling: "coolingStatus",
      };
      systemStatusState = { ...systemStatusState, [statusKeyByDevice[device]]: !active };
      if (device === "cooling") {
        systemStatusState.fanStatus = !active;
        systemStatusState.sprayStatus = !active;
      }
      renderControlButtons(systemStatusState);
    }
  }
  await loadData();
  if (data.isError) alertMsg(data);
}

async function irrigate() {
  await runManualDevice("irrigation", "/irrigation", { duration: manualIrrigationDuration.value });
}

async function fanTimer() {
  await runManualDevice("fan", "/fan-timer", { duration: fanDuration.value });
}

async function sprayTimer() {
  await runManualDevice("spray", "/spray-timer", { duration: sprayDuration.value });
}

async function coolingTimer() {
  await runManualDevice("cooling", "/cooling-timer", { duration: coolingDuration.value });
}

async function coolingTarget() {
  await runManualDevice("cooling", "/cooling-target", { target_temp: targetTemp.value });
}

async function toggleDeviceAuto(device) {
  const nextDisabled = !Boolean(autoDisabledState[device]);
  const data = await request(`/auto-device/${device}`, "POST", { disabled: nextDisabled });
  alertMsg(data);

  if (data.autoDisabled) {
    autoDisabledState = data.autoDisabled;
    renderAutoToggleButtons();
  }
}

async function toggleAllDeviceAuto() {
  const nextDisabled = !Object.values(autoDisabledState).every(Boolean);
  const data = await request("/auto-device/all", "POST", { disabled: nextDisabled });
  alertMsg(data);

  if (data.autoDisabled) {
    autoDisabledState = data.autoDisabled;
    renderAutoToggleButtons();
    renderAutoIrrigationModeControls();
  }
}

async function setAutoIrrigationMode(mode) {
  const data = await request("/auto-irrigation-mode", "POST", { mode });
  alertMsg(data);

  if (!data.isError) {
    autoIrrigationModeState = data.autoIrrigationMode || mode;
    renderAutoIrrigationModeControls();
    await loadData();
  }
}

async function toggleAutoRule(device, sensor, direction) {
  const sensorOption = AUTO_RULE_SENSOR_OPTIONS.find((item) => item.key === sensor);
  if (!AUTO_RULE_DEVICE_OPTIONS[device] || !sensorOption || isAutoRuleDirectionDisabled(sensorOption, direction)) return;

  const enabled = direction === "unused" ? false : !isAutoRuleEnabled(device, sensor, direction);
  const data = await request("/auto-rules", "POST", { device, sensor, direction, enabled });
  alertMsg(data);

  if (!data.isError) {
    autoRulesState = createDefaultAutoRules(data.autoRules || autoRulesState);
    renderAutoRuleSetup();
    await loadData();
  }
}

async function toggleEmergency() {
  const data = await request("/emergency", "POST", {});
  if (data.isError) alertMsg(data);

  if (!data.isError) {
    systemStatusState.emergencyActive = false;
    if (data.autoDisabled) {
      autoDisabledState = data.autoDisabled;
      renderAutoToggleButtons();
    }
    renderEmergencyButton();
    await loadData();
  }
}

function updateAutoScheduleFormButtons() {
  const saveButton = document.getElementById("autoScheduleSaveButton");
  const cancelButton = document.getElementById("autoScheduleCancelButton");
  const editingSchedule = autoSchedulesCache.find((item) => Number(item.id) === Number(autoScheduleEditId));
  const editingActiveDevice =
    editingSchedule && normalizeAutoScheduleDevice(editingSchedule.device_type) === activeAutoScheduleDevice;
  const deviceLabel = getAutoScheduleDeviceLabel(activeAutoScheduleDevice).toLowerCase();

  if (saveButton) {
    saveButton.innerText = editingActiveDevice ? `Cập nhật lịch ${deviceLabel}` : `Lưu lịch ${deviceLabel}`;
  }
  if (cancelButton) {
    cancelButton.classList.toggle("hidden", !editingActiveDevice);
  }
}

function setAutoScheduleTimeInputs(timeValue = "") {
  const [hour = "", minute = ""] = String(timeValue || "").split(":");
  const hourInput = document.getElementById("autoHour");
  const minuteInput = document.getElementById("autoMinute");

  if (hourInput) hourInput.value = hour;
  if (minuteInput) minuteInput.value = minute;
}

function readAutoScheduleTime() {
  const hour = Number(document.getElementById("autoHour")?.value);
  const minute = Number(document.getElementById("autoMinute")?.value);

  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function prefillAutoScheduleFromMainPlant(force = false) {
  // Lay gio tuoi mac dinh cua cay chinh de dien san vao form lich tuoi tu dong.
  if (!mainPlant || autoScheduleEditId) return;

  const hourInput = document.getElementById("autoHour");
  const minuteInput = document.getElementById("autoMinute");
  const durationInput = document.getElementById("autoDuration");
  if (!hourInput || !minuteInput || !durationInput) return;

  const hasTimeInput = hourInput.value !== "" || minuteInput.value !== "";
  if ((force || !hasTimeInput) && mainPlant.watering_time) {
    setAutoScheduleTimeInputs(mainPlant.watering_time);
  }

  if ((force || !durationInput.value) && mainPlant.watering_duration) {
    durationInput.value = mainPlant.watering_duration;
  }
}

function editAutoSchedule(id) {
  // Khi bam Sua, dua lich vao form hien tai va doi nut Luu thanh Cap nhat.
  const schedule = autoSchedulesCache.find((item) => Number(item.id) === Number(id));
  if (!schedule) return;

  autoScheduleEditId = schedule.id;
  activeAutoScheduleDevice = normalizeAutoScheduleDevice(schedule.device_type);
  setAutoScheduleTimeInputs(schedule.irrigation_time || "");
  autoDuration.value = schedule.irrigation_duration || "";
  renderAutoScheduleDeviceButtons();
  updateAutoScheduleFormButtons();
  renderAutoScheduleList();
}

function cancelAutoScheduleEdit() {
  autoScheduleEditId = null;
  setAutoScheduleTimeInputs("");
  autoDuration.value = "";
  renderAutoScheduleDeviceButtons();
  updateAutoScheduleFormButtons();
  renderAutoScheduleList();
}

async function setAutoIrrigation() {
  // Tu dong dung POST khi tao moi va PUT khi dang sua lich da co.
  const irrigationTime = readAutoScheduleTime();
  const duration = Number(autoDuration.value);

  if (!irrigationTime) {
    showToast("Vui lòng nhập giờ chạy từ 0-23 và phút từ 0-59", "warning");
    return;
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    showToast("Vui lòng nhập thời gian chạy lớn hơn 0 giây", "warning");
    return;
  }

  const payload = {
    plant_id: mainPlant?.id || 1,
    device_type: activeAutoScheduleDevice,
    irrigation_time: irrigationTime,
    irrigation_duration: duration,
  };
  const data = autoScheduleEditId
    ? await request(`/auto-irrigation/${autoScheduleEditId}`, "PUT", payload)
    : await request("/auto-irrigation", "POST", payload);

  alertMsg(data);
  if (!data.isError) {
    autoScheduleEditId = null;
    setAutoScheduleTimeInputs("");
    autoDuration.value = "";
    renderAutoScheduleDeviceButtons();
    updateAutoScheduleFormButtons();
    await loadAutoIrrigationSchedules();
    await loadData();
  }
}

async function loadAutoIrrigationSchedules() {
  const data = await request("/auto-irrigation");
  if (!Array.isArray(data)) return;

  autoSchedulesCache = data;
  renderAutoScheduleList();
  renderAutoScheduleDeviceButtons();
  updateAutoScheduleFormButtons();
  renderAutoScheduleSummary();
}

async function toggleAutoSchedule(id, isActive) {
  const data = await request(`/auto-irrigation/${id}/toggle`, "PUT", { is_active: isActive });
  alertMsg(data);
  if (!data.isError) {
    await loadAutoIrrigationSchedules();
    await loadData();
  }
}

async function deleteAutoSchedule(id) {
  if (!(await confirmAction({
    title: "Xóa lịch tự động?",
    message: "Bạn muốn xóa lịch điều khiển tự động này?",
    confirmText: "Xóa lịch",
  }))) return;
  const data = await request(`/auto-irrigation/${id}`, "DELETE");
  alertMsg(data);
  if (!data.isError) {
    await loadAutoIrrigationSchedules();
    await loadData();
  }
}

function showFertilizerOverview() {
  document.getElementById("fertilizerOverview").classList.remove("hidden");
  document.getElementById("fertilizerFormPage").classList.add("hidden");
}

async function showFertilizerForm(fertilizerId = null) {
  await ensurePlantsLoaded();
  const fertilizer = fertilizerId
    ? fertilizersCache.find((item) => Number(item.id) === Number(fertilizerId))
    : null;

  document.getElementById("fertilizerOverview").classList.add("hidden");
  document.getElementById("fertilizerFormPage").classList.remove("hidden");
  document.getElementById("fertilizerFormTitle").innerText = fertilizer ? "Sửa thông tin bón phân" : "Thêm bón phân mới";

  fertEditId.value = fertilizer?.id || "";
  renderPlantSelectors();
  fertPlantId.value = fertilizer?.plant_id || mainPlant?.id || "";
  fertType.value = fertilizer?.type || "";
  fertMethod.value = fertilizer?.method || "";
  fertQuantity.value = fertilizer?.quantity || "";
  fertNote.value = fertilizer?.note || "";
}

function fertilizerPayload() {
  return {
    plant_id: fertPlantId.value,
    type: fertType.value.trim(),
    method: fertMethod.value.trim(),
    quantity: fertQuantity.value.trim(),
    note: fertNote.value.trim(),
  };
}

async function saveFertilizer() {
  const payload = fertilizerPayload();
  if (!payload.plant_id) {
    showToast("Vui lòng chọn cây trồng", "warning");
    return;
  }
  if (!payload.type && !payload.method) {
    showToast("Vui lòng nhập loại phân hoặc phương pháp bón", "warning");
    return;
  }

  const id = fertEditId.value;
  const data = id
    ? await request(`/fertilizers/${id}`, "PUT", payload)
    : await request("/fertilizers", "POST", payload);

  alertMsg(data);
  showFertilizerOverview();
  await loadFertilizers();
  await loadData();
}

async function loadFertilizers() {
  const data = await request("/fertilizers");
  if (!Array.isArray(data)) return alertMsg(data);

  fertilizersCache = data;
  renderFertilizerList();
}

function renderFertilizerList() {
  const list = document.getElementById("fertilizerList");
  if (!list) return;

  document.getElementById("fertilizerCount").innerText = `${fertilizersCache.length} lần bón`;

  if (fertilizersCache.length === 0) {
    list.innerHTML = `<div class="empty-state">Chưa có lịch sử bón phân.</div>`;
    return;
  }

  list.innerHTML = fertilizersCache.map((item) => `
    <div class="fertilizer-row">
      <div class="fertilizer-icon">🌾</div>
      <div class="fertilizer-info">
        <div class="plant-title">
          <strong>${escapeHtml(item.type || "--")}</strong>
          <span class="badge small">${formatDateTime(item.created_at)}</span>
        </div>
        <p><strong>Cây:</strong> ${escapeHtml(item.plant_name || `Plant ${item.plant_id || "--"}`)} · <strong>Số lượng:</strong> ${escapeHtml(item.quantity || "--")}</p>
        <p><strong>Phương pháp:</strong> ${escapeHtml(item.method || "--")}${item.note ? ` · <strong>Ghi chú:</strong> ${escapeHtml(item.note)}` : ""}</p>
      </div>
      <div class="plant-actions">
        <button class="mini secondary" onclick="showFertilizerForm(${item.id})">Sửa</button>
        <button class="mini danger" onclick="deleteFertilizerById(${item.id})">Xóa</button>
      </div>
    </div>
  `).join("");
}

async function deleteFertilizerById(id) {
  const fertilizer = fertilizersCache.find((item) => Number(item.id) === Number(id));
  if (!(await confirmAction({
    title: "Xóa lịch sử bón phân?",
    message: `Bạn muốn xóa lần bón "${fertilizer?.type || id}"?`,
    confirmText: "Xóa lịch sử",
  }))) return;
  const data = await request(`/fertilizers/${id}`, "DELETE");
  alertMsg(data);
  await loadFertilizers();
  await loadData();
}

async function addFertilizer() {
  await saveFertilizer();
}

async function updateFertilizer() {
  await saveFertilizer();
}

async function deleteFertilizer() {
  await deleteFertilizerById(fertEditId.value);
}

function showSoilRecordOverview() {
  document.getElementById("soilOverview").classList.remove("hidden");
  document.getElementById("soilFormPage").classList.add("hidden");
}

async function showSoilRecordForm(recordId = null) {
  await ensureGardensLoaded();
  const record = recordId
    ? soilRecordsCache.find((item) => Number(item.id) === Number(recordId))
    : null;

  document.getElementById("soilOverview").classList.add("hidden");
  document.getElementById("soilFormPage").classList.remove("hidden");
  document.getElementById("soilFormTitle").innerText = record ? "Sửa thông tin đất" : "Thêm thông tin đất";

  soilEditId.value = record?.id || "";
  renderGardenSelectors();
  soilGardenId.value = record?.garden_id || mainPlant?.garden_id || "";
  soilPh.value = record?.soil_ph ?? "";
  soilType.value = record?.soil_type || "";
  soilLooseness.value = record?.soil_looseness || "";
  soilDrainage.value = record?.soil_drainage || "";
  soilNote.value = record?.note || "";
}

function soilRecordPayload() {
  return {
    garden_id: soilGardenId.value,
    soil_ph: soilPh.value,
    soil_type: soilType.value.trim(),
    soil_looseness: soilLooseness.value,
    soil_drainage: soilDrainage.value,
    note: soilNote.value.trim(),
  };
}

async function saveSoilRecord() {
  const payload = soilRecordPayload();
  const ph = payload.soil_ph === "" ? null : Number(payload.soil_ph);

  if (!payload.garden_id) {
    showToast("Vui lòng chọn vườn", "warning");
    return;
  }
  if (ph !== null && (!Number.isFinite(ph) || ph < 0 || ph > 14)) {
    showToast("Độ pH đất phải nằm trong khoảng 0-14", "warning");
    return;
  }
  if (ph === null && !payload.soil_type && !payload.soil_looseness && !payload.soil_drainage && !payload.note) {
    showToast("Vui lòng nhập ít nhất một thông tin đất", "warning");
    return;
  }

  const id = soilEditId.value;
  const data = id
    ? await request(`/soil-records/${id}`, "PUT", payload)
    : await request("/soil-records", "POST", payload);

  alertMsg(data);
  if (data.isError) return;
  showSoilRecordOverview();
  await loadSoilRecords();
  await loadPlants();
  await loadData();
}

async function loadSoilRecords() {
  const data = await request("/soil-records");
  if (!Array.isArray(data)) return alertMsg(data);

  soilRecordsCache = data;
  renderSoilRecordList();
}

function renderSoilRecordList() {
  const list = document.getElementById("soilRecordList");
  if (!list) return;

  document.getElementById("soilRecordCount").innerText = `${soilRecordsCache.length} bản ghi`;

  if (soilRecordsCache.length === 0) {
    list.innerHTML = `<div class="empty-state">Chưa có thông tin theo dõi đất.</div>`;
    return;
  }

  list.innerHTML = soilRecordsCache.map((item) => `
    <div class="soil-row">
      <div class="soil-icon">Đất</div>
      <div class="soil-info">
        <div class="plant-title">
          <strong>pH ${formatSoilPh(item.soil_ph)}</strong>
          <span class="badge small">${formatDateTime(item.created_at)}</span>
        </div>
        <p><strong>Vườn:</strong> ${escapeHtml(item.garden_name || `Vườn ${item.garden_id || "--"}`)} · <strong>Loại đất:</strong> ${formatTextValue(item.soil_type)}</p>
        <p><strong>Độ tơi xốp:</strong> ${formatTextValue(item.soil_looseness)} · <strong>Thoát nước:</strong> ${formatTextValue(item.soil_drainage)}${item.note ? ` · <strong>Ghi chú:</strong> ${escapeHtml(item.note)}` : ""}</p>
      </div>
      <div class="plant-actions">
        <button class="mini secondary" onclick="showSoilRecordForm(${item.id})">Sửa</button>
        <button class="mini danger" onclick="deleteSoilRecordById(${item.id})">Xóa</button>
      </div>
    </div>
  `).join("");
}

async function deleteSoilRecordById(id) {
  const record = soilRecordsCache.find((item) => Number(item.id) === Number(id));
  if (!(await confirmAction({
    title: "Xóa thông tin đất?",
    message: `Bạn muốn xóa bản ghi đất của "${record?.garden_name || id}"?`,
    confirmText: "Xóa bản ghi",
  }))) return;

  const data = await request(`/soil-records/${id}`, "DELETE");
  alertMsg(data);
  if (data.isError) return;
  await loadSoilRecords();
  await loadPlants();
  await loadData();
}

async function addSoilRecord() {
  await saveSoilRecord();
}

async function updateSoilRecord() {
  await saveSoilRecord();
}

async function deleteSoilRecord() {
  await deleteSoilRecordById(soilEditId.value);
}

function fillSensorTable(rows) {
  if (!document.getElementById("sensorTable")) return;
  sensorTable.innerHTML = rows.map((sensor) => `
    <tr>
      <td>${sensor.id}</td>
      <td>${sensor.temperature ?? ""}</td>
      <td>${sensor.humidity ?? ""}</td>
      <td>${sensor.soil_moisture ?? ""}</td>
      <td>${normalizeMetricValue(sensor.light, lightSeriesMeta) ?? ""}</td>
      <td>${sensor.gas ?? ""}</td>
      <td>${sensor.created_at ? new Date(sensor.created_at).toLocaleString("vi-VN") : ""}</td>
    </tr>
  `).join("");
}

function fillDeviceLogTable(rows) {
  if (!document.getElementById("deviceLogTable")) return;
  deviceLogTable.innerHTML = rows.map((log) => `
    <tr>
      <td>${log.id}</td>
      <td>${log.device_id}</td>
      <td>${escapeHtml(log.action)}</td>
      <td>${escapeHtml(log.mode ?? "")}</td>
      <td>${log.created_at ? new Date(log.created_at).toLocaleString("vi-VN") : ""}</td>
    </tr>
  `).join("");
}

function fillIrrigationLogTable(rows) {
  if (!document.getElementById("irrigationLogTable")) return;
  irrigationLogTable.innerHTML = rows.map((log) => `
    <tr>
      <td>${log.id}</td>
      <td>${log.amount ?? ""}</td>
      <td>${log.duration ?? ""}</td>
      <td>${log.created_at ? new Date(log.created_at).toLocaleString("vi-VN") : ""}</td>
    </tr>
  `).join("");
}

function fillFertilizerLogTable(rows) {
  if (!document.getElementById("fertilizerLogTable")) return;
  fertilizerLogTable.innerHTML = rows.map((log) => `
    <tr>
      <td>${log.id}</td>
      <td>${escapeHtml(log.plant_name || `Plant ${log.plant_id || "--"}`)}</td>
      <td>${escapeHtml(log.type || "")}</td>
      <td>${escapeHtml(log.method || "")}</td>
      <td>${escapeHtml(log.quantity || "")}</td>
      <td>${formatDateTime(log.created_at)}</td>
    </tr>
  `).join("");
}

async function loadReportTables() {
  await loadData();
}

function exportExcel() {
  const token = encodeURIComponent(localStorage.getItem("token") || "");
  window.location.href = `${API}/export-excel?token=${token}`;
}

async function toggleSimulation() {
  const data = await request("/simulation", "POST", { enabled: !systemStatusState.simulateSensor });
  alertMsg(data);
  if (!data.isError) {
    systemStatusState.simulateSensor = Boolean(data.simulateSensor);
    await loadData();
  }
}

async function toggleFireSimulation() {
  const data = await request("/fire-simulation", "POST", {
    enabled: !systemStatusState.fireSimulationActive,
  });
  if (data.isError) alertMsg(data);
  if (!data.isError) {
    systemStatusState.fireSimulationActive = Boolean(data.fireSimulationActive);
    systemStatusState.fireProtectionActive = Boolean(data.fireProtectionActive);
    systemStatusState.fireResponseUntil = data.fireResponseUntil || null;
    renderFireSafetyStatus();
    await loadAlerts();
    await loadData();
  }
}

async function loadAlertSettings() {
  const data = await request("/alert-settings");
  if (data?.preferences) {
    alertMutedState = Boolean(data.muted);
    alertSettingsState = data.preferences;
    renderAlertMuteButton();
    renderAlertSettings();
    renderFireSafetyStatus();
  }
}

async function saveAlertSettings() {
  const data = await request("/alert-settings", "POST", {
    muted: alertMutedState,
    preferences: collectAlertSettings(),
  });
  alertMsg(data);
  if (!data.isError) {
    alertMutedState = Boolean(data.muted);
    alertSettingsState = data.preferences || alertSettingsState;
    renderAlertMuteButton();
    renderAlertSettings();
    await loadAlerts();
  }
}

async function loadAlerts(triggerButton = null) {
  const refreshButton = triggerButton || null;
  if (refreshButton) {
    refreshButton.classList.add("loading");
    refreshButton.disabled = true;
    refreshButton.setAttribute("aria-busy", "true");
    refreshButton.dataset.originalText = refreshButton.dataset.originalText || refreshButton.innerText;
    refreshButton.innerText = "Đang tải";
  }

  try {
    const data = await request("/alerts");
    if (!Array.isArray(data)) return alertMsg(data);
    alertTable.innerHTML = data.map((alertRow) => {
      const message = alertRow.level === "info" && alertRow.alert_type !== "fire"
        ? compactActionMessage(alertRow.message)
        : alertRow.message;
      return `<tr><td>${alertRow.id}</td><td>${escapeHtml(message)}</td><td>${escapeHtml(alertRow.level)}</td><td>${alertRow.created_at ? new Date(alertRow.created_at).toLocaleString("vi-VN") : ""}</td></tr>`;
    }).join("");
    renderAlertMuteButton();
  } finally {
    if (refreshButton) {
      setTimeout(() => {
        refreshButton.classList.remove("loading");
        refreshButton.disabled = false;
        refreshButton.removeAttribute("aria-busy");
        refreshButton.innerText = refreshButton.dataset.originalText || "Tải lại";
      }, 180);
    }
  }
}

async function toggleAlertMute() {
  const data = await request("/alerts/mute", "POST", { muted: !alertMutedState });
  alertMsg(data);

  if (!data.isError) {
    alertMutedState = Boolean(data.alertMuted);
    hideAlertModal();
    renderAlertMuteButton();
    await loadAlerts();
    await loadData();
  }
}
