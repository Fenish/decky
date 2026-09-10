#pragma once
#include <Arduino.h>
namespace artwork_store {
void begin();
bool available();
uint64_t capacity();
bool load(int page,int cell,uint32_t signature,uint16_t *pixels,size_t cell_bytes,int cells,uint16_t &lit_mask);
bool save(int page,int cell,uint32_t signature,const uint16_t *pixels,size_t cell_bytes,int cells,uint16_t lit_mask);
}
