#include "deck/deck.h"
#include <Arduino.h>
#include <limits.h>
#include "common/key_image.h"
#include "decky_version.h"
#include "keygrid.h"
#include "network/wireless.h"
#include "panel.h"
#include "protocol/identity.h"
#include "storage/artwork_store.h"

namespace {
Deck *running = nullptr;
void run_command(const char *line) { running->command(line); }
// A page being built that hears nothing for this long is dropped.
constexpr uint32_t PENDING_TIMEOUT_MS = 15000;
// Touch is read between transfer blocks too: widgets keep transfers going in
// normal use, and a tap that began and ended inside one would never be seen.
// Every 15 ms keeps the touch reads from slowing the transfer itself.
constexpr uint32_t TOUCH_DURING_TRANSFER_MS = 15;
}  // namespace

Deck::Deck()
    : status_(screen_),
      view_(screen_, pages_, animations_, session_, status_),
      transfer_(session_, *this),
      session_commands_(*this),
      page_commands_(*this),
      key_commands_(*this) {
    router_.add(session_commands_);
    router_.add(page_commands_);
    router_.add(key_commands_);
}

void Deck::begin() {
    running = this;
    // Room for a whole BLOCK: its bytes wait here while the loop draws.
    Serial.setRxBufferSize(Transfer::SERIAL_BLOCK_MAX * 2);
    Serial.begin(460800);
    // Bytes are passed on from the UART once 32 are in rather than 120, so a
    // block is taken in sooner: 128-byte uploads went 25% faster.
    Serial.setRxFIFOFull(32);
    delay(200);
    wireless::reply().printf("\nDecky v6 - connect the desktop to load your workspace (reset %s)\n", reset_reason());
    panel::touch_bus_scan();
    if (!panel::begin()) return;
    const keygrid::Rect first = keygrid::cell(0);
    KeyImage::set(first.w, first.h);
    // Until a desktop says HELLO there is nothing to load: the deck starts out
    // Disconnected, and the progress bar only appears once the desktop connects.
    panel::display.fillScreen(0);
    panel::present();
    disconnected();
    panel::backlight(true);
    initialized_ = true;
    artwork_store::begin();
    wireless::reply().printf("BOOT decky %d\n", DECKY_PROTOCOL);
    wireless::begin();
}

void Deck::loop() {
    if (!initialized_) {
        vTaskDelay(100);
        return;
    }
    wireless::poll(run_command);
    if (pages_.pending && millis() - pages_.pending_at > PENDING_TIMEOUT_MS) {
        pages_.pending = nullptr;
        session_.transitioning = false;
    }
    screen_.resync();
    const bool updating =
        session_.updating_until && static_cast<int32_t>(session_.updating_until - millis()) > 0;
    if (session_.online && !updating && millis() - session_.last_heard_ms > Session::HOST_TIMEOUT_MS) disconnected();
    touch_.poll(*this);
    if (game_.running()) {
        game_.tick(millis());
        // What it has eaten, when that changes: the window keeps the score.
        if (game_.score() != game_score_) {
            game_score_ = game_.score();
            wireless::events().printf("EV GAME SCORE %d\n", game_score_);
        }
        vTaskDelay(1);
        return;
    }
    if (game_.finished()) {
        game_.taken();
        wireless::events().printf("EV GAME OVER %d\n", game_.score());
        if (pages_.active) view_.draw_page();
    }
    animation_frames();
    view_.overlay_frames();
    artwork_store::step();
    vTaskDelay(1);
}

void Deck::command(const char *line) {
    if (wireless::handle(line)) return;
    if (strcmp(line, "ID") != 0 && strcmp(line, "SCREEN") != 0) wireless::claim();
    session_.heard(millis());
    if (!router_.run(line)) wireless::reply().println("ERR unknown command");
}

void Deck::activate(Page &page) {
    pages_.active = &page;
    session_.current_page = page.id;
    session_.current_state = 0;
    session_.warming = false;
    status_.hide();
}

void Deck::warm_progress() {
    if (!session_.warming) return;
    const int cells = pages_.pending ? __builtin_popcount(pages_.pending->mask) : 0;
    status_.show(15 + (85 * (session_.warm_done + cells)) / max(1, session_.warm_total));
}

void Deck::disconnected() {
    session_.online = false;
    session_.warming = false;
    session_.transitioning = false;
    pages_.pending = nullptr;
    touch_.forget();
    drag_.clear();
    transfer_.reset_block();
    animations_.disarm_all();
    // Overlays and live pictures are the session's: the next desktop sends
    // what it wants, over the pages' own pictures.
    pages_.drop_lives();
    // Nobody is left to score it, and it would draw over the notice.
    game_.stop();
    status_.show(-1, "Disconnected");
}

bool Deck::accepting_presses() {
    // While the game has the panel, a finger is the game's alone.
    return session_.online && !status_.shown() && !session_.transitioning && !game_.running();
}

void Deck::touched(int x, int y, bool down, uint32_t now) {
    if (game_.running()) game_.touched(x, y, down, now);
}

void Deck::start_game() {
    session_.transitioning = false;
    game_.start(millis());
}

void Deck::pressed(int cell, int y, uint32_t now) {
    pressed_page_ = session_.current_page;
    const Page *active = pages_.active;
    // An animation takes the finger itself: no outline, it turns instead.
    const bool turning = active && animations_.armed(cell, active->id, active->signature);
    if (!turning) view_.draw_key(cell, true);
    wireless::events().printf("EV %d %d DOWN\n", pressed_page_, cell);
    const int inside = y - keygrid::cell(cell).y;
    if (drag_.wants(cell)) drag_.report(pressed_page_, cell, inside, now, true);
    if (turning) animations_.touch(cell, inside, now, true);
}

void Deck::moved(int cell, int y, uint32_t now) {
    const Page *active = pages_.active;
    const int inside = y - keygrid::cell(cell).y;
    if (drag_.wants(cell)) drag_.report(pressed_page_, cell, inside, now, false);
    if (active && animations_.armed(cell, active->id, active->signature)) animations_.touch(cell, inside, now, false);
}

void Deck::released(int cell, uint32_t now) {
    const Page *active = pages_.active;
    wireless::events().printf("EV %d %d UP\n", pressed_page_, cell);
    if (active && animations_.armed(cell, active->id, active->signature)) animations_.release(cell, now);
    else if (!session_.transitioning && session_.current_page == pressed_page_) view_.draw_key(cell, false);
}

void Deck::between_blocks() {
    // Overlays move at the panel's pace through transfers, which on a page of
    // live widgets take much of every second; each costs little unless it moved.
    view_.overlay_frames();
    if (millis() - touch_polled_ms_ < TOUCH_DURING_TRANSFER_MS) return;
    touch_polled_ms_ = millis();
    touch_.poll(*this);
    animation_frames();
}

void Deck::animation_frames() {
    const Page *active = pages_.active;
    if (!active || !active->complete || status_.shown() || session_.transitioning) return;
    const uint16_t due = animations_.tick(millis());
    for (int cell = 0; cell < keygrid::COUNT; ++cell) {
        const uint16_t bit = 1 << cell;
        const int index = animations_.settled(cell);
        if (index >= 0) wireless::events().printf("EV %d %d WHEEL %d\n", session_.current_page, cell, index);
        const int value = animations_.value(cell, millis());
        if (value != INT_MIN) wireless::events().printf("EV %d %d VALUE %d\n", session_.current_page, cell, value);
        if (!animations_.armed(cell, active->id, active->signature)) {
            composed_ &= ~bit;
            continue;
        }
        if ((due & bit) && !(composed_ & bit)) {
            animations_.compose(cell);
            composed_ |= bit;
        }
        if ((composed_ & bit) && screen_.clear(keygrid::cell(cell))) {
            view_.write_key(cell, false);
            composed_ &= ~bit;
        }
    }
}
