#!/usr/bin/env node
/**
 * Standalone probe: verifies the NetHome Plus cloud path end-to-end with a real
 * account, without Homey. Run `npm run build` first (compiles lib/ to .homeybuild/).
 *
 *   MIDEA_USER='you@example.com' MIDEA_PASS='secret' node scripts/probe.cjs [applianceId] [--set-power on|off]
 */
const { NetHomePlusCloud } = require('../.homeybuild/lib/NetHomePlusCloud');
const AC = require('../.homeybuild/lib/MideaAC');

(async () => {
  const user = process.env.MIDEA_USER, pass = process.env.MIDEA_PASS;
  if (!user || !pass) { console.error('Set MIDEA_USER and MIDEA_PASS environment variables'); process.exit(2); }
  const args = process.argv.slice(2);
  const wantId = args.find((a) => !a.startsWith('--'));
  const setPowerIdx = args.indexOf('--set-power');

  const cloud = new NetHomePlusCloud(user, pass);
  await cloud.login();
  const list = await cloud.listAppliances(true);
  console.log(`\n${list.length} appliance(s) on this account:`);
  for (const a of list) console.log(`  id=${a.id}  type=${a.type}  name="${a.name}"  model=${a.modelNumber}  sn=${a.serialNumber}  online=${a.online}`);

  const acs = list.filter((a) => a.type.toUpperCase() === '0XAC');
  const target = wantId ? acs.find((a) => a.id === wantId) : acs[0];
  if (!target) { console.log('\nNo air conditioner selected/found.'); return; }

  console.log(`\nQuerying state of "${target.name}" (${target.id}) via /v1/appliance/transparent/send ...`);
  const state = await AC.queryState(cloud, target.id);
  console.log(state);

  if (setPowerIdx >= 0) {
    const on = args[setPowerIdx + 1] === 'on';
    console.log(`\nSetting power ${on ? 'ON' : 'OFF'} ...`);
    const confirmed = await AC.applyState(cloud, target.id, { ...state, powerOn: on });
    console.log(confirmed);
  }
})().catch((e) => { console.error('\nFAILED:', e.message); process.exit(1); });
