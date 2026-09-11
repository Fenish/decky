import { DEVICE_FLOWS } from "../../../shared/widgets/discord";
import type {
    DiscordCallWidget,
    DiscordChannelWidget,
    DiscordDeviceWidget,
    DiscordNotificationsWidget,
    DiscordWidget,
} from "../../../shared/widgets/discord";
import type { DiscordService } from "../../integrations/discord/discord-service";
import type { GestureHandler, WidgetAction } from "./widget-action";

/** What a tap on a Discord key asks of Discord; said at once, `failed` hears if Discord refuses. */
type DiscordTap<W extends DiscordWidget> = (
    discord: DiscordService,
    widget: W,
    failed: (error: unknown) => void,
) => string;

/** A Discord key's action: its tap, as DiscordService does it. */
export class DiscordAction<W extends DiscordWidget> implements WidgetAction<W> {
    readonly gestures: { tap: GestureHandler<W> };

    constructor(tap: DiscordTap<W>) {
        this.gestures = {
            tap: (context, widget) => ({
                ok: true,
                message: tap(context.integrations.discord, widget, context.failed),
            }),
        };
    }
}

/** Joins the channel, or leaves it while you are in it. */
export const joinOrLeave = new DiscordAction<DiscordChannelWidget>((discord, widget, failed) =>
    discord.joinOrLeave(widget.channel, failed),
);
/** Leaves the call you are in. */
export const leaveCall = new DiscordAction<DiscordCallWidget>((discord, _widget, failed) =>
    discord.leave(failed),
);
/** Moves Discord to its next microphone, or output. */
export const nextDevice = new DiscordAction<DiscordDeviceWidget>((discord, widget, failed) =>
    discord.nextDevice(DEVICE_FLOWS[widget.type], failed),
);
/** Opens the last notification's conversation. */
export const openInbox = new DiscordAction<DiscordNotificationsWidget>((discord, _widget, failed) =>
    discord.openInbox(failed),
);
