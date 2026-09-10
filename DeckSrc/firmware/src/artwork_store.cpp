#include "artwork_store.h"
#include <SD.h>
#include <SPI.h>

namespace artwork_store {
namespace {
SPIClass spi(FSPI);
bool mounted=false;
constexpr uint32_t MAGIC=0x36434B44;
struct Header {uint32_t magic,signature,cell_bytes;uint16_t cells,lit_mask;};
String filename(int page,int cell){return String("/decky-cache/")+(cell<0?"page-":"on-")+page+(cell<0?String(""):String("-")+cell)+".bin";}
uint32_t checksum(const uint8_t *data,size_t size){
    uint32_t crc=0xFFFFFFFF;
    for(size_t i=0;i<size;++i){crc^=data[i];for(int bit=0;bit<8;++bit)crc=(crc&1)?(crc>>1)^0xEDB88320:crc>>1;}
    return crc^0xFFFFFFFF;
}
bool read_file(const String &path,uint32_t signature,uint16_t *pixels,size_t cell_bytes,int cells,uint16_t &lit_mask){
    File file=SD.open(path,FILE_READ);if(!file)return false;
    Header header{};
    if(file.read(reinterpret_cast<uint8_t*>(&header),sizeof(header))!=sizeof(header)||header.magic!=MAGIC||header.signature!=signature||header.cell_bytes!=cell_bytes||header.cells!=cells||(header.lit_mask>>cells)!=0||file.size()!=sizeof(header)+__builtin_popcount(header.lit_mask)*cell_bytes){file.close();return false;}
    memset(pixels,0,cell_bytes*cells);
    auto *bytes=reinterpret_cast<uint8_t*>(pixels);
    for(int i=0;i<cells;++i)if(header.lit_mask&(1<<i)){
        if(file.read(bytes+i*cell_bytes,cell_bytes)!=cell_bytes){file.close();return false;}
    }
    file.close();
    if(checksum(bytes,cell_bytes*cells)!=signature)return false;
    lit_mask=header.lit_mask;return true;
}
}
void begin(){
    // CrowPanel Basic's separate SPI2 TF slot. Never format the user's card.
    spi.begin(12,13,11,10);
    mounted=SD.begin(10,spi,20000000)&&SD.cardType()!=CARD_NONE;
    if(mounted&&!SD.exists("/decky-cache"))mounted=SD.mkdir("/decky-cache");
}
bool available(){return mounted;}
uint64_t capacity(){return mounted?SD.cardSize():0;}
bool load(int page,int cell,uint32_t signature,uint16_t *pixels,size_t cell_bytes,int cells,uint16_t &lit_mask){
    if(!mounted)return false;
    const String path=filename(page,cell);
    return read_file(path,signature,pixels,cell_bytes,cells,lit_mask)||read_file(path+".old",signature,pixels,cell_bytes,cells,lit_mask);
}
bool save(int page,int cell,uint32_t signature,const uint16_t *pixels,size_t cell_bytes,int cells,uint16_t lit_mask){
    if(!mounted)return false;
    const String path=filename(page,cell),temporary=path+".tmp",backup=path+".old";
    // Only files in Decky's own cache namespace are replaced. A torn save is
    // rejected by the next load's length/CRC checks and fetched from the PC.
    SD.remove(temporary);
    File file=SD.open(temporary,FILE_WRITE);if(!file)return false;
    const Header header{MAGIC,signature,static_cast<uint32_t>(cell_bytes),static_cast<uint16_t>(cells),lit_mask};
    bool ok=file.write(reinterpret_cast<const uint8_t*>(&header),sizeof(header))==sizeof(header);
    const auto *bytes=reinterpret_cast<const uint8_t*>(pixels);
    for(int i=0;i<cells&&ok;++i)if(lit_mask&(1<<i))ok=file.write(bytes+i*cell_bytes,cell_bytes)==cell_bytes;
    file.flush();file.close();
    if(!ok){SD.remove(temporary);return false;}
    SD.remove(backup);
    if(SD.exists(path)&&!SD.rename(path,backup)){SD.remove(temporary);return false;}
    if(!SD.rename(temporary,path)){if(SD.exists(backup))SD.rename(backup,path);return false;}
    SD.remove(backup);return true;
}
}
