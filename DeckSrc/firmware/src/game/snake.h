#pragma once
#include <stdint.h>
#include "display/screen.h"
#include "keygrid.h"

// Snake, played on the deck itself.
//
// The desktop starts it (GAME snake) when someone taps an empty key five
// times, and the deck takes the panel for as long as it lasts - pages and
// widget pictures are left where they are, so the deck comes back to what it
// was showing the moment the game ends.
//
// The board is one grid across the whole panel, seen through the fifteen key
// openings: each opening shows CELLS_X by CELLS_Y of it, so the snake runs on
// behind the ribs and out the other side. A flick of a finger turns it; there
// is nothing to press.
//
// Either end of the game is a crush: what the screen was showing breaks into
// tiles that fall out of their openings. The tiles are the picture's own
// colours, one per tile, taken from the framebuffer as it is - so it costs a
// few kilobytes and no page has to be kept anywhere.
namespace game {

// The board, in cells, and how many of it one key opening shows.
constexpr int CELLS_X = 4;
constexpr int CELLS_Y = 4;
constexpr int WIDTH = keygrid::COLS * CELLS_X;
constexpr int HEIGHT = keygrid::ROWS * CELLS_Y;
// Tiles a key opening breaks into when the screen crushes.
constexpr int TILE = 16;
constexpr int TILES_X = 8;
constexpr int TILES_Y = 8;

/** Where a game has got to. */
enum class Phase { off, crushing, counting, playing, ending, done };

class Snake {
public:
    explicit Snake(Screen &screen) : screen_(screen) {}

    /** Begin: the screen crushes, counts down, and the game starts. */
    void start(uint32_t now);
    /** End it now, without the closing crush (the desktop asked, or it went). */
    void stop() { phase_ = Phase::off; }

    bool running() const { return phase_ != Phase::off && phase_ != Phase::done; }
    /** Over and done: the caller draws its page again and clears this. */
    bool finished() const { return phase_ == Phase::done; }
    void taken() { phase_ = Phase::off; }
    int score() const { return score_; }

    /** A frame, if one is due. */
    void tick(uint32_t now);
    /** Where the finger is, whatever it is over: a flick turns the snake. */
    void touched(int x, int y, bool down, uint32_t now);

private:
    void crush_start(uint32_t now);
    void crush_frame(uint32_t now, bool closing);
    void count_frame(uint32_t now);
    void play_frame(uint32_t now);
    void draw_board();
    void draw_cell(int x, int y, uint16_t colour);
    void place_food();
    bool bites(int x, int y) const;

    Screen &screen_;
    Phase phase_ = Phase::off;
    uint32_t phase_at_ = 0;
    uint32_t stepped_at_ = 0;
    uint32_t framed_at_ = 0;

    // The snake, head first, as cells; and where it is going.
    static constexpr int MAX_LENGTH = WIDTH * HEIGHT;
    uint8_t body_x_[MAX_LENGTH] = {};
    uint8_t body_y_[MAX_LENGTH] = {};
    int length_ = 0;
    int heading_x_ = 1;
    int heading_y_ = 0;
    int turn_x_ = 1;
    int turn_y_ = 0;
    int food_x_ = 0;
    int food_y_ = 0;
    int score_ = 0;
    uint32_t step_ms_ = 220;

    // The crush: a colour for each tile of each opening, and how far it has fallen.
    uint16_t tile_colour_[keygrid::COUNT][TILES_X * TILES_Y] = {};
    int16_t tile_fall_[keygrid::COUNT][TILES_X * TILES_Y] = {};
    int16_t tile_speed_[keygrid::COUNT][TILES_X * TILES_Y] = {};

    // Where the finger landed, to tell a flick from a tap.
    int touch_x_ = -1;
    int touch_y_ = -1;
    bool touching_ = false;
};

}  // namespace game
