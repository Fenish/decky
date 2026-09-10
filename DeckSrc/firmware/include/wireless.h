#pragma once
#include <Arduino.h>
namespace wireless {
void begin();
void poll(void (*command)(const char *));
bool handle(const char *line);
void claim();
Stream &reply();
Stream &events();
bool network_transfer();
int read_network(uint8_t *buffer,size_t count);
}
