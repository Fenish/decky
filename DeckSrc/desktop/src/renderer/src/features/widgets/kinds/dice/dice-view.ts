import type { DiceWidget } from "../../../../../../shared/widgets/dice";
import type { WidgetView } from "../widget-view";
import { dicePlace, diceWheel } from "./dice-deck-look";
import { diceHint, diceSettings } from "./dice-settings";
import { drawDice } from "./draw-dice";

export const diceView: WidgetView<DiceWidget> = {
    draw: drawDice,
    settings: diceSettings,
    hint: diceHint,
    sample: () => ({ value: 3 }),
    deckLook: { build: diceWheel, place: dicePlace },
};
