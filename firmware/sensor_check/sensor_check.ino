// First check: one VL53L1X sensor on an ESP32 (no Wi-Fi or website writes).
// Wiring: VIN -> 3V3, GND -> GND, SDA -> G21, SCL -> G22.
// Leave XSHUT and GPIO1 unconnected. Connect only one sensor for this sketch.
// Install "VL53L1X" by Pololu. Select "ESP32 Dev Module".

#include <Arduino.h>
#include <Wire.h>
#include <VL53L1X.h>

VL53L1X sensor;
bool sensorReady = false;

bool beginSensor() {
  Wire.beginTransmission(0x29);
  if (Wire.endTransmission() != 0) {
    Serial.println("WAIT: no sensor at 0x29. Check 3V3/GND/SDA/SCL. Retrying...");
    return false;
  }

  sensor.setTimeout(500);
  if (!sensor.init()) {
    Serial.println("INIT FAILED: check sensor model and wiring. Retrying...");
    return false;
  }
  if (!sensor.setDistanceMode(VL53L1X::Long) ||
      !sensor.setMeasurementTimingBudget(50000)) {
    Serial.println("CONFIG FAILED: could not set ranging mode. Retrying...");
    return false;
  }

  sensor.startContinuous(60);
  Serial.println("SENSOR OK. Move a hand in front of the sensor.");
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("ESP32 + VL53L1X single-sensor check");
  Serial.println("SDA = G21, SCL = G22; Serial Monitor = 115200 baud");
  if (!Wire.begin(21, 22)) {
    Serial.println("I2C START FAILED. Press EN to restart the ESP32.");
    while (true) delay(1000);
  }
  Wire.setClock(100000);
}

void loop() {
  if (!sensorReady) {
    sensorReady = beginSensor();
    if (!sensorReady) delay(2000);
    return;
  }

  const uint16_t distanceMm = sensor.read();
  if (sensor.timeoutOccurred() || sensor.last_status != 0) {
    Serial.println("READ FAILED: check the wiring. Reconnecting...");
    sensorReady = false;
    delay(1000);
    return;
  }

  if (sensor.ranging_data.range_status == VL53L1X::RangeValid) {
    Serial.printf("distance = %u mm / %.1f cm\n",
                  static_cast<unsigned>(distanceMm), distanceMm / 10.0);
  } else {
    Serial.print("INVALID: ");
    Serial.println(VL53L1X::rangeStatusToString(sensor.ranging_data.range_status));
  }
  delay(200);
}
