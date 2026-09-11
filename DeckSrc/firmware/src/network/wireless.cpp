#include "network/wireless.h"
#include <WiFi.h>
#include <WiFiUdp.h>
#include <Preferences.h>
#include <esp_random.h>
#include <esp_mac.h>
#include <mbedtls/md.h>
#include "security/secure_link.h"

namespace wireless {
namespace {
constexpr uint16_t PORT = 47561, DISCOVERY = 47562;
WiFiServer server(PORT);
WiFiClient client;
// Everything after the handshake goes through this, never through `client` directly.
SecureLink secure(client);
WiFiUDP udp;
Preferences prefs;
// Where the command being run came from (replies go back there), and which
// link the key events go to: the last one that sent a command.
Stream *source = &Serial, *owner = &Serial;
String secret, nonce, serial, joining_ssid, joining_password;
bool authenticated = false, listening = false, joining = false;
uint32_t client_at = 0, join_at = 0;
char usb_line[256] = {}, net_line[256] = {};
size_t usb_length = 0, net_length = 0;
bool usb_overflow = false, net_overflow = false;

// A network name or password on the wire: hex, "-" for none, so any bytes fit
// in a space-separated command.
String hex(const String &value) {
    String result;
    result.reserve(value.length() * 2);
    for (size_t i = 0; i < value.length(); ++i) {
        char b[3];
        snprintf(b, sizeof(b), "%02x", static_cast<uint8_t>(value[i]));
        result += b;
    }
    return result.length() ? result : String("-");
}
bool unhex(const char *value, String &result, size_t maximum) {
    result = "";
    if (strcmp(value, "-") == 0) return true;
    const size_t length = strlen(value);
    if (length % 2 || length > maximum * 2) return false;
    for (size_t i = 0; i < length; i += 2) {
        if (!isxdigit(value[i]) || !isxdigit(value[i + 1])) return false;
        char pair[3] = {value[i], value[i + 1], 0};
        char byte = static_cast<char>(strtol(pair, nullptr, 16));
        if (!byte) return false;
        result += byte;
    }
    return true;
}
String random_hex() {
    uint8_t data[32];
    esp_fill_random(data, sizeof(data));
    String result;
    for (auto byte : data) {
        char b[3];
        snprintf(b, sizeof(b), "%02x", byte);
        result += b;
    }
    return result;
}
// HMAC-SHA256(secret, message), in hex: what each side proves it knows the
// pairing secret with.
String proof(const String &message) {
    uint8_t digest[32];
    mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), reinterpret_cast<const uint8_t *>(secret.c_str()),
                    secret.length(), reinterpret_cast<const uint8_t *>(message.c_str()), message.length(), digest);
    String result;
    for (auto byte : digest) {
        char b[3];
        snprintf(b, sizeof(b), "%02x", byte);
        result += b;
    }
    return result;
}
// Compared in constant time, so a wrong proof takes as long as a nearly right one.
bool equal_secret(const String &a, const String &b) {
    if (a.length() != b.length()) return false;
    uint8_t difference = 0;
    for (size_t i = 0; i < a.length(); ++i) difference |= a[i] ^ b[i];
    return difference == 0;
}
// First 16 bytes of HMAC-SHA256(secret, label + challenge): one AES-128 key per direction.
void session_key(const char *label, uint8_t key[16]) {
    uint8_t digest[32];
    const String message = String(label) + nonce;
    mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), reinterpret_cast<const uint8_t *>(secret.c_str()),
                    secret.length(), reinterpret_cast<const uint8_t *>(message.c_str()), message.length(), digest);
    memcpy(key, digest, 16);
}
void drop_client() {
    client.stop();
    secure.reset();
    authenticated = false;
    net_length = 0;
    net_overflow = false;
    if (owner == &secure) owner = &Serial;
    if (source == &secure) source = &Serial;
}
// The only plain-text exchange on the network: one AUTH line answering the
// challenge. Success switches the connection to encrypted frames; anything
// else ends it.
void read_handshake() {
    while (client.available()) {
        const char byte = static_cast<char>(client.read());
        if (byte == '\r' || byte == '\n') {
            if (!net_length) continue;
            net_line[net_length] = 0;
            net_length = 0;
            if (strncmp(net_line, "AUTH ", 5) == 0 && equal_secret(String(net_line + 5), proof(nonce))) {
                client.printf("OK auth %s\n", proof("server:" + nonce).c_str());
                uint8_t to_deck[16], to_desktop[16];
                session_key("decky c2s ", to_deck);
                session_key("decky s2c ", to_desktop);
                secure.begin(to_desktop, to_deck);
                authenticated = secure.active();
                if (!authenticated) drop_client();
            } else {
                client.println("ERR authentication failed");
                drop_client();
            }
            return;  // stop here: whatever follows the AUTH line is encrypted
        } else if (net_length < 255) net_line[net_length++] = byte;
        else {
            drop_client();
            return;
        }
    }
}
// Lines from one link into `command`, one at a time; replies go back the same way.
void read_commands(Stream &stream, char *buffer, size_t &length, bool &overflow, void (*command)(const char *)) {
    while (stream.available()) {
        const char byte = static_cast<char>(stream.read());
        if (byte == '\r' || byte == '\n') {
            if (overflow) {
                stream.println("ERR command too long");
                overflow = false;
                length = 0;
                continue;
            }
            if (!length) continue;
            buffer[length] = 0;
            length = 0;
            source = &stream;
            command(buffer);
            source = &Serial;
        } else if (length < 255) buffer[length++] = byte;
        else overflow = true;
    }
}
}  // namespace

Stream &reply() { return *source; }
bool network_transfer() { return source == &secure; }
int read_network(uint8_t *buffer, size_t count) { return secure.read(buffer, count); }
Stream &events() { return owner == &secure && !authenticated ? Serial : *owner; }
void claim() { owner = source; }

void begin() {
    uint8_t mac[6];
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    char id[13];
    snprintf(id, sizeof(id), "%02x%02x%02x%02x%02x%02x", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    serial = id;
    prefs.begin("decky-wifi", false);
    secret = prefs.getString("pair");
    if (secret.length() != 64) {
        secret = random_hex();
        prefs.putString("pair", secret);
    }
    WiFi.persistent(false);
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.setAutoReconnect(true);
    const String ssid = prefs.getString("ssid");
    if (ssid.length()) WiFi.begin(ssid.c_str(), prefs.getString("password").c_str());
}

namespace {
// The WIFI_* commands, each given its whole line: false if it does not read as
// that command.
bool status(const char *line) {
    if (strcmp(line, "WIFI_STATUS") != 0) return false;
    const char *state = WiFi.status() == WL_CONNECTED       ? "connected"
                        : joining                           ? "connecting"
                        : prefs.getString("ssid").length() ? "disconnected"
                                                            : "unconfigured";
    reply().printf("OK wifi status=%s ssid=%s ip=%s saved=%d\n", state,
                   hex(WiFi.status() == WL_CONNECTED ? WiFi.SSID() : joining_ssid).c_str(),
                   WiFi.localIP().toString().c_str(), prefs.getString("ssid").length() ? 1 : 0);
    return true;
}
// The pairing secret, for the desktop to keep: USB only, as all that follow.
bool pair(const char *line) {
    if (strcmp(line, "WIFI_PAIR") != 0) return false;
    reply().printf("OK pair %s\n", secret.c_str());
    return true;
}
// A scan in the background; WIFI_LIST reads it.
bool scan(const char *line) {
    if (strcmp(line, "WIFI_SCAN") != 0) return false;
    if (joining) {
        reply().println("ERR wait for Wi-Fi connection");
        return true;
    }
    if (WiFi.scanComplete() != WIFI_SCAN_RUNNING) {
        WiFi.scanDelete();
        WiFi.scanNetworks(true);
    }
    reply().println("OK scanning");
    return true;
}
// Up to 24 networks: name (hex), signal, and 0 open, 1 password, 2 enterprise.
bool list(const char *line) {
    if (strcmp(line, "WIFI_LIST") != 0) return false;
    const int count = WiFi.scanComplete();
    if (count == WIFI_SCAN_RUNNING) {
        reply().println("OK scanning");
        return true;
    }
    if (count < 0) {
        reply().println("ERR Wi-Fi scan failed; try again");
        return true;
    }
    reply().print("OK networks ");
    for (int i = 0; i < count && i < 24; ++i) {
        if (i) reply().print(';');
        reply().printf("%s,%d,%d", hex(WiFi.SSID(i)).c_str(), WiFi.RSSI(i),
                       WiFi.encryptionType(i) == WIFI_AUTH_OPEN               ? 0
                       : WiFi.encryptionType(i) == WIFI_AUTH_WPA2_ENTERPRISE ? 2
                                                                             : 1);
    }
    reply().println();
    return true;
}
// WIFI_JOIN <name hex> <password hex, or ->: saved once it has connected.
bool join(const char *line) {
    if (strncmp(line, "WIFI_JOIN ", 10) != 0) return false;
    char ssid_hex[65], password_hex[129], extra;
    String ssid, password;
    if (sscanf(line, "WIFI_JOIN %64s %128s %c", ssid_hex, password_hex, &extra) != 2 || !unhex(ssid_hex, ssid, 32) ||
        !ssid.length() || !unhex(password_hex, password, 63) || (password.length() && password.length() < 8)) {
        reply().println("ERR invalid Wi-Fi credentials");
        return true;
    }
    if (WiFi.scanComplete() == WIFI_SCAN_RUNNING) {
        reply().println("ERR wait for scan to finish");
        return true;
    }
    joining_ssid = ssid;
    joining_password = password;
    joining = true;
    join_at = millis();
    WiFi.disconnect();
    WiFi.begin(ssid.c_str(), password.c_str());
    reply().println("OK connecting");
    return true;
}
bool forget(const char *line) {
    if (strcmp(line, "WIFI_FORGET") != 0) return false;
    prefs.remove("ssid");
    prefs.remove("password");
    joining = false;
    joining_password = "";
    joining_ssid = "";
    WiFi.disconnect(false, true);
    reply().println("OK forgotten");
    return true;
}

struct WifiCommand {
    const char *name;
    bool (*run)(const char *line);
};
// These change the deck's network or hand out its pairing secret: USB only.
const WifiCommand USB_ONLY[] = {
    {"WIFI_PAIR", pair}, {"WIFI_SCAN", scan}, {"WIFI_LIST", list}, {"WIFI_JOIN", join}, {"WIFI_FORGET", forget},
};
}  // namespace

bool handle(const char *line) {
    if (strncmp(line, "WIFI_", 5) != 0) return false;
    // Status answers over either link.
    if (status(line)) return true;
    if (source != &Serial) {
        reply().println("ERR connect USB to configure Wi-Fi");
        return true;
    }
    const size_t length = strcspn(line, " ");
    for (const WifiCommand &command : USB_ONLY)
        if (strlen(command.name) == length && strncmp(command.name, line, length) == 0 && command.run(line))
            return true;
    reply().println("ERR unknown Wi-Fi command");
    return true;
}

void poll(void (*command)(const char *)) {
    read_commands(Serial, usb_line, usb_length, usb_overflow, command);
    // A network joined is saved only once it connected.
    if (joining && WiFi.status() == WL_CONNECTED) {
        prefs.putString("ssid", joining_ssid);
        prefs.putString("password", joining_password);
        joining_password = "";
        joining = false;
    }
    if (joining && millis() - join_at > 25000) {
        joining = false;
        joining_password = "";
        WiFi.disconnect();
    }
    if (WiFi.status() != WL_CONNECTED) {
        if (listening) {
            server.end();
            udp.stop();
            client.stop();
            listening = false;
        }
        return;
    }
    if (!listening) {
        server.begin();
        server.setNoDelay(true);
        udp.begin(DISCOVERY);
        listening = true;
    }
    // Discovery: a paired desktop finds the deck on the network by its serial.
    if (udp.parsePacket()) {
        char request[32] = {};
        const int length = udp.read(request, sizeof(request) - 1);
        if (length == 14 && strcmp(request, "DECKY_DISCOVER") == 0) {
            udp.beginPacket(udp.remoteIP(), udp.remotePort());
            udp.printf("DECKY %s %d", serial.c_str(), PORT);
            udp.endPacket();
        }
    }
    if (!client.connected()) {
        WiFiClient incoming = server.accept();
        if (incoming) {
            client = incoming;
            client.setNoDelay(true);
            secure.reset();
            authenticated = false;
            client_at = millis();
            net_length = 0;
            net_overflow = false;
            // A new connection gets no key events until it has authenticated and sent a command.
            if (owner == &secure) owner = &Serial;
            nonce = random_hex();
            // "aesgcm1" announces encrypted frames after AUTH. The desktop refuses a
            // challenge without it, so the link cannot be downgraded to plain text.
            client.printf("CHALLENGE %s aesgcm1\n", nonce.c_str());
        }
    }
    if (client.connected()) {
        if (!authenticated) {
            if (millis() - client_at > 5000) {
                drop_client();
                return;
            }
            read_handshake();
        } else {
            read_commands(secure, net_line, net_length, net_overflow, command);
            if (secure.failed()) drop_client();
        }
    } else if (authenticated) {
        drop_client();
    }
}
}  // namespace wireless
