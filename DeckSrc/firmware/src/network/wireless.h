#pragma once
#include <Arduino.h>

// The deck's two links to the desktop, USB serial and Wi-Fi, as one command
// stream. Over Wi-Fi a desktop first answers a challenge with the pairing
// secret (HMAC-SHA256), then every byte travels encrypted (SecureLink). The
// WIFI_* commands - scan, join, forget, pair - are handled here, and only
// over USB.
namespace wireless {
// Wi-Fi from the saved network, if any; the pairing secret made once.
void begin();
// Read both links and run each complete line with `command`.
void poll(void (*command)(const char *));
// A WIFI_* command, handled; false for anything else.
bool handle(const char *line);
// Key events go to the link the last command came from.
void claim();
// Where the command being run came from: its replies go there.
Stream &reply();
// Where key events go (EV lines).
Stream &events();
// Whether the command being run came over Wi-Fi: transfers then read in 4 KB.
bool network_transfer();
int read_network(uint8_t *buffer, size_t count);
}  // namespace wireless
