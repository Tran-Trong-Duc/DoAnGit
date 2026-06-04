const db = require("../db/db");

const pool = db.promise();

const SECURE_TABLES = new Set([
  "users",
  "admin",
  "accounts",
  "credentials",
  "passwords",
  "sessions",
  "auth",
  "api_keys",
  "tokens",
  "oauth",
  "system_settings",
]);

const QUERYABLE_TABLES = new Set([
  "plants",
  "gardens",
  "sensors",
  "devices",
  "thresholds",
  "sensor_data",
  "water_flow",
  "fertilizers",
  "soil_records",
  "alerts",
  "auto_settings",
  "irrigation_schedules",
  "chatbot_knowledge_entries",
  "plant_disease_treatments",
]);

function isTableSecure(tableName) {
  const normalized = String(tableName || "").toLowerCase().trim();
  return SECURE_TABLES.has(normalized);
}

function isTableQueryable(tableName) {
  const normalized = String(tableName || "").toLowerCase().trim();
  if (SECURE_TABLES.has(normalized)) return false;
  return true;
}

async function listAccessibleTables() {
  try {
    const [rows] = await pool.query(`
      SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);
    return rows
      .filter((row) => isTableQueryable(row.TABLE_NAME))
      .map((row) => ({
        name: row.TABLE_NAME,
        rows: row.TABLE_ROWS || 0,
        dataSize: row.DATA_LENGTH || 0,
        indexSize: row.INDEX_LENGTH || 0,
        secure: false,
      }));
  } catch (err) {
    console.log("Cannot list tables:", err.message);
    return [];
  }
}

async function getTableColumns(tableName) {
  if (!isTableQueryable(tableName)) return [];
  try {
    const [rows] = await pool.query(`SHOW COLUMNS FROM \`${tableName}\``);
    return rows.map((row) => ({
      name: row.Field,
      type: row.Type,
      nullable: row.Null === "YES",
      key: row.Key,
      default: row.Default,
    }));
  } catch (err) {
    console.log(`Cannot get columns for ${tableName}:`, err.message);
    return [];
  }
}

async function getTablePreview(tableName, limit = 5) {
  if (!isTableQueryable(tableName)) return [];
  const safeLimit = Math.min(Math.max(1, Number(limit) || 5), 20);
  try {
    const [rows] = await pool.query(
      `SELECT * FROM \`${tableName}\` ORDER BY 1 DESC LIMIT ?`,
      [safeLimit]
    );
    return rows;
  } catch (err) {
    console.log(`Cannot preview ${tableName}:`, err.message);
    return [];
  }
}

async function queryTable(tableName, options = {}) {
  if (!isTableQueryable(tableName)) {
    return { error: `Bảng "${tableName}" không được phép truy vấn.` };
  }

  const {
    where = [],
    orderBy = null,
    limit = 100,
    offset = 0,
    columns = null,
  } = options;

  const safeLimit = Math.min(Math.max(1, Number(limit) || 100), 1000);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const allowedColumns = columns
    ? columns.filter((col) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col))
    : null;

  const columnList = allowedColumns ? `\`${allowedColumns.join("`, `")}\`` : "*";
  const tableIdent = `\`${tableName}\``;

  let sql = `SELECT ${columnList} FROM ${tableIdent}`;
  const params = [];

  if (where && where.length > 0) {
    const whereClauses = [];
    for (const condition of where) {
      if (condition.column && condition.operator) {
        const col = condition.column.replace(/[^a-zA-Z0-9_]/g, "");
        const safeOp = condition.operator.replace(/[^=<>!]/g, "");
        whereClauses.push(`\`${col}\` ${safeOp} ?`);
        params.push(condition.value);
      }
    }
    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(" AND ")}`;
    }
  }

  if (orderBy) {
    const safeOrder = orderBy.replace(/[^a-zA-Z0-9_,\s.]/g, "");
    sql += ` ORDER BY ${safeOrder}`;
  } else {
    sql += " ORDER BY 1 DESC";
  }

  sql += ` LIMIT ${safeLimit} OFFSET ${safeOffset}`;

  try {
    const [rows] = await pool.query(sql, params);
    return { data: rows, count: rows.length };
  } catch (err) {
    console.log(`Query error on ${tableName}:`, err.message);
    return { error: `Lỗi truy vấn: ${err.message}` };
  }
}

async function getWaterFlowStats(options = {}) {
  const { plantName = null, startDate = null, endDate = null, limit = 100 } = options;
  const safeLimit = Math.min(Math.max(1, Number(limit) || 100), 1000);

  let sql = `
    SELECT 
      id,
      DATE(measurement_time) as date,
      TIME(measurement_time) as time,
      measurement_time,
      flow_rate,
      pressure,
      water_level,
      notes
    FROM water_flow
    WHERE 1=1
  `;
  const params = [];

  if (startDate) {
    sql += " AND measurement_time >= ?";
    params.push(startDate);
  }
  if (endDate) {
    sql += " AND measurement_time <= ?";
    params.push(endDate);
  }

  sql += " ORDER BY measurement_time DESC LIMIT ?";
  params.push(safeLimit);

  try {
    const [rows] = await pool.query(sql, params);

    const totalRecords = rows.length;
    let totalVolume = 0;
    let avgFlowRate = 0;
    let minFlowRate = Infinity;
    let maxFlowRate = 0;

    if (rows.length > 0) {
      const flowRates = rows.map((r) => Number(r.flow_rate) || 0).filter((v) => v > 0);
      totalVolume = flowRates.reduce((sum, rate) => sum + rate, 0);
      avgFlowRate = flowRates.length > 0 ? totalVolume / flowRates.length : 0;
      minFlowRate = flowRates.length > 0 ? Math.min(...flowRates) : 0;
      maxFlowRate = flowRates.length > 0 ? Math.max(...flowRates) : 0;
    }

    const durationMinutes = calculateIrrigationDuration(rows);

    return {
      records: rows,
      stats: {
        totalRecords,
        totalVolume: totalVolume.toFixed(2),
        avgFlowRate: avgFlowRate.toFixed(2),
        minFlowRate: minFlowRate === Infinity ? 0 : minFlowRate.toFixed(2),
        maxFlowRate: maxFlowRate.toFixed(2),
        estimatedDurationMinutes: durationMinutes,
        dateRange: {
          from: rows.length > 0 ? rows[rows.length - 1].date : null,
          to: rows.length > 0 ? rows[0].date : null,
        },
      },
    };
  } catch (err) {
    console.log("Water flow stats error:", err.message);
    return { error: `Lỗi truy vấn water_flow: ${err.message}` };
  }
}

function calculateIrrigationDuration(records = []) {
  if (!records || records.length === 0) return 0;

  const sortedRecords = [...records].sort(
    (a, b) => new Date(a.measurement_time) - new Date(b.measurement_time)
  );

  let totalDurationMinutes = 0;
  let irrigationStart = null;
  let lastFlowRate = 0;

  for (const record of sortedRecords) {
    const currentFlow = Number(record.flow_rate) || 0;
    const recordTime = new Date(record.measurement_time);

    if (currentFlow > 0 && lastFlowRate === 0) {
      irrigationStart = recordTime;
    } else if (currentFlow === 0 && lastFlowRate > 0 && irrigationStart) {
      const duration = (recordTime - irrigationStart) / 1000 / 60;
      totalDurationMinutes += duration;
      irrigationStart = null;
    }

    lastFlowRate = currentFlow;
  }

  if (irrigationStart) {
    const lastTime = sortedRecords[sortedRecords.length - 1].measurement_time;
    const duration = (new Date(lastTime) - irrigationStart) / 1000 / 60;
    totalDurationMinutes += duration;
  }

  return Math.round(totalDurationMinutes * 10) / 10;
}

async function getIrrigationSchedule(plantId = null) {
  try {
    let sql = `
      SELECT 
        a.id,
        a.plant_id,
        a.device_type,
        a.irrigation_time,
        a.irrigation_duration,
        a.day_mask,
        a.is_active,
        a.auto_mode,
        p.name as plant_name
      FROM auto_settings a
      LEFT JOIN plants p ON a.plant_id = p.id
      WHERE a.device_type = 'irrigation'
    `;
    const params = [];

    if (plantId) {
      sql += " AND a.plant_id = ?";
      params.push(plantId);
    }

    sql += " ORDER BY a.is_active DESC, a.irrigation_time ASC";

    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (err) {
    console.log("Irrigation schedule error:", err.message);
    return [];
  }
}

async function searchTables(question, options = {}) {
  const { tables = null, limit = 10 } = options;
  const normalizedQuestion = String(question || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .trim();

  const searchTerms = normalizedQuestion.split(/\s+/).filter((t) => t.length > 2);

  const isWaterQuestion =
    /(luu luong|luong nuoc|tuoi|nuoc|flow|watering|irrigation|thoi gian tuoi|duration)/.test(
      normalizedQuestion
    ) ||
    searchTerms.some(
      (t) =>
        ["tưởi", "tưới", "luu", "luong", "nuoc", "nước", "flow"].includes(t) ||
        t.includes("tuoi") ||
        t.includes("luuluong") ||
        t.includes("luongnuoc") ||
        t.includes("thoigian") ||
        t.includes("thoí gian")
    ) ||
    /tưởi|tưới/.test(question);

  const isSensorQuestion =
    /(cam bien|sensor|nhiet do|do am|anh sang|ÁNH SÁNG|temperature|humidity|light)/.test(
      normalizedQuestion
    );

  const isAlertQuestion = /(canh bao|alert|warning)/.test(normalizedQuestion);
  const isFertilizerQuestion = /(phan bon|fertilizer|dinh duong)/.test(normalizedQuestion);
  const isPlantQuestion = /(cay|plant|trong)/.test(normalizedQuestion);
  const isScheduleQuestion = /(lich|schedule|thoi gian|custom)/.test(normalizedQuestion);

  const results = [];

  if (isWaterQuestion) {
    const waterData = await getWaterFlowStats({ limit: 20 });
    if (!waterData.error) {
      results.push({
        table: "water_flow",
        type: "water_flow",
        data: waterData.records || [],
        stats: waterData.stats,
        relevance: 10,
        summary: formatWaterFlowSummary(waterData.stats),
      });
    }
  }

  if (isWaterQuestion || isScheduleQuestion) {
    const schedules = await getIrrigationSchedule();
    if (schedules.length > 0) {
      results.push({
        table: "auto_settings",
        type: "irrigation_schedule",
        data: schedules,
        relevance: 8,
        summary: formatIrrigationScheduleSummary(schedules),
      });
    }
  }

  if (isSensorQuestion) {
    const sensorData = await queryTable("sensor_data", { limit: 10 });
    if (!sensorData.error) {
      results.push({
        table: "sensor_data",
        type: "sensor_data",
        data: sensorData.data || [],
        relevance: 9,
        summary: formatSensorDataSummary(sensorData.data),
      });
    }
  }

  if (isAlertQuestion) {
    const alerts = await queryTable("alerts", {
      where: [{ column: "is_acknowledged", operator: "=", value: 0 }],
      limit: 10,
    });
    if (!alerts.error) {
      results.push({
        table: "alerts",
        type: "alerts",
        data: alerts.data || [],
        relevance: 9,
        summary: formatAlertsSummary(alerts.data),
      });
    }
  }

  if (isFertilizerQuestion) {
    const fertilizers = await queryTable("fertilizers", { limit: 10 });
    if (!fertilizers.error) {
      results.push({
        table: "fertilizers",
        type: "fertilizer",
        data: fertilizers.data || [],
        relevance: 7,
        summary: formatFertilizersSummary(fertilizers.data),
      });
    }
  }

  if (isPlantQuestion) {
    const plants = await queryTable("plants", { limit: 20 });
    if (!plants.error) {
      results.push({
        table: "plants",
        type: "plants",
        data: plants.data || [],
        relevance: 6,
        summary: formatPlantsSummary(plants.data),
      });
    }
  }

  return results.sort((a, b) => b.relevance - a.relevance).slice(0, limit);
}

function formatWaterFlowSummary(stats) {
  if (!stats) return "Không có dữ liệu lưu lượng nước.";

  const parts = [];
  if (stats.totalRecords > 0) {
    parts.push(`${stats.totalRecords} bản ghi`);
  }
  if (stats.avgFlowRate > 0) {
    parts.push(`lưu lượng TB: ${stats.avgFlowRate} lít/phút`);
  }
  if (stats.maxFlowRate > 0) {
    parts.push(`lưu lượng max: ${stats.maxFlowRate} lít/phút`);
  }
  if (stats.estimatedDurationMinutes > 0) {
    parts.push(`thời gian tưới ước tính: ${stats.estimatedDurationMinutes} phút`);
  }
  if (stats.dateRange?.from && stats.dateRange?.to) {
    parts.push(`từ ${stats.dateRange.from} đến ${stats.dateRange.to}`);
  }

  return parts.length > 0 ? parts.join(", ") : "Không có dữ liệu lưu lượng nước.";
}

function formatIrrigationScheduleSummary(schedules) {
  if (!schedules || schedules.length === 0) return "Không có lịch tưới.";
  const active = schedules.filter((s) => s.is_active);
  const times = active.map((s) => s.irrigation_time?.slice(0, 5)).filter(Boolean);
  return `Có ${schedules.length} lịch tưới${active.length > 0 ? `, ${active.length} đang hoạt động` : ""}${
    times.length > 0 ? `: ${times.join(", ")}` : ""
  }.`;
}

function formatSensorDataSummary(data) {
  if (!data || data.length === 0) return "Không có dữ liệu cảm biến.";
  const latest = data[0];
  const parts = [];
  if (latest.temperature != null) parts.push(`nhiệt độ ${latest.temperature}°C`);
  if (latest.humidity != null) parts.push(`ẩm ${latest.humidity}%`);
  if (latest.soil_moisture != null) parts.push(`đất ẩm ${latest.soil_moisture}%`);
  if (latest.light != null) parts.push(`ánh sáng ${latest.light} lux`);
  return `Cảm biến mới nhất: ${parts.join(", ")}.`;
}

function formatAlertsSummary(data) {
  if (!data || data.length === 0) return "Không có cảnh báo.";
  const critical = data.filter((a) => a.level === "critical" || a.level === "danger");
  return `Có ${data.length} cảnh báo chưa đọc${critical.length > 0 ? `, ${critical.length} nghiêm trọng` : ""}.`;
}

function formatFertilizersSummary(data) {
  if (!data || data.length === 0) return "Không có dữ liệu phân bón.";
  return `Có ${data.length} bản ghi phân bón.`;
}

function formatPlantsSummary(data) {
  if (!data || data.length === 0) return "Không có cây trồng.";
  const mainPlant = data.find((p) => p.is_main);
  const names = data.map((p) => p.name).filter(Boolean);
  return `Hệ thống có ${data.length} cây${mainPlant ? `, cây chính: ${mainPlant.name}` : ""}.`;
}

module.exports = {
  isTableSecure,
  isTableQueryable,
  listAccessibleTables,
  getTableColumns,
  getTablePreview,
  queryTable,
  getWaterFlowStats,
  calculateIrrigationDuration,
  getIrrigationSchedule,
  searchTables,
  SECURE_TABLES,
  QUERYABLE_TABLES,
};
