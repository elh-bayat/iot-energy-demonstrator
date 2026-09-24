/*
 * Energy Demonstrator – RFID node
 *
 * ESP8266 (NodeMCU) + 2x PN532 NFC/RFID readers on a shared hardware SPI bus.
 * Every new tag placed on a reader is reported to the FastAPI backend:
 *
 *   POST /api/rfid   {"tag_uid": "04A1B2C3", "reader_id": "reader_1"}
 *
 * Features
 *  - two readers on one SPI bus with independent chip-select lines
 *  - per-reader debounce (a tag resting on a reader is reported once)
 *  - tag-removal detection (logged on serial)
 *  - automatic re-initialisation of a reader that is missing or stops answering
 *  - non-blocking Wi-Fi reconnect
 */

#include <Arduino.h>
#include <SPI.h>
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <Adafruit_PN532.h>

#include "config.h"

struct RfidReader {
  Adafruit_PN532 nfc;
  const char*    id;
  uint8_t        csPin;
  bool           online;
  unsigned long  lastInitAttempt;
  String         currentUid;  // tag currently resting on the reader ("" = none)
  unsigned long  lastSeenMs;
  unsigned long  lastHealthCheck;
};

static RfidReader readers[] = {
  { Adafruit_PN532(PN532_SS_1), READER_1_ID, PN532_SS_1, false, 0, "", 0, 0 },
  { Adafruit_PN532(PN532_SS_2), READER_2_ID, PN532_SS_2, false, 0, "", 0, 0 },
};
static const size_t READER_COUNT = sizeof(readers) / sizeof(readers[0]);

static unsigned long lastWifiAttempt = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static String uidToHex(const uint8_t* uid, uint8_t len) {
  static const char HEX_CHARS[] = "0123456789ABCDEF";
  String out;
  out.reserve(len * 2);
  for (uint8_t i = 0; i < len; i++) {
    out += HEX_CHARS[(uid[i] >> 4) & 0x0F];
    out += HEX_CHARS[uid[i] & 0x0F];
  }
  return out;
}

static void deselectAllReaders() {
  // Both CS lines must be HIGH before any SPI transaction so the
  // two PN532 modules never drive MISO at the same time.
  for (size_t i = 0; i < READER_COUNT; i++) {
    pinMode(readers[i].csPin, OUTPUT);
    digitalWrite(readers[i].csPin, HIGH);
  }
}

static bool initReader(RfidReader& r) {
  r.lastInitAttempt = millis();
  r.nfc.begin();

  const uint32_t version = r.nfc.getFirmwareVersion();
  if (!version) {
    Serial.printf("[%s] PN532 not found (check wiring / SPI switch settings)\n", r.id);
    r.online = false;
    return false;
  }

  Serial.printf("[%s] PN5%02X firmware %u.%u\n", r.id,
                (unsigned)((version >> 24) & 0xFF),
                (unsigned)((version >> 16) & 0xFF),
                (unsigned)((version >> 8) & 0xFF));

  r.nfc.SAMConfig();                        // normal mode, polling (no IRQ line)
  r.nfc.setPassiveActivationRetries(0x01);  // return quickly when no tag is present
  r.online = true;
  return true;
}

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------

static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  const unsigned long now = millis();
  if (lastWifiAttempt != 0 && now - lastWifiAttempt < WIFI_RETRY_MS) return;

  lastWifiAttempt = now;
  Serial.printf("[wifi] connecting to %s ...\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

static bool postRfidEvent(const String& uid, const char* readerId) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[http] skipped: Wi-Fi not connected");
    return false;
  }

  WiFiClient client;
  HTTPClient http;
  const String url = String("http://") + API_HOST + ":" + API_PORT + API_RFID_PATH;

  if (!http.begin(client, url)) {
    Serial.println("[http] begin() failed");
    return false;
  }
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");

  const String body = String("{\"tag_uid\":\"") + uid + "\",\"reader_id\":\"" + readerId + "\"}";
  const int code = http.POST(body);
  http.end();

  if (code >= 200 && code < 300) {
    Serial.printf("[http] %s -> %d\n", body.c_str(), code);
    return true;
  }
  Serial.printf("[http] POST failed: %d (%s)\n", code, HTTPClient::errorToString(code).c_str());
  return false;
}

// ---------------------------------------------------------------------------
// RFID polling
// ---------------------------------------------------------------------------

static void pollReader(RfidReader& r) {
  const unsigned long now = millis();

  if (!r.online) {
    if (now - r.lastInitAttempt >= REINIT_INTERVAL_MS) initReader(r);
    return;
  }

  uint8_t uid[7] = {0};
  uint8_t uidLen = 0;
  const bool found = r.nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLen, READ_TIMEOUT_MS);

  if (!found) {
    // Tag removed?
    if (r.currentUid.length() && now - r.lastSeenMs > TAG_HOLD_MS) {
      Serial.printf("[%s] tag %s removed\n", r.id, r.currentUid.c_str());
      r.currentUid = "";
    }
    return;
  }

  const String hex = uidToHex(uid, uidLen);
  const bool sameTag = (hex == r.currentUid);
  r.lastSeenMs = now;

  if (sameTag) return;  // tag still resting on the reader -> already reported

  r.currentUid = hex;
  Serial.printf("[%s] tag %s detected (%u-byte UID)\n", r.id, hex.c_str(), uidLen);
  postRfidEvent(hex, r.id);
}

static void checkReaderHealth(RfidReader& r) {
  // A PN532 that lost power or got disconnected stops answering.
  // Checking the firmware version periodically lets us detect and recover.
  const unsigned long now = millis();
  if (!r.online || now - r.lastHealthCheck < REINIT_INTERVAL_MS) return;
  r.lastHealthCheck = now;

  if (!r.nfc.getFirmwareVersion()) {
    Serial.printf("[%s] reader stopped responding, will re-initialise\n", r.id);
    r.online = false;
    r.currentUid = "";
  }
}

// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println();
  Serial.println("Energy Demonstrator - RFID node (ESP8266 + 2x PN532)");

  deselectAllReaders();
  SPI.begin();

  for (size_t i = 0; i < READER_COUNT; i++) initReader(readers[i]);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  ensureWifi();
}

void loop() {
  ensureWifi();

  for (size_t i = 0; i < READER_COUNT; i++) {
    pollReader(readers[i]);
    checkReaderHealth(readers[i]);
    yield();  // keep the ESP8266 Wi-Fi stack / watchdog happy
  }
}
