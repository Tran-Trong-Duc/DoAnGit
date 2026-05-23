const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const fs = require("fs");
const db = require("../db/db");
const mqtt = require("mqtt");
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const ExcelJS = require("exceljs");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "..", "public");
const chatBotFile = path.join(__dirname, "..", "chatBot", "index.html");
const uploadDir = path.join(publicDir, "uploads");

fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const safeExt = [".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext) ? ext : ".jpg";
    cb(null, `plant-${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Chỉ được tải lên file ảnh"));
    }
    cb(null, true);
  },
});

const knowledgeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const isExcel =
      ext === ".xlsx" ||
      file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (!isExcel) return cb(new Error("Chỉ hỗ trợ file Excel .xlsx để nạp dữ liệu ChatBot"));
    cb(null, true);
  },
});

app.use(cors());
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

app.get("/app.html", (req, res) => {
  if (!readToken(req)) {
    return res.redirect("/login.html");
  }

  res.sendFile(path.join(publicDir, "app.html"));
});

function serveChatBot(req, res) {
  res.sendFile(chatBotFile);
}

app.get("/chatBot", serveChatBot);
app.get("/chatBot.html", serveChatBot);
app.get("/chatbot", serveChatBot);
app.get("/chatbot.html", serveChatBot);
app.get("/Ai_demo", serveChatBot);
app.get("/Ai_demo.html", serveChatBot);

app.use(express.static(publicDir));

function getCookie(req, name) {
  const cookies = req.headers.cookie || "";
  const match = cookies
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`));

  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function readToken(req) {
  return req.headers.authorization || req.query.token || getCookie(req, "sg_token");
}

function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ message: "Chưa đăng nhập" });
  }
  next();
}

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function runQuery(res, work) {
  try {
    await schemaReady;
    await work();
  } catch (err) {
    console.log("SQL error:", err);
    res.status(500).json({ message: "Lỗi server", error: err.message });
  }
}

function parseDuration(value, fallback = 1) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : fallback;
}

function parseOptionalNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseOptionalText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeLightReading(value) {
  const number = parseOptionalNumber(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, number);
}

function normalizeLightMaxThreshold(value) {
  const number = normalizeLightReading(value);
  return Number.isFinite(number) ? number : LIGHT_DEFAULT_MAX_LUX;
}

function normalizeSensorRow(row) {
  return {
    ...row,
    light: normalizeLightReading(row?.light),
  };
}

function normalizeTimeValue(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (/^\d{1,2}:\d{2}$/.test(text)) {
    const [hour, minute] = text.split(":").map(Number);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
    }
  }
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(text)) {
    const [hour, minute, second] = text.split(":").map(Number);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
    }
  }
  return null;
}

let coolingStatus = false;
let irrigationStatus = false;
let fanStatus = false;
let sprayStatus = false;
let buzzerStatus = false;
let coolingTargetTemp = null;
let coolingTargetTimer = null;
let fireResponseTimer = null;
let fireResponseUntil = null;
let fireSuppressedUntilMs = 0;
let mainPlantId = 1;
let schemaReady = Promise.resolve();
let autoCoolingActive = false;
let autoFanActive = false;
let autoSprayActive = false;
let autoIrrigationActive = false;
let autoIrrigationMode = "sensor";
let sensorIrrigationStartedAt = null;
let emergencyActive = false;
let fireProtectionActive = false;
let fireSimulationActive = false;
let fireFlameDetected = false;
let alertMuted = false;
let mqttConnected = false;
let lastSensorAt = null;
let lastSensorSaveAt = 0;
let lastSensorSource = "unknown";
let latestSensorReading = null;
let simulateSensor = process.env.SIMULATE_SENSOR === "true";
let sensorSaveInProgress = false;
const deviceCountdownEnds = {
  irrigation: null,
  fan: null,
  spray: null,
  cooling: null,
  buzzer: null,
};
// Cac co nay cho phep nguoi dung tat rieng logic tu dong cua tung nhom thiet bi.
const autoDisabled = {
  irrigation: false,
  fan: false,
  spray: false,
  cooling: false,
};
const activeThresholdAlerts = new Set();
const lastAutoScheduleRuns = new Map();
const alertPreferences = {
  popup_enabled: true,
  temp_enabled: true,
  humidity_enabled: true,
  soil_enabled: true,
  light_enabled: true,
  gas_enabled: true,
  fire_enabled: true,
  action_enabled: true,
};

// Giao dien van cap nhat cam bien lien tuc, nhung database chi luu moi 30 phut de tranh phinh du lieu.
const AUTO_SCHEDULE_CHECK_INTERVAL_MS = 1000;
const MAX_COOLING_TARGET_SECONDS = 15 * 60;
const SENSOR_SAVE_INTERVAL_MS = 30 * 60 * 1000;
const LIVE_SENSOR_BUFFER_SIZE = 120;
const LIGHT_DEFAULT_MAX_LUX = 40000;
const GAS_DANGER_THRESHOLD = 400;
const FIRE_SMOKE_THRESHOLD = GAS_DANGER_THRESHOLD;
const FIRE_TEMP_SPIKE_C = 20;
const FIRE_TEMP_SPIKE_WINDOW_MS = 5000;
const FIRE_CRITICAL_TEMP = 60;
const FIRE_RESPONSE_SECONDS = 2 * 60 * 60;
const DEVICE_COMMAND_TOPICS = {
  irrigation: "garden/pump/set",
  fan: "garden/fan/set",
  spray: "garden/spray/set",
  buzzer: "garden/buzzer/set",
};
const DEVICE_COMMAND_LABELS = {
  irrigation: "bơm tưới",
  fan: "quạt",
  spray: "phun sương",
  buzzer: "còi báo động",
};
const recentDeviceCommands = [];
const recentLiveSensors = [];
const recentFireSamples = [];
const alertClients = new Set();
let simulatedSensorTick = 0;

function clampSensorValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundSensorValue(value) {
  return Math.round(value * 10) / 10;
}

function buildSimulatedSensorReading() {
  const tick = simulatedSensorTick++;
  const slowWave = Math.sin(tick / 35);
  const dayWave = Math.sin(tick / 18);
  const smallWave = Math.sin(tick / 7) * 0.25;
  const temperature = roundSensorValue(clampSensorValue(27 + dayWave * 1.8 + slowWave * 0.8 + smallWave, 24.5, 31.5));
  const humidity = roundSensorValue(clampSensorValue(70 - dayWave * 5 + Math.cos(tick / 29) * 2, 58, 82));
  const soil_moisture = roundSensorValue(clampSensorValue(61 + Math.sin(tick / 42) * 4 - Math.sin(tick / 12) * 1.5, 52, 72));
  const light = Math.round(clampSensorValue(540 + Math.max(dayWave, 0) * 320 + Math.sin(tick / 22) * 90, 120, 1000));
  const gas = Math.round(clampSensorValue(145 + Math.sin(tick / 16) * 18 + Math.cos(tick / 41) * 10, 95, 210));

  return { temperature, humidity, soil_moisture, light, gas, flame: 0 };
}

function deviceActionMessage(device, state) {
  const label = DEVICE_COMMAND_LABELS[device] || device;
  const normalizedState = String(state || "").toLowerCase();
  const verb = ["on", "1", "true", "bat", "bật"].includes(normalizedState) ? "Bật" : "Tắt";
  return `${verb} ${label}`;
}

async function getColumns(tableName) {
  const rows = await query(`SHOW COLUMNS FROM ${tableName}`);
  return rows.map((row) => row.Field);
}

async function addColumnIfMissing(tableName, columnName, definition) {
  const columns = await getColumns(tableName);
  if (!columns.includes(columnName)) {
    await query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function modifyColumn(tableName, columnName, definition) {
  try {
    await query(`ALTER TABLE ${tableName} MODIFY COLUMN ${columnName} ${definition}`);
  } catch (err) {
    console.log(`Cannot modify ${tableName}.${columnName}:`, err.message);
  }
}

async function saveSystemSetting(key, value) {
  await query(
    `INSERT INTO system_settings (setting_key, setting_value)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)`,
    [key, String(value)]
  );
}

async function loadSystemSettings() {
  const rows = await query("SELECT setting_key, setting_value FROM system_settings");
  const settings = new Map(rows.map((row) => [row.setting_key, row.setting_value]));

  alertMuted = settings.get("alert_muted") === "1";
  simulateSensor = settings.has("simulate_sensor")
    ? settings.get("simulate_sensor") === "1"
    : false;

  Object.keys(alertPreferences).forEach((key) => {
    if (settings.has(`alert_${key}`)) {
      alertPreferences[key] = settings.get(`alert_${key}`) === "1";
    }
  });
}

function toSettingBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return ["1", "true", "on", "yes"].includes(String(value).toLowerCase());
}

function alertSettingsResponse() {
  return {
    muted: alertMuted,
    preferences: { ...alertPreferences },
  };
}

function parseFlameValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (value === undefined || value === null) return false;
  return ["1", "true", "yes", "on", "detected", "fire"].includes(String(value).toLowerCase());
}

function scheduleRunsToday(schedule, now) {
  const mask = String(schedule.day_mask || "1111111").padEnd(7, "1").slice(0, 7);
  const dayIndex = now.getDay() === 0 ? 6 : now.getDay() - 1;
  return mask[dayIndex] !== "0";
}

function clearAutoScheduleRunCache(scheduleId) {
  Array.from(lastAutoScheduleRuns.keys()).forEach((key) => {
    if (key.startsWith(`${scheduleId}-`)) lastAutoScheduleRuns.delete(key);
  });
}

function rememberLiveSensor(reading) {
  // Luu tam vao RAM de man hinh cap nhat moi 3 giay ma khong can ghi MySQL lien tuc.
  latestSensorReading = reading;
  recentLiveSensors.push(reading);
  while (recentLiveSensors.length > LIVE_SENSOR_BUFFER_SIZE) {
    recentLiveSensors.shift();
  }
}

function shouldSaveSensorToDatabase(nowMs) {
  return !lastSensorSaveAt || nowMs - lastSensorSaveAt >= SENSOR_SAVE_INTERVAL_MS;
}

async function saveSensorToDatabaseIfDue(reading, receivedAtMs) {
  if (!shouldSaveSensorToDatabase(receivedAtMs) || sensorSaveInProgress) return false;

  let lockAcquired = false;
  sensorSaveInProgress = true;

  try {
    // Khoa MySQL giup tranh trung ban ghi neu vo tinh chay nhieu tien trinh Node cung luc.
    const locks = await query("SELECT GET_LOCK('iot_garden_sensor_periodic_save', 0) AS lock_acquired");
    lockAcquired = Number(locks[0]?.lock_acquired) === 1;
    if (!lockAcquired) return false;

    const latestRows = await query("SELECT created_at FROM sensor_data ORDER BY id DESC LIMIT 1");
    const latestSavedAt = latestRows[0]?.created_at ? new Date(latestRows[0].created_at).getTime() : 0;
    if (Number.isFinite(latestSavedAt) && latestSavedAt > lastSensorSaveAt) {
      lastSensorSaveAt = latestSavedAt;
    }

    if (!shouldSaveSensorToDatabase(receivedAtMs)) return false;

    await query(
      "INSERT INTO sensor_data (temperature, humidity, soil_moisture, light, gas, flame, level) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [reading.temperature, reading.humidity, reading.soil, reading.light, reading.gas, reading.flame ? 1 : 0, reading.level]
    );
    lastSensorSaveAt = receivedAtMs;
    return true;
  } catch (err) {
    console.log("Cannot save sensor_data:", err.message);
    return false;
  } finally {
    if (lockAcquired) {
      try {
        await query("SELECT RELEASE_LOCK('iot_garden_sensor_periodic_save')");
      } catch (err) {
        console.log("Cannot release sensor save lock:", err.message);
      }
    }
    sensorSaveInProgress = false;
  }
}

async function ensureSchema() {
  try {
    // Tu bo sung cac cot moi de database cu van chay duoc sau khi nang cap tinh nang.
    await query(`CREATE TABLE IF NOT EXISTS devices (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(100) DEFAULT NULL,
      device_type VARCHAR(50) DEFAULT NULL,
      garden_id INT DEFAULT NULL,
      status VARCHAR(30) DEFAULT 'offline',
      mqtt_topic VARCHAR(120) DEFAULT NULL,
      note TEXT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

    await query(`CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(80) NOT NULL,
      setting_value VARCHAR(255) DEFAULT NULL,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

    await query(`CREATE TABLE IF NOT EXISTS soil_records (
      id INT NOT NULL AUTO_INCREMENT,
      plant_id INT DEFAULT NULL,
      garden_id INT DEFAULT NULL,
      soil_ph DECIMAL(4,2) NULL,
      soil_type VARCHAR(100) NULL,
      soil_looseness VARCHAR(100) NULL,
      soil_drainage VARCHAR(100) NULL,
      note TEXT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

    await addColumnIfMissing("devices", "device_type", "VARCHAR(50) DEFAULT NULL");
    await addColumnIfMissing("devices", "garden_id", "INT DEFAULT NULL");
    await addColumnIfMissing("devices", "mqtt_topic", "VARCHAR(120) DEFAULT NULL");
    await addColumnIfMissing("devices", "note", "TEXT NULL");
    await addColumnIfMissing("devices", "created_at", "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP");
    await addColumnIfMissing("sensor_data", "light", "DECIMAL(8,2) NULL");
    await addColumnIfMissing("sensor_data", "flame", "TINYINT(1) NOT NULL DEFAULT 0");
    await modifyColumn("devices", "status", "VARCHAR(30) DEFAULT 'offline'");
    await addColumnIfMissing("plants", "is_main", "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnIfMissing("plants", "image_path", "VARCHAR(255) NULL");
    await addColumnIfMissing("plants", "image_data", "MEDIUMBLOB NULL");
    await addColumnIfMissing("plants", "image_mime", "VARCHAR(100) NULL");
    await addColumnIfMissing("plants", "image_updated_at", "TIMESTAMP NULL");
    await addColumnIfMissing("plants", "watering_time", "TIME NULL");
    await addColumnIfMissing("plants", "watering_duration", "INT NULL");
    await addColumnIfMissing("plants", "description", "TEXT NULL");
    await addColumnIfMissing("plants", "soil_ph", "DECIMAL(4,2) NULL");
    await addColumnIfMissing("plants", "soil_type", "VARCHAR(100) NULL");
    await addColumnIfMissing("plants", "soil_looseness", "VARCHAR(100) NULL");
    await addColumnIfMissing("plants", "soil_drainage", "VARCHAR(100) NULL");
    await addColumnIfMissing("plants", "soil_note", "TEXT NULL");
    await addColumnIfMissing("gardens", "device_info", "TEXT NULL");
    await addColumnIfMissing("thresholds", "humidity_min", "DECIMAL(6,2) NULL");
    await addColumnIfMissing("thresholds", "humidity_max", "DECIMAL(6,2) NULL");
    await addColumnIfMissing("thresholds", "soil_min", "DECIMAL(6,2) NULL");
    await addColumnIfMissing("thresholds", "soil_max", "DECIMAL(6,2) NULL");
    await addColumnIfMissing("thresholds", "light_min", "DECIMAL(8,2) NULL");
    await addColumnIfMissing("thresholds", "light_max", "DECIMAL(8,2) NULL");
    await query("UPDATE thresholds SET light_max=? WHERE light_max IS NULL", [LIGHT_DEFAULT_MAX_LUX]);
    await addColumnIfMissing("fertilizers", "plant_id", "INT NULL");
    await addColumnIfMissing("fertilizers", "type", "VARCHAR(100) NULL");
    await addColumnIfMissing("fertilizers", "method", "VARCHAR(100) NULL");
    await addColumnIfMissing("fertilizers", "quantity", "VARCHAR(100) NULL");
    await addColumnIfMissing("fertilizers", "note", "TEXT NULL");
    await addColumnIfMissing("fertilizers", "created_at", "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP");
    await addColumnIfMissing("soil_records", "plant_id", "INT NULL");
    await addColumnIfMissing("soil_records", "garden_id", "INT NULL");
    await addColumnIfMissing("soil_records", "soil_ph", "DECIMAL(4,2) NULL");
    await addColumnIfMissing("soil_records", "soil_type", "VARCHAR(100) NULL");
    await addColumnIfMissing("soil_records", "soil_looseness", "VARCHAR(100) NULL");
    await addColumnIfMissing("soil_records", "soil_drainage", "VARCHAR(100) NULL");
    await addColumnIfMissing("soil_records", "note", "TEXT NULL");
    await addColumnIfMissing("soil_records", "created_at", "TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP");
    await addColumnIfMissing("alerts", "is_acknowledged", "TINYINT(1) NOT NULL DEFAULT 1");
    await addColumnIfMissing("alerts", "acknowledged_at", "TIMESTAMP NULL");
    await addColumnIfMissing("alerts", "alert_type", "VARCHAR(50) NULL");
    await addColumnIfMissing("auto_settings", "day_mask", "VARCHAR(7) NOT NULL DEFAULT '1111111'");
    await backfillPlantImagesFromUploads();
    await backfillSoilRecordGardens();

    await loadSystemSettings();

    // Khi server khoi dong lai, lay moc luu sensor moi nhat de giu dung chu ky 1 gio.
    const latestSavedSensor = await query("SELECT created_at FROM sensor_data ORDER BY id DESC LIMIT 1");
    const savedAt = latestSavedSensor[0]?.created_at ? new Date(latestSavedSensor[0].created_at).getTime() : 0;
    if (Number.isFinite(savedAt)) {
      lastSensorSaveAt = savedAt;
    }

    const currentMain = await query("SELECT id FROM plants WHERE is_main=1 ORDER BY id LIMIT 1");
    if (currentMain.length > 0) {
      mainPlantId = currentMain[0].id;
      return;
    }

    const firstPlant = await query("SELECT id FROM plants ORDER BY id LIMIT 1");
    if (firstPlant.length > 0) {
      mainPlantId = firstPlant[0].id;
      await query("UPDATE plants SET is_main=1 WHERE id=?", [mainPlantId]);
    }
  } catch (err) {
    console.log("Cannot prepare database schema:", err.message);
  }
}

function normalizePlant(row) {
  return {
    id: row.id,
    name: row.name,
    garden_id: row.garden_id,
    image_path: row.image_path || null,
    has_image: Boolean(row.has_image || row.image_path),
    is_main: Boolean(row.is_main),
    watering_time: row.watering_time || null,
    watering_duration: row.watering_duration ?? null,
    description: row.description || null,
    soil_ph: row.soil_ph ?? null,
    soil_type: row.soil_type || null,
    soil_looseness: row.soil_looseness || null,
    soil_drainage: row.soil_drainage || null,
    soil_note: row.soil_note || null,
    temp_min: row.temp_min ?? null,
    temp_max: row.temp_max ?? null,
    humidity_min: row.humidity_min ?? null,
    humidity_max: row.humidity_max ?? null,
    soil_min: row.soil_min ?? null,
    soil_max: row.soil_max ?? null,
    light_max: normalizeLightMaxThreshold(row.light_max),
  };
}

function uploadedImageMime(imagePath = "") {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function resolveUploadedImagePath(imagePath) {
  if (!imagePath || !imagePath.startsWith("/uploads/")) return null;

  const filePath = path.resolve(publicDir, imagePath.replace(/^\/+/, ""));
  if (!filePath.startsWith(`${uploadDir}${path.sep}`)) return null;
  return filePath;
}

function deleteUploadedImage(imagePath) {
  const filePath = resolveUploadedImagePath(imagePath);
  if (!filePath) return;

  fs.promises.unlink(filePath).catch(() => {});
}

async function readPlantImageFile(file) {
  if (!file?.path) return null;
  return {
    data: await fs.promises.readFile(file.path),
    mime: file.mimetype || uploadedImageMime(file.originalname),
  };
}

async function backfillPlantImagesFromUploads() {
  const rows = await query(`
    SELECT id, image_path
    FROM plants
    WHERE image_data IS NULL AND image_path IS NOT NULL AND image_path <> ''
  `);

  for (const row of rows) {
    const filePath = resolveUploadedImagePath(row.image_path);
    if (!filePath || !fs.existsSync(filePath)) continue;

    try {
      await query(
        "UPDATE plants SET image_data=?, image_mime=?, image_updated_at=COALESCE(image_updated_at, NOW()) WHERE id=?",
        [await fs.promises.readFile(filePath), uploadedImageMime(row.image_path), row.id]
      );
    } catch (err) {
      console.log(`Cannot move plant image ${row.id} into database:`, err.message);
    }
  }
}

async function backfillSoilRecordGardens() {
  await query(`
    UPDATE soil_records s
    INNER JOIN plants p ON p.id = s.plant_id
    SET s.garden_id = p.garden_id
    WHERE s.garden_id IS NULL AND s.plant_id IS NOT NULL
  `);
}

async function getPlantsWithThresholds() {
  const plants = await query(`
    SELECT id, name, garden_id, image_path, image_mime, image_data IS NOT NULL AS has_image,
      is_main, watering_time, watering_duration,
      description,
      soil_ph, soil_type, soil_looseness, soil_drainage, soil_note
    FROM plants
    ORDER BY is_main DESC, id DESC
  `);
  const thresholds = await query(`
    SELECT th.*
    FROM thresholds th
    INNER JOIN (
      SELECT plant_id, MAX(id) AS id
      FROM thresholds
      GROUP BY plant_id
    ) latest ON latest.id = th.id
  `);
  const thresholdByPlant = new Map(thresholds.map((row) => [row.plant_id, row]));

  return plants.map((plant) => {
    const threshold = thresholdByPlant.get(plant.id) || {};
    return normalizePlant({ ...plant, ...threshold, id: plant.id });
  });
}

async function getMainPlant() {
  const plants = await getPlantsWithThresholds();
  return plants.find((plant) => plant.is_main) || plants[0] || null;
}

function servePlantImage(req, res) {
  runQuery(res, async () => {
    const rows = await query("SELECT image_data, image_mime, image_path FROM plants WHERE id=?", [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).send("Không tìm thấy cây trồng");
    }

    const imageData = rows[0].image_data;
    if (imageData && imageData.length > 0) {
      res.setHeader("Content-Type", rows[0].image_mime || "image/jpeg");
      res.setHeader("Cache-Control", "no-store");
      return res.send(imageData);
    }

    const filePath = resolveUploadedImagePath(rows[0].image_path);
    if (filePath && fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }

    res.status(404).send("Cây trồng chưa có ảnh");
  });
}

function soilRecordParams(payload) {
  return [
    parseOptionalNumber(payload.garden_id),
    parseOptionalNumber(payload.soil_ph),
    parseOptionalText(payload.soil_type),
    parseOptionalText(payload.soil_looseness),
    parseOptionalText(payload.soil_drainage),
    parseOptionalText(payload.note ?? payload.soil_note),
  ];
}

function idealSoilParams(payload) {
  return [
    parseOptionalNumber(payload.soil_ph),
    parseOptionalText(payload.soil_type),
    parseOptionalText(payload.soil_looseness),
    parseOptionalText(payload.soil_drainage),
    parseOptionalText(payload.soil_note),
  ];
}

async function insertThreshold(plantId, payload) {
  await query(
    `INSERT INTO thresholds
    (plant_id, temp_min, temp_max, humidity_min, humidity_max, soil_min, soil_max, light_min, light_max)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      plantId,
      parseOptionalNumber(payload.temp_min),
      parseOptionalNumber(payload.temp_max),
      parseOptionalNumber(payload.humidity_min),
      parseOptionalNumber(payload.humidity_max),
      parseOptionalNumber(payload.soil_min),
      parseOptionalNumber(payload.soil_max),
      null,
      normalizeLightMaxThreshold(payload.light_max),
    ]
  );
}

function alertPreferenceKey(alertType) {
  if (["temp", "humidity", "soil", "light", "gas", "fire", "action"].includes(alertType)) {
    return `${alertType}_enabled`;
  }
  return "popup_enabled";
}

function notifyAlertClients(alertRow) {
  const payload = `event: alert\ndata: ${JSON.stringify(alertRow)}\n\n`;
  alertClients.forEach((res) => {
    try {
      res.write(payload);
    } catch {
      alertClients.delete(res);
    }
  });
}

function createAlert(message, level = "warning", alertType = "system", forcePopup = false) {
  const typeEnabled = alertPreferences[alertPreferenceKey(alertType)] !== false;
  const shouldPopup = forcePopup || (!alertMuted && alertPreferences.popup_enabled && typeEnabled);

  db.query(
    "INSERT INTO alerts (message, level, alert_type, is_acknowledged) VALUES (?, ?, ?, ?)",
    [message, level, alertType, shouldPopup ? 0 : 1],
    (err, result) => {
      if (err) {
        console.log("Cannot save alert:", err.message);
        return;
      }
      if (shouldPopup) {
        notifyAlertClients({
          id: result.insertId,
          message,
          level,
          alert_type: alertType,
          is_acknowledged: 0,
          created_at: new Date(),
        });
      }
    }
  );
}

async function acknowledgeAllUnreadAlerts() {
  await query("UPDATE alerts SET is_acknowledged=1, acknowledged_at=NOW() WHERE is_acknowledged=0");
}

async function resolveDeviceCommandTopic(device) {
  const fallbackTopic = DEVICE_COMMAND_TOPICS[device];

  try {
    await schemaReady;
    // Neu thiet bi that da khai bao topic MQTT rieng thi uu tien dung topic do.
    const rows = await query(
      `SELECT mqtt_topic
      FROM devices
      WHERE device_type=? AND mqtt_topic IS NOT NULL AND mqtt_topic <> ''
      ORDER BY status='online' DESC, id DESC
      LIMIT 1`,
      [device]
    );

    return rows[0]?.mqtt_topic || fallbackTopic;
  } catch (err) {
    console.log("Cannot resolve device topic:", err.message);
    return fallbackTopic;
  }
}

function rememberDeviceCommand(command) {
  recentDeviceCommands.unshift(command);
  if (recentDeviceCommands.length > 20) {
    recentDeviceCommands.pop();
  }
}

function isPcccCommand({ action = "", mode = "", message = "" } = {}) {
  const text = `${action} ${mode} ${message}`;
  return /(^|\s)fire_|(\(|\s)(fire|simulation)(\)|\s)|PCCC/i.test(text);
}

function isPcccCommandAlert(alertRow) {
  return alertRow?.alert_type === "hardware" && isPcccCommand({ message: alertRow.message });
}

async function publishDeviceCommand({ device, state, action, mode = "manual", duration = null, reason = "", extra = {}, notify = true }) {
  if (!DEVICE_COMMAND_TOPICS[device]) return null;

  // Ham trung tam de ca dieu khien tay va tu dong deu gui lenh cung mot dinh dang.
  const topic = await resolveDeviceCommandTopic(device);
  const payload = {
    id: `cmd-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    device,
    state,
    action,
    mode,
    duration,
    reason,
    requested_at: new Date().toISOString(),
    source: "smart_garden_web",
    ...extra,
  };
  const message = deviceActionMessage(device, state);

  rememberDeviceCommand({
    topic,
    payload,
    message,
    mqttConnected,
    created_at: payload.requested_at,
  });

  // Lenh PCCC/khẩn cấp có thông báo tổng riêng, không tạo thêm popup phụ cho từng thiết bị.
  if (notify && !isPcccCommand({ action, mode, message }) && mode !== "emergency") {
    createAlert(
      mqttConnected ? message : `${message} - đang chờ MQTT kết nối`,
      mqttConnected ? "info" : "warning",
      "hardware",
      mode === "manual"
    );
  }

  if (!topic) return null;

  client.publish(topic, JSON.stringify(payload), { qos: 1, retain: false }, (err) => {
    if (err) {
      console.log("Cannot publish device command:", err.message);
      createAlert(`Gửi lệnh MQTT thất bại: ${err.message}`, "warning", "hardware");
    }
  });

  return { topic, payload };
}

function logDeviceAction(deviceId, action, mode = "auto") {
  db.query(
    "INSERT INTO device_logs (device_id, action, mode) VALUES (?, ?, ?)",
    [deviceId, action, mode]
  );
}

function logCoolingAction(action, mode = "auto") {
  // Lam mat dung 2 thiet bi rieng: quat (2) va bom/phun suong lam mat (3), khong ghi nham vao bom tuoi (1).
  logDeviceAction(2, action, mode);
  logDeviceAction(3, action, mode);
}

function setDeviceCountdown(keys, seconds) {
  const endAt = Date.now() + parseDuration(seconds) * 1000;
  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(deviceCountdownEnds, key)) {
      deviceCountdownEnds[key] = endAt;
    }
  });
}

function clearDeviceCountdown(keys) {
  keys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(deviceCountdownEnds, key)) {
      deviceCountdownEnds[key] = null;
    }
  });
}

function clearAllDeviceCountdowns() {
  clearDeviceCountdown(Object.keys(deviceCountdownEnds));
}

function getDeviceCountdowns() {
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(deviceCountdownEnds).map(([key, endAt]) => {
      const remaining = endAt ? Math.max(0, Math.ceil((endAt - now) / 1000)) : 0;
      if (endAt && remaining <= 0) deviceCountdownEnds[key] = null;
      return [key, remaining];
    })
  );
}

function analyzeFireRisk(temperature, gas, flameDetected, nowMs) {
  // PCCC dung cua so 5 giay de phat hien nhiet do tang bat thuong nhanh.
  recentFireSamples.push({ temperature, gas, at: nowMs });
  while (recentFireSamples.length && nowMs - recentFireSamples[0].at > FIRE_TEMP_SPIKE_WINDOW_MS) {
    recentFireSamples.shift();
  }

  const temperatures = recentFireSamples.map((item) => item.temperature).filter(Number.isFinite);
  const maxTemp = temperatures.length ? Math.max(...temperatures) : temperature;
  const minTemp = temperatures.length ? Math.min(...temperatures) : temperature;
  const tempDelta = maxTemp - minTemp;
  const smokeHigh = Number.isFinite(gas) && gas >= FIRE_SMOKE_THRESHOLD;
  const tempSpike = smokeHigh && tempDelta >= FIRE_TEMP_SPIKE_C;
  const criticalTemp = Number.isFinite(temperature) && temperature >= FIRE_CRITICAL_TEMP;
  const temporarilySuppressed = nowMs < fireSuppressedUntilMs;

  return {
    flameDetected,
    smokeHigh,
    tempSpike,
    criticalTemp,
    tempDelta,
    shouldStartFireResponse: !temporarilySuppressed && (flameDetected || tempSpike || criticalTemp),
  };
}

function stopFireResponse({ mode = "fire", reason = "fire_response_finished", publish = true } = {}) {
  if (fireResponseTimer) {
    clearTimeout(fireResponseTimer);
    fireResponseTimer = null;
  }
  clearDeviceCountdown(["irrigation", "spray", "buzzer"]);

  fireProtectionActive = false;
  fireSimulationActive = false;
  fireResponseUntil = null;
  recentFireSamples.length = 0;
  autoIrrigationActive = false;
  autoSprayActive = false;
  sensorIrrigationStartedAt = null;
  irrigationStatus = false;
  sprayStatus = false;
  buzzerStatus = false;
  if (!autoCoolingActive) coolingStatus = false;

  logDeviceAction(1, "fire_irrigation_off", mode);
  logDeviceAction(3, "fire_spray_off", mode);
  logDeviceAction(4, "fire_buzzer_off", mode);

  if (publish) {
    publishDeviceCommand({ device: "irrigation", state: "off", action: "fire_irrigation_off", mode, reason });
    publishDeviceCommand({ device: "spray", state: "off", action: "fire_spray_off", mode, reason });
    publishDeviceCommand({ device: "buzzer", state: "off", action: "fire_buzzer_off", mode, reason });
  }
}

function startFireResponse({ reason, temperature, gas, tempDelta = 0, mode = "fire", simulated = false }) {
  if (fireProtectionActive) return false;

  const untilMs = Date.now() + FIRE_RESPONSE_SECONDS * 1000;
  fireProtectionActive = true;
  fireSimulationActive = simulated;
  fireResponseUntil = new Date(untilMs);
  autoCoolingActive = false;
  autoFanActive = false;
  autoSprayActive = true;
  autoIrrigationActive = true;
  sensorIrrigationStartedAt = null;
  coolingTargetTemp = null;
  if (coolingTargetTimer) {
    clearTimeout(coolingTargetTimer);
    coolingTargetTimer = null;
  }
  coolingStatus = true;
  fanStatus = false;
  sprayStatus = true;
  irrigationStatus = true;
  buzzerStatus = true;
  setDeviceCountdown(["irrigation", "spray", "buzzer"], FIRE_RESPONSE_SECONDS);

  if (fireResponseTimer) clearTimeout(fireResponseTimer);
  fireResponseTimer = setTimeout(() => {
    stopFireResponse({ mode, reason: "fire_response_timeout" });
  }, FIRE_RESPONSE_SECONDS * 1000);

  db.query("INSERT INTO irrigation_logs (amount,duration) VALUES (1,?)", [FIRE_RESPONSE_SECONDS]);
  logDeviceAction(2, "fire_fan_off", mode);
  logDeviceAction(1, "fire_irrigation_on", mode);
  logDeviceAction(3, "fire_spray_on", mode);
  logDeviceAction(4, "fire_buzzer_on", mode);

  // Khi nghi ngo chay, khong bat quat de tranh day khoi/lua lan nhanh.
  publishDeviceCommand({ device: "fan", state: "off", action: "fire_fan_off", mode, reason });
  publishDeviceCommand({ device: "irrigation", state: "on", action: "fire_irrigation_on", mode, duration: FIRE_RESPONSE_SECONDS, reason });
  publishDeviceCommand({ device: "spray", state: "on", action: "fire_spray_on", mode, duration: FIRE_RESPONSE_SECONDS, reason });
  publishDeviceCommand({ device: "buzzer", state: "on", action: "fire_buzzer_on", mode, duration: FIRE_RESPONSE_SECONDS, reason });

  const message = simulated
    ? `Giả lập PCCC: bật còi báo động, phun nước làm mát và bơm tưới trong ${FIRE_RESPONSE_SECONDS / 3600} giờ`
    : `Cảnh báo cháy: ${reason}. Nhiệt độ ${temperature}°C, khói/khí độc ${gas}, biến động ${tempDelta.toFixed(1)}°C/5 giây. Đã tắt quạt, bật còi báo động, phun nước và bơm tưới trong ${FIRE_RESPONSE_SECONDS / 3600} giờ`;
  createAlert(message, "danger", "fire", true);
  return true;
}

function updateThresholdAlerts(readings, thresholds) {
  // Set activeThresholdAlerts chan viec lap lai cung mot canh bao khi sensor gui lien tuc.
  const checks = [
    {
      key: "temp_low",
      active: Number.isFinite(thresholds.tempMin) && readings.temperature < thresholds.tempMin,
      message: `Nhiệt độ thấp: ${readings.temperature}`,
      level: "warning",
      type: "temp",
    },
    {
      key: "temp_high",
      active: Number.isFinite(thresholds.tempMax) && readings.temperature > thresholds.tempMax,
      message: `Nhiệt độ cao: ${readings.temperature}`,
      level: "danger",
      type: "temp",
    },
    {
      key: "humidity_low",
      active: Number.isFinite(thresholds.humidityMin) && readings.humidity < thresholds.humidityMin,
      message: `Độ ẩm không khí thấp: ${readings.humidity}`,
      level: "warning",
      type: "humidity",
    },
    {
      key: "humidity_high",
      active: Number.isFinite(thresholds.humidityMax) && readings.humidity > thresholds.humidityMax,
      message: `Độ ẩm không khí cao: ${readings.humidity}`,
      level: "warning",
      type: "humidity",
    },
    {
      key: "soil_low",
      active: Number.isFinite(thresholds.soilMin) && readings.soil < thresholds.soilMin,
      message: `Độ ẩm đất thấp: ${readings.soil}`,
      level: "warning",
      type: "soil",
    },
    {
      key: "soil_high",
      active: Number.isFinite(thresholds.soilMax) && readings.soil > thresholds.soilMax,
      message: `Độ ẩm đất cao: ${readings.soil}`,
      level: "warning",
      type: "soil",
    },
    {
      key: "light_high",
      active: Number.isFinite(thresholds.lightMax) && Number.isFinite(readings.light) && readings.light > thresholds.lightMax,
      message: `Ánh sáng cao: ${readings.light} lux`,
      level: "warning",
      type: "light",
    },
    {
      key: "gas_high",
      active: Number.isFinite(thresholds.gasMax) && readings.gas > thresholds.gasMax,
      message: `Khí độc cao: ${readings.gas}`,
      level: "danger",
      type: "gas",
    },
  ];

  const currentActiveKeys = new Set();
  checks.forEach((check) => {
    if (!check.active) return;
    currentActiveKeys.add(check.key);
    if (!activeThresholdAlerts.has(check.key)) {
      activeThresholdAlerts.add(check.key);
      createAlert(check.message, check.level, check.type);
    }
  });

  activeThresholdAlerts.forEach((key) => {
    if (!currentActiveKeys.has(key)) activeThresholdAlerts.delete(key);
  });
}

function stopCooling({ publish = true, mode = "auto", reason = "stop_cooling" } = {}) {
  coolingStatus = false;
  fanStatus = false;
  sprayStatus = false;
  coolingTargetTemp = null;
  autoCoolingActive = false;
  clearDeviceCountdown(["cooling", "fan", "spray"]);
  if (coolingTargetTimer) {
    clearTimeout(coolingTargetTimer);
    coolingTargetTimer = null;
  }
  if (publish) {
    publishDeviceCommand({ device: "fan", state: "off", action: "cooling_off", mode, reason, notify: false });
    publishDeviceCommand({ device: "spray", state: "off", action: "cooling_off", mode, reason, notify: false });
  }
}

function stopAutoCooling() {
  autoCoolingActive = false;
  coolingStatus = false;
  clearDeviceCountdown(["cooling"]);
  if (!autoFanActive) {
    fanStatus = false;
    clearDeviceCountdown(["fan"]);
    publishDeviceCommand({ device: "fan", state: "off", action: "cooling_off", mode: "auto", reason: "temperature_normal", notify: false });
  }
  if (!autoSprayActive) {
    sprayStatus = false;
    clearDeviceCountdown(["spray"]);
    publishDeviceCommand({ device: "spray", state: "off", action: "cooling_off", mode: "auto", reason: "temperature_normal", notify: false });
  }
  coolingTargetTemp = null;
}

function stopAutoDeviceIfRunning(device, reason = "auto_disabled") {
  if (fireProtectionActive && ["irrigation", "spray"].includes(device)) return;

  if (device === "cooling" && autoCoolingActive) {
    stopAutoCooling();
    logCoolingAction("cooling_off", "auto");
    return;
  }

  if (device === "fan" && (autoFanActive || (autoCoolingActive && fanStatus))) {
    autoFanActive = false;
    fanStatus = false;
    clearDeviceCountdown(["fan"]);
    logDeviceAction(2, "auto_fan_off", "auto");
    publishDeviceCommand({ device: "fan", state: "off", action: "auto_fan_off", mode: "auto", reason, notify: false });
    return;
  }

  if (device === "spray" && (autoSprayActive || (autoCoolingActive && sprayStatus))) {
    autoSprayActive = false;
    sprayStatus = false;
    clearDeviceCountdown(["spray"]);
    logDeviceAction(3, "auto_spray_off", "auto");
    publishDeviceCommand({ device: "spray", state: "off", action: "auto_spray_off", mode: "auto", reason, notify: false });
    return;
  }

  if (device === "irrigation" && autoIrrigationActive) {
    const duration = sensorIrrigationStartedAt
      ? Math.max(1, Math.round((Date.now() - sensorIrrigationStartedAt) / 1000))
      : 0;
    sensorIrrigationStartedAt = null;
    autoIrrigationActive = false;
    irrigationStatus = false;
    clearDeviceCountdown(["irrigation"]);
    if (duration > 0) {
      db.query("INSERT INTO irrigation_logs (amount,duration) VALUES (1,?)", [duration]);
    }
    logDeviceAction(1, "auto_irrigation_off", "auto");
    publishDeviceCommand({ device: "irrigation", state: "off", action: "auto_irrigation_off", mode: "auto", reason, notify: false });
  }
}

function startCoolingTargetSafetyTimer(target) {
  // Co gioi han thoi gian de tranh quat/phun nuoc chay mai neu khong dat muc tieu.
  if (coolingTargetTimer) clearTimeout(coolingTargetTimer);

  coolingTargetTimer = setTimeout(() => {
    if (coolingTargetTemp === null) return;
    stopCooling({ mode: "manual", reason: "cooling_target_timeout" });
    logCoolingAction("cooling_target_timeout", "manual");
    createAlert(
      `Đã tự tắt làm mát vì quá ${MAX_COOLING_TARGET_SECONDS / 60} phút chưa đạt ${target}°C`,
      "warning",
      "action"
    );
  }, MAX_COOLING_TARGET_SECONDS * 1000);
}

function startTimedDevice({ duration, onStart, onStop, log, commandOn, commandOff, timerKeys = [] }) {
  // Dung chung cho cac lenh bat thiet bi theo so giay: bat, ghi log, gui MQTT, roi tu tat.
  const seconds = parseDuration(duration);
  onStart();
  if (timerKeys.length > 0) setDeviceCountdown(timerKeys, seconds);
  if (log) {
    db.query("INSERT INTO device_logs (device_id, action, mode) VALUES (?, ?, ?)", log);
  }
  if (commandOn) {
    publishDeviceCommand({ ...commandOn, duration: commandOn.duration ?? seconds });
  }
  setTimeout(() => {
    if (
      fireProtectionActive &&
      commandOff &&
      ["irrigation", "spray", "buzzer"].includes(commandOff.device)
    ) {
      clearDeviceCountdown(timerKeys);
      return;
    }
    onStop();
    clearDeviceCountdown(timerKeys);
    if (commandOff) {
      publishDeviceCommand({ ...commandOff, duration: commandOff.duration ?? seconds });
    }
  }, seconds * 1000);
  return seconds;
}

// MQTT
const client = mqtt.connect(
  "mqtts://d10fcd7af0074059b6861fa801308d26.s1.eu.hivemq.cloud:8883",
  {
    username: "admin",
    password: "Ab123456",
    reconnectPeriod: 5000,
  }
);

client.on("connect", () => {
  mqttConnected = true;
  console.log("Connected to HiveMQ");
  client.subscribe("sensor");
});

client.on("error", (err) => {
  mqttConnected = false;
  console.log("MQTT error:", err.message);
});

client.on("close", () => {
  mqttConnected = false;
});

client.on("offline", () => {
  mqttConnected = false;
});

schemaReady = ensureSchema();

setInterval(() => {
  if (!simulateSensor) return;

  const sensor = {
    source: "simulated",
    ...buildSimulatedSensorReading(),
  };
  client.publish("sensor", JSON.stringify(sensor));
}, 2000);

client.on("message", (topic, message) => {
  let sensor;

  try {
    sensor = JSON.parse(message.toString());
  } catch {
    sensor = {
      temperature: parseInt(message.toString(), 10),
      humidity: 0,
      soil_moisture: 0,
      light: null,
      gas: 0,
      flame: 0,
    };
  }

  const temperature = Number(sensor.temperature) || 0;
  const humidity = Number(sensor.humidity) || 0;
  const soil = Number(sensor.soil_moisture) || 0;
  const light = normalizeLightReading(sensor.light ?? sensor.light_intensity ?? sensor.lux ?? sensor.illuminance);
  const gas = Number(sensor.gas) || 0;
  const flameDetected = parseFlameValue(sensor.flame ?? sensor.flame_detected ?? sensor.fire);
  const receivedAt = new Date();
  const receivedAtMs = receivedAt.getTime();
  lastSensorAt = receivedAt;
  lastSensorSource = sensor.source || "mqtt";
  fireFlameDetected = flameDetected;

  // Tach du lieu live va du lieu luu tru: live phuc vu giao dien, MySQL phuc vu bao cao dai han.
  let level = "normal";
  if (temperature > 30) level = "hot";
  if (gas > 400) level = "danger";
  if (flameDetected) level = "danger";

  rememberLiveSensor({
    id: `live-${receivedAtMs}`,
    temperature,
    humidity,
    soil_moisture: soil,
    light,
    gas,
    flame: flameDetected ? 1 : 0,
    level,
    source: lastSensorSource,
    is_live: true,
    created_at: receivedAt,
  });

  saveSensorToDatabaseIfDue({ temperature, humidity, soil, light, gas, flame: flameDetected, level }, receivedAtMs);

  const fireRisk = analyzeFireRisk(temperature, gas, flameDetected, receivedAtMs);
  if (fireRisk.shouldStartFireResponse) {
    const fireReason = fireRisk.flameDetected
      ? "cảm biến lửa phát hiện ngọn lửa"
      : fireRisk.criticalTemp
        ? `nhiệt độ cao bất thường >= ${FIRE_CRITICAL_TEMP}°C`
        : `phát hiện khói/khí độc và nhiệt độ tăng ${fireRisk.tempDelta.toFixed(1)}°C trong 5 giây`;
    startFireResponse({
      reason: fireReason,
      temperature,
      gas,
      tempDelta: fireRisk.tempDelta,
    });
  }

  if (coolingTargetTemp !== null && temperature <= coolingTargetTemp) {
    const reachedTarget = coolingTargetTemp;
    stopCooling({ mode: "manual", reason: "target_temp_reached" });
    logCoolingAction("cooling_target_reached", "manual");
    createAlert(`Đã đạt nhiệt độ mục tiêu ${reachedTarget}°C, tự tắt làm mát`, "info", "action");
  }

  db.query(
    "SELECT * FROM thresholds WHERE plant_id = ? ORDER BY id DESC LIMIT 1",
    [mainPlantId],
    (err, result) => {
      if (err) return;

      const th = result?.[0] || {};
      const tempMin = parseOptionalNumber(th.temp_min);
      const tempMax = parseOptionalNumber(th.temp_max);
      const humidityMin = parseOptionalNumber(th.humidity_min);
      const humidityMax = parseOptionalNumber(th.humidity_max);
      const soilMin = parseOptionalNumber(th.soil_min);
      const soilMax = parseOptionalNumber(th.soil_max);
      const lightMax = normalizeLightMaxThreshold(th.light_max);

      updateThresholdAlerts(
        { temperature, humidity, soil, light, gas },
        { tempMin, tempMax, humidityMin, humidityMax, soilMin, soilMax, lightMax, gasMax: GAS_DANGER_THRESHOLD }
      );
      if (fireProtectionActive) return;

      const tempReturnPoint =
        Number.isFinite(tempMin) && Number.isFinite(tempMax) ? (tempMin + tempMax) / 2 : tempMax;
      const airQualityFanNeeded =
        (Number.isFinite(humidityMax) && humidity > humidityMax) || gas > GAS_DANGER_THRESHOLD;
      const humiditySprayNeeded =
        Number.isFinite(humidityMin) && Number.isFinite(humidity) && humidity < humidityMin;
      const sensorIrrigationNeeded =
        autoIrrigationMode === "sensor" &&
        Number.isFinite(soilMin) &&
        Number.isFinite(soil) &&
        soil < soilMin;

      // Nhiet do vuot nguong thi tu bat lam mat va giu den khi ve diem giua cua nguong.
      if (Number.isFinite(tempMax) && temperature > tempMax && !autoCoolingActive && !autoDisabled.cooling) {
        const coolingDevices = [
          !autoDisabled.fan ? "quạt" : null,
          !autoDisabled.spray ? "phun nước" : null,
        ].filter(Boolean).join(" và ");

        autoCoolingActive = true;
        coolingStatus = true;
        if (!autoDisabled.fan) fanStatus = true;
        if (!autoDisabled.spray) sprayStatus = true;

        logCoolingAction("cooling_on", "auto");
        if (!autoDisabled.fan) {
          publishDeviceCommand({ device: "fan", state: "on", action: "cooling_on", mode: "auto", reason: "temperature_high", notify: false });
        }
        if (!autoDisabled.spray) {
          publishDeviceCommand({ device: "spray", state: "on", action: "cooling_on", mode: "auto", reason: "temperature_high", notify: false });
        }
        createAlert(
          `Tự động bật ${coolingDevices || "làm mát"} do nhiệt độ ${temperature} vượt ngưỡng`,
          "info",
          "action"
        );
      }

      if (
        autoCoolingActive &&
        coolingTargetTemp === null &&
        Number.isFinite(tempReturnPoint) &&
        temperature <= tempReturnPoint
      ) {
        stopAutoCooling();
        logCoolingAction("cooling_off", "auto");
        createAlert(`Tự động tắt làm mát vì nhiệt độ đã về ${temperature}`, "info", "action");
      }

      // Khoa auto theo tung thiet bi: tat auto phun thi do am thap khong tu bat phun.
      if (humiditySprayNeeded && !autoSprayActive && !autoDisabled.spray) {
        autoSprayActive = true;
        sprayStatus = true;
        clearDeviceCountdown(["spray"]);
        logDeviceAction(3, "humidity_spray_on", "auto");
        publishDeviceCommand({ device: "spray", state: "on", action: "humidity_spray_on", mode: "auto", reason: "humidity_low", notify: false });
        createAlert(`Tự động bật phun nước do độ ẩm không khí ${humidity} thấp`, "info", "action");
      }

      if (autoSprayActive && (!humiditySprayNeeded || autoDisabled.spray) && !fireProtectionActive) {
        autoSprayActive = false;
        clearDeviceCountdown(["spray"]);
        logDeviceAction(3, "humidity_spray_off", "auto");
        if (!autoCoolingActive) {
          sprayStatus = false;
          publishDeviceCommand({
            device: "spray",
            state: "off",
            action: "humidity_spray_off",
            mode: "auto",
            reason: autoDisabled.spray ? "auto_disabled" : "humidity_normal",
            notify: false,
          });
          createAlert("Tự động tắt phun nước vì độ ẩm không khí đã về bình thường", "info", "action");
        }
      }

      // Do am khong khi cao hoac khi doc cao thi bat quat den khi chi so ve binh thuong.
      if (airQualityFanNeeded && !autoFanActive && !autoDisabled.fan) {
        const reason = gas > GAS_DANGER_THRESHOLD ? `khí độc ${gas} cao` : `độ ẩm không khí ${humidity} cao`;
        autoFanActive = true;
        fanStatus = true;
        logDeviceAction(2, "air_quality_fan_on", "auto");
        publishDeviceCommand({ device: "fan", state: "on", action: "air_quality_fan_on", mode: "auto", reason, notify: false });
        createAlert(`Tự động bật quạt do ${reason}`, "info", "action");
      }

      if (autoFanActive && !airQualityFanNeeded && !autoCoolingActive) {
        autoFanActive = false;
        fanStatus = false;
        logDeviceAction(2, "air_quality_fan_off", "auto");
        publishDeviceCommand({ device: "fan", state: "off", action: "air_quality_fan_off", mode: "auto", reason: "air_quality_normal", notify: false });
        createAlert("Tự động tắt quạt vì độ ẩm/không khí đã về bình thường", "info", "action");
      }

      // Khoa auto tuoi: do am dat thap khong tu bat bom tuoi neu nguoi dung da tat.
      if (
        autoIrrigationMode === "sensor" &&
        sensorIrrigationNeeded &&
        !autoIrrigationActive &&
        !autoDisabled.irrigation
      ) {
        autoIrrigationActive = true;
        irrigationStatus = true;
        sensorIrrigationStartedAt = Date.now();
        clearDeviceCountdown(["irrigation"]);
        logDeviceAction(1, "soil_irrigation_on", "auto");
        publishDeviceCommand({ device: "irrigation", state: "on", action: "soil_irrigation_on", mode: "auto", reason: "soil_low", notify: false });
        createAlert(`Tự động tưới vì độ ẩm đất ${soil} thấp`, "info", "action");
      }

      if (
        autoIrrigationMode === "sensor" &&
        autoIrrigationActive &&
        (!sensorIrrigationNeeded || autoDisabled.irrigation) &&
        !fireProtectionActive
      ) {
        const duration = sensorIrrigationStartedAt
          ? Math.max(1, Math.round((Date.now() - sensorIrrigationStartedAt) / 1000))
          : 0;
        sensorIrrigationStartedAt = null;
        autoIrrigationActive = false;
        irrigationStatus = false;
        clearDeviceCountdown(["irrigation"]);
        if (duration > 0) {
          db.query("INSERT INTO irrigation_logs (amount,duration) VALUES (1,?)", [duration]);
        }
        logDeviceAction(1, "soil_irrigation_off", "auto");
        publishDeviceCommand({
          device: "irrigation",
          state: "off",
          action: "soil_irrigation_off",
          mode: "auto",
          reason: autoDisabled.irrigation ? "auto_disabled" : "soil_normal",
          notify: false,
        });
        createAlert("Tự động tắt bơm tưới vì độ ẩm đất đã về bình thường", "info", "action");
      }
    }
  );
});

// REGISTER
app.post("/register", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: "Vui lòng nhập đầy đủ thông tin" });
  }

  runQuery(res, async () => {
    const existing = await query("SELECT * FROM users WHERE email=?", [email]);
    if (existing.length > 0) {
      return res.json({ message: "Email đã tồn tại" });
    }

    await query("INSERT INTO users (name,email,password) VALUES (?,?,?)", [
      name,
      email,
      password,
    ]);
    res.json({ message: "Đăng ký thành công" });
  });
});

// LOGIN
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  runQuery(res, async () => {
    const rows = await query("SELECT * FROM users WHERE email=? AND password=?", [
      email,
      password,
    ]);

    if (rows.length === 0) {
      return res.json({ message: "Sai tài khoản hoặc mật khẩu" });
    }

    res.cookie("sg_token", "123456", { sameSite: "lax" });
    res.json({
      message: "OK",
      user: rows[0],
      token: "123456",
    });
  });
});

app.get("/plants/:id/image", servePlantImage);

app.use(requireAuth);

app.get("/alert-stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  res.write(": connected\n\n");

  alertClients.add(res);
  req.on("close", () => {
    alertClients.delete(res);
  });
});

// GARDENS
app.get("/gardens", (req, res) => {
  runQuery(res, async () => {
    const rows = await query("SELECT * FROM gardens ORDER BY id DESC");
    res.json(rows);
  });
});

app.post("/gardens", (req, res) => {
  const { name, location, user_id, device_info } = req.body;
  runQuery(res, async () => {
    await query("INSERT INTO gardens (name, location, user_id, device_info) VALUES (?, ?, ?, ?)", [
      name,
      location,
      user_id || 1,
      device_info || null,
    ]);
    res.json({ message: "Đã thêm vườn" });
  });
});

app.put("/gardens/:id", (req, res) => {
  const { name, location, user_id, device_info } = req.body;
  runQuery(res, async () => {
    const current = await query("SELECT * FROM gardens WHERE id=?", [req.params.id]);
    if (current.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy vườn" });
    }

    await query("UPDATE gardens SET name=?, location=?, user_id=?, device_info=? WHERE id=?", [
      name || current[0].name,
      location || current[0].location,
      user_id || current[0].user_id,
      device_info ?? current[0].device_info,
      req.params.id,
    ]);
    res.json({ message: "Đã cập nhật vườn" });
  });
});

app.delete("/gardens/:id", (req, res) => {
  runQuery(res, async () => {
    await query("DELETE FROM gardens WHERE id=?", [req.params.id]);
    res.json({ message: "Đã xóa vườn" });
  });
});

// DEVICE INVENTORY
app.get("/devices", (req, res) => {
  runQuery(res, async () => {
    const rows = await query(`
      SELECT d.*, g.name AS garden_name
      FROM devices d
      LEFT JOIN gardens g ON g.id = d.garden_id
      ORDER BY d.id DESC
    `);
    res.json(rows);
  });
});

app.post("/devices", (req, res) => {
  const { name, device_type, garden_id, status, mqtt_topic, note } = req.body;
  runQuery(res, async () => {
    await query(
      `INSERT INTO devices (name, device_type, garden_id, status, mqtt_topic, note)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name || null,
        device_type || null,
        garden_id || null,
        status || "offline",
        mqtt_topic || null,
        note || null,
      ]
    );
    res.json({ message: "Đã thêm thiết bị" });
  });
});

app.put("/devices/:id", (req, res) => {
  const { name, device_type, garden_id, status, mqtt_topic, note } = req.body;
  runQuery(res, async () => {
    const current = await query("SELECT * FROM devices WHERE id=?", [req.params.id]);
    if (current.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy thiết bị" });
    }

    await query(
      `UPDATE devices
      SET name=?, device_type=?, garden_id=?, status=?, mqtt_topic=?, note=?
      WHERE id=?`,
      [
        name || current[0].name,
        device_type || current[0].device_type,
        garden_id || current[0].garden_id,
        status || current[0].status,
        mqtt_topic ?? current[0].mqtt_topic,
        note ?? current[0].note,
        req.params.id,
      ]
    );
    res.json({ message: "Đã cập nhật thiết bị" });
  });
});

app.delete("/devices/:id", (req, res) => {
  runQuery(res, async () => {
    await query("DELETE FROM devices WHERE id=?", [req.params.id]);
    res.json({ message: "Đã xóa thiết bị" });
  });
});

// PLANTS
app.get("/plants", (req, res) => {
  runQuery(res, async () => {
    const rows = await getPlantsWithThresholds();
    res.json(rows);
  });
});

app.post("/plants", upload.single("image"), (req, res) => {
  const { name, garden_id } = req.body;
  runQuery(res, async () => {
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
    const imageFile = await readPlantImageFile(req.file);
    const idealSoil = idealSoilParams(req.body);
    const result = await query(
      `INSERT INTO plants
      (name, garden_id, image_path, image_data, image_mime, image_updated_at,
        description, soil_ph, soil_type, soil_looseness, soil_drainage, soil_note,
        watering_time, watering_duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        garden_id,
        imagePath,
        imageFile?.data || null,
        imageFile?.mime || null,
        imageFile ? new Date() : null,
        parseOptionalText(req.body.description),
        ...idealSoil,
        normalizeTimeValue(req.body.watering_time),
        parseOptionalNumber(req.body.watering_duration),
      ]
    );

    await insertThreshold(result.insertId, req.body);

    res.json({ message: "Đã thêm cây trồng", id: result.insertId, image_path: imagePath });
  });
});

app.post("/plants/:id/main", (req, res) => {
  runQuery(res, async () => {
    mainPlantId = Number(req.params.id) || 1;
    await query("UPDATE plants SET is_main=0");
    await query("UPDATE plants SET is_main=1 WHERE id=?", [mainPlantId]);
    res.json({ message: "Đã chọn cây chính" });
  });
});

app.put("/plants/:id", upload.single("image"), (req, res) => {
  const { name, garden_id } = req.body;
  runQuery(res, async () => {
    const current = await query("SELECT id, name, garden_id, image_path FROM plants WHERE id=?", [req.params.id]);
    if (current.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy cây trồng" });
    }

    const imagePath = req.file ? `/uploads/${req.file.filename}` : current[0].image_path;
    const imageFile = await readPlantImageFile(req.file);
    const idealSoil = idealSoilParams(req.body);

    if (imageFile) {
      await query(
        `UPDATE plants
        SET name=?, garden_id=?, image_path=?, image_data=?, image_mime=?, image_updated_at=NOW(),
          description=?, soil_ph=?, soil_type=?, soil_looseness=?, soil_drainage=?, soil_note=?,
          watering_time=?, watering_duration=?
        WHERE id=?`,
        [
          name || current[0].name,
          garden_id || current[0].garden_id,
          imagePath,
          imageFile.data,
          imageFile.mime,
          parseOptionalText(req.body.description),
          ...idealSoil,
          normalizeTimeValue(req.body.watering_time),
          parseOptionalNumber(req.body.watering_duration),
          req.params.id,
        ]
      );
    } else {
      await query(
        `UPDATE plants
        SET name=?, garden_id=?, image_path=?, description=?,
          soil_ph=?, soil_type=?, soil_looseness=?, soil_drainage=?, soil_note=?,
          watering_time=?, watering_duration=?
        WHERE id=?`,
        [
          name || current[0].name,
          garden_id || current[0].garden_id,
          imagePath,
          parseOptionalText(req.body.description),
          ...idealSoil,
          normalizeTimeValue(req.body.watering_time),
          parseOptionalNumber(req.body.watering_duration),
          req.params.id,
        ]
      );
    }
    if (req.file && current[0].image_path && current[0].image_path !== imagePath) {
      deleteUploadedImage(current[0].image_path);
    }
    await insertThreshold(req.params.id, req.body);
    res.json({ message: "Đã cập nhật cây trồng", id: Number(req.params.id), image_path: imagePath });
  });
});

app.delete("/plants/:id", (req, res) => {
  runQuery(res, async () => {
    const current = await query("SELECT * FROM plants WHERE id=?", [req.params.id]);
    const isDeletingMain = Number(req.params.id) === Number(mainPlantId);
    await query("DELETE FROM thresholds WHERE plant_id=?", [req.params.id]);
    await query("DELETE FROM plants WHERE id=?", [req.params.id]);
    if (current[0]?.image_path) {
      deleteUploadedImage(current[0].image_path);
    }
    if (isDeletingMain) {
      const nextPlant = await query("SELECT id FROM plants ORDER BY id LIMIT 1");
      if (nextPlant.length > 0) {
        mainPlantId = nextPlant[0].id;
        await query("UPDATE plants SET is_main=0");
        await query("UPDATE plants SET is_main=1 WHERE id=?", [mainPlantId]);
      }
    }
    res.json({ message: "Đã xóa cây trồng" });
  });
});

// DEVICES
app.post("/irrigation", (req, res) => {
  const seconds = startTimedDevice({
    duration: req.body.duration,
    onStart: () => {
      irrigationStatus = true;
    },
    onStop: () => {
      irrigationStatus = false;
    },
    log: [1, "irrigation_on", "manual"],
    commandOn: { device: "irrigation", state: "on", action: "irrigation_on", mode: "manual" },
    commandOff: { device: "irrigation", state: "off", action: "irrigation_off", mode: "manual", reason: "timer_finished" },
    timerKeys: ["irrigation"],
  });
  db.query("INSERT INTO irrigation_logs (amount,duration) VALUES (1,?)", [seconds]);
  res.json({ message: `Đã tưới ${seconds} giây` });
});

app.post("/fan-timer", (req, res) => {
  const seconds = startTimedDevice({
    duration: req.body.duration,
    onStart: () => {
      fanStatus = true;
    },
    onStop: () => {
      fanStatus = false;
    },
    log: [2, "fan_on", "manual"],
    commandOn: { device: "fan", state: "on", action: "fan_on", mode: "manual" },
    commandOff: { device: "fan", state: "off", action: "fan_off", mode: "manual", reason: "timer_finished" },
    timerKeys: ["fan"],
  });
  res.json({ message: `Đã bật quạt ${seconds} giây` });
});

app.post("/spray-timer", (req, res) => {
  const seconds = startTimedDevice({
    duration: req.body.duration,
    onStart: () => {
      sprayStatus = true;
    },
    onStop: () => {
      sprayStatus = false;
    },
    log: [3, "spray_on", "manual"],
    commandOn: { device: "spray", state: "on", action: "spray_on", mode: "manual" },
    commandOff: { device: "spray", state: "off", action: "spray_off", mode: "manual", reason: "timer_finished" },
    timerKeys: ["spray"],
  });
  res.json({ message: `Đã phun nước ${seconds} giây` });
});

app.post("/cooling-timer", (req, res) => {
  const seconds = startTimedDevice({
    duration: req.body.duration,
    onStart: () => {
      coolingStatus = true;
      fanStatus = true;
      sprayStatus = true;
    },
    onStop: () => stopCooling({ publish: false }),
    log: [2, "cooling_on", "manual"],
    commandOn: { device: "fan", state: "on", action: "cooling_on", mode: "manual", notify: false },
    commandOff: { device: "fan", state: "off", action: "cooling_off", mode: "manual", reason: "timer_finished", notify: false },
    timerKeys: ["cooling", "fan", "spray"],
  });
  logDeviceAction(3, "cooling_on", "manual");
    publishDeviceCommand({ device: "spray", state: "on", action: "cooling_on", mode: "manual", duration: seconds, notify: false });
    createAlert(`Bật làm mát trong ${seconds} giây`, "info", "hardware", true);
    setTimeout(() => {
      logCoolingAction("cooling_off", "manual");
      clearDeviceCountdown(["spray"]);
      publishDeviceCommand({ device: "spray", state: "off", action: "cooling_off", mode: "manual", reason: "timer_finished", notify: false });
      createAlert("Tắt làm mát", "info", "hardware", true);
    }, seconds * 1000);
  res.json({ message: `Đã làm mát ${seconds} giây` });
});

app.post("/cooling-target", (req, res) => {
  const target = Number(req.body.target_temp);
  if (!Number.isFinite(target)) {
    return res.status(400).json({ message: "Nhiệt độ mục tiêu không hợp lệ" });
  }

  runQuery(res, async () => {
    const [latestRows, plant] = await Promise.all([
      query("SELECT temperature FROM sensor_data ORDER BY id DESC LIMIT 1"),
      getMainPlant(),
    ]);
    const currentTemp = parseOptionalNumber(latestSensorReading?.temperature ?? latestRows[0]?.temperature);
    const tempMin = parseOptionalNumber(plant?.temp_min);
    const tempMax = parseOptionalNumber(plant?.temp_max);

    // Khong cho dat muc tieu vo ly de he thong lam mat khong bi chay lien tuc.
    if (Number.isFinite(currentTemp) && target >= currentTemp) {
      return res.status(400).json({
        message: `Nhiệt độ mục tiêu phải thấp hơn nhiệt độ hiện tại (${currentTemp}°C)`,
      });
    }

    if (Number.isFinite(tempMin) && target < tempMin) {
      return res.status(400).json({
        message: `Không đặt mục tiêu thấp hơn nhiệt độ tối thiểu của cây chính (${tempMin}°C)`,
      });
    }

    if (Number.isFinite(tempMax) && target > tempMax) {
      return res.status(400).json({
        message: `Mục tiêu nên nằm trong ngưỡng cây chính, tối đa ${tempMax}°C`,
      });
    }

    coolingTargetTemp = target;
    coolingStatus = true;
    fanStatus = true;
    sprayStatus = true;
    setDeviceCountdown(["cooling", "fan", "spray"], MAX_COOLING_TARGET_SECONDS);
    logCoolingAction("cooling_target_on", "manual");
    publishDeviceCommand({ device: "fan", state: "on", action: "cooling_target_on", mode: "manual", extra: { target_temp: target }, notify: false });
    publishDeviceCommand({ device: "spray", state: "on", action: "cooling_target_on", mode: "manual", extra: { target_temp: target }, notify: false });
    createAlert(`Bật làm mát đến ${target}°C`, "info", "hardware", true);
    startCoolingTargetSafetyTimer(target);
    res.json({
      message: `Đang làm mát đến ${target}°C, tự tắt nếu quá ${MAX_COOLING_TARGET_SECONDS / 60} phút chưa đạt`,
    });
  });
});

app.post("/emergency", (req, res) => {
  emergencyActive = false;
  autoCoolingActive = false;
  autoFanActive = false;
  autoSprayActive = false;
  autoIrrigationActive = false;
  sensorIrrigationStartedAt = null;
  coolingTargetTemp = null;
  if (coolingTargetTimer) {
    clearTimeout(coolingTargetTimer);
    coolingTargetTimer = null;
  }
  if (fireResponseTimer) {
    clearTimeout(fireResponseTimer);
    fireResponseTimer = null;
  }
  fireProtectionActive = false;
  fireSimulationActive = false;
  fireResponseUntil = null;
  fireSuppressedUntilMs = Date.now() + 15000;
  recentFireSamples.length = 0;
  clearAllDeviceCountdowns();

  irrigationStatus = false;
  fanStatus = false;
  sprayStatus = false;
  buzzerStatus = false;
  coolingStatus = false;

  Object.keys(autoDisabled).forEach((device) => {
    autoDisabled[device] = true;
  });

  const state = "off";
  const action = "emergency_stop";
  const mode = "emergency";
  const devices = [
    { id: 1, device: "irrigation" },
    { id: 2, device: "fan" },
    { id: 3, device: "spray" },
    { id: 4, device: "buzzer" },
  ];

  devices.forEach(({ id, device }) => {
    logDeviceAction(id, action, mode);
    publishDeviceCommand({ device, state, action, mode, reason: "manual_emergency" });
  });

  createAlert(
    "Dừng khẩn cấp: đã tắt bơm tưới, quạt, phun mát và còi",
    "info",
    "action",
    true
  );

  res.json({
    message: "Đã dừng khẩn cấp: tắt bơm tưới, quạt, phun mát và còi",
    emergencyActive,
    autoDisabled,
    status: { irrigationStatus, fanStatus, sprayStatus, buzzerStatus, coolingStatus },
  });
});

app.post("/auto-device/all", (req, res) => {
  const disabled = Boolean(req.body.disabled);
  Object.keys(autoDisabled).forEach((device) => {
    autoDisabled[device] = disabled;
    if (disabled) stopAutoDeviceIfRunning(device);
  });

  res.json({
    message: disabled ? "Đã tắt chức năng tự động" : "Đã bật lại chức năng tự động",
    autoDisabled,
  });
});

app.post("/auto-irrigation-mode", (req, res) => {
  const mode = String(req.body.mode || "").toLowerCase();
  if (!["sensor", "schedule"].includes(mode)) {
    return res.status(400).json({ message: "Chế độ tưới không hợp lệ" });
  }

  autoIrrigationMode = mode;
  if (autoIrrigationActive) {
    autoIrrigationActive = false;
    sensorIrrigationStartedAt = null;
    irrigationStatus = false;
    clearDeviceCountdown(["irrigation"]);
    publishDeviceCommand({
      device: "irrigation",
      state: "off",
      action: "auto_irrigation_mode_changed",
      mode: "auto",
      reason: `switch_to_${mode}`,
    });
  }

  res.json({
    message: mode === "sensor" ? "Đã chọn tưới tự động theo cảm biến" : "Đã chọn tưới theo lịch",
    autoIrrigationMode,
  });
});

app.post("/auto-device/:device", (req, res) => {
  const device = req.params.device;
  if (!Object.prototype.hasOwnProperty.call(autoDisabled, device)) {
    return res.status(400).json({ message: "Thiết bị không hợp lệ" });
  }

  // disabled=true nghia la auto khong duoc phep tu bat thiet bi nay.
  autoDisabled[device] = Boolean(req.body.disabled);
  if (autoDisabled[device]) stopAutoDeviceIfRunning(device);
  res.json({
    message: autoDisabled[device] ? "Đã tắt tự động cho thiết bị" : "Đã bật lại tự động cho thiết bị",
    autoDisabled,
  });
});

// AUTO IRRIGATION
app.get("/auto-irrigation", (req, res) => {
  runQuery(res, async () => {
    const rows = await query(`
      SELECT a.*, p.name AS plant_name
      FROM auto_settings a
      LEFT JOIN plants p ON p.id = a.plant_id
      ORDER BY a.is_active DESC, a.irrigation_time ASC, a.id DESC
    `);
    res.json(rows);
  });
});

app.post("/auto-irrigation", (req, res) => {
  const { plant_id, irrigation_time, irrigation_duration, day_mask } = req.body;

  runQuery(res, async () => {
    if (!irrigation_time) {
      return res.status(400).json({ message: "Vui lòng chọn giờ tưới" });
    }

    await query(
      `INSERT INTO auto_settings
      (plant_id, auto_mode, irrigation_time, irrigation_duration, is_active, day_mask)
      VALUES (?, 1, ?, ?, 1, ?)`,
      [
        plant_id || mainPlantId,
        irrigation_time,
        parseDuration(irrigation_duration),
        String(day_mask || "1111111").slice(0, 7),
      ]
    );
    res.json({ message: "Đã lưu lịch tưới tự động" });
  });
});

app.put("/auto-irrigation/:id", (req, res) => {
  const { plant_id, irrigation_time, irrigation_duration, day_mask } = req.body;

  runQuery(res, async () => {
    if (!irrigation_time) {
      return res.status(400).json({ message: "Vui lòng chọn giờ tưới" });
    }

    const current = await query("SELECT * FROM auto_settings WHERE id=?", [req.params.id]);
    if (current.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy lịch tưới" });
    }

    await query(
      `UPDATE auto_settings
      SET plant_id=?, irrigation_time=?, irrigation_duration=?, day_mask=?
      WHERE id=?`,
      [
        plant_id || current[0].plant_id || mainPlantId,
        irrigation_time,
        parseDuration(irrigation_duration),
        String(day_mask || current[0].day_mask || "1111111").slice(0, 7),
        req.params.id,
      ]
    );
    // Xoa dau vet lan chay cu de lich vua sua co the kich hoat dung theo gio moi.
    clearAutoScheduleRunCache(req.params.id);
    res.json({ message: "Đã cập nhật giờ tưới tự động" });
  });
});

app.put("/auto-irrigation/:id/toggle", (req, res) => {
  runQuery(res, async () => {
    await query("UPDATE auto_settings SET is_active=? WHERE id=?", [
      Boolean(req.body.is_active) ? 1 : 0,
      req.params.id,
    ]);
    clearAutoScheduleRunCache(req.params.id);
    res.json({ message: "Đã cập nhật trạng thái lịch tưới" });
  });
});

app.delete("/auto-irrigation/:id", (req, res) => {
  runQuery(res, async () => {
    await query("DELETE FROM auto_settings WHERE id=?", [req.params.id]);
    clearAutoScheduleRunCache(req.params.id);
    res.json({ message: "Đã xóa lịch tưới tự động" });
  });
});

setInterval(() => {
  // Quet lich moi 1 giay de bom bat gan nhu ngay khi den phut tuoi.
  // runKey dam bao moi lich chi chay 1 lan trong dung phut do.
  const now = new Date();
  const dateKey =
    now.getFullYear().toString() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0");
  const time =
    now.getHours().toString().padStart(2, "0") +
    ":" +
    now.getMinutes().toString().padStart(2, "0") +
    ":00";

  db.query("SELECT * FROM auto_settings WHERE is_active=1", (err, result) => {
    if (err || !result || result.length === 0) return;

    result.forEach((row) => {
      const scheduleTime = String(row.irrigation_time || "").slice(0, 8);
      const runKey = `${row.id}-${dateKey}-${time}`;
      if (
        autoIrrigationMode === "schedule" &&
        scheduleTime === time &&
        !lastAutoScheduleRuns.has(runKey) &&
        scheduleRunsToday(row, now) &&
        !autoDisabled.irrigation
      ) {
        lastAutoScheduleRuns.set(runKey, true);
        const seconds = parseDuration(row.irrigation_duration);
        autoIrrigationActive = true;
        irrigationStatus = true;
        setDeviceCountdown(["irrigation"], seconds);
        db.query("INSERT INTO irrigation_logs (amount,duration) VALUES (1,?)", [seconds]);
        publishDeviceCommand({ device: "irrigation", state: "on", action: "schedule_irrigation_on", mode: "auto", duration: seconds, reason: "schedule", notify: false });
        createAlert(`Tự động tưới theo lịch lúc ${time} trong ${seconds} giây`, "info", "action");
        setTimeout(() => {
          if (fireProtectionActive) return;
          autoIrrigationActive = false;
          irrigationStatus = false;
          clearDeviceCountdown(["irrigation"]);
          publishDeviceCommand({ device: "irrigation", state: "off", action: "schedule_irrigation_off", mode: "auto", reason: "timer_finished" });
        }, seconds * 1000);
      }
    });
  });
}, AUTO_SCHEDULE_CHECK_INTERVAL_MS);

// FERTILIZERS
app.get("/fertilizers", (req, res) => {
  runQuery(res, async () => {
    const rows = await query(
      `SELECT
        f.id,
        f.plant_id,
        p.name AS plant_name,
        COALESCE(f.type, f.name) AS type,
        f.method,
        COALESCE(f.quantity, f.amount) AS quantity,
        f.note,
        f.created_at
      FROM fertilizers f
      LEFT JOIN plants p ON p.id = f.plant_id
      ORDER BY f.created_at DESC, f.id DESC`
    );
    res.json(rows);
  });
});

app.post("/fertilizers", (req, res) => {
  const { plant_id, type, method, quantity, note } = req.body;
  if (!plant_id) {
    return res.status(400).json({ message: "Vui lòng chọn cây trồng" });
  }

  runQuery(res, async () => {
    const amount = parseOptionalNumber(quantity);

    // Khi thêm mới, NOW() giúp lưu đúng thời điểm bón phân vào lịch sử báo cáo.
    const result = await query(
      `INSERT INTO fertilizers
      (plant_id, name, amount, type, method, quantity, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        plant_id || null,
        type || method || `Plant ${plant_id || ""}`.trim(),
        amount,
        type || null,
        method || null,
        quantity || null,
        note || null,
      ]
    );
    res.json({ message: "Đã thêm thông tin bón phân", id: result.insertId });
  });
});

app.put("/fertilizers/:id", (req, res) => {
  const { plant_id, type, method, quantity, note } = req.body;
  if (!plant_id) {
    return res.status(400).json({ message: "Vui lòng chọn cây trồng" });
  }

  runQuery(res, async () => {
    const current = await query("SELECT * FROM fertilizers WHERE id=?", [req.params.id]);
    if (current.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy thông tin bón phân" });
    }

    await query(`UPDATE fertilizers
      SET plant_id=?, name=?, amount=?, type=?, method=?, quantity=?, note=?
      WHERE id=?`, [
      plant_id || current[0].plant_id,
      type || method || current[0].name,
      parseOptionalNumber(quantity),
      type || null,
      method || null,
      quantity || null,
      note || null,
      req.params.id,
    ]);
    res.json({ message: "Đã cập nhật bón phân" });
  });
});

app.delete("/fertilizers/:id", (req, res) => {
  runQuery(res, async () => {
    await query("DELETE FROM fertilizers WHERE id=?", [req.params.id]);
    res.json({ message: "Đã xóa bón phân" });
  });
});

// SOIL RECORDS
app.get("/soil-records", (req, res) => {
  runQuery(res, async () => {
    const rows = await query(
      `SELECT
        s.id,
        s.plant_id,
        s.garden_id,
        p.name AS plant_name,
        g.name AS garden_name,
        s.soil_ph,
        s.soil_type,
        s.soil_looseness,
        s.soil_drainage,
        s.note,
        s.created_at
      FROM soil_records s
      LEFT JOIN plants p ON p.id = s.plant_id
      LEFT JOIN gardens g ON g.id = s.garden_id
      ORDER BY s.created_at DESC, s.id DESC`
    );
    res.json(rows);
  });
});

app.post("/soil-records", (req, res) => {
  const [gardenId, soilPh, soilType, soilLooseness, soilDrainage, note] = soilRecordParams(req.body);
  if (!gardenId) {
    return res.status(400).json({ message: "Vui lòng chọn vườn" });
  }

  if (
    !Number.isFinite(soilPh) &&
    !soilType &&
    !soilLooseness &&
    !soilDrainage &&
    !note
  ) {
    return res.status(400).json({ message: "Vui lòng nhập ít nhất một thông tin đất" });
  }
  if (Number.isFinite(soilPh) && (soilPh < 0 || soilPh > 14)) {
    return res.status(400).json({ message: "Độ pH đất phải nằm trong khoảng 0-14" });
  }

  runQuery(res, async () => {
    const result = await query(
      `INSERT INTO soil_records
      (garden_id, plant_id, soil_ph, soil_type, soil_looseness, soil_drainage, note, created_at)
      VALUES (?, NULL, ?, ?, ?, ?, ?, NOW())`,
      [gardenId, soilPh, soilType, soilLooseness, soilDrainage, note]
    );
    res.json({ message: "Đã thêm thông tin đất", id: result.insertId });
  });
});

app.put("/soil-records/:id", (req, res) => {
  const [gardenId, soilPh, soilType, soilLooseness, soilDrainage, note] = soilRecordParams(req.body);
  if (!gardenId) {
    return res.status(400).json({ message: "Vui lòng chọn vườn" });
  }

  if (
    !Number.isFinite(soilPh) &&
    !soilType &&
    !soilLooseness &&
    !soilDrainage &&
    !note
  ) {
    return res.status(400).json({ message: "Vui lòng nhập ít nhất một thông tin đất" });
  }
  if (Number.isFinite(soilPh) && (soilPh < 0 || soilPh > 14)) {
    return res.status(400).json({ message: "Độ pH đất phải nằm trong khoảng 0-14" });
  }

  runQuery(res, async () => {
    const current = await query("SELECT * FROM soil_records WHERE id=?", [req.params.id]);
    if (current.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy thông tin đất" });
    }

    await query(
      `UPDATE soil_records
      SET garden_id=?, plant_id=NULL, soil_ph=?, soil_type=?, soil_looseness=?, soil_drainage=?, note=?
      WHERE id=?`,
      [gardenId, soilPh, soilType, soilLooseness, soilDrainage, note, req.params.id]
    );
    res.json({ message: "Đã cập nhật thông tin đất" });
  });
});

app.delete("/soil-records/:id", (req, res) => {
  runQuery(res, async () => {
    await query("DELETE FROM soil_records WHERE id=?", [req.params.id]);
    res.json({ message: "Đã xóa thông tin đất" });
  });
});

// REPORTS
app.get("/alerts", (req, res) => {
  runQuery(res, async () => {
    const rows = await query("SELECT * FROM alerts ORDER BY id DESC LIMIT 100");
    res.json(rows.filter((alertRow) => !isPcccCommandAlert(alertRow)));
  });
});

app.post("/alerts/:id/ack", (req, res) => {
  runQuery(res, async () => {
    await query(
      "UPDATE alerts SET is_acknowledged=1, acknowledged_at=NOW() WHERE id=?",
      [req.params.id]
    );
    res.json({ message: "Đã xác nhận cảnh báo" });
  });
});

app.post("/alerts/mute", (req, res) => {
  runQuery(res, async () => {
    alertMuted = Boolean(req.body.muted);
    await saveSystemSetting("alert_muted", alertMuted ? "1" : "0");
    await acknowledgeAllUnreadAlerts();

    res.json({
      message: alertMuted ? "Đã tắt cảnh báo" : "Đã bật lại cảnh báo",
      alertMuted,
    });
  });
});

app.get("/alert-settings", (req, res) => {
  runQuery(res, async () => {
    res.json(alertSettingsResponse());
  });
});

app.post("/alert-settings", (req, res) => {
  runQuery(res, async () => {
    const incoming = req.body.preferences || req.body;

    if (Object.prototype.hasOwnProperty.call(req.body, "muted")) {
      alertMuted = toSettingBoolean(req.body.muted, alertMuted);
      await saveSystemSetting("alert_muted", alertMuted ? "1" : "0");
      await acknowledgeAllUnreadAlerts();
    }

    for (const key of Object.keys(alertPreferences)) {
      if (Object.prototype.hasOwnProperty.call(incoming, key)) {
        alertPreferences[key] = toSettingBoolean(incoming[key], alertPreferences[key]);
        await saveSystemSetting(`alert_${key}`, alertPreferences[key] ? "1" : "0");
      }
    }

    if (alertMuted || !alertPreferences.popup_enabled) {
      await acknowledgeAllUnreadAlerts();
    } else {
      const disabledTypes = Object.entries(alertPreferences)
        .filter(([key, enabled]) => key.endsWith("_enabled") && !["popup_enabled", "fire_enabled"].includes(key) && !enabled)
        .map(([key]) => key.replace("_enabled", ""));

      if (disabledTypes.length > 0) {
        await query(
          "UPDATE alerts SET is_acknowledged=1, acknowledged_at=NOW() WHERE is_acknowledged=0 AND alert_type IN (?)",
          [disabledTypes]
        );
      }
    }

    res.json({
      message: "Đã lưu cấu hình cảnh báo",
      ...alertSettingsResponse(),
    });
  });
});

app.post("/simulation", (req, res) => {
  runQuery(res, async () => {
    simulateSensor = toSettingBoolean(req.body.enabled, simulateSensor);
    await saveSystemSetting("simulate_sensor", simulateSensor ? "1" : "0");
    res.json({
      message: simulateSensor ? "Đã bật dữ liệu cảm biến mô phỏng" : "Đã tắt dữ liệu cảm biến mô phỏng",
      simulateSensor,
    });
  });
});

app.post("/fire-simulation", (req, res) => {
  runQuery(res, async () => {
    const enabled = toSettingBoolean(req.body.enabled, !fireSimulationActive);

  if (enabled) {
      if (fireProtectionActive) {
        fireSimulationActive = true;
        return res.json({
          message: "Chế độ PCCC đang kích hoạt, đã chuyển sang điều khiển giả lập để có thể tắt",
          fireSimulationActive,
          fireProtectionActive,
          fireResponseUntil,
        });
      }

      const started = startFireResponse({
        reason: "fire_simulation",
        temperature: latestSensorReading?.temperature ?? FIRE_CRITICAL_TEMP,
        gas: latestSensorReading?.gas ?? FIRE_SMOKE_THRESHOLD,
        tempDelta: FIRE_TEMP_SPIKE_C,
        mode: "simulation",
        simulated: true,
      });
      return res.json({
        message: started
          ? "Đã bật giả lập PCCC: còi, bơm tưới và phun sương sẽ chạy trong 2 giờ"
          : "Chế độ PCCC đang kích hoạt",
        fireSimulationActive,
        fireProtectionActive,
        fireResponseUntil,
      });
    }

    if (fireSimulationActive || fireProtectionActive) {
      stopFireResponse({ mode: "simulation", reason: "fire_simulation_off" });
      fireSuppressedUntilMs = Date.now() + 15000;
    } else {
      fireSimulationActive = false;
    }

    res.json({
      message: "Đã tắt giả lập PCCC",
      fireSimulationActive,
      fireProtectionActive,
      fireResponseUntil,
    });
  });
});

app.post("/fire-response/resolve", (req, res) => {
  runQuery(res, async () => {
    stopFireResponse({ mode: "fire", reason: "incident_resolved_by_user" });
    fireSuppressedUntilMs = Date.now() + 60000;

    if (req.body.alert_id) {
      await query(
        "UPDATE alerts SET is_acknowledged=1, acknowledged_at=NOW() WHERE id=?",
        [req.body.alert_id]
      );
    }

    await query(
      "UPDATE alerts SET is_acknowledged=1, acknowledged_at=NOW() WHERE is_acknowledged=0 AND alert_type='fire'"
    );

    res.json({
      message: "Đã khắc phục sự cố PCCC và độ khẩn cấp",
      fireSimulationActive,
      fireProtectionActive,
      fireResponseUntil,
    });
  });
});

const { createAssistantService } = require("./services/assistant");
const { searchSite, getSiteSearchStatus } = require("./services/siteSearch");
const {
  searchKnowledge,
  upsertKnowledge,
  getKnowledgeStatus,
  warmKnowledgeCache,
} = require("../chatBot/mysqlKnowledge");
const {
  importExcelKnowledge,
  createExcelTemplateBuffer,
  updateExcelKnowledge,
} = require("../chatBot/excelImport");

function getSystemSnapshot() {
  return {
    mqttConnected,
    simulateSensor,
    emergencyActive,
    autoIrrigationMode,
    fireProtectionActive,
    irrigationStatus,
    fanStatus,
    sprayStatus,
    coolingStatus,
    buzzerStatus,
    autoDisabled: { ...autoDisabled },
  };
}

const assistantService = createAssistantService({
  query,
  schemaReady,
  getPlantsWithThresholds,
  normalizeSensorRow,
  getLatestSensorReading: () => latestSensorReading,
  getSystemSnapshot,
  alertMuted,
  gasDangerThreshold: GAS_DANGER_THRESHOLD,
});

app.get("/site-search/status", (req, res) => {
  res.json(getSiteSearchStatus());
});

app.get("/site-search", async (req, res) => {
  try {
    const result = await searchSite(req.query.q, req.query.start);
    res.json(result);
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ message: err.message });
    }
    console.log("site-search error:", err.message);
    res.status(err.statusCode && err.statusCode < 600 ? err.statusCode : 502).json({
      message: err.message || "Không tìm được trên chỉ mục nội bộ",
      configured: getSiteSearchStatus().configured,
    });
  }
});

app.post("/plant-assistant", async (req, res) => {
  try {
    const messages = req.body?.messages;
    const question = String(req.body?.question || "").trim();
    if (!messages?.length && !question) {
      return res.status(400).json({ message: "Vui lòng nhập câu hỏi" });
    }
    const result = await assistantService.chatForPlantAssistant(messages, { question });
    res.json(result);
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ message: err.message });
    }
    console.log("plant-assistant error:", err.message);
    res.status(500).json({ message: "Lỗi server", error: err.message });
  }
});

async function sendAssistantStatus(req, res) {
  try {
    res.json({
      ...(await assistantService.getStatus()),
      knowledgeStore: await getKnowledgeStatus(),
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
}

async function handleAssistantChat(req, res) {
  try {
    const result = await assistantService.chat(req.body?.messages, {
      question: req.body?.question,
      mode: req.body?.mode,
    });
    res.json(result);
  } catch (err) {
    if (err.statusCode === 400) {
      return res.status(400).json({ message: err.message });
    }
    console.log("ai-demo/chat error:", err.message);
    res.status(500).json({ message: "Lỗi server", error: err.message });
  }
}

app.get("/chatbot/status", sendAssistantStatus);
app.get("/ai-demo/status", sendAssistantStatus);

app.post("/chatbot/chat", handleAssistantChat);
app.post("/ai-demo/chat", handleAssistantChat);

app.get("/chatbot/knowledge/search", (req, res) => {
  (async () => {
    const results = await searchKnowledge(req.query.q, Number(req.query.limit) || 10);
    res.json({ results, status: await getKnowledgeStatus() });
  })().catch((err) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
});

app.post("/chatbot/knowledge", (req, res) => {
  (async () => {
    const entry = await upsertKnowledge(req.body || {});
    res.json({
      message: "Đã nạp thông tin vào tri thức MySQL",
      entry,
      status: await getKnowledgeStatus(),
    });
  })().catch((err) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
});

app.get("/chatbot/knowledge/template-excel", async (req, res) => {
  try {
    const buffer = await createExcelTemplateBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="smart-garden-chatbot-mau-nap-du-lieu.xlsx"');
    res.send(buffer);
  } catch (err) {
    res.status(err.statusCode || 500).json({ message: err.message });
  }
});

app.post("/chatbot/knowledge/import-excel", (req, res) => {
  knowledgeUpload.single("file")(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ message: uploadErr.message });
    }
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ message: "Vui lòng chọn file Excel .xlsx để nạp dữ liệu." });
      }
      const result = await importExcelKnowledge(req.file.buffer, req.file.originalname);
      res.json({
        message: `Đã nạp ${result.importedCount} mục mới vào chatbot_knowledge_entries, bỏ qua ${result.skippedCount || 0} mục đã có`,
        ...result,
        status: await getKnowledgeStatus(),
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ message: err.message });
    }
  });
});

app.post("/chatbot/knowledge/update-excel", (req, res) => {
  knowledgeUpload.single("file")(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ message: uploadErr.message });
    }
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ message: "Vui lòng chọn file Excel .xlsx để sửa nguồn chat." });
      }
      const result = await updateExcelKnowledge(req.file.buffer, req.file.originalname);
      res.json({
        message: `Đã sửa ${result.updatedCount} mục, thêm ${result.createdCount} mục mới, giữ nguyên ${result.unchangedCount} mục trong chatbot_knowledge_entries`,
        ...result,
        status: await getKnowledgeStatus(),
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ message: err.message });
    }
  });
});

app.get("/report", (req, res) => {
  runQuery(res, async () => {
    const fertilizerQuery = `SELECT
      f.id,
      f.plant_id,
      p.name AS plant_name,
      COALESCE(f.type, f.name) AS type,
      f.method,
      COALESCE(f.quantity, f.amount) AS quantity,
      f.note,
      f.created_at
    FROM fertilizers f
    LEFT JOIN plants p ON p.id = f.plant_id
    ORDER BY f.created_at DESC, f.id DESC`;

    const [
      sensorData,
      deviceLogs,
      irrigationLogs,
      fertilizerLogs,
      unreadAlerts,
      autoSettings,
      mainPlant,
      devices,
    ] = await Promise.all([
      query("SELECT * FROM sensor_data WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 YEAR) ORDER BY created_at ASC, id ASC"),
      query("SELECT * FROM device_logs ORDER BY id DESC LIMIT 100"),
      query("SELECT * FROM irrigation_logs ORDER BY id DESC LIMIT 100"),
      query(fertilizerQuery + " LIMIT 100"),
      query(
        alertMuted
          ? "SELECT * FROM alerts WHERE is_acknowledged=0 AND alert_type IN ('hardware','fire') ORDER BY id DESC LIMIT 5"
          : "SELECT * FROM alerts WHERE is_acknowledged=0 ORDER BY id DESC LIMIT 5"
      ),
      query(`
        SELECT a.*, p.name AS plant_name
        FROM auto_settings a
        LEFT JOIN plants p ON p.id = a.plant_id
        ORDER BY a.is_active DESC, a.irrigation_time ASC, a.id DESC
        LIMIT 20
      `),
      getMainPlant(),
      query("SELECT * FROM devices ORDER BY id DESC"),
    ]);

    const deviceSummary = devices.reduce(
      (summary, device) => {
        const status = String(device.status || "offline").toLowerCase();
        summary.total += 1;
        if (status === "online") summary.online += 1;
        else if (status === "maintenance") summary.maintenance += 1;
        else summary.offline += 1;
        return summary;
      },
      { total: 0, online: 0, offline: 0, maintenance: 0 }
    );
    // Bao cao tra ve ca du lieu da luu MySQL va du lieu live de bieu do khong bi dung trong 1 gio.
    const savedSensorData = sensorData.map(normalizeSensorRow);
    const liveSensorData = recentLiveSensors.map(normalizeSensorRow);
    const displaySensorData = [...savedSensorData, ...liveSensorData];
    const visibleUnreadAlerts = unreadAlerts.filter((alertRow) => !isPcccCommandAlert(alertRow));
    const latestUnreadAlert =
      fireProtectionActive || fireSimulationActive
        ? visibleUnreadAlerts.find((alert) => alert.alert_type === "fire") || visibleUnreadAlerts[0] || null
        : visibleUnreadAlerts[0] || null;
    const latestSoilRecordRows = mainPlant?.garden_id
      ? await query(
          `SELECT s.*, g.name AS garden_name
          FROM soil_records s
          LEFT JOIN gardens g ON g.id = s.garden_id
          WHERE s.garden_id=?
          ORDER BY s.created_at DESC, s.id DESC
          LIMIT 1`,
          [mainPlant.garden_id]
        )
      : [];

    res.json({
      sensor_data: displaySensorData,
      saved_sensor_data: savedSensorData,
      live_sensor_data: liveSensorData,
      latest_sensor: latestSensorReading ? normalizeSensorRow(latestSensorReading) : null,
      device_logs: deviceLogs,
      irrigation_logs: irrigationLogs,
      fertilizer_logs: fertilizerLogs,
      latest_fertilizer: fertilizerLogs[0] || null,
      unread_alerts: visibleUnreadAlerts,
      latest_unread_alert: latestUnreadAlert,
      auto_settings: autoSettings,
      latest_auto_setting: autoSettings[0] || null,
      main_plant: mainPlant,
      latest_soil_record: latestSoilRecordRows[0] || null,
      devices,
      device_summary: deviceSummary,
      device_commands: recentDeviceCommands,
      latest_device_command: recentDeviceCommands[0] || null,
      status: {
        coolingStatus,
        irrigationStatus,
        fanStatus,
        sprayStatus,
        buzzerStatus,
        autoCoolingActive,
        autoFanActive,
        autoSprayActive,
        autoIrrigationActive,
        emergencyActive,
        autoIrrigationMode,
        fireProtectionActive,
        fireSimulationActive,
        fireFlameDetected,
        fireResponseUntil,
        fireSmokeThreshold: FIRE_SMOKE_THRESHOLD,
        fireCriticalTemp: FIRE_CRITICAL_TEMP,
        fireTempSpikeC: FIRE_TEMP_SPIKE_C,
        fireResponseSeconds: FIRE_RESPONSE_SECONDS,
        alertMuted,
        mqttConnected,
        lastSensorAt,
        lastSensorSaveAt: lastSensorSaveAt ? new Date(lastSensorSaveAt) : null,
        sensorSaveIntervalSeconds: SENSOR_SAVE_INTERVAL_MS / 1000,
        lastSensorSource,
        simulateSensor,
        latestDeviceCommand: recentDeviceCommands[0] || null,
        deviceCountdowns: getDeviceCountdowns(),
        alertPreferences,
        autoDisabled,
      },
    });
  });
});

app.get("/export-excel", (req, res) => {
  runQuery(res, async () => {
    const rows = await query("SELECT * FROM sensor_data ORDER BY id ASC");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Data");

    sheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Nhiệt độ", key: "temperature", width: 15 },
      { header: "Độ ẩm", key: "humidity", width: 15 },
      { header: "Độ ẩm đất", key: "soil_moisture", width: 15 },
      { header: "Ánh sáng (lux)", key: "light", width: 15 },
      { header: "Khí độc", key: "gas", width: 15 },
      { header: "Mức độ", key: "level", width: 15 },
      { header: "Thời gian", key: "created_at", width: 24 },
    ];
    sheet.addRows(rows.map(normalizeSensorRow));

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", "attachment; filename=sensor_report.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  });
});

app.use((err, req, res, next) => {
  console.log("Request error:", err.message);
  res.status(400).json({ message: err.message || "Lỗi request" });
});

app.listen(PORT, () => {
  console.log(`Server chay tai http://localhost:${PORT}`);
  warmKnowledgeCache().catch((err) => {
    console.log("Knowledge cache warm failed:", err.message);
  });
});

process.on("uncaughtException", (err) => {
  console.log("Uncaught error:", err);
});

process.on("unhandledRejection", (err) => {
  console.log("Unhandled promise:", err);
});
