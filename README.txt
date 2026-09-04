Control your Midea, Comfee, Carrier, Senville and other NetHome Plus compatible air conditioners from Homey, through the Midea cloud.

Since Midea closed the cloud endpoint that hands out the token and key needed for local (LAN) pairing, new units can no longer be added over the local network. This app talks to the Midea cloud instead, the same way the NetHome Plus app does when your phone is away from home, so pairing keeps working.

Features
- Power on/off
- Mode: auto, cool, heat, dry, fan only
- Target temperature from 16 to 30 °C in 0.5 °C steps
- Indoor and outdoor temperature
- Fan speed: auto, silent, low, medium, high, full
- Swing: off, vertical, horizontal, both
- Turbo, ECO and 8 °C freeze protection
- Flow cards (triggers, conditions and actions) for every function
- Triggers also fire when the unit is changed from the remote control or the NetHome Plus app

Setup
1. Add the air conditioners to the NetHome Plus app first.
2. In Homey add a device, choose this app and sign in with your NetHome Plus account.
3. Pick the units you want to control.

Notes
- An internet connection is required; there is no local fallback.
- The state is refreshed by polling the cloud (30 seconds by default, adjustable in the device settings).
- Use "Repair" on a device if you change your NetHome Plus password.
