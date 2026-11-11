import { exec } from 'node:child_process';
import util from 'node:util';

const execPromise = util.promisify(exec);

/**
 * Checks if the Windows machine Wi-Fi card supports Hosted Network / SoftAP.
 */
export async function checkHotspotSupport() {
  if (process.platform !== 'win32') {
    return { supported: false, reason: 'Non-Windows operating system' };
  }

  try {
    const { stdout } = await execPromise('netsh wlan show drivers');
    const match = stdout.match(/Hosted network supported\s*:\s*(Yes|No)/i);
    const supported = match ? match[1].toLowerCase() === 'yes' : false;
    return { supported };
  } catch (err) {
    return { supported: false, error: err.message };
  }
}

/**
 * Starts a native ad-hoc Wi-Fi hotspot on Windows.
 * This allows true router-less direct connection on trains/cars without any Wi-Fi router.
 */
export async function startWindowsHotspot({ ssid = 'uDrop-Share', key = 'udrop1234' } = {}) {
  if (process.platform !== 'win32') {
    throw new Error('Router-less hotspot mode is only supported natively on Windows at this time.');
  }

  // 1. Configure the hosted network
  await execPromise(`netsh wlan set hostednetwork mode=allow ssid="${ssid}" key="${key}" keyUsage=temporary`);

  // 2. Start the hosted network
  await execPromise('netsh wlan start hostednetwork');

  return {
    ssid,
    key,
    // Standard Wi-Fi pairing string recognized by iOS and Android camera apps
    wifiQrString: `WIFI:S:${ssid};T:WPA;P:${key};;`,
    gatewayIp: '192.168.137.1' // Windows default ICS / hosted network IP
  };
}

/**
 * Stops the hosted network.
 */
export async function stopWindowsHotspot() {
  if (process.platform !== 'win32') return;
  try {
    await execPromise('netsh wlan stop hostednetwork');
  } catch (e) {
    // Ignore cleanup error
  }
}
