# Counting stability (firmware 1.6.1)

Single-sensor counting requires an initially clear beam, three stable blocked
readings, then at least 500 ms of continuous clear readings. Short body gaps,
invalid readings, and missing frames cannot re-arm the beam. A completed passage
is queued once and retries retain the original event ID.

The server serializes updates in a Firestore transaction and stores gate state
per device. Within a boot session it rejects equal or older capture uptimes,
even when the request ID changes. Completed passages less than 500 ms after
the last accepted passage are recorded as SUPPRESSED, without changing either
the queue or daily visitor count. Suppressed events do not extend the interval.
Disabled counting still consumes captures, preventing later backfill.

The 500 ms guard uses capture time, so network delays do not merge independently
captured passages. Firmware installation is required for the 500 ms clear hold;
the server guard also protects existing session-aware firmware.

Keep the existing secrets.h (Wi-Fi, endpoint and device key) when replacing the
sketch. Preserve SENSOR_COUNT=2 if using two sensors; the default is one sensor.
Upload cafeteria_gate.ino with the existing ESP32 board and Pololu libraries.

Validate on the physical installation: one passage, a pause in the beam, moving
an arm while blocked, two people with a visible gap, and a network reconnect.
The server tests simulate repeated IDs, changed IDs, bounce, delayed delivery,
reboot, disabled counting, daily totals, and transaction conflicts.

A single distance sensor cannot separate people walking side by side or people
without a clear gap, and cannot determine direction. These timings intentionally
merge brief gaps; adjust after observing real passages if necessary. Two-sensor
mode retains A/B direction detection. Hardware calibration and ESP32 compilation
must be checked with the installed board and libraries before operational use.

Offline recovery in 1.6.0 stores at most 128 queued events plus the upload in
flight in RAM for at most 5 minutes. Power loss clears RAM. Expired, rejected,
and queue-overflow events increment a diagnostic drop counter. Heartbeats report
pending/drop counts and RSSI every 10 seconds and on sensor readiness changes.
VL53L1X out-of-range status is handled as a clear beam; valid clipped/unchecked
ranges remain usable. Unknown/bad measurements never imply a clear beam.
Transport loss for 5 seconds or unusable frames for 10 seconds triggers recovery.
The queue estimate preserves fractional service progress across sensor writes.

In single-sensor mode, 1.6.1 also recovers the sensor's previous 0x30/0x31 I2C
address before initialization when no device answers at 0x29. An ESP32 reset
does not power-cycle the sensor if XSHUT is unconnected; without address
recovery a previously working four-wire sensor can fail to initialize after
an upload, reboot, or I2C retry. Model IDs are checked before restoring 0x29.
