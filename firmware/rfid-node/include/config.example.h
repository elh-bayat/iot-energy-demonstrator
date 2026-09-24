// Copy this file to config.h and fill in your values.
// config.h is git-ignored so Wi-Fi credentials never end up in the repository.
#pragma once

// ---------- Wi-Fi ----------
#define WIFI_SSID      "your-ssid"
#define WIFI_PASSWORD  "your-password"

// ---------- Backend (FastAPI) ----------
// IP/hostname of the machine running `uvicorn main:app --host 0.0.0.0`
#define API_HOST       "192.168.1.100"
#define API_PORT       8000
#define API_RFID_PATH  "/api/rfid"

// ---------- PN532 chip-select pins (hardware SPI: SCK=D5, MISO=D6, MOSI=D7) ----------
// D8/GPIO15 is avoided because it is a boot-strapping pin.
// Note: D3/GPIO0 and D4/GPIO2 are also strapping pins and must be HIGH at boot.
// An idle CS line is HIGH, so they are safe for chip select.
#define PN532_SS_1     D4   // GPIO2
#define PN532_SS_2     D3   // GPIO0

// ---------- Reader identities (sent as reader_id to the backend) ----------
#define READER_1_ID    "reader_1"
#define READER_2_ID    "reader_2"

// ---------- Timing ----------
#define READ_TIMEOUT_MS      60     // max time spent polling one reader per loop
#define TAG_HOLD_MS          1500   // same tag on same reader within this window = one event
#define REINIT_INTERVAL_MS   5000   // retry interval for a reader that failed to initialise
#define WIFI_RETRY_MS        10000  // reconnect interval when Wi-Fi drops
#define HTTP_TIMEOUT_MS      2000
