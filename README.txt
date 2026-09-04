Midea is the world's largest manufacturer of air treatment products, and its air conditioners are sold under many names: Midea, Comfee, Carrier, Senville, Inventor, Artel and other brands that use the NetHome Plus app. This app brings those units into Homey and keeps them working after the change Midea made to its cloud.

In 2026 Midea closed the cloud service that handed out the token and key required to pair a unit over the local network. Existing Homey and home-automation integrations depend on that step, so new units can no longer be added. This app takes a different route: it talks to the Midea cloud the same way the NetHome Plus app does when you are away from home, so pairing and control keep working with nothing more than your NetHome Plus account.

What you can do
- Switch the unit on and off
- Choose the mode: auto, cool, heat, dry or fan only
- Set the target temperature from 16 to 30 °C in 0.5 °C steps
- Read the indoor and outdoor temperature
- Set the fan speed: auto, silent, low, medium, high or full
- Control the swing: off, vertical, horizontal or both
- Enable Turbo, ECO and the 8 °C freeze protection
- Build Flows with triggers, conditions and actions for every function, including changes made from the remote control or the NetHome Plus app

Getting started
1. Add the air conditioners to the NetHome Plus app.
2. In Homey add a new device, choose Midea Cloud and sign in with your NetHome Plus account.
3. Select the units you want to control.

Good to know
- An internet connection is required; there is no local fallback.
- The state is refreshed by polling the cloud every 30 seconds by default. You can change the interval in the device settings.
- If you change your NetHome Plus password, use Repair on the device to sign in again.
