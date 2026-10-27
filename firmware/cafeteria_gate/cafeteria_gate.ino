#include <Arduino.h>
#include <HTTPClient.h>
#include <VL53L1X.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <atomic>
#include <esp_timer.h>
#include <time.h>
#include "ca_cert.h"
#include "secrets.h"

namespace {
constexpr uint8_t SDA_PIN = 21;
constexpr uint8_t SCL_PIN = 22;
constexpr uint8_t XSHUT_A_PIN = 18;
constexpr uint8_t XSHUT_B_PIN = 19;
constexpr uint16_t DETECT_DISTANCE_MM = 900;
constexpr uint16_t CLEAR_DISTANCE_MM = 1050;
constexpr uint8_t STABLE_SAMPLES = 3;
constexpr uint32_t HEARTBEAT_MS = 20000;
constexpr uint32_t MAX_EVENT_AGE_MS = 30000;
constexpr char DEVICE_ID[] = "cafeteria-gate-01";
constexpr char FIRMWARE_VERSION[] = "1.1.0";

VL53L1X sensorA;
VL53L1X sensorB;
std::atomic<bool> sensorsReady{false};
std::atomic<bool> networkReady{false};
char bootId[17];
uint32_t sequenceNumber = 0;
QueueHandle_t eventQueue = nullptr;

struct BeamState {
  bool blocked = false;
  uint8_t blockedSamples = 0;
  uint8_t clearSamples = 0;
  uint32_t lastFrameMs = 0;
};
struct SensorEvent {
  uint64_t uptimeMs;
  uint64_t occurredAtMs;
  uint32_t sequence;
  uint16_t distanceMm;
  char sensorId;
};
BeamState beamA;
BeamState beamB;

uint64_t uptimeMs() { return static_cast<uint64_t>(esp_timer_get_time()) / 1000; }
uint64_t epochMs() {
  timeval now;
  gettimeofday(&now, nullptr);
  return static_cast<uint64_t>(now.tv_sec) * 1000 + now.tv_usec / 1000;
}
bool clockReady() { return time(nullptr) >= 1735689600; }

bool initSensor(VL53L1X& sensor, uint8_t address) {
  sensor.setTimeout(100);
  if (!sensor.init()) return false;
  sensor.setAddress(address);
  if (!sensor.setDistanceMode(VL53L1X::Long) || !sensor.setMeasurementTimingBudget(50000)) return false;
  sensor.startContinuous(60);
  return true;
}
bool startSensors() {
  // LOW disables the sensor. INPUT releases XSHUT to its carrier's pull-up;
  // never actively drive a 2.8 V XSHUT pin HIGH with the ESP32's 3.3 V output.
  digitalWrite(XSHUT_A_PIN, LOW);
  digitalWrite(XSHUT_B_PIN, LOW);
  pinMode(XSHUT_A_PIN, OUTPUT);
  pinMode(XSHUT_B_PIN, OUTPUT);
  delay(10);
  pinMode(XSHUT_A_PIN, INPUT);
  delay(10);
  if (!initSensor(sensorA, 0x30)) return false;
  pinMode(XSHUT_B_PIN, INPUT);
  delay(10);
  if (!initSensor(sensorB, 0x31)) return false;
  beamA = BeamState{};
  beamB = BeamState{};
  beamA.lastFrameMs = beamB.lastFrameMs = millis();
  return true;
}

void sampleBeam(VL53L1X& sensor, BeamState& beam, char id) {
  if (!sensor.dataReady() || sensor.last_status != 0) return;
  const uint16_t distance = sensor.read(false);
  beam.lastFrameMs = millis();
  if (sensor.timeoutOccurred() || sensor.last_status != 0 ||
      sensor.ranging_data.range_status != VL53L1X::RangeValid) {
    beam.blockedSamples = beam.clearSamples = 0;
    return;
  }
  if (distance > 0 && distance < DETECT_DISTANCE_MM) {
    beam.clearSamples = 0;
    if (beam.blockedSamples < STABLE_SAMPLES) ++beam.blockedSamples;
    if (!beam.blocked && beam.blockedSamples >= STABLE_SAMPLES) {
      beam.blocked = true;
      Serial.printf("SENSOR %c: %u mm\n", id, static_cast<unsigned>(distance));
      if (!networkReady.load()) {
        Serial.println("LOCAL ONLY: Wi-Fi/server not ready; event not uploaded.");
        return;
      }
      SensorEvent event{uptimeMs(), epochMs(), ++sequenceNumber, distance, id};
      if (xQueueSend(eventQueue, &event, 0) != pdTRUE) {
        Serial.println("QUEUE FULL: event lost. Check the network before counting.");
      }
    }
  } else if (distance >= CLEAR_DISTANCE_MM) {
    beam.blockedSamples = 0;
    if (beam.clearSamples < STABLE_SAMPLES) ++beam.clearSamples;
    if (beam.clearSamples >= STABLE_SAMPLES) beam.blocked = false;
  } else {
    beam.blockedSamples = beam.clearSamples = 0;
  }
}

int postJson(const String& json) {
  WiFiClientSecure client;
  client.setCACert(SERVER_ROOT_CA);
  client.setHandshakeTimeout(10);
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(7000);
  if (!http.begin(client, SENSOR_API_URL)) return -1;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", SENSOR_DEVICE_KEY);
  const int status = http.POST(json);
  // A 2xx transport response alone is insufficient if the body is malformed.
  const String response = http.getString();
  http.end();
  if (response.indexOf("\"servingStatus\":\"CLOSED\"") >= 0) Serial.println("SITE CLOSED: connection is ready; enable serving in /admin to display the queue.");
  if (response.indexOf("\"servingStatus\":\"PAUSED\"") >= 0) Serial.println("SITE PAUSED: connection is ready; resume serving in /admin when appropriate.");
  if (status >= 200 && status < 300 && response.indexOf("\"ok\":true") < 0) return -2;
  return status;
}
bool success(int status) { return status >= 200 && status < 300; }
String baseMessage(const char* kind) {
  return String("{\"kind\":\"") + kind + "\",\"deviceId\":\"" + DEVICE_ID + "\",\"bootId\":\"" + bootId + "\"";
}

void networkTask(void*) {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  uint32_t lastConnect = 0;
  uint32_t lastHeartbeat = 0;
  uint32_t lastNotice = 0;
  bool connecting = false;
  bool timeRequested = false;
  bool verified = false;
  bool haveEvent = false;
  SensorEvent event{};
  for (;;) {
    const uint32_t now = millis();
    if (strlen(WIFI_SSID) == 0) {
      networkReady.store(false);
      if (lastNotice == 0 || now - lastNotice >= 30000) {
        Serial.println("WIFI NOT SET: fill WIFI_SSID / WIFI_PASSWORD in secrets.h, then upload again.");
        lastNotice = now;
      }
      vTaskDelay(pdMS_TO_TICKS(250));
      continue;
    }
    if (WiFi.status() != WL_CONNECTED) {
      networkReady.store(false);
      verified = false;
      if (!connecting || now - lastConnect >= 15000) {
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
        lastConnect = now;
        connecting = true;
        Serial.println("WIFI CONNECTING (2.4 GHz)...");
      }
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }
    if (!timeRequested) {
      configTime(0, 0, "pool.ntp.org", "time.google.com", "time.cloudflare.com");
      timeRequested = true;
      Serial.println("WIFI OK; synchronizing time for HTTPS...");
    }
    if (!clockReady()) {
      networkReady.store(false);
      if (now - lastNotice >= 15000) {
        Serial.println("WAITING FOR TIME: allow NTP (UDP 123) on this Wi-Fi network.");
        lastNotice = now;
      }
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }
    if (!verified) {
      const int status = postJson(baseMessage("check") + "}");
      if (!success(status)) {
        networkReady.store(false);
        Serial.printf("SERVER CHECK HTTP %d (401=key, 503=server, negative=TLS/network).\n", status);
        vTaskDelay(pdMS_TO_TICKS(5000));
        continue;
      }
      verified = true;
      networkReady.store(true);
      lastHeartbeat = now - HEARTBEAT_MS;
      Serial.println("SERVER OK: sensor data will upload automatically.");
    }
    if (millis() - lastHeartbeat >= HEARTBEAT_MS) {
      const String json = baseMessage("heartbeat") + ",\"sensorsReady\":" +
        (sensorsReady.load() ? "true" : "false") + ",\"firmwareVersion\":\"" + FIRMWARE_VERSION + "\"}";
      const int status = postJson(json);
      lastHeartbeat = millis();
      Serial.printf("HEARTBEAT HTTP %d\n", status);
      if (status == 401 || status == 403) {
        verified = false;
        networkReady.store(false);
        continue;
      }
    }
    if (!haveEvent) haveEvent = xQueueReceive(eventQueue, &event, pdMS_TO_TICKS(50)) == pdTRUE;
    if (!haveEvent) continue;
    if (uptimeMs() - event.uptimeMs > MAX_EVENT_AGE_MS) {
      Serial.println("EVENT EXPIRED: network delay exceeded 30 seconds; event not counted.");
      haveEvent = false;
      continue;
    }
    char eventId[100];
    snprintf(eventId, sizeof(eventId), "%s-%s-%lu", DEVICE_ID, bootId, static_cast<unsigned long>(event.sequence));
    char values[260];
    snprintf(values, sizeof(values), ",\"eventId\":\"%s\",\"sensorId\":\"%c\",\"sequence\":%lu,\"uptimeMs\":%llu,\"occurredAtMs\":%llu,\"distanceMm\":%u,\"firmwareVersion\":\"%s\"}",
      eventId, event.sensorId, static_cast<unsigned long>(event.sequence),
      static_cast<unsigned long long>(event.uptimeMs), static_cast<unsigned long long>(event.occurredAtMs),
      static_cast<unsigned>(event.distanceMm), FIRMWARE_VERSION);
    const int status = postJson(baseMessage("event") + values);
    Serial.printf("UPLOAD %c #%lu HTTP %d\n", event.sensorId, static_cast<unsigned long>(event.sequence), status);
    if (success(status) || (status >= 400 && status < 500 && status != 408 && status != 429 && status != 401 && status != 403)) {
      haveEvent = false;
    } else {
      // Keep the original ID and FIFO order, so server retries cannot count twice.
      if (status == 401 || status == 403) { verified = false; networkReady.store(false); }
      vTaskDelay(pdMS_TO_TICKS(1000));
    }
  }
}
}  // namespace

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("Cafeteria gate 1.1.0: two VL53L1X sensors, ESP32 Dev Module");
  snprintf(bootId, sizeof(bootId), "%08lx%08lx", static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  Wire.begin(SDA_PIN, SCL_PIN, 100000);
  Wire.setTimeOut(25);
  eventQueue = xQueueCreate(32, sizeof(SensorEvent));
  if (!eventQueue || xTaskCreate(networkTask, "sensor-network", 12288, nullptr, 1, nullptr) != pdPASS) {
    Serial.println("START FAILED: not enough memory. Press EN to retry.");
    while (true) delay(1000);
  }
}

void loop() {
  static uint32_t lastInit = 0;
  if (!sensorsReady.load()) {
    if (lastInit == 0 || millis() - lastInit >= 3000) {
      lastInit = millis();
      const bool ready = startSensors();
      sensorsReady.store(ready);
      Serial.println(ready ? "SENSORS OK: A=0x30, B=0x31" : "SENSOR INIT FAILED: check both sensors and XSHUT wires; retrying.");
    }
    delay(5);
    return;
  }
  sampleBeam(sensorA, beamA, 'A');
  sampleBeam(sensorB, beamB, 'B');
  if (millis() - beamA.lastFrameMs > 5000 || millis() - beamB.lastFrameMs > 5000) {
    sensorsReady.store(false);
    Serial.println("SENSOR DATA LOST: restarting sensors.");
  }
  delay(2);
}
