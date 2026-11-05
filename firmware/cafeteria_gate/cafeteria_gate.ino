#include <Arduino.h>
#include <HTTPClient.h>
#include <Preferences.h>
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
std::atomic<uint32_t> detectDistanceMm{1500};
constexpr uint8_t STABLE_SAMPLES = 3;
// A brief gap between an arm and torso must not re-arm the counter.
constexpr uint32_t CLEAR_HOLD_MS = 500;
constexpr uint32_t HEARTBEAT_MS = 10000;
constexpr uint32_t RAW_BATCH_MS = 120;
constexpr uint32_t RAW_IDLE_REFRESH_MS = 2000;
constexpr uint32_t MAX_EVENT_AGE_MS = 300000;
constexpr char DEVICE_ID[] = "cafeteria-gate-01";
constexpr char FIRMWARE_VERSION[] = "1.9.1";
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
      const bool transportOk = !l1.timeoutOccurred() && l1.last_status == 0;
      const auto status = l1.ranging_data.range_status;
      valid = transportOk && (status == VL53L1X::RangeValid ||
          status == VL53L1X::RangeValidMinRangeClipped ||
          status == VL53L1X::RangeValidNoWrapCheckFail);
      noTarget = transportOk && status == VL53L1X::OutOfBoundsFail;
      if (valid && mm == 0) mm = 1;
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
std::atomic<uint32_t> droppedEvents{0};
char bootId[17];
uint32_t sequenceNumber = 0;
QueueHandle_t eventQueue = nullptr;
QueueHandle_t rawQueue = nullptr;
struct RawFrame { uint64_t at; uint16_t mm; uint8_t quality; };
struct RawBatch { uint64_t uptimeMs; uint64_t occurredAtMs; uint32_t sequence; uint8_t count; RawFrame frames[20]; };

struct BeamState {
  bool blocked = false;
  bool armed = false;
  bool pendingPassage = false;
  uint16_t passageDistance = 0;
  uint8_t blockedSamples = 0;
  uint8_t clearSamples = 0;
  uint32_t lastFrameMs = 0;
  uint32_t lastUsableFrameMs = 0;
  uint32_t clearSinceMs = 0;
  uint16_t configuredDistanceMm = 0;
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

String uint64String(uint64_t value) { char text[24]; snprintf(text, sizeof(text), "%llu", static_cast<unsigned long long>(value)); return String(text); }
uint64_t uptimeMs() { return static_cast<uint64_t>(esp_timer_get_time()) / 1000; }
uint64_t epochMs() {
  timeval now;
  gettimeofday(&now, nullptr);
  return static_cast<uint64_t>(now.tv_sec) * 1000 + now.tv_usec / 1000;
}
bool clockReady() { return time(nullptr) >= 1735689600; }

// A reset of the ESP32 does not reset a separately powered sensor when XSHUT
// is unconnected. Restore its previous assigned address before library init.
void recoverSingleSensorAddress() {
  Wire.beginTransmission(0x29);
  if (Wire.endTransmission() == 0) return;
  for (uint8_t address = 0x30; address <= 0x31; ++address) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() != 0) continue;
    Wire.beginTransmission(address);
    Wire.write(uint8_t(0x01));
    Wire.write(uint8_t(0x0F));
    const bool selected = Wire.endTransmission(false) == 0;
    uint16_t model = 0;
    if (selected && Wire.requestFrom(address, uint8_t(2)) == 2) {
      model = uint16_t(Wire.read()) << 8;
      model |= Wire.read();
    }
    const bool l1 = model == 0xEACC;
    if (!l1) {
      Wire.beginTransmission(address);
      Wire.write(uint8_t(0xC0));
      if (Wire.endTransmission(false) != 0 ||
          Wire.requestFrom(address, uint8_t(1)) != 1 || Wire.read() != 0xEE) continue;
    }
    Wire.beginTransmission(address);
    if (l1) { Wire.write(uint8_t(0x00)); Wire.write(uint8_t(0x01)); }
    else Wire.write(uint8_t(0x8A));
    Wire.write(uint8_t(0x29));
    if (Wire.endTransmission() == 0) {
      Serial.printf("SENSOR ADDRESS RECOVERED: 0x%02X -> 0x29\n", address);
      delay(10);
      return;
    }
  }
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
  if (SENSOR_COUNT == 1) {
    pinMode(XSHUT_B_PIN, INPUT);
    recoverSingleSensorAddress();
  }
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
  beamA.lastUsableFrameMs = beamB.lastUsableFrameMs = millis();
  return true;
}

// Forward measurements only: all presence/pass counting runs on the server.
void sampleRaw(DistanceSensor& sensor, BeamState& health) {
  static RawBatch batch{};
  static RawBatch retained{};
  static bool hasRetained = false;
  static uint64_t sentAt = 0;
  static uint64_t activeUntil = 0;
  static uint16_t sentMm = 0;
  static uint8_t sentQuality = 255;
  uint16_t mm = 0; bool valid = false, noTarget = false;
  if (!sensor.read(mm, valid, noTarget)) return;
  health.lastFrameMs = millis();
  if (valid || noTarget) health.lastUsableFrameMs = millis();
  const uint8_t quality = noTarget ? 2 : valid ? 1 : 0;
  const uint64_t captured = uptimeMs();
  batch.frames[batch.count++] = RawFrame{captured, mm, quality};
  batch.uptimeMs = captured;
  batch.occurredAtMs = clockReady() ? epochMs() : 0;
  const bool signalChanged = sentQuality != quality || abs(int(sentMm) - int(mm)) > 20;
  if (!signalChanged && batch.count < 20 && batch.uptimeMs - batch.frames[0].at < RAW_BATCH_MS && batch.uptimeMs - sentAt < RAW_IDLE_REFRESH_MS) return;
  bool unchanged = sentQuality == quality && abs(int(sentMm) - int(mm)) <= 20;
  for (uint8_t i = 0; i < batch.count; ++i)
    if (batch.frames[i].quality != quality || abs(int(batch.frames[i].mm) - int(mm)) > 20) unchanged = false;
  // Generic telemetry compression; it never classifies people or passages.
  if (!unchanged) activeUntil = batch.uptimeMs + 1000;
  if (!unchanged || batch.uptimeMs <= activeUntil || batch.uptimeMs - sentAt >= RAW_IDLE_REFRESH_MS) {
    // Preserve the latest skipped measurements before a signal change. This
    // prevents compression from hiding a slow crossing near any web threshold.
    if (hasRetained) {
      retained.sequence = ++sequenceNumber;
      if (xQueueSend(rawQueue, &retained, 0) != pdTRUE) droppedEvents.fetch_add(1);
    }
    hasRetained = false;
    batch.sequence = ++sequenceNumber;
    if (xQueueSend(rawQueue, &batch, 0) != pdTRUE) droppedEvents.fetch_add(1);
    else { sentAt = batch.uptimeMs; sentMm = mm; sentQuality = quality; }
  } else {
    // Keep a full trailing window, not just one short packet. The server needs
    // at least 500 ms of continuous clear samples to arm before a crossing.
    const uint8_t keep = hasRetained ? std::min<uint8_t>(retained.count, 20 - batch.count) : 0;
    for (uint8_t i = 0; i < keep; ++i) retained.frames[i] = retained.frames[retained.count - keep + i];
    for (uint8_t i = 0; i < batch.count; ++i) retained.frames[keep + i] = batch.frames[i];
    retained.count = keep + batch.count;
    retained.uptimeMs = batch.uptimeMs;
    retained.occurredAtMs = batch.occurredAtMs;
    hasRetained = true;
  }
  batch = RawBatch{};
}

void sampleBeam(DistanceSensor& sensor, BeamState& beam, char id) {
  const uint16_t detect = detectDistanceMm.load();
  const uint16_t clear = detect + 150;
  if (beam.configuredDistanceMm != detect) {
    beam = BeamState{};
    beam.configuredDistanceMm = detect;
    beam.lastFrameMs = beam.lastUsableFrameMs = millis();
  }
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
  if (valid || noTarget) beam.lastUsableFrameMs = millis();
  if (noTarget) distance = clear;
  else if (!valid) {
    beam.blockedSamples = beam.clearSamples = 0;
    beam.clearSinceMs = 0;
    return;
  }
  if (distance > 0 && distance < detect) {
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
      SensorEvent event{uptimeMs(), clockReady() ? epochMs() : 0, ++sequenceNumber, distance, id};
      if (xQueueSend(eventQueue, &event, 0) != pdTRUE) {
        droppedEvents.fetch_add(1);
        Serial.println("QUEUE FULL: event lost. Check the network before counting.");
      }
    }
  } else if (distance >= clear) {
    beam.blockedSamples = 0;
    if (beam.clearSamples == 0) beam.clearSinceMs = millis();
    if (beam.clearSamples < STABLE_SAMPLES) ++beam.clearSamples;
    if (beam.clearSamples >= STABLE_SAMPLES &&
        millis() - beam.clearSinceMs >= CLEAR_HOLD_MS) {
      beam.blocked = false;
      beam.armed = true;
      if (SENSOR_COUNT == 1 && beam.pendingPassage) {
        beam.pendingPassage = false;
        SensorEvent event{uptimeMs(), clockReady() ? epochMs() : 0, ++sequenceNumber, beam.passageDistance, id};
        if (xQueueSend(eventQueue, &event, 0) != pdTRUE) {
          droppedEvents.fetch_add(1);
          Serial.println("QUEUE FULL: passage lost.");
        } else Serial.println("PASSAGE COMPLETE: queued one person (offline buffering enabled).");
      }
    }
  } else {
    beam.blockedSamples = beam.clearSamples = 0;
    beam.clearSinceMs = 0;
  }
}

int postJson(const String& json) {
  static WiFiClientSecure client;
  client.setCACert(SERVER_ROOT_CA);
  client.setHandshakeTimeout(5);
  static HTTPClient http;
  http.setReuse(true);
  http.setConnectTimeout(3000);
  http.setTimeout(10000);
  if (!http.begin(client, SENSOR_API_URL)) return -1;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", SENSOR_DEVICE_KEY);
  const bool reusedSocket = client.connected();
  const uint64_t requestStart = uptimeMs();
  const int status = http.POST(json);
  // A 2xx transport response alone is insufficient if the body is malformed.
  const String response = http.getString();
  if (json.indexOf("\"kind\":\"event\"") >= 0 && status >= 200 && status < 300) {
    Serial.printf("SERVER RESULT: %s\n", response.c_str());
  }
  const uint64_t responseAt = uptimeMs();
  Serial.printf("HTTP TIMING start=%llu done=%llu rtt=%llu reusedSocket=%u status=%d\n",
    (unsigned long long)requestStart, (unsigned long long)responseAt,
    (unsigned long long)(responseAt-requestStart), reusedSocket, status);
  http.end();
  if (status < 0) client.stop();
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
  bool haveRaw = false;
  RawBatch raw{};
  static RawFrame uploadFrames[160];
  uint16_t uploadCount = 0;
  bool lastSensorsReady = false;
  uint8_t uploadFailures = 0;
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
    const bool readyNow = sensorsReady.load();
    const bool dataPending = SENSOR_COUNT == 1 ? haveRaw || uxQueueMessagesWaiting(rawQueue) > 0 : haveEvent || uxQueueMessagesWaiting(eventQueue) > 0;
    // Data wins the regular heartbeat slot; bound deferral even under continuous traffic.
    if (readyNow != lastSensorsReady || millis() - lastHeartbeat >= HEARTBEAT_MS + 2000 ||
        (!dataPending && millis() - lastHeartbeat >= HEARTBEAT_MS)) {
      const String json = baseMessage("heartbeat") + ",\"sensorsReady\":" +
        (readyNow ? "true" : "false") + ",\"firmwareVersion\":\"" + FIRMWARE_VERSION + "\",\"pendingEvents\":" + String(SENSOR_COUNT == 1 ? uxQueueMessagesWaiting(rawQueue) + (haveRaw ? 1 : 0) : uxQueueMessagesWaiting(eventQueue) + (haveEvent ? 1 : 0)) + ",\"droppedEvents\":" + String(droppedEvents.load()) + ",\"wifiRssi\":" + String(WiFi.RSSI()) + "}";
      const int status = postJson(json);
      lastHeartbeat = millis();
      lastSensorsReady = readyNow;
      Serial.printf("HEARTBEAT HTTP %d\n", status);
      if (status == 401 || status == 403) {
        verified = false;
        networkReady.store(false);
        continue;
      }
    }
    if (SENSOR_COUNT == 1) {
      if (!haveRaw) {
        haveRaw = xQueueReceive(rawQueue, &raw, pdMS_TO_TICKS(50)) == pdTRUE;
        uploadCount = 0;
        if (haveRaw) {
          for (uint8_t i = 0; i < raw.count; ++i) uploadFrames[uploadCount++] = raw.frames[i];
          RawBatch extra{};
          while (uploadCount + 20 <= 160 && xQueueReceive(rawQueue, &extra, 0) == pdTRUE) {
            if (uptimeMs() - extra.uptimeMs > MAX_EVENT_AGE_MS) { droppedEvents.fetch_add(1); continue; }
            for (uint8_t i = 0; i < extra.count; ++i) uploadFrames[uploadCount++] = extra.frames[i];
            raw = extra;
          }
        }
      }
      if (!haveRaw) continue;
      if (uptimeMs() - raw.uptimeMs > MAX_EVENT_AGE_MS) { droppedEvents.fetch_add(1); haveRaw = false; continue; }
      char id[100];
      snprintf(id, sizeof(id), "%s-%s-raw-%lu", DEVICE_ID, bootId, static_cast<unsigned long>(raw.sequence));
      String json = baseMessage("distance") + ",\"eventId\":\"" + id + "\",\"sensorId\":\"A\",\"sequence\":" + String(raw.sequence) + ",\"uptimeMs\":" + uint64String(raw.uptimeMs) + ",\"occurredAtMs\":" + uint64String(raw.occurredAtMs ? raw.occurredAtMs : epochMs() - (uptimeMs() - raw.uptimeMs)) + ",\"frames\":[";
      json.reserve(5500);
      for (uint16_t i = 0; i < uploadCount; ++i) {
        if (i) json += ',';
        json += "[" + uint64String(uploadFrames[i].at) + "," + String(uploadFrames[i].mm) + "," + String(uploadFrames[i].quality) + "]";
      }
      json += "],\"firmwareVersion\":\"" + String(FIRMWARE_VERSION) + "\"}";
      const uint64_t sendStart = uptimeMs();
      Serial.printf("RAW TIMING first=%llu last=%llu send=%llu oldestAge=%llu newestAge=%llu frames=%u queued=%u bytes=%u\n",
        (unsigned long long)uploadFrames[0].at, (unsigned long long)raw.uptimeMs, (unsigned long long)sendStart,
        (unsigned long long)(sendStart-uploadFrames[0].at), (unsigned long long)(sendStart-raw.uptimeMs),
        uploadCount, (unsigned)uxQueueMessagesWaiting(rawQueue), (unsigned)json.length());
      const int status = postJson(json);
      Serial.printf("RAW DISTANCE UPLOAD #%lu HTTP %d\n", static_cast<unsigned long>(raw.sequence), status);
      if (success(status) || (status >= 400 && status < 500 && status != 401 && status != 403 && status != 408 && status != 429)) {
        if (!success(status)) droppedEvents.fetch_add(1);
        haveRaw = false;
        uploadFailures = 0;
      } else {
        if (status == 401 || status == 403 || ++uploadFailures >= 3) { verified = false; networkReady.store(false); uploadFailures = 0; }
        vTaskDelay(pdMS_TO_TICKS(1000));
      }
      continue;
    }
    if (!haveEvent) haveEvent = xQueueReceive(eventQueue, &event, pdMS_TO_TICKS(50)) == pdTRUE;
    if (!haveEvent) continue;
    if (uptimeMs() - event.uptimeMs > MAX_EVENT_AGE_MS) {
      droppedEvents.fetch_add(1);
      Serial.println("EVENT EXPIRED: buffered for over 5 minutes; event not counted.");
      haveEvent = false;
      continue;
    }
    char eventId[100];
    snprintf(eventId, sizeof(eventId), "%s-%s-%lu", DEVICE_ID, bootId, static_cast<unsigned long>(event.sequence));
    char values[260];
    snprintf(values, sizeof(values), ",\"eventId\":\"%s\",\"sensorId\":\"%c\",\"sequence\":%lu,\"uptimeMs\":%llu,\"occurredAtMs\":%llu,\"distanceMm\":%u,\"firmwareVersion\":\"%s\"}",
      eventId, event.sensorId, static_cast<unsigned long>(event.sequence),
      static_cast<unsigned long long>(event.uptimeMs), static_cast<unsigned long long>(event.occurredAtMs ? event.occurredAtMs : epochMs() - (uptimeMs() - event.uptimeMs)),
      static_cast<unsigned>(event.distanceMm), FIRMWARE_VERSION);
    const int status = postJson(baseMessage("event") + values);
    Serial.printf("UPLOAD %c #%lu HTTP %d\n", event.sensorId, static_cast<unsigned long>(event.sequence), status);
    if (success(status) || (status >= 400 && status < 500 && status != 408 && status != 429 && status != 401 && status != 403)) {
      if (!success(status)) droppedEvents.fetch_add(1);
      haveEvent = false;
      uploadFailures = 0;
    } else {
      // Keep the original ID and FIFO order, so server retries cannot count twice.
      if (status == 401 || status == 403) { verified = false; networkReady.store(false); }
      if (++uploadFailures >= 3) { verified = false; uploadFailures = 0; }
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
  eventQueue = xQueueCreate(128, sizeof(SensorEvent));
  rawQueue = xQueueCreate(64, sizeof(RawBatch));
  if (!eventQueue || !rawQueue ||
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
  if (SENSOR_COUNT == 1) sampleRaw(sensorA, beamA);
  else sampleBeam(sensorA, beamA, 'A');
  if (SENSOR_COUNT == 2) sampleBeam(sensorB, beamB, 'B');
  if (millis() - beamA.lastFrameMs > 5000 || millis() - beamA.lastUsableFrameMs > 10000 ||
      (SENSOR_COUNT == 2 && (millis() - beamB.lastFrameMs > 5000 || millis() - beamB.lastUsableFrameMs > 10000))) {
    sensorsReady.store(false);
    Serial.println("SENSOR DATA LOST: recovering I2C and restarting sensors.");
    Wire.end();
    delay(10);
    Wire.begin(SDA_PIN, SCL_PIN, 100000);
    Wire.setTimeOut(25);
  }
  delay(2);
}
