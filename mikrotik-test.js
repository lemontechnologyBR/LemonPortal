const { RouterOSAPI } = require('node-routeros');

const conn = new RouterOSAPI({
  host: '207.248.23.56',
  port: 30120,
  user: 'fsociety',
  password: 'bsk@4511',
  timeout: 15,
});

async function run() {
  try {
    console.log('Conectando ao MikroTik...');
    await conn.connect();
    console.log('✅ Conectado!\n');

    const queries = [
      { label: '📡 PPP Active Sessions',      cmd: '/ppp/active/print'             },
      { label: '📊 Queue Simple',             cmd: '/queue/simple/print'           },
      { label: '🌐 IP Hotspot Active',        cmd: '/ip/hotspot/active/print'      },
      { label: '🔌 Interfaces',               cmd: '/interface/print'              },
      { label: '📈 IP Accounting Snapshot',   cmd: '/ip/accounting/snapshot/take'  },
      { label: '🧾 IP Accounting Data',       cmd: '/ip/accounting/snapshot/print' },
      { label: '📋 RADIUS Info',              cmd: '/radius/print'                 },
      { label: '🖥️ System Resource',          cmd: '/system/resource/print'        },
    ];

    for (const q of queries) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(q.label);
      console.log('='.repeat(60));
      try {
        const result = await conn.write(q.cmd);
        if (!result || result.length === 0) {
          console.log('(vazio / sem dados)');
        } else {
          // Mostra os primeiros 3 registros e as chaves disponíveis
          const sample = result.slice(0, 3);
          console.log(`Total de registros: ${result.length}`);
          console.log('Campos disponíveis:', Object.keys(sample[0] || {}).join(', '));
          console.log('\nAmostra (primeiros 3):');
          sample.forEach((r, i) => console.log(`  [${i+1}]`, JSON.stringify(r, null, 2)));
        }
      } catch (e) {
        console.log(`⚠️  Erro: ${e.message || e}`);
      }
    }

    await conn.close();
    console.log('\n✅ Conexão encerrada.');
  } catch (err) {
    console.error('❌ Falha na conexão:', err.message || err);
  }
}

run();
