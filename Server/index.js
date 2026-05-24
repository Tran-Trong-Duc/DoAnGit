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

function toAutoRuleBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return Boolean(fallback);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  return ["1", "true", "on", "yes"].includes(String(value).toLowerCase());
}

function normalizeAutoRuleConfig(source = DEFAULT_AUTO_RULES) {
  const normalized = {};
  AUTO_RULE_DEVICES.forEach((device) => {
    normalized[device] = {};
    Object.keys(AUTO_RULE_SENSORS).forEach((sensorKey) => {
      normalized[device][sensorKey] = {};
      AUTO_RULE_DIRECTIONS.forEach((direction) => {
        const fallback = DEFAULT_AUTO_RULES?.[device]?.[sensorKey]?.[direction] || false;
        const value = source?.[device]?.[sensorKey]?.[direction];
        normalized[device][sensorKey][direction] = toAutoRuleBoolean(value, fallback);
      });
    });
  });
  return normalized;
}

function autoRuleEnabled(device, sensorKey, direction) {
  return Boolean(autoRuleConfig?.[device]?.[sensorKey]?.[direction]);
}

function hasAnyEnabledAutoRule(device) {
  return Object.keys(AUTO_RULE_SENSORS).some((sensorKey) =>
    AUTO_RULE_DIRECTIONS.some((direction) => autoRuleEnabled(device, sensorKey, direction))
  );
}

function getAutoRuleSensorList() {
  return Object.entries(AUTO_RULE_SENSORS).map(([key, sensor]) => ({
    key,
    label: sensor.label,
    unit: sensor.unit || "",
    fireOnly: Boolean(sensor.fireOnly),
  }));
}

function getAutoRuleThreshold(sensorKey, direction, thresholds) {
  const sensor = AUTO_RULE_SENSORS[sensorKey];
  if (!sensor || sensor.fireOnly) return null;
  if (direction === "inside") {
    const min = sensor.minKey ? parseOptionalNumber(thresholds[sensor.minKey]) : null;
    const max = sensor.maxKey ? parseOptionalNumber(thresholds[sensor.maxKey]) : null;
    return { min, max };
  }
  if (direction === "below" && sensor.minKey) return parseOptionalNumber(thresholds[sensor.minKey]);
  if (direction === "above" && sensor.maxKey) return parseOptionalNumber(thresholds[sensor.maxKey]);
  return null;
}

function getTriggeredAutoRules(device, readings, thresholds) {
  if (!AUTO_RULE_DEVICES.includes(device)) return [];

  const triggered = [];
  Object.entries(AUTO_RULE_SENSORS).forEach(([sensorKey, sensor]) => {
    if (sensor.fireOnly) return;
    const value = parseOptionalNumber(readings[sensor.readingKey]);
    if (!Number.isFinite(value)) return;

    AUTO_RULE_DIRECTIONS.forEach((direction) => {
      if (!autoRuleEnabled(device, sensorKey, direction)) return;
      const threshold = getAutoRuleThreshold(sensorKey, direction, thresholds);
      let matched = false;

      if (direction === "inside") {
        const min = parseOptionalNumber(threshold?.min);
        const max = parseOptionalNumber(threshold?.max);
        if (!Number.isFinite(min) && !Number.isFinite(max)) return;
        matched =
          (!Number.isFinite(min) || value >= min) &&
          (!Number.isFinite(max) || value <= max);
      } else {
        if (!Number.isFinite(threshold)) return;
        matched = direction === "below" ? value < threshold : value > threshold;
      }

      if (matched) {
        triggered.push({
          device,
          sensorKey,
          direction,
          label: sensor.label,
          value,
          threshold,
          min: threshold?.min,
          max: threshold?.max,
          unit: sensor.unit || "",
        });
      }
    });
  });

  return triggered;
}

function formatAutoRuleReason(trigger) {
  if (!trigger) return "rule tự động";
  if (trigger.direction === "inside") {
    const min = parseOptionalNumber(trigger.min);
    const max = parseOptionalNumber(trigger.max);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return `${trigger.label} ${trigger.value}${trigger.unit} trong ngưỡng ${min}${trigger.unit} - ${max}${trigger.unit}`;
    }
    if (Number.isFinite(max)) {
      return `${trigger.label} ${trigger.value}${trigger.unit} trong ngưỡng <= ${max}${trigger.unit}`;
    }
    return `${trigger.label} ${trigger.value}${trigger.unit} trong ngưỡng >= ${min}${trigger.unit}`;
  }
  const side = trigger.direction === "below" ? "dưới" : "trên";
  return `${trigger.label} ${trigger.value}${trigger.unit} ${side} ngưỡng ${trigger.threshold}${trigger.unit}`;
}

function normalizeAutoScheduleDevice(value) {
  const device = String(value || "irrigation").toLowerCase();
  return Object.prototype.hasOwnProperty.call(AUTO_SCHEDULE_DEVICES, device) ? device : "irrigation";
}

function setAutoScheduleDeviceStatus(device, active) {
  if (device === "fan") {
    autoFanActive = active;
    fanStatus = active;
    return;
  }
  if (device === "spray") {
    autoSprayActive = active;
    sprayStatus = active;
    return;
  }
  autoIrrigationActive = active;
  irrigationStatus = active;
  if (!active) sensorIrrigationStartedAt = null;
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
const manualDeviceTimers = {
  irrigation: null,
  fan: null,
  spray: null,
  cooling: null,
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
const SENSOR_SAVE_INTERVAL_MS = 30 * 60 * 1000;
const LIVE_SENSOR_BUFFER_SIZE = 120;
const LIGHT_DEFAULT_MAX_LUX = 40000;
const GAS_DANGER_THRESHOLD = 400;
const FIRE_SMOKE_THRESHOLD = GAS_DANGER_THRESHOLD;
const FIRE_TEMP_SPIKE_C = 20;
const FIRE_TEMP_SPIKE_WINDOW_MS = 5000;
const FIRE_CRITICAL_TEMP = 60;
const FIRE_RESPONSE_SECONDS = 2 * 60 * 60;
const AUTO_RULE_DEVICES = ["irrigation", "fan", "spray"];
const AUTO_RULE_DIRECTIONS = ["below", "inside", "above"];
const AUTO_RULE_SENSORS = {
  temperature: {
    label: "Nhiệt độ",
    readingKey: "temperature",
    minKey: "tempMin",
    maxKey: "tempMax",
    unit: "°C",
  },
  humidity: {
    label: "Độ ẩm không khí",
    readingKey: "humidity",
    minKey: "humidityMin",
    maxKey: "humidityMax",
    unit: "%",
  },
  soil_moisture: {
    label: "Độ ẩm đất",
    readingKey: "soil",
    minKey: "soilMin",
    maxKey: "soilMax",
    unit: "%",
  },
  light: {
    label: "Ánh sáng",
    readingKey: "light",
    minKey: "lightMin",
    maxKey: "lightMax",
    unit: " lux",
  },
  gas: {
    label: "Khí độc",
    readingKey: "gas",
    maxKey: "gasMax",
    unit: " ppm",
  },
  flame: {
    label: "Cảm biến lửa",
    readingKey: "flame",
    fireOnly: true,
  },
};
const DEFAULT_AUTO_RULES = {
  irrigation: {
    soil_moisture: { below: true, above: false },
  },
  fan: {
    temperature: { below: false, above: true },
    humidity: { below: false, above: true },
    gas: { below: false, above: true },
  },
  spray: {
    temperature: { below: false, above: true },
    humidity: { below: true, above: false },
  },
};
let autoRuleConfig = normalizeAutoRuleConfig();
const AUTO_SCHEDULE_DEVICES = {
  irrigation: {
    label: "bơm tưới",
    deviceId: 1,
    countdownKey: "irrigation",
    onAction: "schedule_irrigation_on",
    offAction: "schedule_irrigation_off",
  },
  fan: {
    label: "quạt",
    deviceId: 2,
    countdownKey: "fan",
    onAction: "schedule_fan_on",
    offAction: "schedule_fan_off",
  },
  spray: {
    label: "phun làm mát",
    deviceId: 3,
    countdownKey: "spray",
    onAction: "schedule_spray_on",
    offAction: "schedule_spray_off",
  },
};
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

  if (settings.has("auto_rules")) {
    try {
      autoRuleConfig = normalizeAutoRuleConfig(JSON.parse(settings.get("auto_rules")));
    } catch (err) {
      console.log("Cannot load auto rules:", err.message);
      autoRuleConfig = normalizeAutoRuleConfig();
    }
  } else {
    autoRuleConfig = normalizeAutoRuleConfig();
  }
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
    await modifyColumn("system_settings", "setting_value", "TEXT NULL");

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

    await query(`CREATE TABLE IF NOT EXISTS plant_disease_treatments (
      id INT NOT NULL AUTO_INCREMENT,
      plant_id INT DEFAULT NULL,
      ten_cay VARCHAR(180) NOT NULL,
      ten_cay_normalized VARCHAR(180) NULL,
      benh_so TINYINT UNSIGNED NOT NULL,
      ten_benh VARCHAR(180) NOT NULL,
      tu_khoa TEXT NULL,
      trieu_chung TEXT NULL,
      nguyen_nhan TEXT NULL,
      cach_chua MEDIUMTEXT NOT NULL,
      phong_ngua MEDIUMTEXT NULL,
      nguoi_dua_phac_do VARCHAR(180) NULL,
      chuc_danh_nguoi_dua VARCHAR(120) NULL,
      nguon_phac_do TEXT NULL,
      source_title VARCHAR(255) NULL,
      source_url TEXT NULL,
      source_author VARCHAR(180) NULL,
      source_organization VARCHAR(180) NULL,
      source_published_at DATE NULL,
      source_checked_at TIMESTAMP NULL,
      is_verified TINYINT(1) NOT NULL DEFAULT 0,
      verified_at TIMESTAMP NULL,
      verification_note TEXT NULL,
      muc_do VARCHAR(40) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_plant_disease_slot (ten_cay, benh_so),
      UNIQUE KEY uq_plant_disease_name (ten_cay, ten_benh),
      KEY idx_plant_disease_plant_id (plant_id),
      KEY idx_plant_disease_plant_name (ten_cay),
      KEY idx_plant_disease_plant_normalized (ten_cay_normalized),
      KEY idx_plant_disease_disease_name (ten_benh),
      KEY idx_plant_disease_author (nguoi_dua_phac_do),
      KEY idx_plant_disease_verified (is_verified),
      CHECK (benh_so BETWEEN 1 AND 10)
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
    await modifyColumn("plant_disease_treatments", "nguoi_dua_phac_do", "VARCHAR(180) NULL");
    await addColumnIfMissing("plant_disease_treatments", "ten_cay_normalized", "VARCHAR(180) NULL");
    await addColumnIfMissing("plant_disease_treatments", "source_title", "VARCHAR(255) NULL");
    await addColumnIfMissing("plant_disease_treatments", "source_url", "TEXT NULL");
    await addColumnIfMissing("plant_disease_treatments", "source_author", "VARCHAR(180) NULL");
    await addColumnIfMissing("plant_disease_treatments", "source_organization", "VARCHAR(180) NULL");
    await addColumnIfMissing("plant_disease_treatments", "source_published_at", "DATE NULL");
    await addColumnIfMissing("plant_disease_treatments", "source_checked_at", "TIMESTAMP NULL");
    await addColumnIfMissing("plant_disease_treatments", "is_verified", "TINYINT(1) NOT NULL DEFAULT 0");
    await addColumnIfMissing("plant_disease_treatments", "verified_at", "TIMESTAMP NULL");
    await addColumnIfMissing("plant_disease_treatments", "verification_note", "TEXT NULL");
    await addColumnIfMissing("alerts", "is_acknowledged", "TINYINT(1) NOT NULL DEFAULT 1");
    await addColumnIfMissing("alerts", "acknowledged_at", "TIMESTAMP NULL");
    await addColumnIfMissing("alerts", "alert_type", "VARCHAR(50) NULL");
    await addColumnIfMissing("auto_settings", "day_mask", "VARCHAR(7) NOT NULL DEFAULT '1111111'");
    await addColumnIfMissing("auto_settings", "device_type", "VARCHAR(30) NOT NULL DEFAULT 'irrigation'");
    await query("UPDATE auto_settings SET device_type='irrigation' WHERE device_type IS NULL OR device_type=''");
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

function normalizeTimerKeys(keys) {
  return (Array.isArray(keys) ? keys : [keys]).filter((key) =>
    Object.prototype.hasOwnProperty.call(manualDeviceTimers, key)
  );
}

function clearManualDeviceTimers(keys) {
  const timerKeys = normalizeTimerKeys(keys);
  const handles = new Set(timerKeys.map((key) => manualDeviceTimers[key]).filter(Boolean));
  handles.forEach((handle) => clearTimeout(handle));
  Object.keys(manualDeviceTimers).forEach((key) => {
    if (timerKeys.includes(key) || handles.has(manualDeviceTimers[key])) {
      manualDeviceTimers[key] = null;
    }
  });
}

function setManualDeviceTimer(keys, handle) {
  normalizeTimerKeys(keys).forEach((key) => {
    manualDeviceTimers[key] = handle;
  });
}

function finishManualDeviceTimer(keys, handle) {
  normalizeTimerKeys(keys).forEach((key) => {
    if (manualDeviceTimers[key] === handle) manualDeviceTimers[key] = null;
  });
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

function startTimedDevice({ duration, onStart, onStop, log, commandOn, commandOff, timerKeys = [] }) {
  // Dung chung cho cac lenh bat thiet bi theo so giay: bat, ghi log, gui MQTT, roi tu tat.
  const seconds = parseDuration(duration);
  if (timerKeys.length > 0) clearManualDeviceTimers(timerKeys);
  onStart();
  if (timerKeys.length > 0) setDeviceCountdown(timerKeys, seconds);
  if (log) {
    db.query("INSERT INTO device_logs (device_id, action, mode) VALUES (?, ?, ?)", log);
  }
  if (commandOn) {
    publishDeviceCommand({ ...commandOn, duration: commandOn.duration ?? seconds });
  }
  const handle = setTimeout(() => {
    finishManualDeviceTimer(timerKeys, handle);
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
  if (timerKeys.length > 0) setManualDeviceTimer(timerKeys, handle);
  return seconds;
}

function deviceStatusPayload() {
  return {
    irrigationStatus,
    fanStatus,
    sprayStatus,
    coolingStatus,
    coolingTargetTemp,
    buzzerStatus,
    deviceCountdowns: getDeviceCountdowns(),
  };
}

function setManualCoolingPart(device, active, reason = "manual_partial_cooling") {
  const configs = {
    fan: { id: 2, label: "quạt", other: "spray", otherLabel: "phun mát" },
    spray: { id: 3, label: "phun mát", other: "fan", otherLabel: "quạt" },
  };
  const config = configs[device];
  if (!config || coolingTargetTemp === null) return null;

  const currentActive = device === "fan" ? fanStatus : sprayStatus;
  const otherActive = config.other === "fan" ? fanStatus : sprayStatus;

  if (!active && !currentActive) {
    return { message: `${config.label} đang tắt, chức năng làm mát mục tiêu vẫn tiếp tục.`, info: true };
  }

  if (!active && !otherActive) {
    return {
      message: `Cần giữ ít nhất một thiết bị làm mát đang chạy. Muốn tắt toàn bộ, hãy dùng nút Dừng ở ô làm mát.`,
      info: true,
    };
  }

  if (active && currentActive) {
    return { message: `${config.label} đang bật trong chức năng làm mát mục tiêu.`, info: true };
  }

  clearManualDeviceTimers([device]);
  clearDeviceCountdown([device]);
  if (device === "fan") {
    fanStatus = active;
    autoFanActive = false;
  } else {
    sprayStatus = active;
    autoSprayActive = false;
  }

  const action = `cooling_target_${device}_${active ? "on" : "off"}`;
  logDeviceAction(config.id, action, "manual");
  publishDeviceCommand({
    device,
    state: active ? "on" : "off",
    action,
    mode: "manual",
    reason,
    extra: { target_temp: coolingTargetTemp },
    notify: false,
  });

  return active
    ? { message: `Đã bật lại ${config.label}; chức năng làm mát đến ${coolingTargetTemp}°C vẫn tiếp tục.`, info: true }
    : { message: `Đã tắt ${config.label}; chức năng làm mát đến ${coolingTargetTemp}°C vẫn tiếp tục bằng ${config.otherLabel}.`, info: true };
}

function stopManualDevice(device, reason = "manual_stop") {
  if ((device === "fan" || device === "spray") && coolingTargetTemp !== null) {
    return setManualCoolingPart(device, false, reason);
  }

  if (device === "cooling" || ((device === "fan" || device === "spray") && coolingStatus)) {
    clearManualDeviceTimers(["cooling", "fan", "spray"]);
    stopCooling({ mode: "manual", reason });
    logCoolingAction("cooling_off", "manual");
    createAlert("Đã dừng làm mát", "info", "hardware", true);
    return { message: "Đã dừng làm mát" };
  }

  const configs = {
    irrigation: { id: 1, action: "irrigation_off", label: "tưới" },
    fan: { id: 2, action: "fan_off", label: "quạt" },
    spray: { id: 3, action: "spray_off", label: "phun mát" },
  };
  const config = configs[device];
  if (!config) return null;

  clearManualDeviceTimers([device]);
  clearDeviceCountdown([device]);
  if (device === "irrigation") {
    irrigationStatus = false;
    autoIrrigationActive = false;
    sensorIrrigationStartedAt = null;
  }
  if (device === "fan") {
    fanStatus = false;
    autoFanActive = false;
  }
  if (device === "spray") {
    sprayStatus = false;
    autoSprayActive = false;
  }

  logDeviceAction(config.id, config.action, "manual");
  publishDeviceCommand({ device, state: "off", action: config.action, mode: "manual", reason });
  return { message: `Đã dừng ${config.label}` };
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
      const lightMin = normalizeLightReading(th.light_min);
      const lightMax = normalizeLightMaxThreshold(th.light_max);
      const sensorReadings = { temperature, humidity, soil, light, gas, flame: flameDetected ? 1 : 0 };
      const thresholdValues = {
        tempMin,
        tempMax,
        humidityMin,
        humidityMax,
        soilMin,
        soilMax,
        lightMin,
        lightMax,
        gasMax: GAS_DANGER_THRESHOLD,
      };

      updateThresholdAlerts(
        { temperature, humidity, soil, light, gas },
        thresholdValues
      );
      if (fireProtectionActive) return;

      const useSensorAutoRules = autoIrrigationMode === "sensor";
      const fanAutoTriggers = useSensorAutoRules ? getTriggeredAutoRules("fan", sensorReadings, thresholdValues) : [];
      const sprayAutoTriggers = useSensorAutoRules ? getTriggeredAutoRules("spray", sensorReadings, thresholdValues) : [];
      const irrigationAutoTriggers = useSensorAutoRules ? getTriggeredAutoRules("irrigation", sensorReadings, thresholdValues) : [];
      const airQualityFanNeeded = fanAutoTriggers.length > 0;
      const humiditySprayNeeded = sprayAutoTriggers.length > 0;
      const sensorIrrigationNeeded =
        useSensorAutoRules &&
        irrigationAutoTriggers.length > 0;

      // Khoa auto theo tung thiet bi: tat auto phun thi do am thap khong tu bat phun.
      if (humiditySprayNeeded && !autoSprayActive && !autoDisabled.spray) {
        const reason = sprayAutoTriggers.map(formatAutoRuleReason).join(", ");
        autoSprayActive = true;
        sprayStatus = true;
        clearDeviceCountdown(["spray"]);
        logDeviceAction(3, "humidity_spray_on", "auto");
        publishDeviceCommand({ device: "spray", state: "on", action: "humidity_spray_on", mode: "auto", reason, notify: false });
        createAlert(`Tự động bật phun nước do ${reason}`, "info", "action");
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
            reason: autoDisabled.spray ? "auto_disabled" : "auto_rule_normal",
            notify: false,
          });
          createAlert("Tự động tắt phun nước vì chỉ số đã về ngưỡng", "info", "action");
        }
      }

      // Do am khong khi cao hoac khi doc cao thi bat quat den khi chi so ve binh thuong.
      if (airQualityFanNeeded && !autoFanActive && !autoDisabled.fan) {
        const reason = fanAutoTriggers.map(formatAutoRuleReason).join(", ");
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
        publishDeviceCommand({ device: "fan", state: "off", action: "air_quality_fan_off", mode: "auto", reason: "auto_rule_normal", notify: false });
        createAlert("Tự động tắt quạt vì chỉ số đã về ngưỡng", "info", "action");
      }

      // Khoa auto tuoi: do am dat thap khong tu bat bom tuoi neu nguoi dung da tat.
      if (
        useSensorAutoRules &&
        sensorIrrigationNeeded &&
        !autoIrrigationActive &&
        !autoDisabled.irrigation
      ) {
        autoIrrigationActive = true;
        irrigationStatus = true;
        sensorIrrigationStartedAt = Date.now();
        clearDeviceCountdown(["irrigation"]);
        logDeviceAction(1, "soil_irrigation_on", "auto");
        const reason = irrigationAutoTriggers.map(formatAutoRuleReason).join(", ");
        publishDeviceCommand({ device: "irrigation", state: "on", action: "soil_irrigation_on", mode: "auto", reason, notify: false });
        createAlert(`Tự động tưới vì ${reason}`, "info", "action");
      }

      if (
        useSensorAutoRules &&
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
          reason: autoDisabled.irrigation ? "auto_disabled" : "auto_rule_normal",
          notify: false,
        });
        createAlert("Tự động tắt bơm tưới vì chỉ số đã về ngưỡng", "info", "action");
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
app.post("/manual-device/:device/stop", (req, res) => {
  const device = String(req.params.device || "").toLowerCase();
  const result = stopManualDevice(device);
  if (!result) {
    return res.status(400).json({ message: "Thiết bị không hợp lệ" });
  }
  res.json({
    message: result.message,
    info: Boolean(result.info),
    status: deviceStatusPayload(),
  });
});

app.post("/manual-device/:device/start", (req, res) => {
  const device = String(req.params.device || "").toLowerCase();
  const result = setManualCoolingPart(device, true, "manual_partial_cooling_start");
  if (!result) {
    return res.status(400).json({ message: "Chỉ bật lại quạt/phun riêng khi đang làm mát tới nhiệt độ mục tiêu" });
  }
  res.json({
    message: result.message,
    info: Boolean(result.info),
    status: deviceStatusPayload(),
  });
});

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
    onStop: () => {
      stopCooling({ mode: "manual", reason: "timer_finished" });
      logCoolingAction("cooling_off", "manual");
      createAlert("Tắt làm mát", "info", "hardware", true);
    },
    log: [2, "cooling_on", "manual"],
    commandOn: { device: "fan", state: "on", action: "cooling_on", mode: "manual", notify: false },
    timerKeys: ["cooling", "fan", "spray"],
  });
  logDeviceAction(3, "cooling_on", "manual");
  publishDeviceCommand({ device: "spray", state: "on", action: "cooling_on", mode: "manual", duration: seconds, notify: false });
  createAlert(`Bật làm mát trong ${seconds} giây`, "info", "hardware", true);
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
    clearDeviceCountdown(["cooling", "fan", "spray"]);
    clearManualDeviceTimers(["cooling", "fan", "spray"]);
    if (coolingTargetTimer) {
      clearTimeout(coolingTargetTimer);
      coolingTargetTimer = null;
    }
    logCoolingAction("cooling_target_on", "manual");
    publishDeviceCommand({ device: "fan", state: "on", action: "cooling_target_on", mode: "manual", extra: { target_temp: target }, notify: false });
    publishDeviceCommand({ device: "spray", state: "on", action: "cooling_target_on", mode: "manual", extra: { target_temp: target }, notify: false });
    createAlert(`Bật làm mát đến ${target}°C`, "info", "hardware", true);
    res.json({
      message: `Đang làm mát liên tục đến ${target}°C, hệ thống sẽ tự tắt khi đạt nhiệt độ mục tiêu`,
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
  clearManualDeviceTimers(Object.keys(manualDeviceTimers));

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
    return res.status(400).json({ message: "Chế độ điều khiển tự động không hợp lệ" });
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
    message: mode === "sensor" ? "Đã chọn setup tự động theo cảm biến/ngưỡng" : "Đã chọn điều khiển tự động theo lịch",
    autoIrrigationMode,
  });
});

app.get("/auto-rules", (req, res) => {
  res.json({
    autoRules: autoRuleConfig,
    sensors: getAutoRuleSensorList(),
  });
});

app.post("/auto-rules", (req, res) => {
  runQuery(res, async () => {
    const device = String(req.body.device || "").toLowerCase();
    const sensor = String(req.body.sensor || "").toLowerCase();
    const direction = String(req.body.direction || "").toLowerCase();
    const enabled = toAutoRuleBoolean(req.body.enabled, false);

    if (!AUTO_RULE_DEVICES.includes(device)) {
      return res.status(400).json({ message: "Thiết bị tự động không hợp lệ" });
    }
    if (!Object.prototype.hasOwnProperty.call(AUTO_RULE_SENSORS, sensor)) {
      return res.status(400).json({ message: "Cảm biến không hợp lệ" });
    }
    if (AUTO_RULE_SENSORS[sensor].fireOnly) {
      return res.status(400).json({ message: "Cảm biến lửa chỉ phục vụ PCCC" });
    }
    if (direction === "unused") {
      const nextRules = normalizeAutoRuleConfig(autoRuleConfig);
      AUTO_RULE_DIRECTIONS.forEach((ruleDirection) => {
        nextRules[device][sensor][ruleDirection] = false;
      });
      autoRuleConfig = nextRules;
      await saveSystemSetting("auto_rules", JSON.stringify(autoRuleConfig));

      if (!hasAnyEnabledAutoRule(device)) stopAutoDeviceIfRunning(device, "auto_rule_disabled");

      return res.json({
        message: "Đã tắt cảm biến này khỏi setup tự động",
        autoRules: autoRuleConfig,
        sensors: getAutoRuleSensorList(),
      });
    }
    if (!AUTO_RULE_DIRECTIONS.includes(direction)) {
      return res.status(400).json({ message: "Chiều ngưỡng không hợp lệ" });
    }
    if (direction === "below" && !AUTO_RULE_SENSORS[sensor].minKey) {
      return res.status(400).json({ message: "Cảm biến này không có ngưỡng dưới" });
    }
    if (direction === "above" && !AUTO_RULE_SENSORS[sensor].maxKey) {
      return res.status(400).json({ message: "Cảm biến này không có ngưỡng trên" });
    }
    if (direction === "inside" && !AUTO_RULE_SENSORS[sensor].minKey && !AUTO_RULE_SENSORS[sensor].maxKey) {
      return res.status(400).json({ message: "Cảm biến này chưa có ngưỡng sử dụng" });
    }

    const nextRules = normalizeAutoRuleConfig(autoRuleConfig);
    nextRules[device][sensor][direction] = enabled;
    autoRuleConfig = nextRules;
    await saveSystemSetting("auto_rules", JSON.stringify(autoRuleConfig));

    if (!hasAnyEnabledAutoRule(device)) stopAutoDeviceIfRunning(device, "auto_rule_disabled");

    res.json({
      message: enabled ? "Đã bật rule tự động" : "Đã tắt rule tự động",
      autoRules: autoRuleConfig,
      sensors: getAutoRuleSensorList(),
    });
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
  const deviceType = normalizeAutoScheduleDevice(req.body.device_type);

  runQuery(res, async () => {
    if (!irrigation_time) {
      return res.status(400).json({ message: "Vui lòng chọn giờ chạy lịch tự động" });
    }

    await query(
      `INSERT INTO auto_settings
      (plant_id, auto_mode, device_type, irrigation_time, irrigation_duration, is_active, day_mask)
      VALUES (?, 1, ?, ?, ?, 1, ?)`,
      [
        plant_id || mainPlantId,
        deviceType,
        irrigation_time,
        parseDuration(irrigation_duration),
        String(day_mask || "1111111").slice(0, 7),
      ]
    );
    res.json({ message: "Đã lưu lịch điều khiển tự động" });
  });
});

app.put("/auto-irrigation/:id", (req, res) => {
  const { plant_id, irrigation_time, irrigation_duration, day_mask } = req.body;
  const deviceType = normalizeAutoScheduleDevice(req.body.device_type);

  runQuery(res, async () => {
    if (!irrigation_time) {
      return res.status(400).json({ message: "Vui lòng chọn giờ chạy lịch tự động" });
    }

    const current = await query("SELECT * FROM auto_settings WHERE id=?", [req.params.id]);
    if (current.length === 0) {
      return res.status(404).json({ message: "Không tìm thấy lịch tự động" });
    }

    await query(
      `UPDATE auto_settings
      SET plant_id=?, device_type=?, irrigation_time=?, irrigation_duration=?, day_mask=?
      WHERE id=?`,
      [
        plant_id || current[0].plant_id || mainPlantId,
        deviceType,
        irrigation_time,
        parseDuration(irrigation_duration),
        String(day_mask || current[0].day_mask || "1111111").slice(0, 7),
        req.params.id,
      ]
    );
    // Xoa dau vet lan chay cu de lich vua sua co the kich hoat dung theo gio moi.
    clearAutoScheduleRunCache(req.params.id);
    res.json({ message: "Đã cập nhật lịch điều khiển tự động" });
  });
});

app.put("/auto-irrigation/:id/toggle", (req, res) => {
  runQuery(res, async () => {
    await query("UPDATE auto_settings SET is_active=? WHERE id=?", [
      Boolean(req.body.is_active) ? 1 : 0,
      req.params.id,
    ]);
    clearAutoScheduleRunCache(req.params.id);
    res.json({ message: "Đã cập nhật trạng thái lịch tự động" });
  });
});

app.delete("/auto-irrigation/:id", (req, res) => {
  runQuery(res, async () => {
    await query("DELETE FROM auto_settings WHERE id=?", [req.params.id]);
    clearAutoScheduleRunCache(req.params.id);
    res.json({ message: "Đã xóa lịch điều khiển tự động" });
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
        const device = normalizeAutoScheduleDevice(row.device_type);
        const scheduleDevice = AUTO_SCHEDULE_DEVICES[device];
        const countdownKeys = [scheduleDevice.countdownKey];

        setAutoScheduleDeviceStatus(device, true);
        setDeviceCountdown(countdownKeys, seconds);
        logDeviceAction(scheduleDevice.deviceId, scheduleDevice.onAction, "auto");
        if (device === "irrigation") {
          db.query("INSERT INTO irrigation_logs (amount,duration) VALUES (1,?)", [seconds]);
        }
        publishDeviceCommand({
          device,
          state: "on",
          action: scheduleDevice.onAction,
          mode: "auto",
          duration: seconds,
          reason: "schedule",
          notify: false,
        });
        createAlert(`Điều khiển tự động theo lịch: bật ${scheduleDevice.label} lúc ${time} trong ${seconds} giây`, "info", "action");
        setTimeout(() => {
          if (fireProtectionActive && ["irrigation", "spray"].includes(device)) return;
          setAutoScheduleDeviceStatus(device, false);
          clearDeviceCountdown(countdownKeys);
          logDeviceAction(scheduleDevice.deviceId, scheduleDevice.offAction, "auto");
          publishDeviceCommand({ device, state: "off", action: scheduleDevice.offAction, mode: "auto", reason: "timer_finished" });
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
    autoRules: autoRuleConfig,
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
        message: `Đã nạp ${result.mainImportedCount || 0} mục vào chatbot_knowledge_entries và ${result.diseaseImportedCount || 0} mục bệnh vào plant_disease_treatments, bỏ qua ${result.skippedCount || 0} mục đã có`,
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
        message: `Đã sửa ${result.mainUpdatedCount || 0} mục chính và ${result.diseaseUpdatedCount || 0} mục bệnh; thêm ${result.createdCount} mục mới, giữ nguyên ${result.unchangedCount} mục`,
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
        coolingTargetTemp,
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
        autoRules: autoRuleConfig,
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
