# Decky's Windows helper: the PC's volume and microphone, and what is
# playing. One JSON request a line in, one answer a line out, for as long as
# Decky runs (src/main/system/windows-host.ts). Once asked to (watch-audio), it
# also writes a line of its own whenever the volume or a mute changes - from
# the deck, the keyboard or Windows' own slider: {"event":"audio",...}.
$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8

# Core Audio: the default speaker (flow 0) and microphone (flow 1).
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr client); int UnregisterControlChangeNotify(IntPtr client);
    int GetChannelCount(out int count); int SetMasterVolumeLevel(float level, Guid context);
    int SetMasterVolumeLevelScalar(float level, Guid context); int GetMasterVolumeLevel(out float level);
    int GetMasterVolumeLevelScalar(out float level); int SetChannelVolumeLevel(uint channel, float level, Guid context);
    int SetChannelVolumeLevelScalar(uint channel, float level, Guid context); int GetChannelVolumeLevel(uint channel, out float level);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid context); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[Guid("657804FA-D6AD-4496-8A60-352752AF4F89"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolumeCallback { [PreserveSig] int OnNotify(IntPtr data); }
[StructLayout(LayoutKind.Sequential)]
public struct PropertyKey { public Guid Format; public int Id; }
[Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMNotificationClient {
    [PreserveSig] int OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string id, int state);
    [PreserveSig] int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int OnDefaultDeviceChanged(int flow, int role, [MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string id, PropertyKey key);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object face); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int flow, int mask, out IntPtr devices); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    int RegisterEndpointNotificationCallback(IMMNotificationClient client); int UnregisterEndpointNotificationCallback(IMMNotificationClient client);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
// Told by Windows the moment a speaker or microphone's volume or mute changes.
public class DeckyVolumeWatch : IAudioEndpointVolumeCallback {
    readonly int flow;
    public DeckyVolumeWatch(int flow) { this.flow = flow; }
    public int OnNotify(IntPtr data) {
        // AUDIO_VOLUME_NOTIFICATION_DATA: a GUID, then BOOL muted, float level.
        bool muted = Marshal.ReadInt32(data, 16) != 0;
        float level = BitConverter.ToSingle(BitConverter.GetBytes(Marshal.ReadInt32(data, 20)), 0);
        DeckyAudio.Say(flow, level, muted);
        return 0;
    }
}
// Told when the default speaker or microphone becomes another device.
public class DeckyDeviceWatch : IMMNotificationClient {
    public int OnDeviceStateChanged(string id, int state) { return 0; }
    public int OnDeviceAdded(string id) { return 0; }
    public int OnDeviceRemoved(string id) { return 0; }
    public int OnDefaultDeviceChanged(int flow, int role, string id) {
        // Not from inside Windows' call: it asks for no waiting there.
        if (role == 1) ThreadPool.QueueUserWorkItem(_ => DeckyAudio.Watch());
        return 0;
    }
    public int OnPropertyValueChanged(string id, PropertyKey key) { return 0; }
}
public static class DeckyAudio {
    static readonly object gate = new object();
    static IMMDeviceEnumerator devices;
    static readonly DeckyDeviceWatch deviceWatch = new DeckyDeviceWatch();
    static readonly IAudioEndpointVolume[] watched = new IAudioEndpointVolume[2];
    static readonly IntPtr[] watchers = new IntPtr[2];
    static IAudioEndpointVolume Endpoint(int flow) {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(flow, 1, out device));
        var id = typeof(IAudioEndpointVolume).GUID; object face;
        Marshal.ThrowExceptionForHR(device.Activate(ref id, 23, IntPtr.Zero, out face));
        return (IAudioEndpointVolume)face;
    }
    public static float Level(int flow) { float v; Marshal.ThrowExceptionForHR(Endpoint(flow).GetMasterVolumeLevelScalar(out v)); return v; }
    public static void SetLevel(int flow, float v) { Marshal.ThrowExceptionForHR(Endpoint(flow).SetMasterVolumeLevelScalar(v, Guid.Empty)); }
    public static bool Muted(int flow) { bool m; Marshal.ThrowExceptionForHR(Endpoint(flow).GetMute(out m)); return m; }
    public static void SetMuted(int flow, bool m) { Marshal.ThrowExceptionForHR(Endpoint(flow).SetMute(m, Guid.Empty)); }
    // Listen to the default speaker and microphone - again, after the default
    // changed - and say how they are now.
    public static void Watch() {
        lock (gate) {
            if (devices == null) {
                devices = (IMMDeviceEnumerator)new MMDeviceEnumerator();
                devices.RegisterEndpointNotificationCallback(deviceWatch);
            }
            for (int flow = 0; flow < 2; flow++) {
                if (watched[flow] != null) { try { watched[flow].UnregisterControlChangeNotify(watchers[flow]); } catch { } }
                watched[flow] = null;
                try {
                    if (watchers[flow] == IntPtr.Zero)
                        watchers[flow] = Marshal.GetComInterfaceForObject(new DeckyVolumeWatch(flow), typeof(IAudioEndpointVolumeCallback));
                    var endpoint = Endpoint(flow);
                    Marshal.ThrowExceptionForHR(endpoint.RegisterControlChangeNotify(watchers[flow]));
                    watched[flow] = endpoint;
                    float level; bool muted;
                    endpoint.GetMasterVolumeLevelScalar(out level); endpoint.GetMute(out muted);
                    Say(flow, level, muted);
                } catch { if (flow == 1) SayMissing(); }
            }
        }
    }
    public static void Say(int flow, float level, bool muted) {
        Line(String.Format("{{\"event\":\"audio\",\"flow\":{0},\"level\":{1},\"muted\":{2}}}", flow, (int)Math.Round(level * 100), muted ? "true" : "false"));
    }
    static void SayMissing() { Line("{\"event\":\"audio\",\"flow\":1,\"missing\":true}"); }
    // Console.Out is synchronized: a line from here never splits an answer.
    static void Line(string text) { Console.Out.WriteLine(text); Console.Out.Flush(); }
}
"@

# What is playing: Windows' media sessions, through WinRT.
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$methods = [System.WindowsRuntimeSystemExtensions].GetMethods()
$asTask = ($methods | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asTaskProgress = ($methods | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperationWithProgress`2' })[0]
function Await($operation, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    $null = $task.Wait(3000)
    $task.Result
}
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.Buffer, Windows.Storage.Streams, ContentType = WindowsRuntime]
$script:manager = $null
$script:coverKey = ""
$script:cover = $null

function Session {
    if (-not $script:manager) {
        $script:manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    }
    $script:manager.GetCurrentSession()
}

# A cover as a data URL. The stream's own members are out of PowerShell's
# reach, so they are called through their interfaces.
function Cover($reference) {
    $stream = Await ($reference.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    $size = [uint32]([Windows.Storage.Streams.IRandomAccessStream].GetProperty("Size").GetValue($stream))
    if ($size -eq 0 -or $size -gt 4MB) { return $null }
    $buffer = ([Windows.Storage.Streams.Buffer]::new($size)).psobject.BaseObject
    $read = [Windows.Storage.Streams.IInputStream].GetMethod("ReadAsync").Invoke($stream.psobject.BaseObject, [object[]]@($buffer, $size, [Windows.Storage.Streams.InputStreamOptions]::None))
    $task = $asTaskProgress.MakeGenericMethod([Windows.Storage.Streams.IBuffer], [uint32]).Invoke($null, @($read))
    $null = $task.Wait(3000)
    $bytes = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]::ToArray($task.Result)
    $type = [Windows.Storage.Streams.IContentTypeProvider].GetProperty("ContentType").GetValue($stream)
    "data:$type;base64," + [Convert]::ToBase64String($bytes)
}

function Media {
    $session = Session
    if (-not $session) { return @{ none = $true } }
    $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $timeline = $session.GetTimelineProperties()
    $key = "$($session.SourceAppUserModelId)|$($props.Title)|$($props.Artist)"
    # The cover is read once a track, not every second.
    if ($key -ne $script:coverKey) {
        $script:coverKey = $key
        $script:cover = $null
        try { if ($props.Thumbnail) { $script:cover = Cover $props.Thumbnail } } catch { }
    }
    @{
        key      = $key
        title    = [string]$props.Title
        artist   = [string]$props.Artist
        playing  = [string]$session.GetPlaybackInfo().PlaybackStatus -eq "Playing"
        position = [int64]$timeline.Position.TotalMilliseconds
        duration = [int64]$timeline.EndTime.TotalMilliseconds
        updated  = [int64]$timeline.LastUpdatedTime.ToUnixTimeMilliseconds()
        cover    = $script:cover
    }
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    $request = $line | ConvertFrom-Json
    try {
        switch ($request.op) {
            "audio" {
                $result = @{ level = [math]::Round([DeckyAudio]::Level(0) * 100); muted = [DeckyAudio]::Muted(0); mic = $null }
                try { $result.mic = @{ muted = [DeckyAudio]::Muted(1) } } catch { }
            }
            "volume" {
                [DeckyAudio]::SetLevel(0, [float]([double]$request.level / 100))
                # As Windows' own slider does: turning it up unmutes.
                if ([double]$request.level -gt 0 -and [DeckyAudio]::Muted(0)) { [DeckyAudio]::SetMuted(0, $false) }
                $result = @{}
            }
            "watch-audio" { [DeckyAudio]::Watch(); $result = @{} }
            "mute" { [DeckyAudio]::SetMuted(0, [bool]$request.muted); $result = @{} }
            "micmute" { [DeckyAudio]::SetMuted(1, [bool]$request.muted); $result = @{} }
            "media" { $result = Media }
            "media-toggle" { $s = Session; if ($s) { $null = Await ($s.TryTogglePlayPauseAsync()) ([bool]) }; $result = @{} }
            "media-next" { $s = Session; if ($s) { $null = Await ($s.TrySkipNextAsync()) ([bool]) }; $result = @{} }
            default { throw "Unknown request: $($request.op)" }
        }
        $answer = @{ id = $request.id; ok = $true; result = $result }
    } catch {
        $answer = @{ id = $request.id; ok = $false; error = $_.Exception.Message }
    }
    [Console]::Out.WriteLine(($answer | ConvertTo-Json -Compress -Depth 4))
    [Console]::Out.Flush()
}
