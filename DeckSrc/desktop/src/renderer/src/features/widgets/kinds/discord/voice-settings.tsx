import { useState } from "react";
import type { ReactNode } from "react";
import type { Widget } from "../../../../../../shared/widgets";
import { SNOWFLAKE } from "../../../../../../shared/widgets/discord";
import type {
    DiscordChannelWidget,
    VoiceLayout,
    VoiceWidget,
} from "../../../../../../shared/widgets/discord";
import { errorText } from "../../../../app/error-text";
import { AppCard } from "../../../integrations/app-card";
import { Segmented, Switch } from "../../form-controls";
import type { SettingsProps } from "../widget-view";

/**
 * The channel a key shows, by its ID, and a button beside it that takes the
 * one you are in now - with its name, for the editor. A component of its own,
 * as settings may not use hooks.
 */
function ChannelField({
    widget,
    onChange,
}: {
    widget: DiscordChannelWidget;
    onChange: (widget: Widget) => void;
}) {
    const [asking, setAsking] = useState(false);
    const [note, setNote] = useState("");
    const valid = widget.channel === "" || SNOWFLAKE.test(widget.channel);
    const useCurrent = (): void => {
        setAsking(true);
        setNote("");
        window.deck
            .integrationCall("discord", "currentChannel")
            .then((found) => {
                const channel = found as { id: string; name: string } | null;
                if (!channel) setNote("You aren't in a voice channel in Discord.");
                else onChange({ ...widget, channel: channel.id, name: channel.name });
            })
            .catch((error) => setNote(errorText(error)))
            .finally(() => setAsking(false));
    };
    return (
        <>
            <div className="channel-pick">
                <label className="field">
                    Voice channel ID
                    <input
                        aria-label="Voice channel ID"
                        placeholder="Join it in Discord, then Use current"
                        inputMode="numeric"
                        maxLength={21}
                        value={widget.channel}
                        // A typed ID's name is not known: it goes.
                        onChange={(event) => {
                            const { name: _name, ...rest } = widget;
                            onChange({ ...rest, channel: event.target.value.trim() });
                        }}
                    />
                </label>
                <button type="button" className="button" disabled={asking} onClick={useCurrent}>
                    {asking ? "Asking…" : "Use current"}
                </button>
            </div>
            {widget.name && <p className="channel-name">{widget.name}</p>}
            {!valid && (
                <p className="firmware-error">
                    A channel ID is 17 to 20 digits: in Discord, right-click the channel → Copy
                    Channel ID.
                </p>
            )}
            {note && (
                <p className="firmware-error" role="alert">
                    {note}
                </p>
            )}
        </>
    );
}

/** A voice key's settings: the channel for a channel's key; for both, Discord's card. */
export function voiceSettings({ widget, onChange }: SettingsProps<VoiceWidget>): ReactNode {
    return (
        <>
            {widget.type === "discord-channel" && (
                <ChannelField widget={widget} onChange={onChange} />
            )}
            <AppCard id="discord" />
        </>
    );
}

const LAYOUT_CHOICES: { value: VoiceLayout; label: string }[] = [
    { value: "grid", label: "Grid" },
    { value: "row", label: "Row" },
    { value: "stack", label: "Stack" },
];

/** A voice key's own looks, in its Appearance tab: how its people sit, and its name or not. */
export function voiceLooks({ widget, onChange }: SettingsProps<VoiceWidget>): ReactNode {
    const { showName: _showName, ...rest } = widget;
    return (
        <>
            <Segmented
                label="People"
                value={widget.layout ?? "grid"}
                options={LAYOUT_CHOICES}
                onChange={(layout) => onChange({ ...widget, layout })}
            />
            <Switch
                label="Channel name"
                on={widget.showName !== false}
                onChange={(on) => onChange(on ? rest : { ...rest, showName: false })}
            />
        </>
    );
}

/** What each voice key says under its settings. */
const HINTS: Record<VoiceWidget["type"], string> = {
    "discord-channel":
        "Shows who is in the channel, as their avatars - past four, three and how many more - " +
        "and turns green while you are in it. Tap to join it; tap again to leave.",
    "discord-call":
        "Shows who is in the call you are in, with a green ring on whoever speaks. With no call, " +
        "the key's icon. Tap to leave the call.",
};

export function voiceHint(widget: VoiceWidget): string {
    return HINTS[widget.type];
}
