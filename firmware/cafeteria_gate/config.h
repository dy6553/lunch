#pragma once
// 1: completed single-sensor passages + Wi-Fi/server counting. 2: original A/B entry tracking.
#ifndef SENSOR_COUNT
#define SENSOR_COUNT 1
#endif
#define PRINT_DISTANCES true
#define WIFI_SETUP_PASSWORD "lunchsetup"
#define WIFI_SETUP_BUTTON_PIN 0  // BOOT: hold for 3 seconds after the board starts.
static_assert(SENSOR_COUNT == 1 || SENSOR_COUNT == 2, "SENSOR_COUNT must be 1 or 2");
