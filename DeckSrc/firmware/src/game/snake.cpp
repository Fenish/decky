#include "game/snake.h"
#include <Arduino.h>
#include "panel.h"

namespace game {
namespace {

// How long each part of it lasts, and how often a frame is drawn.
constexpr uint32_t CRUSH_MS = 900;
constexpr uint32_t COUNT_MS = 3000;
constexpr uint32_t FRAME_MS = 30;
// The snake's own colours, and the food's.
constexpr uint16_t HEAD = 0xE7FF;
constexpr uint16_t BODY = 0x8618;
constexpr uint16_t FOOD = 0x30FC;
constexpr uint16_t GROUND = 0x0000;

/** The opening a board cell falls in, and where inside it. */
struct Where {
    keygrid::Rect key;
    int x;
    int y;
    int w;
    int h;
};

Where where(int cell_x, int cell_y) {
    const keygrid::Rect key = keygrid::cell(cell_y / CELLS_Y, cell_x / CELLS_X);
    const int w = key.w / CELLS_X, h = key.h / CELLS_Y;
    return {key, key.x + (cell_x % CELLS_X) * w, key.y + (cell_y % CELLS_Y) * h, w, h};
}

}  // namespace

void Snake::start(uint32_t now) {
    score_ = 0;
    step_ms_ = 220;
    length_ = 3;
    for (int i = 0; i < length_; ++i) {
        body_x_[i] = static_cast<uint8_t>(WIDTH / 2 - i);
        body_y_[i] = static_cast<uint8_t>(HEIGHT / 2);
    }
    heading_x_ = turn_x_ = 1;
    heading_y_ = turn_y_ = 0;
    place_food();
    crush_start(now);
    phase_ = Phase::crushing;
}

/** The screen as it stands, taken as tiles to be dropped. */
void Snake::crush_start(uint32_t now) {
    const uint16_t *frame = panel::framebuffer();
    for (int cell = 0; cell < keygrid::COUNT; ++cell) {
        const keygrid::Rect key = keygrid::cell(cell);
        for (int ty = 0; ty < TILES_Y; ++ty)
            for (int tx = 0; tx < TILES_X; ++tx) {
                // One colour a tile: the pixel at its middle. Averaging looks
                // no better once they are falling, and costs 256 reads each.
                const int x = key.x + (tx * key.w) / TILES_X + key.w / (TILES_X * 2);
                const int y = key.y + (ty * key.h) / TILES_Y + key.h / (TILES_Y * 2);
                const int at = ty * TILES_X + tx;
                tile_colour_[cell][at] = frame[y * panel::WIDTH + x];
                tile_fall_[cell][at] = 0;
                // Each falls at its own pace, so the picture comes apart
                // rather than sliding down in one piece.
                tile_speed_[cell][at] = static_cast<int16_t>(3 + (random(0, 5)) + (ty * 2));
            }
    }
    phase_at_ = now;
    framed_at_ = 0;
}

void Snake::crush_frame(uint32_t now, bool closing) {
    if (now - framed_at_ < FRAME_MS) return;
    framed_at_ = now;
    for (int cell = 0; cell < keygrid::COUNT; ++cell) {
        const keygrid::Rect key = keygrid::cell(cell);
        if (!screen_.clear(key)) continue;
        panel::display.fillRect(key.x, key.y, key.w, key.h, GROUND);
        const int tw = key.w / TILES_X, th = key.h / TILES_Y;
        for (int ty = 0; ty < TILES_Y; ++ty)
            for (int tx = 0; tx < TILES_X; ++tx) {
                const int at = ty * TILES_X + tx;
                tile_fall_[cell][at] = static_cast<int16_t>(tile_fall_[cell][at] + tile_speed_[cell][at]);
                tile_speed_[cell][at] = static_cast<int16_t>(tile_speed_[cell][at] + 2);
                const int top = ty * th + tile_fall_[cell][at];
                // Piled at the foot of its own opening, or gone past it.
                if (top >= key.h) continue;
                panel::display.fillRect(key.x + tx * tw, key.y + top, tw, th, tile_colour_[cell][at]);
            }
    }
    if (now - phase_at_ < CRUSH_MS) return;
    if (closing) {
        phase_ = Phase::done;
        return;
    }
    phase_ = Phase::counting;
    phase_at_ = now;
    for (int cell = 0; cell < keygrid::COUNT; ++cell) {
        const keygrid::Rect key = keygrid::cell(cell);
        screen_.wait(key);
        panel::display.fillRect(key.x, key.y, key.w, key.h, GROUND);
    }
}

/** Three, two, one - and what to do with a finger. */
void Snake::count_frame(uint32_t now) {
    const int left = static_cast<int>((COUNT_MS - (now - phase_at_)) / 1000) + 1;
    if (now - framed_at_ < 120) {
        if (now - phase_at_ >= COUNT_MS) {
            phase_ = Phase::playing;
            stepped_at_ = now;
            draw_board();
        }
        return;
    }
    framed_at_ = now;
    const keygrid::Rect middle = keygrid::cell(keygrid::COUNT / 2);
    if (!screen_.clear(middle)) return;
    panel::display.fillRect(middle.x, middle.y, middle.w, middle.h, GROUND);
    panel::display.setFont(&fonts::Font4);
    panel::display.setTextSize(2);
    panel::display.setTextColor(0xFFFF);
    panel::display.setTextDatum(textdatum_t::middle_center);
    panel::display.drawNumber(left, middle.x + middle.w / 2, middle.y + middle.h / 2);
    // "SWIPE TO MOVE", a word to a key, either side of the count.
    static const char *const WORDS[] = {"SWIPE", "TO", "MOVE"};
    const int keys[] = {keygrid::COUNT / 2 - 2, keygrid::COUNT / 2 - 1, keygrid::COUNT / 2 + 1};
    panel::display.setFont(&fonts::Font2);
    panel::display.setTextSize(1);
    panel::display.setTextColor(0x9CF3);
    for (int i = 0; i < 3; ++i) {
        const keygrid::Rect key = keygrid::cell(keys[i]);
        if (!screen_.clear(key)) continue;
        panel::display.fillRect(key.x, key.y, key.w, key.h, GROUND);
        panel::display.drawString(WORDS[i], key.x + key.w / 2, key.y + key.h / 2);
    }
}

void Snake::draw_cell(int x, int y, uint16_t colour) {
    const Where at = where(x, y);
    panel::display.fillRect(at.x + 1, at.y + 1, at.w - 2, at.h - 2, colour);
}

void Snake::draw_board() {
    for (int cell = 0; cell < keygrid::COUNT; ++cell) {
        const keygrid::Rect key = keygrid::cell(cell);
        screen_.wait(key);
        panel::display.fillRect(key.x, key.y, key.w, key.h, GROUND);
    }
    for (int i = 0; i < length_; ++i) draw_cell(body_x_[i], body_y_[i], i ? BODY : HEAD);
    draw_cell(food_x_, food_y_, FOOD);
}

bool Snake::bites(int x, int y) const {
    for (int i = 0; i < length_; ++i)
        if (body_x_[i] == x && body_y_[i] == y) return true;
    return false;
}

void Snake::place_food() {
    for (int tries = 0; tries < 200; ++tries) {
        const int x = random(0, WIDTH), y = random(0, HEIGHT);
        if (bites(x, y)) continue;
        food_x_ = x;
        food_y_ = y;
        return;
    }
}

void Snake::play_frame(uint32_t now) {
    if (now - stepped_at_ < step_ms_) return;
    stepped_at_ = now;
    heading_x_ = turn_x_;
    heading_y_ = turn_y_;
    const int head_x = body_x_[0] + heading_x_, head_y = body_y_[0] + heading_y_;
    // The walls are the walls: no wrapping, or it never ends.
    if (head_x < 0 || head_x >= WIDTH || head_y < 0 || head_y >= HEIGHT || bites(head_x, head_y)) {
        crush_start(now);
        phase_ = Phase::ending;
        return;
    }
    const bool eating = head_x == food_x_ && head_y == food_y_;
    const int tail_x = body_x_[length_ - 1], tail_y = body_y_[length_ - 1];
    for (int i = length_ - 1; i > 0; --i) {
        body_x_[i] = body_x_[i - 1];
        body_y_[i] = body_y_[i - 1];
    }
    body_x_[0] = static_cast<uint8_t>(head_x);
    body_y_[0] = static_cast<uint8_t>(head_y);
    if (eating && length_ < MAX_LENGTH) {
        body_x_[length_] = static_cast<uint8_t>(tail_x);
        body_y_[length_] = static_cast<uint8_t>(tail_y);
        ++length_;
        ++score_;
        // A little quicker with every bite, to a floor.
        if (step_ms_ > 90) step_ms_ -= 6;
        place_food();
        draw_cell(food_x_, food_y_, FOOD);
    } else {
        draw_cell(tail_x, tail_y, GROUND);
    }
    if (length_ > 1) draw_cell(body_x_[1], body_y_[1], BODY);
    draw_cell(head_x, head_y, HEAD);
}

void Snake::tick(uint32_t now) {
    switch (phase_) {
        case Phase::crushing:
            crush_frame(now, false);
            break;
        case Phase::counting:
            count_frame(now);
            break;
        case Phase::playing:
            play_frame(now);
            break;
        case Phase::ending:
            crush_frame(now, true);
            break;
        default:
            break;
    }
}

void Snake::touched(int x, int y, bool down, uint32_t now) {
    (void)now;
    if (phase_ != Phase::playing && phase_ != Phase::counting) return;
    if (down && !touching_) {
        touching_ = true;
        touch_x_ = x;
        touch_y_ = y;
        return;
    }
    if (!down) {
        touching_ = false;
        return;
    }
    const int dx = x - touch_x_, dy = y - touch_y_;
    // Far enough to be a flick and not a wobble; the longer way wins.
    constexpr int FLICK = 24;
    if (abs(dx) < FLICK && abs(dy) < FLICK) return;
    if (abs(dx) > abs(dy)) {
        // Never straight back on itself: that is a bite, not a turn.
        if (heading_x_ == 0) {
            turn_x_ = dx > 0 ? 1 : -1;
            turn_y_ = 0;
        }
    } else if (heading_y_ == 0) {
        turn_x_ = 0;
        turn_y_ = dy > 0 ? 1 : -1;
    }
    touch_x_ = x;
    touch_y_ = y;
}

}  // namespace game
