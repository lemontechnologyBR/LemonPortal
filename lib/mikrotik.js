const { RouterOSAPI } = require('node-routeros');
const {
  ROS_HOST,
  ROS_PORT,
  ROS_USER,
  ROS_PASS,
} = require('./config');

const _rosCache = new Map();
const ROS_CACHE_TTL = 2500;

function parsePair(str) {
  const [a, b] = (str || '0/0').split('/').map(Number);
  return [a || 0, b || 0];
}

async function getMikrotikConexao(login) {
  const cached = _rosCache.get(login);
  if (cached && Date.now() - cached.ts < ROS_CACHE_TTL) return cached.data;

  if (!ROS_HOST || !ROS_USER) {
    const data = {
      online: false,
      login,
      ip: null,
      mac: null,
      uptime: null,
      dlBytes: 0,
      ulBytes: 0,
      dlRate: 0,
      ulRate: 0,
      maxDl: 0,
      maxUl: 0,
      dropped: 0,
      erro: 'MikroTik não configurado (MIKROTIK_HOST / MIKROTIK_USER no .env).',
    };
    _rosCache.set(login, { data, ts: Date.now() });
    return data;
  }

  const conn = new RouterOSAPI({
    host: ROS_HOST,
    port: ROS_PORT,
    user: ROS_USER,
    password: ROS_PASS,
    timeout: 10,
  });
  await conn.connect();

  try {
    const sessions = await conn.write('/ppp/active/print', [`?~name=${login}`]);
    const session = sessions.find(s => s.name === login) || sessions[0] || null;

    if (!session) {
      const data = {
        online: false,
        login,
        ip: null,
        mac: null,
        uptime: null,
        dlBytes: 0,
        ulBytes: 0,
        dlRate: 0,
        ulRate: 0,
        maxDl: 0,
        maxUl: 0,
        dropped: 0,
      };
      _rosCache.set(login, { data, ts: Date.now() });
      return data;
    }

    const pppoeIfaceName = `<pppoe-${session.name}>`;
    const queues = await conn.write('/queue/simple/print', [`?name=${pppoeIfaceName}`]);
    const queue = queues[0] || null;
    const ifStats = await conn.write('/interface/print', ['stats', `?name=${pppoeIfaceName}`]);
    const iface = ifStats[0] || null;

    let ulBytes = 0;
    let dlBytes = 0;
    if (iface) {
      ulBytes = Number(iface['rx-byte'] || 0);
      dlBytes = Number(iface['tx-byte'] || 0);
    } else if (queue) {
      [ulBytes, dlBytes] = parsePair(queue.bytes);
    }

    const now = Date.now();
    let dlRate = 0;
    let ulRate = 0;
    const prev = _rosCache.get(login);
    if (prev && prev.prevTs && now - prev.prevTs > 500) {
      const dt = (now - prev.prevTs) / 1000;
      dlRate = Math.max(0, Math.round(((dlBytes - prev.prevDlBytes) / dt) * 8));
      ulRate = Math.max(0, Math.round(((ulBytes - prev.prevUlBytes) / dt) * 8));
    } else if (queue) {
      [ulRate, dlRate] = parsePair(queue.rate);
    }

    let maxUl = 0;
    let maxDl = 0;
    if (queue) {
      [maxUl, maxDl] = parsePair(queue['max-limit']);
    }

    const dropped = queue ? parsePair(queue.dropped)[1] : 0;

    const data = {
      online: true,
      login: session.name,
      ip: session.address || null,
      mac: session['caller-id'] || null,
      uptime: session.uptime || null,
      dlBytes,
      ulBytes,
      dlRate,
      ulRate,
      maxDl,
      maxUl,
      dropped,
    };

    _rosCache.set(login, { data, ts: now, prevDlBytes: dlBytes, prevUlBytes: ulBytes, prevTs: now });
    return data;
  } finally {
    await conn.close();
  }
}

module.exports = { getMikrotikConexao, parsePair };
