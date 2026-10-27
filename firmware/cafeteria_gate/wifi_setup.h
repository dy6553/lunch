#pragma once

#include <Arduino.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <atomic>
#include "config.h"

// All portal, Wi-Fi and NVS operations run in one task. Sensor sampling and
// HTTPS uploads have their own tasks; opening the portal keeps uploads working.
class WifiSetup {
 public:
  void begin(const char* fallbackSsid, const char* fallbackPassword) {
    pinMode(WIFI_SETUP_BUTTON_PIN, INPUT_PULLUP);
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setHostname("esp32");
    WiFi.setAutoReconnect(true);
    WiFi.setSleep(false);
    Preferences preferences;
    if (preferences.begin("lunch-wifi", true)) {
      if (preferences.getBytesLength("credentials") == sizeof(saved_)) {
        preferences.getBytes("credentials", &saved_, sizeof(saved_));
      }
      preferences.end();
    }
    if (!valid(saved_)) {
      saved_ = Credentials{};
      if (validInput(fallbackSsid, fallbackPassword)) {
        copyCredentials(saved_, fallbackSsid, fallbackPassword);
      }
    }
    target_ = saved_;
    const char* headers[] = {"Origin"};
    server_.collectHeaders(headers, 1);
    server_.on("/", HTTP_GET, [this]() {
      if (!authorize()) return;
      noCache();
      server_.send_P(200, "text/html; charset=utf-8", PAGE);
    });
    server_.on("/status", HTTP_GET, [this]() {
      if (!authorize()) return;
      noCache();
      server_.send(200, "application/json", String("{\"state\":\"") + state_ +
        "\",\"connected\":" + (online_.load() ? "true" : "false") +
        ",\"setupWifi\":" + (portal_ ? "true" : "false") + "}");
    });
    server_.on("/save", HTTP_POST, [this]() { saveRequest(); });
    server_.on("/close", HTTP_POST, [this]() {
      if (!authorize() || !sameOriginMutation()) return;
      noCache();
      if (!online_.load() || candidate_) {
        server_.send(409, "application/json", "{\"ok\":false}");
        return;
      }
      server_.send(200, "application/json", "{\"ok\":true}");
      closeAt_ = millis() + 1000;
      closeScheduled_ = true;
    });
    server_.onNotFound([this]() {
      if (!authorize()) return;
      noCache();
      server_.sendHeader("Location", "http://192.168.4.1/", true);
      server_.send(302, "text/plain", "Open http://192.168.4.1/");
    });
    server_.begin();
    unavailableAt_ = millis();
    if (target_.ssid[0]) connect();
    else openPortal(false);
  }

  void poll() {
    uint32_t now = millis();
    if (digitalRead(WIFI_SETUP_BUTTON_PIN) == LOW) {
      if (!buttonDown_) { buttonDown_ = true; buttonAt_ = now; }
      if (!buttonHandled_ && now - buttonAt_ >= 3000) {
        buttonHandled_ = true;
        openPortal(true);
      }
    } else {
      buttonDown_ = buttonHandled_ = false;
    }
    if (portal_) {
      dns_.processNextRequest();
    }
    server_.handleClient();
    now = millis();
    // Let the HTTP response reach the phone before switching its network.
    if (candidate_ && joinScheduled_ && now - attemptAt_ >= 300) {
      joinScheduled_ = false;
      connect();
    }
    now = millis();

    const bool connected = target_.ssid[0] && WiFi.status() == WL_CONNECTED &&
      WiFi.SSID() == target_.ssid;
    if (candidate_) {
      if (!joinScheduled_ && connected && now - attemptAt_ >= 1000) {
        Preferences preferences;
        bool stored = false;
        if (preferences.begin("lunch-wifi", false)) {
          stored = preferences.putBytes("credentials", &target_, sizeof(target_)) == sizeof(target_);
          preferences.end();
        }
        candidate_ = false;
        if (stored) {
          saved_ = target_;
          state_ = "connected";
          closeAt_ = now + 15000;
          closeScheduled_ = true;
          Serial.println("WIFI SAVED: setup Wi-Fi closes in 15 seconds.");
        } else {
          state_ = "storage-error";
          Serial.println("WIFI SAVE FAILED: connected, but settings were not saved; retry in setup.");
        }
      } else if (!joinScheduled_ && now - attemptAt_ >= 30000) {
        candidate_ = false;
        state_ = "failed";
        target_ = saved_;
        WiFi.disconnect(false, false);
        attemptStarted_ = false;
        if (target_.ssid[0]) connect();
        Serial.println("WIFI SETUP FAILED: check Wi-Fi name/password; previous settings kept.");
      }
    } else if (connected) {
      unavailable_ = false;
      attemptStarted_ = false;
      if (portal_ && !manual_ && !closeScheduled_) {
        state_ = "connected";
        closeAt_ = now + 15000;
        closeScheduled_ = true;
      }
    } else {
      if (!unavailable_) { unavailable_ = true; unavailableAt_ = now; }
      if (now - unavailableAt_ >= 30000) openPortal(false);
      if (target_.ssid[0] && (!attemptStarted_ || now - attemptAt_ >= 15000)) connect();
    }
    online_.store(connected && !candidate_);
    if (connected && !announced_) {
      mdns_ = MDNS.begin("esp32");
      announced_ = true;
      if (mdns_) MDNS.addService("http", "tcp", 80);
      Serial.print("WIFI SETTINGS: http://esp32.local/ or http://");
      Serial.println(WiFi.localIP());
    } else if (!connected && announced_) {
      if (mdns_) MDNS.end();
      mdns_ = announced_ = false;
    }
    if (portal_ && closeScheduled_ && static_cast<int32_t>(now - closeAt_) >= 0) {
      dns_.stop();
      WiFi.softAPdisconnect(true);
      portal_ = false;
      closeScheduled_ = false;
      state_ = "ready";
      Serial.println("WIFI SETUP CLOSED: settings remain available at http://esp32.local/");
    }
  }

  bool ready() const { return online_.load(); }
  uint32_t revision() const { return revision_.load(); }

 private:
  struct Credentials {
    char ssid[33] = {};
    char password[65] = {};
  };
  Credentials saved_, target_;
  DNSServer dns_;
  WebServer server_{80};
  std::atomic<bool> online_{false};
  std::atomic<uint32_t> revision_{0};
  bool portal_ = false, manual_ = false, candidate_ = false;
  bool joinScheduled_ = false, mdns_ = false, announced_ = false;
  bool attemptStarted_ = false, unavailable_ = true, closeScheduled_ = false;
  bool buttonDown_ = false, buttonHandled_ = false;
  uint32_t attemptAt_ = 0, unavailableAt_ = 0, closeAt_ = 0, buttonAt_ = 0;
  const char* state_ = "ready";

  static bool validInput(const String& ssid, const String& password) {
    if (ssid.length() == 0 || ssid.length() > 32 || password.length() > 64) return false;
    if (password.length() == 64) {
      for (unsigned i = 0; i < password.length(); ++i) {
        const char c = password[i];
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'))) return false;
      }
      return true;
    }
    return password.length() == 0 || password.length() >= 8;
  }
  static bool valid(const Credentials& credentials) {
    return credentials.ssid[32] == '\0' && credentials.password[64] == '\0' &&
      validInput(credentials.ssid, credentials.password);
  }
  static void copyCredentials(Credentials& out, const String& ssid, const String& password) {
    out = Credentials{};
    ssid.toCharArray(out.ssid, sizeof(out.ssid));
    password.toCharArray(out.password, sizeof(out.password));
  }
  void connect() {
    online_.store(false);
    revision_.fetch_add(1);
    WiFi.disconnect(false, false);
    WiFi.begin(target_.ssid, target_.password);
    attemptAt_ = millis();
    attemptStarted_ = true;
    Serial.println("WIFI CONNECTING (2.4 GHz)...");
  }
  void openPortal(bool manual) {
    if (manual) manual_ = true;
    if (portal_) return;
    WiFi.mode(WIFI_AP_STA);
    if (!WiFi.softAPConfig(IPAddress(192, 168, 4, 1), IPAddress(192, 168, 4, 1), IPAddress(255, 255, 255, 0)) ||
        !WiFi.softAP("ESP32 Setup", WIFI_SETUP_PASSWORD)) {
      Serial.println("WIFI SETUP START FAILED: press EN to retry.");
      return;
    }
    dns_.start(53, "*", WiFi.softAPIP());
    portal_ = true;
    manual_ = manual;
    state_ = "ready";
    closeScheduled_ = false;
    Serial.println("WIFI SETUP READY: join ESP32 Setup, then open http://192.168.4.1/");
  }
  bool authorize() {
    // Setup Wi-Fi already requires its WPA password. On the regular LAN,
    // require the same setup password before allowing configuration changes.
    if (portal_ && server_.client().localIP() == WiFi.softAPIP()) return true;
    if (WiFi.status() == WL_CONNECTED) {
      if (server_.authenticate("admin", WIFI_SETUP_PASSWORD)) return true;
      server_.requestAuthentication();
      return false;
    }
    server_.send(403, "text/plain", "Connect to ESP32 Setup");
    return false;
  }
  void noCache() {
    server_.sendHeader("Cache-Control", "no-store");
    server_.sendHeader("X-Content-Type-Options", "nosniff");
  }
  bool sameOriginMutation() {
    const String origin = server_.header("Origin");
    if (origin.length() == 0 || origin == String("http://") + server_.hostHeader()) return true;
    server_.send(403, "application/json", "{\"ok\":false}");
    return false;
  }
  void saveRequest() {
    if (!authorize() || !sameOriginMutation()) return;
    noCache();
    if (candidate_) {
      server_.send(409, "application/json", "{\"ok\":false}");
      return;
    }
    const String ssid = server_.arg("ssid"), password = server_.arg("password");
    if (!validInput(ssid, password)) {
      server_.send(400, "application/json", "{\"ok\":false}");
      return;
    }
    copyCredentials(target_, ssid, password);
    openPortal(true);  // Recovery path if the new credentials do not connect.
    candidate_ = true;
    manual_ = true;
    state_ = "connecting";
    closeScheduled_ = false;
    server_.send(202, "application/json", "{\"ok\":true}");
    online_.store(false);
    attemptAt_ = millis();
    joinScheduled_ = true;
  }

  static constexpr const char* PAGE = R"WIFIHTML(<!doctype html>
<html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP32 Wi-Fi 설정</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f4f7fb;color:#172235;font:16px/1.6 system-ui,sans-serif}
main{width:calc(100% - 32px);max-width:440px;margin:36px auto;padding:24px;background:#fff;border-radius:20px}
h1{font-size:25px;margin:0 0 8px}p{margin:8px 0 20px;color:#4d5b70}label{display:block;font-weight:650;margin-top:18px}
input{width:100%;min-width:0;padding:13px;font:inherit;border:1px solid #aeb9c9;border-radius:10px;margin-top:7px}
button{width:100%;padding:14px;margin-top:22px;border:0;border-radius:10px;background:#1262db;color:white;font:inherit;font-weight:700;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}button.secondary{margin-top:12px;color:#344561;background:#edf1f7}
#status{padding:12px;background:#eef5ff;border-radius:10px;overflow-wrap:anywhere;margin:20px 0 0}
.small{font-size:14px;margin-bottom:0}input:focus-visible,button:focus-visible{outline:3px solid #66aaff;outline-offset:2px}
</style><main>
<h1>급식실 Wi-Fi 연결</h1><p>인터넷에 연결할 <strong>2.4GHz Wi-Fi</strong> 이름과 비밀번호를 입력하세요.</p>
<form id="wifi" action="/save" method="post">
<label for="ssid">Wi-Fi 이름</label><input id="ssid" name="ssid" required maxlength="32" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Wi-Fi 이름을 정확히 입력">
<label for="password">Wi-Fi 비밀번호</label><input id="password" name="password" type="password" maxlength="64" autocomplete="new-password" placeholder="비밀번호가 없으면 비워 두세요">
<button id="submit" type="submit">연결하고 저장</button></form>
<p id="status" role="status" aria-live="polite">연결이 확인되면 보드에 저장됩니다.</p>
<button id="close" type="button" class="secondary" hidden>설정용 Wi-Fi 끄기</button>
<p class="small">다음에도 보드와 같은 Wi-Fi에서 <strong>http://esp32.local</strong>을 열면 변경할 수 있어요. 학교 로그인 페이지가 필요한 Wi-Fi는 지원하지 않습니다.</p>
</main><script>
const form=document.getElementById('wifi'),statusText=document.getElementById('status'),submit=document.getElementById('submit'),closeButton=document.getElementById('close');
let done=false,submitting=false,requested=false;
async function poll(){
 try{
  const response=await fetch('/status',{cache:'no-store'});if(!response.ok)return;
  const data=await response.json();
  if(data.state==='connected'&&requested){
   done=true;form.hidden=true;closeButton.hidden=true;
   statusText.textContent='연결되었습니다. 설정용 Wi-Fi는 약 15초 후 종료됩니다. 휴대폰을 원래 Wi-Fi나 모바일 데이터에 연결한 뒤 급식 사이트를 열어 주세요.';
  }else if(!done){
   submit.disabled=submitting||data.state==='connecting';closeButton.hidden=!data.connected||!data.setupWifi||data.state==='connecting';
   if(data.state==='connecting')statusText.textContent='연결 확인 중입니다. 최대 30초가 걸립니다. Wi-Fi를 바꾸면 휴대폰도 새 Wi-Fi에 연결한 뒤 http://esp32.local을 다시 여세요. 실패하면 ESP32 Setup에서 재설정할 수 있어요.';
   if(data.state==='failed')statusText.textContent='연결하지 못했습니다. Wi-Fi 이름·비밀번호와 2.4GHz 사용 여부를 확인해 다시 입력하세요. 기존 저장 정보는 유지됩니다.';
   if(data.state==='storage-error')statusText.textContent='Wi-Fi에는 연결됐지만 저장에 실패했습니다. 연결하고 저장을 다시 눌러 주세요.';
  }
 }catch{if(requested&&!done)statusText.textContent='Wi-Fi 변경으로 연결이 끊어졌을 수 있어요. 30초 뒤 휴대폰도 새 Wi-Fi에 연결하고 http://esp32.local을 다시 여세요. 연결되지 않으면 ESP32 Setup에서 다시 설정하세요.';}
}
form.addEventListener('submit',async event=>{
 event.preventDefault();submitting=true;submit.disabled=true;
 try{
  const response=await fetch('/save',{method:'POST',body:new URLSearchParams(new FormData(form))});
  requested=response.ok;
  statusText.textContent=response.ok?'연결 확인 중입니다. 최대 30초가 걸립니다. Wi-Fi가 바뀌면 휴대폰도 새 Wi-Fi에 연결한 뒤 http://esp32.local을 다시 여세요.':'입력값을 확인하세요. Wi-Fi 이름은 32바이트 이하, 비밀번호는 8~63자 또는 빈칸이어야 합니다.';
 }catch{statusText.textContent='ESP32 Setup 연결을 확인한 뒤 다시 시도해 주세요.';}
 submitting=false;await poll();
});
closeButton.addEventListener('click',async()=>{
 try{const response=await fetch('/close',{method:'POST'});if(response.ok){done=true;form.hidden=true;closeButton.hidden=true;statusText.textContent='설정 화면을 종료합니다. 휴대폰을 원래 Wi-Fi로 연결해 주세요.';}}catch{}
});
poll();setInterval(poll,1200);
</script></html>)WIFIHTML";
};
