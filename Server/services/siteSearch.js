const GOOGLE_CSE_CX = String(process.env.GOOGLE_CSE_CX || "").trim();

function isGoogleCseConfigured() {
  return GOOGLE_CSE_CX.length > 4;
}

function searchSite(query) {
  const q = String(query || "").trim();
  if (!q) {
    const err = new Error("Vui lòng nhập từ khóa tìm kiếm");
    err.statusCode = 400;
    throw err;
  }

  if (!isGoogleCseConfigured()) {
    return {
      configured: false,
      embedConfigured: false,
      mode: "not-configured",
      provider: "Google Programmable Search Element",
      query: q,
      items: [],
      totalResults: "0",
      searchTime: 0,
      message: "Chưa cấu hình Google Programmable Search. Thêm GOOGLE_CSE_CX vào file .env.",
    };
  }

  return {
    configured: true,
    embedConfigured: true,
    mode: "google-cse-element",
    provider: "Google Programmable Search Element",
    cx: GOOGLE_CSE_CX,
    query: q,
    items: [],
    totalResults: "0",
    searchTime: 0,
    message: "",
  };
}

function getSiteSearchStatus() {
  const configured = isGoogleCseConfigured();
  return {
    configured,
    embedConfigured: configured,
    provider: "Google Programmable Search Element",
    cx: configured ? GOOGLE_CSE_CX : "",
  };
}

module.exports = {
  searchSite,
  getSiteSearchStatus,
  isGoogleCseConfigured,
};
