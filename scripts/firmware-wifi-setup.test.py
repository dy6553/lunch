"""Exercise the real portal controller with fake radio/NVS/HTTP adapters.

Run: python scripts/firmware-wifi-setup.test.py
The ESP32 cross-compile is a separate check; this test needs only g++.
"""

from pathlib import Path
import subprocess,os,shlex
import tempfile

ROOT = Path(__file__).resolve().parents[1]
STUBS = r'''
#pragma once
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cstring>
#include <functional>
#include <iostream>
#include <map>
#include <string>
#include <vector>
class String : public std::string {
 public:
  using std::string::string;
  String(const std::string& value) : std::string(value) {}
  void toCharArray(char* out, size_t size) const {
    const auto n = std::min(size - 1, length());
    memcpy(out, data(), n); out[n] = 0;
  }
};
uint32_t clockMs = 100;
int button = 1;
constexpr int LOW=0, INPUT_PULLUP=2, WIFI_STA=1, WIFI_AP_STA=3;
constexpr int WL_CONNECTED=3, HTTP_GET=0, HTTP_POST=1;
uint32_t millis() { return clockMs; }
void pinMode(int, int) {}
int digitalRead(int) { return button; }
struct { template<class T> void println(const T&) {} template<class T> void print(const T&) {} } Serial;
struct IPAddress {
  int first, second, third, fourth;
  IPAddress(int a=0,int b=0,int c=0,int d=0):first(a),second(b),third(c),fourth(d){}
  bool operator==(const IPAddress& p) const {
    return first==p.first && second==p.second && third==p.third && fourth==p.fourth;
  }
};
struct FakeWifi {
  int statusCode=0, modeValue=0, starts=0;
  bool ap=false;
  String ssid, password, apName;
  void persistent(bool) {}
  void mode(int value) { modeValue=value; }
  void setAutoReconnect(bool) {}
  void setHostname(const char*) {}
  IPAddress localIP() const { return IPAddress(192,168,1,20); }
  void setSleep(bool) {}
  int status() const { return statusCode; }
  String SSID() const { return ssid; }
  void disconnect(bool, bool) { statusCode=0; }
  void begin(const char* name, const char* pass) {
    ssid=name; password=pass; statusCode=0; ++starts; clockMs+=7;
  }
  bool softAPConfig(IPAddress, IPAddress, IPAddress) { return true; }
  bool softAP(const char* name, const char*) { ap=true; apName=name; return true; }
  IPAddress softAPIP() const { return IPAddress(192,168,4,1); }
  void softAPdisconnect(bool) { ap=false; modeValue=WIFI_STA; }
} WiFi;
std::map<std::string,std::vector<char>> nvs;
bool failWrite=false;
class Preferences {
 public:
  bool begin(const char*, bool) { return true; }
  size_t getBytesLength(const char* key) { return nvs[key].size(); }
  size_t getBytes(const char* key, void* out, size_t size) {
    auto& bytes=nvs[key]; const auto n=std::min(size,bytes.size());
    memcpy(out,bytes.data(),n); return n;
  }
  size_t putBytes(const char* key, const void* source, size_t size) {
    if(failWrite) return 0;
    nvs[key]=std::vector<char>((const char*)source,(const char*)source+size); return size;
  }
  void end() {}
};
struct { bool begin(const char*){return true;} void addService(const char*,const char*,int){} void end(){} } MDNS;
class DNSServer {
 public:
  void start(int,const char*,IPAddress){}
  void stop(){}
  void processNextRequest(){}
};
class WebServer;
WebServer* http=nullptr;
class WebServer {
 public:
  struct Client { IPAddress address{192,168,4,1}; IPAddress localIP(){return address;} } clientValue;
  std::map<std::pair<std::string,int>,std::function<void()>> routes;
  std::map<std::string,String> args,headers;
  std::function<void()> missing;
  int code=0;
  String body;
  bool running=false, authenticated=false;
  String origin;
  void collectHeaders(const char**, int){}
  String header(const char*){return origin;}
  String hostHeader(){return "esp32.local";}
  bool authenticate(const char*,const char*){return authenticated;}
  void requestAuthentication(){send(401,"text/plain","Authentication required");}
  explicit WebServer(int){http=this;}
  void on(const char* path,int method,std::function<void()> callback){routes[{path,method}]=callback;}
  void onNotFound(std::function<void()> callback){missing=callback;}
  void begin(){running=true;}
  void stop(){running=false;}
  void handleClient(){}
  Client client(){return clientValue;}
  void send(int value,const char*,const String& data){code=value;body=data;}
  void send_P(int value,const char* type,const char* data){send(value,type,String(data));}
  void sendHeader(const char* key,const char* value,bool=false){headers[key]=value;}
  String arg(const char* key){return args[key];}
  void request(const char* path,int method=HTTP_GET){
    assert(running);code=0;body.clear();headers.clear();
    auto it=routes.find({path,method});if(it==routes.end())missing();else it->second();
  }
};
void reset(){WiFi=FakeWifi{};nvs.clear();failWrite=false;clockMs=100;button=1;}
'''

TESTS = r'''
#include "wifi_setup.h"
void advance(WifiSetup& setup,uint32_t ms){clockMs+=ms;setup.poll();}
void submit(WifiSetup& setup,const char* name,const char* pass){
  http->args={{"ssid",name},{"password",pass}};http->request("/save",HTTP_POST);
  if(http->code==202)advance(setup,300);
}
void state(const char* expected){
  http->request("/status");assert(http->code==200);
  assert(http->body.find(String("\"state\":\"")+expected+"\"")!=std::string::npos);
  assert(http->body.find("password")==std::string::npos);
}
void openButton(WifiSetup& setup){button=0;setup.poll();advance(setup,3000);button=1;setup.poll();}
void complete(WifiSetup& setup){WiFi.statusCode=WL_CONNECTED;advance(setup,1000);}
int main(){
  reset();
  {
    WifiSetup setup;setup.begin("","");setup.poll();
    assert(WiFi.ap && WiFi.apName=="ESP32 Setup" && !setup.ready());
    http->request("/");assert(http->code==200 && http->body.find("lang=\"ko\"")!=std::string::npos);
    assert(http->headers["Cache-Control"]=="no-store");
    http->request("/generate_204");assert(http->code==302);
    assert(http->headers["Location"]=="http://192.168.4.1/");
    http->clientValue.address=IPAddress(192,168,1,20);
    submit(setup,"attacker","validpassword");assert(http->code==403 && WiFi.starts==0);
    http->clientValue.address=WiFi.softAPIP();
    submit(setup,"","validpassword");assert(http->code==400);
    submit(setup,"school","short");assert(http->code==400);
    submit(setup,"123456789012345678901234567890123","validpassword");assert(http->code==400);
    submit(setup,"school","wrongpassword");assert(http->code==202);state("connecting");
    assert(nvs["credentials"].empty());
    submit(setup,"other","validpassword");assert(http->code==409);
    advance(setup,30000);state("failed");assert(nvs["credentials"].empty() && WiFi.ap);
    std::cout<<"PASS initial setup, captive redirect, access boundary, validation, failed password\n";
  }
  reset();
  std::vector<char> persisted;
  {
    WifiSetup setup;setup.begin("","");
    submit(setup,"school","validpassword");complete(setup);state("connected");
    assert(setup.ready() && WiFi.ap && !nvs["credentials"].empty());persisted=nvs["credentials"];
    advance(setup,14999);assert(WiFi.ap);
    advance(setup,1);assert(!WiFi.ap && setup.ready());
    // Settings remain available over the LAN, without pressing BOOT.
    http->clientValue.address=WiFi.localIP();
    http->request("/");assert(http->code==401 && http->running);
    http->authenticated=true;http->request("/");assert(http->code==200);
    http->origin="http://untrusted.example";
    submit(setup,"evil","validpassword");assert(http->code==403 && setup.ready());
    http->origin="http://esp32.local";
    // A LAN submission starts the recovery AP and preserves the old NVS data.
    submit(setup,"new-school","wrongpassword");assert(http->code==202 && WiFi.ap);
    advance(setup,30000);assert(nvs["credentials"]==persisted);
    complete(setup);assert(setup.ready());
    http->clientValue.address=WiFi.softAPIP();http->origin="";
    http->request("/close",HTTP_POST);advance(setup,1000);assert(!WiFi.ap);
    openButton(setup);assert(WiFi.ap && setup.ready());state("ready");
    const auto before=setup.revision();
    submit(setup,"new-school","wrongpassword");assert(!setup.ready() && setup.revision()!=before);
    advance(setup,30000);state("failed");
    assert(nvs["credentials"]==persisted && WiFi.ssid=="school" && WiFi.ap);
    complete(setup);assert(setup.ready());state("failed");
    http->request("/close",HTTP_POST);assert(http->code==200);
    advance(setup,1000);assert(!WiFi.ap && setup.ready());
    std::cout<<"PASS save on success, LAN authentication and changes, cross-origin rejection, BOOT, rollback\n";
  }
  {
    // Simulated reboot: NVS survives while radio state does not.
    WiFi=FakeWifi{};clockMs=100;
    WifiSetup setup;setup.begin("","");assert(WiFi.ssid=="school" && !WiFi.ap);
    complete(setup);assert(setup.ready());
    openButton(setup);submit(setup,"new-school","newpassword");complete(setup);
    assert(nvs["credentials"]!=persisted);advance(setup,15000);assert(!WiFi.ap);
    WiFi.statusCode=0;setup.poll();advance(setup,30000);assert(WiFi.ap && !setup.ready());
    complete(setup);state("connected");advance(setup,15000);assert(!WiFi.ap && setup.ready());
    std::cout<<"PASS reboot persistence, successful replacement, outage fallback and recovery\n";
  }
  reset();
  {
    WifiSetup setup;setup.begin("","");failWrite=true;
    submit(setup,"school","validpassword");complete(setup);state("storage-error");
    assert(nvs["credentials"].empty() && WiFi.ap && setup.ready());
    failWrite=false;submit(setup,"school","validpassword");complete(setup);state("connected");
    std::cout<<"PASS storage failure stays visible and can be retried\n";
  }
  reset();
  {
    clockMs=UINT32_MAX-500;
    WifiSetup setup;setup.begin("fallback","validpassword");
    advance(setup,30000);assert(WiFi.ap);
    submit(setup,"open-network","");complete(setup);state("connected");
    advance(setup,15000);assert(!WiFi.ap && setup.ready());
    std::cout<<"PASS clock rollover, compile-time fallback, open Wi-Fi\n";
  }
}
'''

with tempfile.TemporaryDirectory(prefix="lunch-wifi-test-") as directory:
    folder = Path(directory)
    (folder / "stubs.h").write_text(STUBS)
    for header in ["Arduino.h", "DNSServer.h", "Preferences.h", "WebServer.h", "WiFi.h", "ESPmDNS.h"]:
        (folder / header).write_text('#include "stubs.h"\n')
    (folder / "test.cpp").write_text(TESTS)
    subprocess.run([
        "g++", "-std=c++17", "-Wall", "-Wextra", "-Werror",
        "-I", str(folder), "-I", str(ROOT / "firmware/cafeteria_gate"),
        str(folder / "test.cpp"), "-o", str(folder / ("test.exe" if os.name=="nt" else "test")),
    ], check=True)
    subprocess.run([str(folder / "test")], check=True)
