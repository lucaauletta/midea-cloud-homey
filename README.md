# Midea Cloud for Homey

Homey app (SDK 3, TypeScript) that controls Midea, Comfee, Carrier, Senville and other air
conditioners that work with the **NetHome Plus** app, through the **Midea cloud** instead of the
local network.

## Why cloud

Since late August 2026 Midea has closed the `/v1/iot/secure/getToken` endpoint of the NetHome Plus
cloud (it now answers `errorCode 9999`). Without a token/key pair it is no longer possible to pair
v3 units locally, which is what broke the community "Midea" app (nl.intyme.midea) and the Home
Assistant integrations. The other NetHome Plus endpoints still work (checked on 2026-09-04):

| Endpoint | Status |
|---|---|
| `/v1/user/login/id/get`, `/v1/user/login` | working |
| `/v1/appliance/user/list/get` | working |
| `/v1/appliance/transparent/send` (commands and status) | working |
| `/v1/iot/secure/getToken` | closed (9999) |

This app uses `transparent/send`, the same channel the NetHome Plus app uses when the phone is not
on the home network. The MSmartHome cloud (`mp-prod.appsmb.com`) times out at login and is not used.

## Features

Same feature set as the community "Midea" app for Homey, but everything goes through the cloud:

| Feature | Capability | Flow cards |
|---|---|---|
| Power on/off | `onoff` | Homey built-in |
| Mode off/auto/cool/heat/dry/fan | `midea_mode` | changed to…, is…, set… |
| Target temperature 16–30 °C (0.5 steps) | `target_temperature` | Homey built-in |
| Indoor and outdoor temperature | `measure_temperature`, `measure_temperature.outdoor` | Homey built-in |
| Fan speed auto/silent/low/medium/high/full | `midea_fan_speed` | changed to…, is…, set… |
| Swing off/vertical/horizontal/both | `midea_swing_mode` | changed to…, is…, set… |
| Turbo | `midea_turbo` | turned on, turned off, is on, turn on, turn off |
| ECO (forces cool mode) | `midea_eco` | turned on, turned off, is on, turn on, turn off |
| Freeze protection 8 °C (forces heat mode) | `midea_freeze_protection` | turned on, turned off, is on, turn on, turn off |

Triggers also fire when the state is changed from the remote control or the NetHome Plus app,
because polling detects the difference.

## Device settings

- polling interval (default 30 s, minimum 10 s): every poll is one request to the Midea cloud
- number of consecutive failures before the device is marked unavailable
- log level (errors / information / debug with cloud requests and hex frames)

## Repair

If you change your NetHome Plus password, use *Repair* on the device: it asks for the credentials
again and reconnects without removing and re-adding the unit.

## Project layout

- `lib/NetHomePlusCloud.ts` – login, appliance list, transparent send with the session AES key
- `lib/MideaAC.ts` – `0xAA` frames (status query `0x41`, set `0x40`), `0xC0` reply parsing, `5A5A` cloud packet
- `drivers/ac/` – Homey driver: pairing with NetHome Plus login, polling, capabilities and flow cards
- `scripts/probe.cjs` – end-to-end check from the terminal, without Homey

## Requirements

- Node.js 24
- Docker Desktop or OrbStack for `homey app run` / `homey app install` on Homey Pro (2023) and
  Homey Pro mini, unless you run with `--remote`
- A NetHome Plus account with the air conditioners already added

## 1. Check from the terminal (before touching Homey)

```bash
npm install
npm run build
MIDEA_USER='you@example.com' MIDEA_PASS='secret' node scripts/probe.cjs
```

The probe lists the appliances and reads the state of the first air conditioner. To test a
command (turns the first unit off):

```bash
MIDEA_USER='you@example.com' MIDEA_PASS='secret' node scripts/probe.cjs <applianceId> --set-power off
```

Credentials are passed as environment variables and are not stored anywhere.

## 2. Install on Homey

```bash
npx homey login
npx homey app run --remote
```

`homey app run` builds, uploads the app to the selected Homey and streams the logs. Use
`npx homey app install` to keep it installed after closing the terminal.

Then in Homey: *Add device → Midea Cloud → Air conditioner (cloud)*, enter the NetHome Plus
credentials and pick the units.

## Notes

- NetHome Plus credentials are stored in the device store on Homey, as the existing community app does.
- If Midea also closes `transparent/send`, the app stops working: there is no local fallback without token/key.
- Protocol references: [midea-beautiful-air](https://github.com/nbogojevic/midea-beautiful-air),
  [midea-msmart](https://github.com/mill1000/midea-msmart),
  [midea-msmarthome-ac-euosk105](https://github.com/mteutelink/midea-msmarthome-ac-euosk105).

## License

GPL-3.0
