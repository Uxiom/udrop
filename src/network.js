import os from 'node:os';

/**
 * Discovers the best local IPv4 address for P2P connection.
 * Prioritizes Wi-Fi and hotspot interfaces over virtual/docker bridges.
 * @returns {{ primaryIp: string, allIps: Array<{ name: string, ip: string }> }}
 */
export function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const allIps = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        // Skip virtual or docker interfaces if possible
        const isVirtual = /vEthernet|docker|WSL|VirtualBox|VMware/i.test(name);
        allIps.push({
          name,
          ip: addr.address,
          isVirtual,
          isWifi: /Wi-Fi|Wireless|WLAN|Hotspot/i.test(name)
        });
      }
    }
  }

  // Sort: Wi-Fi first, physical ethernet next, virtual last
  allIps.sort((a, b) => {
    if (a.isWifi && !b.isWifi) return -1;
    if (!a.isWifi && b.isWifi) return 1;
    if (!a.isVirtual && b.isVirtual) return -1;
    if (a.isVirtual && !b.isVirtual) return 1;
    return 0;
  });

  const primaryIp = allIps.length > 0 ? allIps[0].ip : '127.0.0.1';

  return {
    primaryIp,
    allIps
  };
}

/**
 * Returns privacy-first connection info using mDNS hostname (.local).
 * Prevents raw internal IP addresses from being exposed or displayed.
 */
export function getLocalHostInfo(port = 4040) {
  const cleanHost = os.hostname().toLowerCase().replace(/[^a-z0-9\-]/g, '');
  const mdnsHost = `${cleanHost}.local`;
  const { primaryIp, allIps } = getLocalIpAddresses();

  return {
    hostname: cleanHost,
    mdnsHost,
    mdnsUrl: `http://${mdnsHost}:${port}`,
    ipUrl: `http://${primaryIp}:${port}`,
    maskedLabel: `${cleanHost}.local:${port}`,
    port,
    primaryIp,
    allIps
  };
}
