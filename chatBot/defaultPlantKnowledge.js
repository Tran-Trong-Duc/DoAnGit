function removeAccent(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueTerms(items = [], max = 15) {
  const seen = new Set();
  const out = [];
  items.forEach((item) => {
    const value = String(item || "").trim();
    const key = removeAccent(value);
    if (!value || seen.has(key)) return;
    seen.add(key);
    out.push(value);
  });
  return out.slice(0, max);
}

const GROUPS = [
  {
    type: "rau ăn lá",
    temp: "15-30°C",
    soil: "60-80%",
    ph: "6.0-7.0",
    light: "ánh sáng vừa đến mạnh, tránh nắng gắt kéo dài",
    harvest: "thu lá hoặc cắt tỉa nhiều lần khi cây còn non và lá giòn",
    names: [
      "Rau muống", "Xà lách", "Cải xanh", "Cải ngọt", "Cải thìa", "Cải bó xôi", "Cải xoăn",
      "Cải bẹ xanh", "Cải cúc", "Cải bẹ dún", "Mồng tơi", "Rau dền", "Rau ngót", "Tần ô",
      "Cải thảo", "Bắp cải", "Rau má", "Diếp cá", "Lá lốt", "Tía tô", "Kinh giới",
      "Húng quế", "Húng lủi", "Ngò rí", "Hành lá", "Cần tây", "Hẹ", "Thì là",
      "Cải rocket", "Cải cầu vồng", "Rau sam", "Rau đắng", "Cải mizuna", "Cải mầm",
      "Rau cải xoong", "Rau nhút", "Rau càng cua", "Rau om",
    ],
  },
  {
    type: "rau ăn quả và củ",
    temp: "20-32°C",
    soil: "55-75%",
    ph: "5.8-6.8",
    light: "nắng trực tiếp 6-8 giờ mỗi ngày",
    harvest: "thu hoạch khi quả hoặc củ đạt kích thước thương phẩm, tránh để quá già làm giảm chất lượng",
    names: [
      "Cà chua", "Ớt", "Dưa leo", "Bí đỏ", "Bí xanh", "Bầu", "Mướp hương", "Mướp đắng",
      "Đậu bắp", "Đậu cô ve", "Đậu đũa", "Cà tím", "Cà pháo", "Dưa hấu", "Dưa lưới",
      "Khoai tây", "Khoai lang", "Cà rốt", "Củ cải trắng", "Củ dền", "Su hào", "Hành tây",
      "Tỏi", "Gừng", "Nghệ", "Riềng", "Sả", "Ngô ngọt", "Lạc", "Đậu nành", "Đậu xanh",
      "Đậu Hà Lan", "Bí ngòi", "Ớt chuông", "Cà chua bi", "Củ kiệu", "Khoai môn", "Khoai sọ",
      "Sen lấy củ", "Măng tây", "Dưa gang", "Su su", "Mướp Nhật", "Củ năng", "Củ sắn",
    ],
  },
  {
    type: "cây gia vị",
    temp: "18-32°C",
    soil: "45-70%",
    ph: "6.0-7.2",
    light: "nắng nhẹ đến nắng trực tiếp tùy loài, cần thoáng gió",
    harvest: "thu lá, thân non hoặc củ theo nhu cầu, nên cắt tỉa để cây ra chồi mới",
    names: [
      "Hương thảo", "Oregano", "Xô thơm", "Húng tây", "Rau răm", "Ngò gai", "Bạc hà",
      "Bạc hà Âu", "Tía tô xanh", "Húng chanh", "Lá bạc hà", "Lá nguyệt quế", "Mùi tàu",
      "Cỏ xạ hương", "Hẹ tây", "Ớt hiểm", "Ớt chỉ thiên", "Ớt sừng", "Gừng gió", "Nghệ đen",
    ],
  },
  {
    type: "cây ăn quả",
    temp: "20-35°C",
    soil: "50-75%",
    ph: "5.5-7.0",
    light: "nắng mạnh, tán thoáng và đất thoát nước tốt",
    harvest: "thu quả khi đạt màu, mùi hoặc độ chín đặc trưng; hạn chế để cây thiếu nước lúc nuôi quả",
    names: [
      "Xoài", "Chuối", "Cam", "Quýt", "Bưởi", "Chanh", "Chanh dây", "Ổi", "Táo ta", "Lê",
      "Đào", "Mận", "Nhãn", "Vải", "Chôm chôm", "Sầu riêng", "Măng cụt", "Mít", "Na",
      "Đu đủ", "Dứa", "Thanh long", "Dừa", "Khế", "Hồng xiêm", "Bơ", "Nho", "Dâu tây",
      "Việt quất", "Mâm xôi", "Lựu", "Sung", "Kiwi", "Hồng", "Cóc", "Me", "Mãng cầu xiêm",
      "Mãng cầu ta", "Sơ ri", "Lêkima", "Vú sữa", "Sa kê", "Điều", "Roi", "Dưa pepino",
      "Phúc bồn tử", "Quất", "Táo mèo", "Hạt dẻ", "Ô liu", "Yuzu", "Cherry", "Hạnh nhân",
      "Dâu tằm", "Nho thân gỗ", "Bòn bon", "Chà là", "Hồng giòn", "Đào tiên",
    ],
  },
  {
    type: "hoa và cây cảnh",
    temp: "18-30°C",
    soil: "45-70%",
    ph: "5.8-7.0",
    light: "ánh sáng tán xạ hoặc nắng sáng tùy loài, tránh úng rễ",
    harvest: "thu hoa hoặc giữ dáng tán bằng cắt tỉa, ưu tiên phòng nấm lá và thối gốc",
    names: [
      "Hoa hồng", "Lan hồ điệp", "Địa lan", "Cúc", "Cúc vạn thọ", "Hướng dương", "Đồng tiền",
      "Hoa ly", "Tulip", "Cẩm chướng", "Cẩm tú cầu", "Mai vàng", "Đào cảnh", "Hoa giấy",
      "Dạ yến thảo", "Hoa mười giờ", "Sen", "Súng", "Mẫu đơn", "Lavender", "Nhài",
      "Nguyệt quế", "Sử quân tử", "Tigon", "Thiên lý", "Lan ý", "Trầu bà", "Kim tiền",
      "Lưỡi hổ", "Phát tài", "Phú quý", "Vạn niên thanh", "Ngọc ngân", "Cau tiểu trâm",
      "Xương rồng", "Sen đá", "Nha đam", "Bàng Singapore", "Monstera", "Đa búp đỏ",
      "Dương xỉ", "Thường xuân", "Cọ cảnh", "Bonsai sanh", "Tùng la hán", "Nhất mạt hương",
      "Cỏ lan chi", "Lan dendro", "Lan cattleya", "Hoa trạng nguyên",
    ],
  },
  {
    type: "cây dược liệu và công nghiệp",
    temp: "18-34°C",
    soil: "45-75%",
    ph: "5.5-7.0",
    light: "cần ánh sáng ổn định, đất thoát nước và quản lý ẩm theo từng giai đoạn",
    harvest: "thu lá, thân, rễ, quả hoặc hạt theo bộ phận sử dụng; cần ghi lịch chăm sóc để ổn định chất lượng",
    names: [
      "Cà phê", "Chè", "Cacao", "Hồ tiêu", "Cao su", "Mía", "Bông", "Thuốc lá", "Quế",
      "Hồi", "Đinh hương", "Vani", "Atiso", "Đinh lăng", "Sâm Ngọc Linh", "Hà thủ ô",
      "Ba kích", "Cà gai leo", "Xạ đen", "Kim ngân hoa", "Cúc hoa", "Hoài sơn",
      "Diệp hạ châu", "Nhân trần", "Ích mẫu", "Cỏ ngọt", "Gấc", "Mắc ca", "Mè", "Thầu dầu",
    ],
  },
];

const CATEGORY_CONFIGS = [
  {
    category: "thong_tin",
    label: "thông tin",
    intent: ["thông tin", "gioi thieu", "là cây gì", "dac diem", "mô tả", "thu hoạch", "quả", "lá", "nguồn gốc"],
    answer: (plant) =>
      `${plant.name} thuộc nhóm ${plant.type}. Đây là cây cần theo dõi theo giai đoạn sinh trưởng, đặc biệt là nước, ánh sáng, dinh dưỡng và sâu bệnh. Với mục tiêu sản xuất, ${plant.name} nên được chăm theo lịch ổn định; ${plant.harvest}.`,
  },
  {
    category: "benh",
    label: "bệnh",
    intent: ["bệnh", "benh", "sâu", "sau", "nấm", "nam", "vàng lá", "xoăn lá", "đốm lá", "thối rễ", "rệp", "bọ trĩ", "héo"],
    answer: (plant) =>
      `${plant.name} thường cần kiểm tra các nhóm vấn đề như vàng lá, đốm lá, xoăn lá, thối rễ, rệp, bọ trĩ, sâu ăn lá và nấm bệnh. Khi thấy triệu chứng, hãy kiểm tra mặt dưới lá, chồi non, độ ẩm đất và độ thoáng tán trước khi xử lý. Nếu cây héo nhưng đất vẫn ẩm, ưu tiên kiểm tra rễ và khả năng úng.`,
  },
  {
    category: "moi_truong",
    label: "môi trường sống",
    intent: ["môi trường", "moi truong", "điều kiện sống", "dieu kien song", "ánh sáng", "nắng", "nhiệt độ", "độ ẩm", "pH", "đất", "giá thể"],
    answer: (plant) =>
      `${plant.name} hợp khoảng ${plant.temp}, độ ẩm đất tham khảo ${plant.soil}, pH khoảng ${plant.ph}. Cây cần ${plant.light}. Đất hoặc giá thể nên tơi, sạch, thoát nước tốt và không để rễ bị úng lâu.`,
  },
  {
    category: "nguong",
    label: "ngưỡng cảm biến",
    intent: ["ngưỡng", "nguong", "cảm biến", "cam bien", "sensor", "lux", "tưới", "quạt", "phun mát", "bật", "tắt", "đất khô", "bị nóng"],
    answer: (plant) =>
      `Ngưỡng tham khảo cho ${plant.name}: nhiệt độ ${plant.temp}, độ ẩm đất ${plant.soil}, pH ${plant.ph}. Nếu có cây này trong hệ thống, hãy ưu tiên ngưỡng đã lưu của vườn. Khi có từ khóa như đất khô, bị nóng hoặc bật tưới/quạt, nên kiểm tra cảm biến hiện tại, vị trí đầu dò và lịch sử đo trước khi tự động hóa.`,
  },
  {
    category: "cham_soc",
    label: "chăm sóc",
    intent: ["chăm sóc", "cham soc", "tưới", "tuoi", "bón phân", "bon phan", "cắt tỉa", "cat tia", "trồng", "trong", "gieo", "kali", "đạm"],
    answer: (plant) =>
      `Chăm sóc ${plant.name}: giữ ẩm theo nhu cầu, tránh thay đổi đột ngột giữa khô hạn và úng; bón phân nhẹ, tăng dần theo giai đoạn; tỉa lá/cành già hoặc phần bệnh để tán thoáng. Khi cây ra hoa, quả hoặc thu hoạch, cần ổn định nước và bổ sung dinh dưỡng cân đối.`,
  },
];

function buildKeywords(plant, config) {
  const alias = removeAccent(plant.name);
  return uniqueTerms([
    plant.name,
    alias,
    `cây ${plant.name}`,
    `cay ${alias}`,
    `${plant.name} ${config.label}`,
    `${alias} ${removeAccent(config.label)}`,
    plant.type,
    removeAccent(plant.type),
    ...config.intent,
    ...config.intent.map(removeAccent),
  ], 15);
}

function buildDefaultPlantKnowledge() {
  const plants = [];
  const seen = new Set();
  GROUPS.forEach((group) => {
    group.names.forEach((name) => {
      const key = removeAccent(name);
      if (seen.has(key) || plants.length >= 200) return;
      seen.add(key);
      plants.push({ ...group, name });
    });
  });

  return plants.flatMap((plant) =>
    CATEGORY_CONFIGS.map((config) => ({
      topic: plant.name,
      category: config.category,
      keywords: buildKeywords(plant, config),
      answer: config.answer(plant),
      suggestions: [
        `${plant.name} có bệnh gì thường gặp?`,
        `Điều kiện sống của ${plant.name} là gì?`,
        `Ngưỡng cảm biến cho ${plant.name}`,
      ],
    }))
  );
}

module.exports = {
  buildDefaultPlantKnowledge,
  CATEGORY_CONFIGS,
};
