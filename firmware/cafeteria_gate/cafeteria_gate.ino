#include <Arduino.h>
#include <HTTPClient.h>
#include <VL53L1X.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>

#include "secrets.h"

namespace {
constexpr uint8_t SDA_PIN = 21;
constexpr uint8_t SCL_PIN = 22;
constexpr uint8_t XSHUT_A_PIN = 18;
constexpr uint8_t XSHUT_B_PIN = 19;
constexpr uint8_t SENSOR_A_ADDRESS = 0x30;
constexpr uint8_t SENSOR_B_ADDRESS = 0x31;
constexpr uint16_t DETECT_DISTANCE_MM = 900;
constexpr uint8_t STABLE_SAMPLES = 3;
constexpr uint32_t WIFI_RETRY_MS = 10'000;
constexpr char DEVICE_ID[] = "cafeteria-gate-01";
constexpr char FIRMWARE_VERSION[] = "1.0.0";

VL53L1X sensorA;
VL53L1X sensorB;
uint32_t sequenceNumber = 0;
uint32_t bootNonce = 0;
uint32_t lastWiFiAttemptAt = 0;

struct BeamState {
  bool blocked = false;
  uint8_t blockedSamples = 0;
  uint8_t clearSamples = 0;
};

BeamState beamA;
BeamState beamB;

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWiFiAttemptAt < WIFI_RETRY_MS && lastWiFiAttemptAt != 0) return;

  lastWiFiAttemptAt = millis();
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("Wi-Fi connecting to %s", WIFI_SSID);
  for (uint8_t i = 0; i < 30 && WiFi.status() != WL_CONNECTED; ++i) {
    delay(250);
    Serial.print('.');
  }
  Serial.println(WiFi.status() == WL_CONNECTED ? " connected" : " retry later");
}

void startSensor(VL53L1X& sensor, uint8_t address) {
  sensor.setTimeout(500);
  if (!sensor.init()) {
    Serial.printf("VL53L1X init failed at 0x%02X\n", address);
    while (true) delay(1000);
  }
  sensor.setAddress(address);
  sensor.setDistanceMode(VL53L1X::Long);
  sensor.setMeasurementTimingBudget(50'000);
  sensor.startContinuous(60);
}

void startSensors() {
  pinMode(XSHUT_A_PIN, OUTPUT);
  pinMode(XSHUT_B_PIN, OUTPUT);
  digitalWrite(XSHUT_A_PIN, LOW);
  digitalWrite(XSHUT_B_PIN, LOW);
  delay(20);

  digitalWrite(XSHUT_A_PIN, HIGH);
  delay(20);
  startSensor(sensorA, SENSOR_A_ADDRESS);

  digitalWrite(XSHUT_B_PIN, HIGH);
  delay(20);
  startSensor(sensorB, SENSOR_B_ADDRESS);
}

bool sendEvent(char sensorId, uint16_t distanceMm) {
  connectWiFi();
  if (WiFi.status() != WL_CONNECTED) return false;

  ++sequenceNumber;
  const String eventId = String(DEVICE_ID) + '-' + String(bootNonce, HEX) + '-' + String(sequenceNumber);
  const String json = String("{\"eventId\":\"") + eventId +
    "\",\"deviceId\":\"" + DEVICE_ID +
    "\",\"sensorId\":\"" + sensorId +
    "\",\"sequence\":" + sequenceNumber +
    ",\"distanceMm\":" + distanceMm +
    ",\"confidence\":1,\"firmwareVersion\":\"" + FIRMWARE_VERSION + "\"}";

  WiFiClientSecure client;
  // Prototype setting. Install the current CA certificate before permanent operation.
  client.setInsecure();
  HTTPClient http;
  if (!http.begin(client, SENSOR_API_URL)) return false;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", SENSOR_DEVICE_KEY);
  const int status = http.POST(json);
  const String response = http.getString();
  http.end();
  Serial.printf("Sensor %c, %u mm -> HTTP %d %s\n", sensorId, distanceMm, status, response.c_str());
  return status >= 200 && status < 300;
}

void sampleBeam(VL53L1X& sensor, BeamState& state, char sensorId) {
  const uint16_t distance = sensor.read();
  if (sensor.timeoutOccurred()) return;
  const bool detected = distance > 0 && distance < DETECT_DISTANCE_MM;

  if (detected) {
    state.clearSamples = 0;
    if (state.blockedSamples < STABLE_SAMPLES) ++state.blockedSamples;
    if (!state.blocked && state.blockedSamples >= STABLE_SAMPLES) {
      state.blocked = true;
      sendEvent(sensorId, distance);
    }
  } else {
    state.blockedSamples = 0;
    if (state.clearSamples < STABLE_SAMPLES) ++state.clearSamples;
    if (state.clearSamples >= STABLE_SAMPLES) state.blocked = false;
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  bootNonce = esp_random();
  Wire.begin(SDA_PIN, SCL_PIN, 100000);
  connectWiFi();
  startSensors();
  Serial.println("Cafeteria gate ready");
}

void loop() {
  connectWiFi();
  sampleBeam(sensorA, beamA, 'A');
  sampleBeam(sensorB, beamB, 'B');
  delay(20);
}

