#include <Arduino.h>
#include <HTTPClient.h>
#include <VL53L1X.h>
#include <VL53L0X.h>
#include "config.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <atomic>
#include <esp_timer.h>
#include <time.h>
#include "ca_cert.h"
#include "secrets.h"
#include "wifi_setup.h"

namespace {
constexpr uint8_t SDA_PIN = 21;
constexpr uint8_t SCL_PIN = 22;
constexpr uint8_t XSHUT_A_PIN = 18;
constexpr uint8_t XSHUT_B_PIN = 19;
constexpr uint16_t DETECT_DISTANCE_MM = 900;
constexpr uint16_t CLEAR_DISTANCE_MM = 1050;
constexpr uint8_t STABLE_SAMPLES = 3;
// A brief gap between an arm and torso must not re-arm the counter.
constexpr uint32_t CLEAR_HOLD_MS = 500;
constexpr uint32_t HEARTBEAT_MS = 20000;
constexpr uint32_t MAX_EVENT_AGE_MS = 30000;
constexpr char DEVICE_ID[] = "cafeteria-gate-01";
constexpr char FIRMWARE_VERSION[] = "1.5.0";
WifiSetup wifiSetup;

// Both supported chips can be used, including one of each in two-sensor mode.
struct DistanceSensor {
  VL53L0X l0;
  VL53L1X l1;
  uint8_t model = 0;
  bool begin(uint8_t address) {
    l0.setTimeout(100);
    l1.setTimeout(100);
    if (l1.readReg16Bit(VL53L1X::IDENTIFICATION__MODEL_ID) == 0xEACC) {
      if (!l1.init()) return false;
      l1.setAddress(address);
      if (!l1.setDistanceMode(VL53L1X::Long) || !l1.setMeasurementTimingBudget(50000)) return false;
      l1.startContinuous(60);
      model = 1;
      Serial.printf("SENSOR 0x%02X: VL53L1X OK\n", address);
    } else if (l0.readReg(0xC0) == 0xEE) {
      if (!l0.init()) return false;
      l0.setAddress(address);
      if (!l0.setMeasurementTimingBudget(50000)) return false;
      l0.startContinuous(60);
      model = 2;
      Serial.printf("SENSOR 0x%02X: VL53L0X OK\n", address);
    } else return false;
    return true;
  }
  bool read(uint16_t& mm, bool& valid, bool& noTarget) {
    noTarget = false;
    if (model == 1) {
      if (!l1.dataReady()) return false;
      mm = l1.read(false);
      valid = !l1.timeoutOccurred() && l1.last_status == 0 &&
          l1.ranging_data.range_status == VL53L1X::RangeValid;
    } else {
      if (!(l0.readReg(VL53L0X::RESULT_INTERRUPT_STATUS) & 0x07) || l0.last_status != 0) return false;
      mm = l0.readRangeContinuousMillimeters();
      valid = !l0.timeoutOccurred() && l0.last_status == 0;
      noTarget = valid && mm >= 8190;
      valid = valid && !noTarget;
    }
    return true;
  }
};
DistanceSensor sensorA;
DistanceSensor sensorB;
std::atomic<bool> sensorsReady{false};
std::atomic<bool> networkReady{false};
char bootId[17];
uint32_t sequenceNumber = 0;
QueueHandle_t eventQueue = nullptr;

struct BeamState {
  bool blocked = false;
  bool armed = false;
  bool pendingPassage = false;
  uint16_t passageDistance = 0;
  uint8_t blockedSamples = 0;
  uint8_t clearSamples = 0;
  uint32_t lastFrameMs = 0;
  uint32_t clearSinceMs = 0;
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
  if (SENSOR_COUNT == 1) pinMode(XSHUT_B_PIN, INPUT);
  sensorA = DistanceSensor{};
  if (!sensorA.begin(0x30)) return false;
  if (SENSOR_COUNT == 2) {
    pinMode(XSHUT_B_PIN, INPUT);
    delay(10);
    sensorB = DistanceSensor{};
    if (!sensorB.begin(0x31)) return false;
  }
  beamA = BeamState{};
  beamB = BeamState{};
  beamA.lastFrameMs = beamB.lastFrameMs = millis();
  return true;
}

void sampleBeam(DistanceSensor& sensor, BeamState& beam, char id) {
  uint16_t distance = 0;
  bool valid = false;
  bool noTarget = false;
  if (!sensor.read(distance, valid, noTarget)) {
    if (millis() - beam.lastFrameMs > 250) {
      beam.blockedSamples = beam.clearSamples = 0;
      beam.clearSinceMs = 0;
    }
    return;
  }
  beam.lastFrameMs = millis();
  static uint32_t lastPrint[2] = {0, 0};
  const uint8_t index = id == 'A' ? 0 : 1;
  if (PRINT_DISTANCES && millis() - lastPrint[index] >= 500) {
    lastPrint[index] = millis();
    if (valid) Serial.printf("DISTANCE %c: %u mm (%.1f cm)\n", id, distance, distance / 10.0);
    else Serial.printf("DISTANCE %c: %s\n", id, noTarget ? "OUT OF RANGE" : "INVALID");
  }
  if (noTarget) distance = CLEAR_DISTANCE_MM;
  else if (!valid) {
    beam.blockedSamples = beam.clearSamples = 0;
    beam.clearSinceMs = 0;
    return;
  }
  if (distance > 0 && distance < DETECT_DISTANCE_MM) {
    beam.clearSamples = 0;
    beam.clearSinceMs = 0;
    if (beam.blockedSamples < STABLE_SAMPLES) ++beam.blockedSamples;
    if (!beam.blocked && beam.blockedSamples >= STABLE_SAMPLES) {
      beam.blocked = true;
      Serial.printf("SENSOR %c: %u mm\n", id, static_cast<unsigned>(distance));
      if (SENSOR_COUNT == 1) {
        beam.pendingPassage = beam.armed;
        beam.passageDistance = distance;
        return;
      }
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
    if (beam.clearSamples == 0) beam.clearSinceMs = millis();
    if (beam.clearSamples < STABLE_SAMPLES) ++beam.clearSamples;
    if (beam.clearSamples >= STABLE_SAMPLES &&
        millis() - beam.clearSinceMs >= CLEAR_HOLD_MS) {
      beam.blocked = false;
      beam.armed = true;
      if (SENSOR_COUNT == 1 && beam.pendingPassage) {
        beam.pendingPassage = false;
        if (!networkReady.load()) {
          Serial.println("LOCAL PASSAGE: server not ready; not uploaded.");
        } else {
          SensorEvent event{uptimeMs(), epochMs(), ++sequenceNumber, beam.passageDistance, id};
          if (xQueueSend(eventQueue, &event, 0) != pdTRUE) Serial.println("QUEUE FULL: passage lost.");
          else Serial.println("PASSAGE COMPLETE: queued one person.");
        }
      }
    }
  } else {
    beam.blockedSamples = beam.clearSamples = 0;
    beam.clearSinceMs = 0;
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
  if (json.indexOf("\"kind\":\"event\"") >= 0 && status >= 200 && status < 300) {
    Serial.printf("SERVER RESULT: %s\n", response.c_str());
  }
  http.end();
  if (response.indexOf("\"servingStatus\":\"CLOSED\"") >= 0) Serial.println("SITE CLOSED: connection is ready; enable serving in /admin to display the queue.");
  if (response.indexOf("\"servingStatus\":\"PAUSED\"") >= 0) Serial.println("SITE PAUSED: connection is ready; resume serving in /admin when appropriate.");
  if (status >= 200 && status < 300 && response.indexOf("\"ok\":true") < 0) return -2;
  return status;
}
bool success(int status) { return status >= 200 && status < 300; }
String baseMessage(const char* kind) {
  return String("{\"kind\":\"") + kind + "\",\"deviceId\":\"" + DEVICE_ID + "\",\"bootId\":\"" + bootId + "\",\"sensorMode\":\"" + (SENSOR_COUNT == 1 ? "single" : "paired") + "\"";
}

void wifiSetupTask(void*) {
  wifiSetup.begin(WIFI_SSID, WIFI_PASSWORD);
  for (;;) {
    wifiSetup.poll();
    vTaskDelay(pdMS_TO_TICKS(10));
  }
}

void networkTask(void*) {
  uint32_t wifiRevision = wifiSetup.revision();
  uint32_t lastHeartbeat = 0;
  uint32_t lastNotice = 0;
  bool timeRequested = false;
  bool verified = false;
  bool haveEvent = false;
  SensorEvent event{};
  for (;;) {
    const uint32_t now = millis();
    const uint32_t currentRevision = wifiSetup.revision();
    if (currentRevision != wifiRevision) {
      wifiRevision = currentRevision;
      verified = false;
      timeRequested = false;
      networkReady.store(false);
    }
    if (!wifiSetup.ready()) {
      networkReady.store(false);
      verified = false;
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
      Serial.println(SENSOR_COUNT == 2 ? "SERVER OK: paired sensor events enabled." : "SERVER OK: single-sensor passage counting enabled.");
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
  Serial.printf("Cafeteria gate %s: %u sensor(s), automatic L0X/L1X detection\n", FIRMWARE_VERSION, SENSOR_COUNT);
  snprintf(bootId, sizeof(bootId), "%08lx%08lx", static_cast<unsigned long>(esp_random()), static_cast<unsigned long>(esp_random()));
  Wire.begin(SDA_PIN, SCL_PIN, 100000);
  Wire.setTimeOut(25);
  eventQueue = xQueueCreate(32, sizeof(SensorEvent));
  if (!eventQueue ||
      xTaskCreate(wifiSetupTask, "wifi-setup", 8192, nullptr, 1, nullptr) != pdPASS ||
      xTaskCreate(networkTask, "sensor-network", 12288, nullptr, 1, nullptr) != pdPASS) {
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
      Serial.println(ready ? "SENSORS OK" : "SENSOR INIT FAILED: check configured sensor count and wiring; retrying.");
    }
    delay(5);
    return;
  }
  sampleBeam(sensorA, beamA, 'A');
  if (SENSOR_COUNT == 2) sampleBeam(sensorB, beamB, 'B');
  if (millis() - beamA.lastFrameMs > 5000 || (SENSOR_COUNT == 2 && millis() - beamB.lastFrameMs > 5000)) {
    sensorsReady.store(false);
    Serial.println("SENSOR DATA LOST: restarting sensors.");
  }
  delay(2);
}
