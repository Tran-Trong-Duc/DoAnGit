const PLANT_ASSISTANT_SCOPE_TERMS = [
  "cay", "trong", "rau", "hoa", "qua", "la", "re", "than", "hat", "vuon",
  "benh", "nam", "sau", "rep", "bo tri", "dom", "vang", "heo", "thoi re", "thoi goc", "thoi nhun", "suong", "phan trang",
  "nguong", "nhiet", "do am", "dat", "ph", "anh sang", "lux", "khi doc", "gas",
  "tuoi", "nuoc", "phan bon", "dinh duong", "song", "ly tuong", "sinh truong", "cam bien",
  "bat", "tat", "bom", "quat", "phun", "lam mat", "dieu khien", "tu dong", "nong", "kho", "canh bao",
];

const PLANT_ASSISTANT_STOP_TERMS = new Set([
  "cay", "trong", "benh", "thi", "nen", "lam", "gi", "nhu", "the", "nao", "cho", "voi", "cua",
  "va", "hay", "neu", "khi", "bi", "co", "khong", "duoc", "can", "hoi", "tra", "loi", "du",
  "lieu", "mang", "tim", "kiem", "thong", "tin", "thap", "cao",
]);

const PLANT_ASSISTANT_KNOWN_SUBJECTS = [
  { name: "Hoa hồng", aliases: ["hoa hong", "rose", "roses"] },
  { name: "Cà chua", aliases: ["ca chua", "tomato"] },
  { name: "Dưa leo", aliases: ["dua leo", "dua chuot", "cucumber"] },
  { name: "Ớt", aliases: ["ot", "chili", "pepper"] },
  { name: "Xà lách", aliases: ["xa lach", "lettuce"] },
  { name: "Rau cải", aliases: ["rau cai", "cai xanh", "cai ngot", "brassica"] },
  { name: "Rau muống", aliases: ["rau muong", "water spinach"] },
  { name: "Húng quế", aliases: ["hung que", "basil"] },
  { name: "Sương mai", aliases: ["suong mai", "downy mildew"] },
  { name: "Phấn trắng", aliases: ["phan trang", "powdery mildew"] },
  { name: "Thối rễ", aliases: ["thoi re", "root rot"] },
  { name: "Đốm lá", aliases: ["dom la", "leaf spot"] },
  { name: "Héo rũ", aliases: ["heo ru", "wilt"] },
];

const PLANT_ASSISTANT_ACTIONS = [
  { id: "plants", label: "Mở cây trồng", description: "Xem hoặc chỉnh ngưỡng của cây đang quản lý." },
  { id: "add_plant", label: "Thêm cây", description: "Lưu cây mới cùng ngưỡng nhiệt, ẩm, đất và ánh sáng." },
  { id: "controls", label: "Điều khiển", description: "Tưới, bật quạt hoặc phun mát thủ công." },
  { id: "devices", label: "Thiết bị", description: "Kiểm tra trạng thái thiết bị, MQTT topic và phần cứng." },
  { id: "automation", label: "Tự động", description: "Bật/tắt tự động và lịch tưới theo ngưỡng cây." },
  { id: "soil", label: "Theo dõi đất", description: "Ghi pH, loại đất, độ tơi xốp và thoát nước thực tế." },
  { id: "fertilizers", label: "Bón phân", description: "Ghi nhận phân bón, phương pháp và liều lượng." },
  { id: "alerts", label: "Cảnh báo", description: "Xem cảnh báo vượt ngưỡng và PCCC." },
  { id: "reports", label: "Báo cáo", description: "Xem dữ liệu cảm biến và lịch sử điều khiển." },
];

const PLANT_ASSISTANT_SUBJECT_PROFILES = [
  {
    aliases: ["hoa hong", "rose", "roses"],
    name: "Hoa hồng",
    bullets: [
      "Hoa hồng cần nắng mạnh, thường nên có ít nhất 6 giờ nắng mỗi ngày; thiếu sáng cây dễ vươn dài, ít nụ và dễ bệnh lá.",
      "Đất nên tơi xốp, thoát nước tốt, pH khoảng 6.0-6.8; úng nước lâu là rủi ro lớn cho rễ.",
      "Tưới vào gốc, giữ ẩm đều nhưng không để sũng; hạn chế làm ướt lá vào chiều tối để giảm đốm đen và phấn trắng.",
      "Bón phân cân đối trong giai đoạn ra chồi và ra nụ; sau mỗi lứa hoa nên tỉa hoa tàn, cành yếu và lá bệnh để cây bật mầm mới.",
      "Theo dõi rệp, bọ trĩ, phấn trắng và đốm đen; nếu lá vàng, hãy kiểm tra đồng thời độ ẩm đất, thoát nước, thiếu dinh dưỡng và mặt dưới lá.",
    ],
  },
];

const AI_DEMO_SMALLTALK_TERMS = [
  "xin chao", "hello", "ban la ai", "ai demo", "aidemo", "huong dan", "tro giup",
];

const AI_DEMO_FOLLOW_UP_TERMS = [
  "vay", "the thi", "lam sao", "xu ly", "tiep theo", "co nen", "bao lau", "lieu luong", "cach",
];

const AI_DEMO_CLEAR_OUT_OF_SCOPE_TERMS = [
  "thoi tiet hom nay", "du bao thoi tiet", "bong da", "chung khoan", "gia vang", "bitcoin", "ty gia", "phim", "am nhac", "game",
];

module.exports = {
  PLANT_ASSISTANT_SCOPE_TERMS,
  PLANT_ASSISTANT_STOP_TERMS,
  PLANT_ASSISTANT_KNOWN_SUBJECTS,
  PLANT_ASSISTANT_ACTIONS,
  PLANT_ASSISTANT_SUBJECT_PROFILES,
  AI_DEMO_SMALLTALK_TERMS,
  AI_DEMO_FOLLOW_UP_TERMS,
  AI_DEMO_CLEAR_OUT_OF_SCOPE_TERMS,
};
