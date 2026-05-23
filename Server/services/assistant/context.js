const { withTimeout } = require("./utils");
const { PLANT_ASSISTANT_DB_TIMEOUT_MS } = require("./config");
const { aiDemoContextQuestion, normalizeAssistantText } = require("./text");
const { searchKnowledge } = require("../../../chatBot/mysqlKnowledge");

function isGardenSystemQuestion(question = "") {
  const normalized = normalizeAssistantText(question);
  return /(cay chinh|cay hien tai|cay dang trong|vuon minh|vuon cua toi|he thong|da luu|danh sach cay|liet ke cay|cac cay|cay trong vuon|trong vuon)/.test(normalized);
}

function summarizePlantForContext(plant) {
  if (!plant) return null;
  return {
    id: plant.id,
    name: plant.name,
    is_main: Boolean(plant.is_main),
    garden_id: plant.garden_id,
    temp_min: plant.temp_min,
    temp_max: plant.temp_max,
    humidity_min: plant.humidity_min,
    humidity_max: plant.humidity_max,
    soil_min: plant.soil_min,
    soil_max: plant.soil_max,
    light_max: plant.light_max,
    soil_ph: plant.soil_ph,
    soil_type: plant.soil_type,
    soil_drainage: plant.soil_drainage,
    watering_time: plant.watering_time,
    watering_duration: plant.watering_duration,
  };
}

function summarizeSensorForContext(sensor) {
  if (!sensor || Object.keys(sensor).length === 0) return null;
  return {
    temperature: sensor.temperature,
    humidity: sensor.humidity,
    soil_moisture: sensor.soil_moisture ?? sensor.soil,
    light: sensor.light,
    gas: sensor.gas,
    flame: sensor.flame,
    level: sensor.level,
    source: sensor.source,
    created_at: sensor.created_at,
  };
}

function createContextBuilder(deps) {
  const {
    query,
    schemaReady,
    getPlantsWithThresholds,
    normalizeSensorRow,
    getLatestSensorReading,
    getSystemSnapshot,
    alertMuted,
    gasDangerThreshold,
  } = deps;

  async function loadGardenData() {
    const fallback = {
      plants: [],
      mainPlant: null,
      latestSensor: null,
      unreadAlerts: [],
      dbAvailable: false,
    };

    return withTimeout(
      (async () => {
        await schemaReady;
        const [plants, latestRows, unreadAlerts] = await Promise.all([
          getPlantsWithThresholds(),
          query("SELECT * FROM sensor_data ORDER BY id DESC LIMIT 1"),
          query(
            alertMuted
              ? "SELECT id, message, level, alert_type, created_at FROM alerts WHERE is_acknowledged=0 AND alert_type IN ('hardware','fire') ORDER BY id DESC LIMIT 5"
              : "SELECT id, message, level, alert_type, created_at FROM alerts WHERE is_acknowledged=0 ORDER BY id DESC LIMIT 5"
          ),
        ]);

        const liveReading = getLatestSensorReading();
        const latestSensor = liveReading
          ? normalizeSensorRow(liveReading)
          : normalizeSensorRow(latestRows[0] || {});

        return {
          plants,
          mainPlant: plants.find((plant) => plant.is_main) || plants[0] || null,
          latestSensor,
          unreadAlerts: unreadAlerts || [],
          dbAvailable: true,
        };
      })(),
      PLANT_ASSISTANT_DB_TIMEOUT_MS,
      fallback
    );
  }

  async function buildGardenContext(messages) {
    const question = aiDemoContextQuestion(messages);
    const gardenData = await loadGardenData();
    let knowledgeMatches = [];
    if (!isGardenSystemQuestion(question)) {
      try {
        knowledgeMatches = await searchKnowledge(question, 5);
      } catch (err) {
        console.log("Assistant MySQL knowledge failed:", err.message);
      }
    }

    const system = getSystemSnapshot();
    const plantSummaries = (gardenData.plants || []).slice(0, 12).map(summarizePlantForContext);

    const payload = {
      generatedAt: new Date().toISOString(),
      questionFocus: question,
      mainPlant: summarizePlantForContext(gardenData.mainPlant),
      plants: plantSummaries,
      latestSensor: summarizeSensorForContext(gardenData.latestSensor),
      unreadAlerts: (gardenData.unreadAlerts || []).map((row) => ({
        id: row.id,
        message: row.message,
        level: row.level,
        alert_type: row.alert_type,
        created_at: row.created_at,
      })),
      systemStatus: {
        mqttConnected: system.mqttConnected,
        simulateSensor: system.simulateSensor,
        emergencyActive: system.emergencyActive,
        fireProtectionActive: system.fireProtectionActive,
        autoIrrigationMode: system.autoIrrigationMode,
        deviceStates: {
          irrigation: system.irrigationStatus,
          fan: system.fanStatus,
          spray: system.sprayStatus,
          cooling: system.coolingStatus,
          buzzer: system.buzzerStatus,
        },
        autoDisabled: system.autoDisabled,
        gasDangerThresholdPpm: gasDangerThreshold,
      },
      mysqlKnowledge: knowledgeMatches.map((item) => ({
        topic: item.topic,
        category: item.category,
        answer: item.answer,
        matchedTerms: item.matchedTerms,
      })),
      dbAvailable: gardenData.dbAvailable,
    };

    return {
      question,
      gardenData,
      knowledgeMatches,
      contextJson: JSON.stringify(payload, null, 2),
      payload,
    };
  }

  return { buildGardenContext, loadGardenData };
}

module.exports = { createContextBuilder };
