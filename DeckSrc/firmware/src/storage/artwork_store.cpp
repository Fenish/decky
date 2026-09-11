#include "storage/artwork_store.h"
#include <SD.h>
#include <SPI.h>
#include "common/crc32.h"

namespace artwork_store {
namespace {
SPIClass spi(FSPI);
bool mounted = false;
constexpr uint32_t MAGIC = 0x36434B44;
// How much of a page one step writes: about 7 ms of card time, so an animated
// key misses a frame at most.
constexpr size_t SLICE_BYTES = 8 * 1024;
// A file: this header, then the page's lit keys one after another (black keys
// take no room), or one ON picture.
struct Header {
    uint32_t magic, signature, cell_bytes;
    uint16_t cells, lit_mask;
};
// /decky-cache/page-<index>.bin, or on-<index>-<cell>.bin for an ON picture.
String filename(int page, int cell) {
    return String("/decky-cache/") + (cell < 0 ? "page-" : "on-") + page + (cell < 0 ? String("") : String("-") + cell) +
           ".bin";
}
// The file only if it is whole and its pictures still have the CRC they were
// saved under: a torn or stale file reads as none.
bool read_file(const String &path, uint32_t signature, uint16_t *pixels, size_t cell_bytes, int cells,
               uint16_t &lit_mask) {
    File file = SD.open(path, FILE_READ);
    if (!file) return false;
    Header header{};
    if (file.read(reinterpret_cast<uint8_t *>(&header), sizeof(header)) != sizeof(header) || header.magic != MAGIC ||
        header.signature != signature || header.cell_bytes != cell_bytes || header.cells != cells ||
        (header.lit_mask >> cells) != 0 ||
        file.size() != sizeof(header) + __builtin_popcount(header.lit_mask) * cell_bytes) {
        file.close();
        return false;
    }
    memset(pixels, 0, cell_bytes * cells);
    auto *bytes = reinterpret_cast<uint8_t *>(pixels);
    for (int i = 0; i < cells; ++i)
        if (header.lit_mask & (1 << i)) {
            if (file.read(bytes + i * cell_bytes, cell_bytes) != cell_bytes) {
                file.close();
                return false;
            }
        }
    file.close();
    if (crc32(bytes, cell_bytes * cells) != signature) return false;
    lit_mask = header.lit_mask;
    return true;
}

// One save, a stage per step: the temporary file and its header, the lit keys
// a slice at a time, then the swap into place. Only files in Decky's own cache
// namespace are replaced. A torn save is rejected by the next load's length
// and CRC checks, and fetched from the PC.
class Save {
   public:
    void start(int page, int cell, uint32_t signature, const uint16_t *pixels, size_t cell_bytes, int cells,
               uint16_t lit_mask) {
        path_ = filename(page, cell);
        header_ = {MAGIC, signature, static_cast<uint32_t>(cell_bytes), static_cast<uint16_t>(cells), lit_mask};
        bytes_ = reinterpret_cast<const uint8_t *>(pixels);
        cell_ = -1;
        offset_ = 0;
        stage_ = &Save::open;
    }
    bool active() const { return stage_ != nullptr; }
    void step() {
        if (stage_) (this->*stage_)();
    }
    // Whether a save failed since this was last asked.
    bool take_failure() {
        const bool failed = failed_;
        failed_ = false;
        return failed;
    }

   private:
    using Stage = void (Save::*)();
    String temporary() const { return path_ + ".tmp"; }
    String backup() const { return path_ + ".old"; }

    void open() {
        SD.remove(temporary());
        file_ = SD.open(temporary(), FILE_WRITE);
        if (!file_ || file_.write(reinterpret_cast<const uint8_t *>(&header_), sizeof(header_)) != sizeof(header_))
            return fail();
        stage_ = &Save::write;
    }
    // Up to SLICE_BYTES of the lit keys, from where the last step stopped.
    void write() {
        size_t budget = SLICE_BYTES;
        while (budget > 0) {
            if (cell_ < 0 || offset_ == header_.cell_bytes) {
                cell_ = next_lit(cell_ + 1);
                offset_ = 0;
                if (cell_ < 0) {
                    stage_ = &Save::close;
                    return;
                }
            }
            const size_t length = min(budget, static_cast<size_t>(header_.cell_bytes - offset_));
            if (file_.write(bytes_ + cell_ * header_.cell_bytes + offset_, length) != length) return fail();
            offset_ += length;
            budget -= length;
        }
    }
    void close() {
        file_.flush();
        file_.close();
        stage_ = &Save::swap;
    }
    void swap() {
        SD.remove(backup());
        if (SD.exists(path_) && !SD.rename(path_, backup())) return fail();
        if (!SD.rename(temporary(), path_)) {
            if (SD.exists(backup())) SD.rename(backup(), path_);
            return fail();
        }
        SD.remove(backup());
        stage_ = nullptr;
    }
    void fail() {
        if (file_) file_.close();
        SD.remove(temporary());
        failed_ = true;
        stage_ = nullptr;
    }
    // The first lit key from `from` on; -1 when there is none.
    int next_lit(int from) const {
        for (int cell = from; cell < header_.cells; ++cell)
            if (header_.lit_mask & (1 << cell)) return cell;
        return -1;
    }

    Stage stage_ = nullptr;
    String path_;
    Header header_{};
    const uint8_t *bytes_ = nullptr;
    File file_;
    int cell_ = -1;
    size_t offset_ = 0;
    bool failed_ = false;
};

Save saving;
}  // namespace

void begin() {
    // CrowPanel Basic's separate SPI2 TF slot. Never format the user's card.
    spi.begin(12, 13, 11, 10);
    mounted = SD.begin(10, spi, 20000000) && SD.cardType() != CARD_NONE;
    if (mounted && !SD.exists("/decky-cache")) mounted = SD.mkdir("/decky-cache");
}

bool available() { return mounted; }

uint64_t capacity() {
    finish();
    return mounted ? SD.cardSize() : 0;
}

bool load(int page, int cell, uint32_t signature, uint16_t *pixels, size_t cell_bytes, int cells, uint16_t &lit_mask) {
    if (!mounted) return false;
    finish();
    const String path = filename(page, cell);
    return read_file(path, signature, pixels, cell_bytes, cells, lit_mask) ||
           read_file(path + ".old", signature, pixels, cell_bytes, cells, lit_mask);
}

bool save(int page, int cell, uint32_t signature, const uint16_t *pixels, size_t cell_bytes, int cells,
          uint16_t lit_mask) {
    const bool started = save_in_steps(page, cell, signature, pixels, cell_bytes, cells, lit_mask);
    finish();
    return started && !saving.take_failure();
}

bool save_in_steps(int page, int cell, uint32_t signature, const uint16_t *pixels, size_t cell_bytes, int cells,
                   uint16_t lit_mask) {
    if (!mounted) return false;
    finish();
    const bool earlier_failed = saving.take_failure();
    saving.start(page, cell, signature, pixels, cell_bytes, cells, lit_mask);
    return !earlier_failed;
}

void step() { saving.step(); }

void finish() {
    while (saving.active()) saving.step();
}
}  // namespace artwork_store
