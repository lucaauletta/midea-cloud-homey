import crypto from 'node:crypto';

/**
 * Midea air conditioner (appliance type 0xAC) frame encoding/decoding,
 * plus the cloud (5A5A) packet wrapper used by /v1/appliance/transparent/send.
 *
 * Frame layout reference: mteutelink/midea-msmarthome-ac-euosk105 (LANCommand,
 * SetStateCommand, GetStateResponse) and nbogojevic/midea-beautiful-air (command.py).
 */

export const APPLIANCE_TYPE_AC = 0xac;
const SIGN_KEY = 'xhdiwjnchekd4d512chdjx5d8e4c394D2D7S';

export enum FrameType { SET = 0x02, REQUEST = 0x03 }

export enum OperationalMode { AUTO = 1, COOL = 2, DRY = 3, HEAT = 4, FAN = 5 }

export enum FanSpeed { AUTO = 102, FIXED = 101, SILENT = 20, LOW = 40, MEDIUM = 60, HIGH = 80, FULL = 100 }

export enum SwingMode { OFF = 0, VERTICAL = 0x0c, HORIZONTAL = 0x03, BOTH = 0x0f }

export const MIN_TARGET_TEMPERATURE = 16;
export const MAX_TARGET_TEMPERATURE = 30;

export interface ACState {
  powerOn: boolean;
  mode: OperationalMode;
  fanSpeed: FanSpeed | number;
  swingMode: SwingMode;
  turbo: boolean;
  eco: boolean;
  sleep: boolean;
  freezeProtection: boolean;
  fahrenheit: boolean;
  targetTemperature: number;
  indoorTemperature: number | null;
  outdoorTemperature: number | null;
  errorCode: number;
}

// -----------------------------------------------------------------------------
// CRC / checksum
// -----------------------------------------------------------------------------

const CRC8_854_TABLE = [
  0x00, 0x5E, 0xBC, 0xE2, 0x61, 0x3F, 0xDD, 0x83, 0xC2, 0x9C, 0x7E, 0x20, 0xA3, 0xFD, 0x1F, 0x41,
  0x9D, 0xC3, 0x21, 0x7F, 0xFC, 0xA2, 0x40, 0x1E, 0x5F, 0x01, 0xE3, 0xBD, 0x3E, 0x60, 0x82, 0xDC,
  0x23, 0x7D, 0x9F, 0xC1, 0x42, 0x1C, 0xFE, 0xA0, 0xE1, 0xBF, 0x5D, 0x03, 0x80, 0xDE, 0x3C, 0x62,
  0xBE, 0xE0, 0x02, 0x5C, 0xDF, 0x81, 0x63, 0x3D, 0x7C, 0x22, 0xC0, 0x9E, 0x1D, 0x43, 0xA1, 0xFF,
  0x46, 0x18, 0xFA, 0xA4, 0x27, 0x79, 0x9B, 0xC5, 0x84, 0xDA, 0x38, 0x66, 0xE5, 0xBB, 0x59, 0x07,
  0xDB, 0x85, 0x67, 0x39, 0xBA, 0xE4, 0x06, 0x58, 0x19, 0x47, 0xA5, 0xFB, 0x78, 0x26, 0xC4, 0x9A,
  0x65, 0x3B, 0xD9, 0x87, 0x04, 0x5A, 0xB8, 0xE6, 0xA7, 0xF9, 0x1B, 0x45, 0xC6, 0x98, 0x7A, 0x24,
  0xF8, 0xA6, 0x44, 0x1A, 0x99, 0xC7, 0x25, 0x7B, 0x3A, 0x64, 0x86, 0xD8, 0x5B, 0x05, 0xE7, 0xB9,
  0x8C, 0xD2, 0x30, 0x6E, 0xED, 0xB3, 0x51, 0x0F, 0x4E, 0x10, 0xF2, 0xAC, 0x2F, 0x71, 0x93, 0xCD,
  0x11, 0x4F, 0xAD, 0xF3, 0x70, 0x2E, 0xCC, 0x92, 0xD3, 0x8D, 0x6F, 0x31, 0xB2, 0xEC, 0x0E, 0x50,
  0xAF, 0xF1, 0x13, 0x4D, 0xCE, 0x90, 0x72, 0x2C, 0x6D, 0x33, 0xD1, 0x8F, 0x0C, 0x52, 0xB0, 0xEE,
  0x32, 0x6C, 0x8E, 0xD0, 0x53, 0x0D, 0xEF, 0xB1, 0xF0, 0xAE, 0x4C, 0x12, 0x91, 0xCF, 0x2D, 0x73,
  0xCA, 0x94, 0x76, 0x28, 0xAB, 0xF5, 0x17, 0x49, 0x08, 0x56, 0xB4, 0xEA, 0x69, 0x37, 0xD5, 0x8B,
  0x57, 0x09, 0xEB, 0xB5, 0x36, 0x68, 0x8A, 0xD4, 0x95, 0xCB, 0x29, 0x77, 0xF4, 0xAA, 0x48, 0x16,
  0xE9, 0xB7, 0x55, 0x0B, 0x88, 0xD6, 0x34, 0x6A, 0x2B, 0x75, 0x97, 0xC9, 0x4A, 0x14, 0xF6, 0xA8,
  0x74, 0x2A, 0xC8, 0x96, 0x15, 0x4B, 0xA9, 0xF7, 0xB6, 0xE8, 0x0A, 0x54, 0xD7, 0x89, 0x6B, 0x35,
];

export function crc8(data: Buffer): number {
  let crc = 0;
  for (const b of data) crc = CRC8_854_TABLE[(crc ^ b) & 0xff];
  return crc;
}

function checksum(data: Buffer): number {
  let sum = 0;
  for (let i = 1; i < data.length; i++) sum += data[i];
  return (~sum + 1) & 0xff;
}

let messageId = 0;
function nextMessageId(): number {
  messageId = (messageId + 1) & 0xff;
  return messageId;
}

// -----------------------------------------------------------------------------
// AA frame
// -----------------------------------------------------------------------------

/** Wraps a command body into a Midea "AA" frame for an air conditioner. */
export function buildFrame(body: Buffer, frameType: FrameType): Buffer {
  const payload = Buffer.concat([body, Buffer.from([nextMessageId()])]);
  const payloadCrc = Buffer.concat([payload, Buffer.from([crc8(payload)])]);
  const length = 10 + payloadCrc.length;
  const header = Buffer.from([
    0xaa,
    length,
    APPLIANCE_TYPE_AC,
    APPLIANCE_TYPE_AC ^ length,
    0x00, 0x00, // reserved
    0x00, // frame id
    0x00, // frame protocol version
    0x00, // device protocol version
    frameType,
  ]);
  const frame = Buffer.concat([header, payloadCrc]);
  return Buffer.concat([frame, Buffer.from([checksum(frame)])]);
}

/** Body of the "query status" (0x41) command. */
export function statusQueryBody(): Buffer {
  return Buffer.from([
    0x41, 0x81, 0x00, 0xff, 0x03, 0xff, 0x00,
    0x02, // request indoor temperature
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x03,
  ]);
}

/** Body of the "set state" (0x40) command. */
export function setStateBody(state: ACState, beep = false): Buffer {
  const target = Math.min(MAX_TARGET_TEMPERATURE, Math.max(MIN_TARGET_TEMPERATURE, state.targetTemperature));
  const integral = Math.floor(target);
  const half = target - integral >= 0.5 ? 0x10 : 0;
  const temperature = ((integral - MIN_TARGET_TEMPERATURE) & 0x0f) | half;
  const mode = (state.mode & 0x07) << 5;
  return Buffer.from([
    0x40,
    (beep ? 0x42 : 0) | (state.powerOn ? 0x01 : 0),
    temperature | mode,
    state.fanSpeed & 0x7f,
    0x7f, 0x7f, 0x00, // on/off timers disabled
    0x30 | (state.swingMode & 0x3f),
    state.turbo ? 0x20 : 0,
    state.eco ? 0x80 : 0,
    (state.sleep ? 0x01 : 0) | (state.turbo ? 0x02 : 0) | (state.fahrenheit ? 0x04 : 0),
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00,
    state.freezeProtection ? 0x80 : 0x00,
    0x00, 0x00,
  ]);
}

/**
 * Parses an "AA" frame reply. Returns null when the frame is not a 0xC0 status
 * response (e.g. capabilities or acknowledgements).
 */
export function parseStatusFrame(frame: Buffer): ACState | null {
  if (frame.length < 12 || frame[0] !== 0xaa) {
    throw new Error(`Not an AA frame (len=${frame.length}, first=0x${frame[0]?.toString(16)})`);
  }
  // Frame type byte 9: 0x02 set / 0x03 query / 0x04 notify / 0x05 ...
  const body = frame.subarray(10, frame.length - 2);
  if (body.length < 22 || body[0] !== 0xc0) return null;

  const decodeTemp = (raw: number, decimalNibble: number): number | null => {
    if (raw === 0 || raw === 0xff) return null;
    let t = (raw - 50) / 2;
    const dec = decimalNibble * 0.1;
    t = t >= 0 ? t + dec : t - dec;
    return Math.round(t * 10) / 10;
  };

  return {
    powerOn: (body[1] & 0x01) === 0x01,
    mode: ((body[2] & 0xe0) >> 5) as OperationalMode,
    fanSpeed: body[3] & 0x7f,
    swingMode: (body[7] & 0x0f) as SwingMode,
    turbo: (body[10] & 0x02) === 0x02 || (body[8] & 0x20) === 0x20,
    eco: (body[9] & 0x10) === 0x10,
    sleep: (body[10] & 0x01) === 0x01,
    fahrenheit: (body[10] & 0x04) === 0x04,
    freezeProtection: (body[21] & 0x80) === 0x80,
    targetTemperature: (body[2] & 0x0f) + MIN_TARGET_TEMPERATURE + ((body[2] & 0x10) ? 0.5 : 0),
    indoorTemperature: decodeTemp(body[11], body[15] & 0x0f),
    outdoorTemperature: decodeTemp(body[12], (body[15] & 0xf0) >> 4),
    errorCode: body[16],
  };
}

// -----------------------------------------------------------------------------
// Cloud (5A5A) packet
// -----------------------------------------------------------------------------

/**
 * Wraps an AA frame in the 5A5A transport packet expected by the cloud.
 * Unlike LAN packets the frame is NOT AES encrypted here: the cloud payload as
 * a whole is encrypted with the session data key by NetHomePlusCloud.
 */
export function buildCloudPacket(applianceId: string, frame: Buffer): Buffer {
  const now = new Date();
  const header = Buffer.alloc(40, 0);
  header.set([0x5a, 0x5a, 0x01, 0x11], 0); // static header + message type
  // [4..5] packet length, set below
  header.set([0x20, 0x00], 6);
  // [8..11] message id = 0
  header.set([
    Math.floor(now.getMilliseconds() / 10),
    now.getSeconds(),
    now.getMinutes(),
    now.getHours(),
    now.getDate(),
    now.getMonth() + 1,
    now.getFullYear() % 100,
    Math.floor(now.getFullYear() / 100),
  ], 12);
  header.writeBigUInt64LE(BigInt(applianceId), 20);
  // [28..39] reserved

  const packet = Buffer.concat([header, frame]);
  packet.writeUInt16LE(packet.length + 16, 4);
  const fingerprint = crypto.createHash('md5').update(Buffer.concat([packet, Buffer.from(SIGN_KEY, 'utf8')])).digest();
  return Buffer.concat([packet, fingerprint]);
}

// -----------------------------------------------------------------------------
// Convenience
// -----------------------------------------------------------------------------

export interface TransparentSender {
  transparentSend(applianceId: string, packet: Buffer): Promise<Buffer>;
}

/** Query the current state of an appliance through the cloud. */
export async function queryState(cloud: TransparentSender, applianceId: string): Promise<ACState> {
  const frame = buildFrame(statusQueryBody(), FrameType.REQUEST);
  const reply = await cloud.transparentSend(applianceId, buildCloudPacket(applianceId, frame));
  const state = parseStatusFrame(reply);
  if (!state) throw new Error(`Unexpected reply type 0x${reply[10]?.toString(16)} to status query`);
  return state;
}

/** Apply a full state to an appliance, then re-query it to get the confirmed state. */
export async function applyState(cloud: TransparentSender, applianceId: string, state: ACState): Promise<ACState> {
  const frame = buildFrame(setStateBody(state), FrameType.SET);
  const reply = await cloud.transparentSend(applianceId, buildCloudPacket(applianceId, frame));
  const confirmed = parseStatusFrame(reply);
  if (confirmed) return confirmed;
  return queryState(cloud, applianceId);
}
