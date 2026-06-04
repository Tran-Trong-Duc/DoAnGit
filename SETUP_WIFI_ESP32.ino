#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include "DHT.h"
#include "wifiConfig.h"

// ======================= Cau hinh chan phan cung =======================
// DHT11: do nhiet do va do am khong khi.
#define DHT_PIN 26
#define DHT_TYPE DHT11

// Cam bien do am dat: giu chan cu VN tren ESP32, tuong ung GPIO39.
#define SOIL_PIN 39
#define SOIL_RAW_DRY 4095
#define SOIL_RAW_WET 1200

// MQ-135: giu chan cu GPIO34 de dua len web lam chi so khi doc/chat luong khong khi.
#define MQ135_PIN 34

// Cam bien anh sang BH1750/GY-302: 5 chan VCC, GND, SCL, SDA, ADDR; doc truc tiep don vi lux qua I2C.
#define BH1750_ADDR_LOW 0x23
#define BH1750_ADDR_HIGH 0x5C
#define BH1750_POWER_ON 0x01
#define BH1750_CONT_HIGH_RES_MODE 0x10
#define LIGHT_MAX_LUX 40000

// Cam bien lua 4 chan: VCC, GND, DO, AO.
// DO dung de phat hien nhanh, AO dung de doc muc analog va gui len website de theo doi.
#define FLAME_DO_PIN 32
#define FLAME_AO_PIN 35
#define FLAME_DO_DETECTED_LEVEL LOW
#define FLAME_USE_ANALOG_TRIGGER 0
#define FLAME_AO_TRIGGER_BELOW 1200  // Chi dung khi FLAME_USE_ANALOG_TRIGGER = 1.

// 3 kenh relay dung trong du an Smart Garden.
#define RELAY_PUMP 14   // Bom tuoi cay
#define RELAY_FAN 27    // Quat thong gio/lam mat
#define RELAY_SPRAY 18  // Bom phun suong/lam mat
#define BUZZER_PIN 23   // Coi bao dong PCCC

// Da so module relay 5V kich muc thap: LOW = bat, HIGH = tat.
#define RELAY_ON LOW
#define RELAY_OFF HIGH
#define BUZZER_ON HIGH
#define BUZZER_OFF LOW
#define BUZZER_PASSIVE 0  // 0: coi active/coi bao dong co mach san; 1: coi passive can ESP tao tan so.

// Man hinh OLED 1.3 inch SH1106 I2C: GND, 3.3V, SCL, SDA.
#define OLED_SDA 21
#define OLED_SCL 22
#define OLED_ADDR 0x3C
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

// ======================= Cau hinh MQTT cua website ======================
const char *MQTT_HOST = "d10fcd7af0074059b6861fa801308d26.s1.eu.hivemq.cloud";
const int MQTT_PORT = 8883;
const char *MQTT_USER = "admin";
const char *MQTT_PASS = "Ab123456";

const char *TOPIC_SENSOR = "sensor";
const char *TOPIC_PUMP = "garden/pump/set";
const char *TOPIC_FAN = "garden/fan/set";
const char *TOPIC_SPRAY = "garden/spray/set";
const char *TOPIC_BUZZER = "garden/buzzer/set";

const unsigned long SENSOR_SEND_INTERVAL_MS = 200;  // Gui MQTT nhanh: khoang 5 lan/giay.
const unsigned long SENSOR_READ_INTERVAL_MS = 200;  // Doc nhanh cac cam bien analog/I2C.
const unsigned long DHT_READ_INTERVAL_MS = 2000;    // DHT11 khong doc nhanh on dinh hon muc nay.
const unsigned long MQTT_RECONNECT_INTERVAL_MS = 5000;
const unsigned long DISPLAY_UPDATE_INTERVAL_MS = 1000;
const unsigned long BUZZER_HALF_PERIOD_US = 250;  // Tao am khoang 2kHz cho coi 2 chan/passive buzzer.
const unsigned long BUZZER_PATTERN_MS = 1150;     // Nhip coi su co nhanh: dai-ngan-ngan, nghi, lap lai.
const unsigned long FLAME_FAST_SCAN_INTERVAL_MS = 25;  // Quet cam bien lua rieng, nhanh hon chu ky sensor chung.
const unsigned long FLAME_EVENT_REPEAT_MS = 500;       // Khi co lua, gui MQTT lap lai nhanh de server khong bo lo.
const unsigned long FLAME_LATCH_MS = 10000;            // Giu trang thai co lua 10 giay sau mot lan bat gap.

DHT dht(DHT_PIN, DHT_TYPE);
WiFiClientSecure secureClient;
PubSubClient mqttClient(secureClient);
Adafruit_SH1106G oled = Adafruit_SH1106G(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

unsigned long lastSensorSendAt = 0;
unsigned long lastSensorReadAt = 0;
unsigned long lastDhtReadAt = 0;
unsigned long lastMqttReconnectAt = 0;
unsigned long lastDisplayUpdateAt = 0;
unsigned long lastBuzzerToggleAt = 0;
unsigned long lastFlameScanAt = 0;
unsigned long lastFlameEventPublishAt = 0;
unsigned long lastDhtWarningAt = 0;
unsigned long lastWifiDebugAt = 0;
unsigned long lastSensorDebugAt = 0;
unsigned long flameLatchUntil = 0;
unsigned long pumpOffAt = 0;
unsigned long fanOffAt = 0;
unsigned long sprayOffAt = 0;
unsigned long buzzerOffAt = 0;

float lastTemperature = 0;
float lastHumidity = 0;
int lastSoilMoisture = 0;
int lastSoilRaw = 0;
int lastLightLux = 0;
int lastLightRaw = 0;
int lastGasRaw = 0;
int lastFlameRaw = 4095;
bool lastFlameDetected = false;
bool oledReady = false;
bool lightReady = false;
uint8_t lightSensorAddress = 0;
bool pumpActive = false;
bool fanActive = false;
bool sprayActive = false;
bool buzzerActive = false;
bool buzzerOutputState = false;

void setRelay(uint8_t pin, bool turnOn) {
  digitalWrite(pin, turnOn ? RELAY_ON : RELAY_OFF);
}

void setBuzzer(bool turnOn) {
  buzzerActive = turnOn;
  if (!turnOn) {
    buzzerOutputState = false;
    digitalWrite(BUZZER_PIN, BUZZER_OFF);
  }
}

void handleBuzzerTone() {
  if (!buzzerActive) return;

  // Tao nhip canh bao su co: mot doan dai, hai doan ngan, sau do nghi va lap lai.
  // Mau nhip nhanh: keu dai 420ms -> nghi 90ms -> keu ngan 110ms -> nghi 70ms -> keu ngan 110ms -> nghi.
  // BUZZER_PASSIVE=0: cap muc HIGH/LOW theo nhip cho coi active/coi bao dong.
  // BUZZER_PASSIVE=1: ben trong khoang "keu" se phat xung khoang 2kHz cho coi passive.
  unsigned long phase = millis() % BUZZER_PATTERN_MS;
  bool alarmWindow =
    phase < 420 ||
    (phase >= 510 && phase < 620) ||
    (phase >= 690 && phase < 800);
  if (!alarmWindow) {
    if (buzzerOutputState) {
      buzzerOutputState = false;
      digitalWrite(BUZZER_PIN, BUZZER_OFF);
    }
    return;
  }

#if BUZZER_PASSIVE
  unsigned long nowUs = micros();
  if (nowUs - lastBuzzerToggleAt >= BUZZER_HALF_PERIOD_US) {
    lastBuzzerToggleAt = nowUs;
    buzzerOutputState = !buzzerOutputState;
    digitalWrite(BUZZER_PIN, buzzerOutputState ? BUZZER_ON : BUZZER_OFF);
  }
#else
  if (!buzzerOutputState) {
    buzzerOutputState = true;
    digitalWrite(BUZZER_PIN, BUZZER_ON);
  }
#endif
}

void turnOffDevice(const String &device) {
  if (device == "irrigation") {
    setRelay(RELAY_PUMP, false);
    pumpOffAt = 0;
    pumpActive = false;
  } else if (device == "fan") {
    setRelay(RELAY_FAN, false);
    fanOffAt = 0;
    fanActive = false;
  } else if (device == "spray") {
    setRelay(RELAY_SPRAY, false);
    sprayOffAt = 0;
    sprayActive = false;
  } else if (device == "buzzer") {
    setBuzzer(false);
    buzzerOffAt = 0;
  }
}

void controlDevice(const String &device, bool turnOn, unsigned long durationSeconds) {
  uint8_t relayPin = RELAY_PUMP;
  unsigned long *offAt = &pumpOffAt;
  bool isBuzzer = false;

  if (device == "fan") {
    relayPin = RELAY_FAN;
    offAt = &fanOffAt;
  } else if (device == "spray") {
    relayPin = RELAY_SPRAY;
    offAt = &sprayOffAt;
  } else if (device == "buzzer") {
    offAt = &buzzerOffAt;
    isBuzzer = true;
  }

  if (isBuzzer) {
    setBuzzer(turnOn);
  } else {
    setRelay(relayPin, turnOn);
  }

  if (device == "fan") {
    fanActive = turnOn;
  } else if (device == "spray") {
    sprayActive = turnOn;
  } else if (device == "buzzer") {
    buzzerActive = turnOn;
  } else {
    pumpActive = turnOn;
  }

  // Neu web gui kem duration, ESP32 tu tat sau so giay do de tranh thiet bi chay qua lau.
  if (turnOn && durationSeconds > 0) {
    *offAt = millis() + durationSeconds * 1000UL;
  } else if (!turnOn) {
    *offAt = 0;
  }

  Serial.print(turnOn ? "BAT " : "TAT ");
  Serial.print(device);
  if (durationSeconds > 0) {
    Serial.print(" trong ");
    Serial.print(durationSeconds);
    Serial.print(" giay");
  }
  Serial.println();
}

int readAdcStable(uint8_t pin, uint8_t samples = 8) {
  analogRead(pin);              // Bo lan doc dau sau khi ESP32 doi kenh ADC.
  delayMicroseconds(250);

  uint32_t total = 0;
  for (uint8_t i = 0; i < samples; i++) {
    total += analogRead(pin);
    delayMicroseconds(250);
  }
  return total / samples;
}

bool sampleFlameSensor() {
  lastFlameRaw = analogRead(FLAME_AO_PIN);
  bool flameDigitalDetected = digitalRead(FLAME_DO_PIN) == FLAME_DO_DETECTED_LEVEL;
  bool flameAnalogDetected = false;
#if FLAME_USE_ANALOG_TRIGGER
  flameAnalogDetected = lastFlameRaw > 50 && lastFlameRaw <= FLAME_AO_TRIGGER_BELOW;
#endif
  return flameDigitalDetected || flameAnalogDetected;
}

bool startBh1750At(uint8_t address) {
  Wire.beginTransmission(address);
  Wire.write(BH1750_POWER_ON);
  if (Wire.endTransmission() != 0) return false;
  delay(10);

  Wire.beginTransmission(address);
  Wire.write(BH1750_CONT_HIGH_RES_MODE);
  return Wire.endTransmission() == 0;
}

void setupLightSensor() {
  if (startBh1750At(BH1750_ADDR_LOW)) {
    lightSensorAddress = BH1750_ADDR_LOW;
  } else if (startBh1750At(BH1750_ADDR_HIGH)) {
    lightSensorAddress = BH1750_ADDR_HIGH;
  } else {
    lightReady = false;
    lastLightLux = 0;
    lastLightRaw = 0;
    Serial.println("Khong tim thay cam bien anh sang BH1750, kiem tra SDA/SCL/VCC/GND/ADDR");
    return;
  }

  lightReady = true;
  Serial.print("Da ket noi BH1750 tai dia chi I2C 0x");
  Serial.println(lightSensorAddress, HEX);
}

void readLightSensor() {
  if (!lightReady) {
    setupLightSensor();
    return;
  }

  uint8_t byteCount = Wire.requestFrom((int)lightSensorAddress, 2);
  if (byteCount != 2 || Wire.available() < 2) {
    lightReady = false;
    lastLightLux = 0;
    lastLightRaw = 0;
    Serial.println("Loi doc BH1750, se thu ket noi lai");
    return;
  }

  uint16_t rawValue = ((uint16_t)Wire.read() << 8) | Wire.read();
  lastLightRaw = rawValue;
  lastLightLux = constrain((int)(rawValue / 1.2), 0, LIGHT_MAX_LUX);
}

void readSensors() {
  unsigned long now = millis();
  if (now - lastSensorReadAt < SENSOR_READ_INTERVAL_MS) return;
  lastSensorReadAt = now;

  if (lastDhtReadAt == 0 || now - lastDhtReadAt >= DHT_READ_INTERVAL_MS) {
    lastDhtReadAt = now;
    float humidity = dht.readHumidity();
    float temperature = dht.readTemperature();
    if (!isnan(humidity) && !isnan(temperature)) {
      lastHumidity = humidity;
      lastTemperature = temperature;
    } else {
      // DHT11 loi se lap lai rat nhieu, chi in moi 10 giay de khong che mat log WiFi/MQTT.
      if (now - lastDhtWarningAt > 10000) {
        lastDhtWarningAt = now;
        Serial.println("Khong doc duoc DHT11, giu gia tri gan nhat");
      }
    }
  }

  lastSoilRaw = readAdcStable(SOIL_PIN);
  lastSoilMoisture = map(lastSoilRaw, SOIL_RAW_DRY, SOIL_RAW_WET, 0, 100);
  lastSoilMoisture = constrain(lastSoilMoisture, 0, 100);

  readLightSensor();

  lastGasRaw = readAdcStable(MQ135_PIN);
  bool flameNow = sampleFlameSensor();
  if (flameNow) flameLatchUntil = millis() + FLAME_LATCH_MS;
  lastFlameDetected = flameNow || millis() < flameLatchUntil;
}

void printSensorDebug() {
  if (millis() - lastSensorDebugAt < 5000) return;
  lastSensorDebugAt = millis();

  Serial.print("Sensor raw | soil=");
  Serial.print(lastSoilRaw);
  Serial.print(" -> ");
  Serial.print(lastSoilMoisture);
  Serial.print("% | gas=");
  Serial.print(lastGasRaw);
  Serial.print(" | light=");
  Serial.print(lastLightRaw);
  Serial.print(" -> ");
  Serial.print(lastLightLux);
  Serial.print(" lux | flameDO=");
  Serial.print(digitalRead(FLAME_DO_PIN));
  Serial.print(" flameAO=");
  Serial.print(lastFlameRaw);
  Serial.print(" flame=");
  Serial.println(lastFlameDetected ? "CO" : "KO");
}

void setupDisplay() {
  Wire.begin(OLED_SDA, OLED_SCL);
  oledReady = oled.begin(OLED_ADDR, true);

  if (!oledReady) {
    Serial.println("Khong tim thay OLED, kiem tra SDA/SCL/nguon");
    return;
  }

  oled.clearDisplay();
  oled.setTextColor(SH110X_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println("Smart Garden IoT");
  oled.println("Dang khoi dong...");
  oled.display();
}

void updateDisplay() {
  if (!oledReady) return;
  if (millis() - lastDisplayUpdateAt < DISPLAY_UPDATE_INTERVAL_MS) return;
  lastDisplayUpdateAt = millis();

  oled.clearDisplay();
  oled.setTextSize(1);
  oled.setTextColor(SH110X_WHITE);

  oled.setCursor(0, 0);
  oled.print("WiFi:");
  oled.print(WiFi.status() == WL_CONNECTED ? "OK" : "NO");
  oled.print(" MQTT:");
  oled.println(mqttClient.connected() ? "OK" : "NO");

  oled.setCursor(0, 12);
  oled.print("T:");
  oled.print(lastTemperature, 1);
  oled.print("C  H:");
  oled.print(lastHumidity, 0);
  oled.println("%");

  oled.setCursor(0, 24);
  oled.print("Dat:");
  oled.print(lastSoilMoisture);
  oled.print("% Lua:");
  oled.println(lastFlameDetected ? "CO" : "KO");

  oled.setCursor(0, 38);
  oled.print("AS:");
  oled.print(lastLightLux);
  oled.print(" MQ:");
  oled.print(lastGasRaw);

  oled.setCursor(0, 50);
  oled.print("B:");
  oled.print(pumpActive ? "1 " : "0 ");
  oled.print(" Q:");
  oled.print(fanActive ? "1 " : "0 ");
  oled.print("P:");
  oled.print(sprayActive ? "1 " : "0 ");
  oled.print("C:");
  oled.print(buzzerActive ? "1" : "0");

  oled.display();
}

String deviceFromTopic(const String &topic) {
  if (topic == TOPIC_FAN) return "fan";
  if (topic == TOPIC_SPRAY) return "spray";
  if (topic == TOPIC_BUZZER) return "buzzer";
  return "irrigation";
}

bool isOnState(const String &stateText) {
  String value = stateText;
  value.toLowerCase();
  return value == "on" || value == "1" || value == "true" || value == "bat";
}

void onMqttMessage(char *topic, byte *payload, unsigned int length) {
  String topicText = String(topic);
  String message;

  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }

  Serial.print("Nhan lenh MQTT ");
  Serial.print(topicText);
  Serial.print(": ");
  Serial.println(message);

  String device = deviceFromTopic(topicText);
  String state = message;
  unsigned long duration = 0;

  StaticJsonDocument<384> doc;
  DeserializationError error = deserializeJson(doc, message);
  if (!error) {
    if (doc["device"].is<const char *>()) device = doc["device"].as<String>();
    if (doc["state"].is<const char *>()) state = doc["state"].as<String>();
    if (doc["duration"].is<unsigned long>()) duration = doc["duration"].as<unsigned long>();
  }

  controlDevice(device, isOnState(state), duration);
}

void connectMqttIfNeeded() {
  if (WiFi.status() != WL_CONNECTED || mqttClient.connected()) return;
  if (millis() - lastMqttReconnectAt < MQTT_RECONNECT_INTERVAL_MS) return;

  lastMqttReconnectAt = millis();
  Serial.println("Dang ket noi MQTT...");

  String clientId = "smart-garden-esp32-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  if (mqttClient.connect(clientId.c_str(), MQTT_USER, MQTT_PASS)) {
    Serial.println("Da ket noi MQTT");
    mqttClient.subscribe(TOPIC_PUMP);
    mqttClient.subscribe(TOPIC_FAN);
    mqttClient.subscribe(TOPIC_SPRAY);
    mqttClient.subscribe(TOPIC_BUZZER);
  } else {
    Serial.print("Loi MQTT, state = ");
    Serial.println(mqttClient.state());
  }
}

void printConnectionDebug() {
  if (millis() - lastWifiDebugAt < 5000) return;
  lastWifiDebugAt = millis();

  Serial.print("WiFi status: ");
  Serial.print(WiFi.status());
  Serial.print(" | SSID: ");
  Serial.print(WiFi.SSID());
  Serial.print(" | IP: ");
  Serial.print(WiFi.localIP());
  Serial.print(" | MQTT: ");
  Serial.println(mqttClient.connected() ? "OK" : "NO");
}

void publishSensorData(bool force = false) {
  if (!mqttClient.connected()) return;
  if (!force && millis() - lastSensorSendAt < SENSOR_SEND_INTERVAL_MS) return;
  lastSensorSendAt = millis();

  StaticJsonDocument<384> doc;
  doc["source"] = "esp32";
  doc["temperature"] = lastTemperature;
  doc["humidity"] = lastHumidity;
  doc["soil_moisture"] = lastSoilMoisture;
  doc["light"] = lastLightLux;
  doc["light_raw"] = lastLightRaw;
  doc["gas"] = lastGasRaw;
  doc["flame"] = lastFlameDetected ? 1 : 0;
  doc["flame_raw"] = lastFlameRaw;

  char json[384];
  serializeJson(doc, json);
  mqttClient.publish(TOPIC_SENSOR, json);

  Serial.print("Gui sensor: ");
  Serial.println(json);
}

void handleFlameInstantDetection() {
  if (millis() - lastFlameScanAt < FLAME_FAST_SCAN_INTERVAL_MS) return;
  lastFlameScanAt = millis();

  bool flameNow = sampleFlameSensor();
  if (!flameNow) {
    lastFlameDetected = millis() < flameLatchUntil;
    return;
  }

  flameLatchUntil = millis() + FLAME_LATCH_MS;
  lastFlameDetected = true;

  if (mqttClient.connected() && millis() - lastFlameEventPublishAt >= FLAME_EVENT_REPEAT_MS) {
    lastFlameEventPublishAt = millis();
    publishSensorData(true);
    Serial.println("CANH BAO LUA: gui MQTT ngay");
  }
}

void handleAutoOffRelay() {
  unsigned long now = millis();
  if (pumpOffAt > 0 && now >= pumpOffAt) turnOffDevice("irrigation");
  if (fanOffAt > 0 && now >= fanOffAt) turnOffDevice("fan");
  if (sprayOffAt > 0 && now >= sprayOffAt) turnOffDevice("spray");
  if (buzzerOffAt > 0 && now >= buzzerOffAt) turnOffDevice("buzzer");
}

void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PUMP, OUTPUT);
  pinMode(RELAY_FAN, OUTPUT);
  pinMode(RELAY_SPRAY, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(FLAME_DO_PIN, INPUT_PULLUP);
  pinMode(SOIL_PIN, INPUT);
  pinMode(MQ135_PIN, INPUT);
  pinMode(FLAME_AO_PIN, INPUT);
  setRelay(RELAY_PUMP, false);
  setRelay(RELAY_FAN, false);
  setRelay(RELAY_SPRAY, false);
  setBuzzer(false);

  dht.begin();
  analogReadResolution(12);
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);
  analogSetPinAttenuation(MQ135_PIN, ADC_11db);
  analogSetPinAttenuation(FLAME_AO_PIN, ADC_11db);
  setupDisplay();
  setupLightSensor();

  // HiveMQ Cloud dung TLS. setInsecure giup test nhanh khong can nap certificate.
  secureClient.setInsecure();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(512);

  wifiConfig.begin();
}

void loop() {
  wifiConfig.run();
  connectMqttIfNeeded();
  mqttClient.loop();
  printConnectionDebug();
  handleFlameInstantDetection();
  readSensors();
  printSensorDebug();
  publishSensorData();
  handleAutoOffRelay();
  handleBuzzerTone();
  updateDisplay();
}
