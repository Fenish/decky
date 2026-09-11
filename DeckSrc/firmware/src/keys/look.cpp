#pragma GCC optimize("O2", "fast-math")
#include "keys/look.h"
#include <Arduino.h>
#include <new>
#include "common/key_image.h"
#include "common/memory.h"
#include "keys/dial/dial.h"
#include "keys/die/die.h"
#include "keys/drum/drum.h"
#include "pages/patch.h"

namespace keys {
namespace {
template <typename Kind>
Look *make() {
    return new (std::nothrow) Kind;
}
// Each kind of look under the version byte it starts with. A new kind is a
// row here.
struct Maker {
    uint8_t version;
    Look *(*make)();
};
constexpr Maker MAKERS[] = {
    {1, make<DrumLook>},
    {2, make<DialLook>},
    {3, make<DieLook>},
};
}  // namespace

Look *Look::parse(uint8_t *data, size_t length) {
    ByteReader r{data, length};
    const uint8_t version = r.u8();
    Look *look = nullptr;
    for (const Maker &maker : MAKERS)
        if (maker.version == version) look = maker.make();
    if (look) look->backdrop_ = memory::pixels(KeyImage::pixels());
    if (!look || !look->backdrop_ || !look->read(r)) {
        delete look;
        free(data);
        return nullptr;
    }
    look->data_ = data;
    return look;
}

Look::~Look() {
    free(data_);
    free(backdrop_);
}

bool Look::picture(ByteReader &r, uint16_t *into) {
    const uint32_t bytes = r.u32();
    const uint8_t *patch = r.take(bytes);
    const int W = KeyImage::width(), H = KeyImage::height();
    return r.ok && into && apply_patch(into, W, H, patch, bytes, false) && apply_patch(into, W, H, patch, bytes, true);
}
}  // namespace keys
