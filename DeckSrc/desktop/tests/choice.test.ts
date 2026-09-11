import { describe, expect, it } from "vitest";
import { choiceOf, nextChoice } from "../src/shared/widgets/choice";

const options = [
    { id: "a", name: "Microphone (A)" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
];

describe("keys that cycle through options", () => {
    it("move to the next option, round again after the last, and to the first with none chosen", () => {
        expect(nextChoice(options, "a")?.id).toBe("b");
        expect(nextChoice(options, "c")?.id).toBe("a");
        expect(nextChoice(options, "gone")?.id).toBe("a");
        expect(nextChoice([], "a")).toBeUndefined();
    });

    it("show the option chosen, and where it is among them", () => {
        expect(choiceOf(options, "b", true)).toEqual({
            reachable: true,
            name: "B",
            index: 1,
            count: 3,
        });
        expect(choiceOf(options, "gone", false)).toEqual({
            reachable: false,
            name: "",
            index: -1,
            count: 3,
        });
    });
});
