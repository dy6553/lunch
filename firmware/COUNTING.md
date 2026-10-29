# Server-side distance counting (firmware 1.8.0)

In single-sensor mode the ESP32 forwards timestamped distance measurements and
sensor validity only. It does not classify people or increment visitor counts.
Measurements are batched (up to 20 samples); nearly unchanged telemetry is
compressed to a ten-second refresh without using the person-detection threshold.

The authenticated API reads the admin's threshold for every batch and stores
its beam state and counts atomically in Firestore. The default is 150 cm; admins
can select 10-200 cm. Clear distance is detection + 15 cm. Counting requires an
initial clear interval, three blocked samples, then 500 ms continuously clear.
Invalid measurements and dead-band readings break the clear streak. A changed
threshold starts unarmed, preventing a phantom passage. Retries retain batch IDs
and monotonic capture timestamps; boot sessions start fresh. Sensor events while
counting is disabled consume state without backfilling later.

The single-sensor board keeps the previous four-wire I2C address recovery.
Raw batches are buffered in RAM (64 packets, maximum age five minutes); power
loss, overflow, and rejected packets can lose data and are reported diagnostically.
Two-sensor mode retains the legacy direction-event path.

After installing 1.8.0 once, change the threshold in the web admin and save.
The next measurement batch uses it on the server; no further board upload is
needed to change detection distance or server counting rules.
