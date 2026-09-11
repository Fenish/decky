// Decky's firmware, for the Elecrow CrowPanel Basic 7": one Deck (deck/deck.h)
// holds every part, and Arduino runs it. See the README for the layout.
#include <Arduino.h>
#include "deck/deck.h"

namespace {
Deck deck;
}  // namespace

void setup() { deck.begin(); }

void loop() { deck.loop(); }
