#pragma once
#include <stddef.h>
#include <string.h>

// A group of the desktop's commands (pages, animated keys, the session...).
class CommandSet {
public:
    virtual ~CommandSet() = default;
    // Run `line` if its first word, `name`, is one of this set's commands and
    // it reads as one. False otherwise: the deck answers ERR unknown command.
    virtual bool run(const char *name, const char *line) = 0;
};

// A command set whose commands are a table of names and the methods that run
// them. Each method parses its own line and returns false if it does not read
// as that command. A new command is one row and one method:
//
//     bool PageCommands::run(const char *name, const char *line) {
//         static const Command COMMANDS[] = {{"CACHE", &PageCommands::cache}, ...};
//         return run_from(COMMANDS, name, line);
//     }
template <typename Self>
class CommandTable : public CommandSet {
protected:
    struct Command {
        const char *name;
        bool (Self::*run)(const char *line);
    };
    template <size_t N>
    bool run_from(const Command (&commands)[N], const char *name, const char *line) {
        for (const Command &command : commands)
            if (strcmp(command.name, name) == 0) return (static_cast<Self *>(this)->*command.run)(line);
        return false;
    }
};

// Each line from the desktop goes to the command set that knows it. A new
// feature brings its own CommandSet and adds it here.
class CommandRouter {
public:
    static constexpr int MAX_SETS = 8;
    void add(CommandSet &set) {
        if (count_ < MAX_SETS) sets_[count_++] = &set;
    }
    // Run `line`; false when no set understood it.
    bool run(const char *line);

private:
    CommandSet *sets_[MAX_SETS] = {};
    int count_ = 0;
};
