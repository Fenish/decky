#include "protocol/command_router.h"
#include <string.h>

bool CommandRouter::run(const char *line) {
    char name[16];
    size_t length = strcspn(line, " ");
    if (length >= sizeof name) return false;
    memcpy(name, line, length);
    name[length] = 0;
    for (int i = 0; i < count_; ++i)
        if (sets_[i]->run(name, line)) return true;
    return false;
}
