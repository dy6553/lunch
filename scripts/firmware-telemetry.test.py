"""Run the real sampling function on a host, then feed its packets to the server counter."""
from pathlib import Path
import subprocess,tempfile,json,os,shlex
root=Path(__file__).resolve().parents[1]
source=(root/'firmware/cafeteria_gate/cafeteria_gate.ino').read_text()
function=source.split('void sampleRaw(',1)[1].split('\nvoid sampleBeam(',1)[0]
constants='\n'.join(line for line in source.splitlines() if line.startswith(('constexpr uint32_t RAW_BATCH_MS','constexpr uint32_t RAW_IDLE_REFRESH_MS')))
stub=r'''
#include <stdint.h>
#include <assert.h>
#include <stdlib.h>
#include <stdio.h>
namespace std {
 template<class T> T min(T a,T b){return a<b?a:b;}
 template<class T> struct atomic {T value;atomic(T v):value(v){} T fetch_add(T n){T old=value;value+=n;return old;} T load(){return value;}};
 struct Output {Output& operator<<(const char* s){printf("%s",s);return *this;} Output& operator<<(char c){putchar(c);return *this;} template<class T> Output& operator<<(T n){printf("%llu",(unsigned long long)n);return *this;}} cout;
 template<class T> struct vector {T data[4096]{};size_t length=0;void push_back(T v){assert(length<4096);data[length++]=v;}size_t size()const{return length;}T& operator[](size_t i){return data[i];}const T* begin()const{return data;}const T* end()const{return data+length;}};
}
uint64_t clockMs=1000;
uint64_t uptimeMs(){return clockMs;}
uint32_t millis(){return clockMs;}
bool clockReady(){return true;}
uint64_t epochMs(){return clockMs+1800000000000ULL;}
struct RawFrame {uint64_t at;uint16_t mm;uint8_t quality;};
struct RawBatch {uint64_t uptimeMs;uint64_t occurredAtMs;uint32_t sequence;uint8_t count;RawFrame frames[20];};
struct BeamState {uint32_t lastFrameMs=0,lastUsableFrameMs=0;};
struct DistanceSensor {uint16_t mm=2000;uint8_t quality=1;bool read(uint16_t& value,bool& valid,bool& noTarget){value=mm;valid=quality==1;noTarget=quality==2;return true;}};
std::vector<RawBatch> packets;
std::vector<uint64_t> sentTimes;
uint32_t sequenceNumber=0;
std::atomic<uint32_t> droppedEvents{0};
void* rawQueue=nullptr;
constexpr int pdTRUE=1;
int xQueueSend(void*,RawBatch* batch,int){assert(batch->count>0&&batch->count<=20);packets.push_back(*batch);sentTimes.push_back(clockMs);return pdTRUE;}
'''
main=r'''
int main(int argc,char** argv){
 DistanceSensor sensor;BeamState health;
 auto frames=[&](int count,uint16_t mm,int quality=1){sensor.mm=mm;sensor.quality=quality;for(int i=0;i<count;++i){sampleRaw(sensor,health);clockMs+=60;}};
 const int scenario=argc>1?atoi(argv[1]):0;
 if(scenario==0){
 frames(50,2000);
 auto change=clockMs;auto before=packets.size();frames(10,400);
 assert(packets.size()>before);
 size_t changed=before;while(changed<packets.size()&&packets[changed].frames[packets[changed].count-1].mm!=400)++changed;
 assert(changed<packets.size() && sentTimes[changed]-change==0);
 frames(70,2000);frames(10,400);frames(40,2000);
 bool retained=false;for(const auto& p:packets)if(p.count==20){retained=true;assert(p.frames[19].at-p.frames[0].at>=500);}
 assert(retained);assert(droppedEvents.load()==0);
 for(size_t i=1;i<sentTimes.size();++i)assert(sentTimes[i]-sentTimes[i-1]<=2040);
 }else{
 frames(100,2000);
 if(scenario==1){for(int mm=2000;mm>=400;mm-=10)frames(1,mm);frames(10,400);}
 else if(scenario==2){frames(5,400);frames(4,2000);frames(10,400);}
 else if(scenario==3){frames(10,0,0);}
 else if(scenario==4){frames(10,400);frames(30,8190,2);}
 else if(scenario==5){frames(2,400);}
 else {frames(10,400);}
 frames(70,2000);
 }
 std::cout<<"[";bool firstPacket=true;for(const auto& p:packets){if(!firstPacket)std::cout<<",";firstPacket=false;std::cout<<"[";for(int i=0;i<p.count;++i){if(i)std::cout<<",";const auto& f=p.frames[i];std::cout<<"["<<f.at<<","<<f.mm<<","<<int(f.quality)<<"]";}std::cout<<"]";}std::cout<<"]";
}
'''
with tempfile.TemporaryDirectory() as temp:
 cpp=Path(temp)/'sampling.cpp';binary=Path(temp)/('sampling.exe' if os.name=='nt' else 'sampling')
 cpp.write_text(stub+constants+'\nvoid sampleRaw('+function+main)
 subprocess.run(shlex.split(os.environ.get('CXX','g++'),posix=False)+['-std=c++17','-O2',str(cpp),'-o',str(binary)],check=True)
 packets=subprocess.check_output([str(binary)],text=True)
 js="""
import {processDistanceFrames} from './lib/distance-counter.ts';
let input='';for await(const chunk of process.stdin)input+=chunk;
let saved='',count=0;const {packets,expected}=JSON.parse(input);for(const frames of packets){const result=processDistanceFrames(frames,saved,1500);count+=result.passages.length;saved=JSON.stringify(result.state);}
if(count!==expected)throw new Error('Unexpected passage total through compressed short packets, received '+count);
console.log(JSON.stringify({changedBatchWaitMs:0,idleRefreshMs:2000,retainedClearHistory:true,serverPassages:count}));
"""
 for scenario,expected in enumerate([2,1,1,0,1,0,1]):
  packets=subprocess.check_output([str(binary),str(scenario)],text=True)
  subprocess.run(['node','--input-type=module','-e',js],input=json.dumps({'packets':json.loads(packets),'expected':expected}),text=True,cwd=root,check=True)
