#include "input/drag.h"
#include <Arduino.h>
#include "network/wireless.h"

void DragReport::report(int page, int cell, int inside, uint32_t now, bool first) {
    if (!first && (abs(inside - sent_y_) < 2 || now - sent_ms_ < 20)) return;
    sent_y_ = inside;
    sent_ms_ = now;
    wireless::events().printf("EV %d %d MOVE %d\n", page, cell, inside);
}
