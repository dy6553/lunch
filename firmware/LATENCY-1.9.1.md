# ESP32 1.9.1

Based on main e2a1e0b93ace1b2a913350feda5be744fa4e4d07 (1.9.0).

- Queue a changed measurement immediately (quality change or >20 mm from last queued value). Continue measuring during the single FIFO HTTP sender.
- Reduce active batching from 240 to 120 ms. Stable telemetry refresh remains 2000 ms; retain 20 trailing frames before resuming transmission.
- Prioritize queued data over scheduled heartbeat, with a 2000 ms maximum deferral. Report sensor health changes immediately. Blocking HTTP time is additional to scheduling time.
- Preserve 500 ms clear confirmation, 3 stable detection samples, frame order, boot IDs, retries and TLS verification.
- HTTP TIMING uses board monotonic uptime for start/end/round trip; reusedSocket reports connection state before POST, not proof of a handshake-free request. RAW TIMING records first/last frame, send time, frame ages, count, queued packets and JSON bytes. Ages include batching and queue wait; they are not web display latency.

## Deployment

Firmware-only update; compatible with the existing distance endpoint. No web settings, operating status, visitor counts or authentication settings are changed. Keep the existing private secrets.h when compiling. Never distribute binaries containing credentials.

## Comparison

| Interval | 1.9.0 | 1.9.1 |
|---|---|---|
| Configured active batch span | 240 ms | 120 ms |
| Additional batch wait after >20 mm/quality change | Up to 240 ms at 60 ms sampling | 0 ms in sampler; network queue remains |
| Stable refresh | 2000 ms | 2000 ms |
| Person clear confirmation | 500 ms | 500 ms |
| Internet/server/browser end-to-end latency | Not measured | Not measured |

Physical human passage validation must be distinguished from host simulation. No fixed internet display deadline is guaranteed.
