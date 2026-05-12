const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const sqliteDb = new Database(path.join(DATA_DIR, 'lemon.db'));
sqliteDb.pragma('journal_mode = WAL');

sqliteDb.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    login             TEXT PRIMARY KEY,
    points            INTEGER DEFAULT 0,
    total_earned      INTEGER DEFAULT 0,
    streak            INTEGER DEFAULT 0,
    completed_missions TEXT DEFAULT '[]',
    awarded_invoices  TEXT DEFAULT '[]',
    referrals         TEXT DEFAULT '[]',
    redeemed          TEXT DEFAULT '[]',
    log               TEXT DEFAULT '[]',
    speedtests        TEXT DEFAULT '[]',
    login_history     TEXT DEFAULT '[]',
    visited_sections  TEXT DEFAULT '[]',
    updated_at        TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    login       TEXT NOT NULL,
    tipo        TEXT NOT NULL,
    canal       TEXT NOT NULL DEFAULT 'zap',
    mensagem    TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'sent',
    erro        TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notif_templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chave       TEXT UNIQUE NOT NULL,
    titulo      TEXT NOT NULL,
    mensagem    TEXT NOT NULL,
    ativo       INTEGER DEFAULT 1,
    updated_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pending_payments (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    mp_id        TEXT UNIQUE NOT NULL,
    login        TEXT NOT NULL,
    titulo_uuid  TEXT NOT NULL,
    valor        REAL NOT NULL,
    status       TEXT DEFAULT 'pending',
    tentativas   INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mp_subscriptions (
    preapproval_id   TEXT PRIMARY KEY,
    login            TEXT NOT NULL,
    cpf_limpo        TEXT NOT NULL,
    valor_mensal     REAL NOT NULL,
    titulo_uuid_ref  TEXT,
    status           TEXT DEFAULT 'pending',
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wallet_customers (
    login            TEXT PRIMARY KEY,
    mp_customer_id   TEXT NOT NULL,
    updated_at       TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wallet_cards (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    login            TEXT NOT NULL,
    mp_customer_id   TEXT NOT NULL,
    mp_card_id       TEXT NOT NULL,
    last_four        TEXT,
    payment_method_id TEXT,
    holder_name      TEXT,
    created_at       TEXT DEFAULT (datetime('now')),
    UNIQUE(login, mp_card_id)
  );

  CREATE TABLE IF NOT EXISTS mp_baixa_applied (
    mp_id      TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS portal_avisos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ordem       INTEGER NOT NULL DEFAULT 0,
    mensagem    TEXT NOT NULL,
    tipo        TEXT NOT NULL DEFAULT 'info',
    link_text   TEXT,
    link_href   TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    login       TEXT NOT NULL,
    endpoint    TEXT NOT NULL UNIQUE,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    user_agent  TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_push_sub_login ON push_subscriptions(login);

  CREATE TABLE IF NOT EXISTS splash_loading_mensagens (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ordem    INTEGER NOT NULL DEFAULT 0,
    texto    TEXT NOT NULL
  );
`);

(function migrarClubFaturaDescontoCol() {
  try {
    sqliteDb.exec(`ALTER TABLE clients ADD COLUMN club_fatura_desconto TEXT DEFAULT NULL`);
  } catch (e) {
    if (!String(e.message || '').includes('duplicate column')) {
      console.warn('⚠️  Migração club_fatura_desconto:', e.message);
    }
  }
})();

(function migrarPushNotifPrefsCol() {
  try {
    sqliteDb.exec(`ALTER TABLE clients ADD COLUMN push_notif_prefs TEXT DEFAULT NULL`);
  } catch (e) {
    if (!String(e.message || '').includes('duplicate column')) {
      console.warn('⚠️  Migração push_notif_prefs:', e.message);
    }
  }
})();

sqliteDb.exec(`
  CREATE TABLE IF NOT EXISTS push_fatura_digest (
    login TEXT NOT NULL,
    day   TEXT NOT NULL,
    PRIMARY KEY (login, day)
  );

  CREATE TABLE IF NOT EXISTS zap_fatura_digest (
    login TEXT NOT NULL,
    day   TEXT NOT NULL,
    PRIMARY KEY (login, day)
  );

  CREATE TABLE IF NOT EXISTS watch_oauth (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    access_token  TEXT,
    token_type    TEXT,
    raw_json      TEXT,
    updated_at    TEXT DEFAULT (datetime('now'))
  );
`);

const tplStmt = sqliteDb.prepare(`INSERT OR IGNORE INTO notif_templates (chave, titulo, mensagem) VALUES (?, ?, ?)`);
tplStmt.run('boas_vindas', 'Boas-vindas ao portal', `Olá {nome}! 👋

Bem-vindo(a) à *Lemon Technology*! 🍋

Você agora tem acesso ao nosso portal exclusivo do cliente:
🔗 {portal_url}

Acesse com seu CPF e aproveite tudo que preparamos para você:

✨ *Lemon Club* – Ganhe pontos a cada pagamento em dia e resgate recompensas incríveis
📊 Monitore sua conexão em tempo real
💳 Consulte faturas e histórico de pagamentos
🏆 Complete missões, suba de nível e ganhe benefícios exclusivos

Qualquer dúvida, é só chamar aqui! 😊`);

tplStmt.run('lemon_club', 'Apresentação Lemon Club', `🍋 *Lemon Club* – O clube de vantagens da Lemon Technology!

Olá {nome}, sabia que você acumula pontos toda vez que paga sua fatura em dia?

🏅 Como funciona:
• Pague em dia → ganhe pontos
• Indique amigos → ganhe ainda mais
• Complete missões no portal → bônus especiais

🎁 Resgate seus pontos por:
• Descontos na mensalidade
• Upgrades de plano
• Brindes exclusivos e muito mais!

Acesse agora: {portal_url} e veja seus pontos 🚀`);

tplStmt.run('novo_cadastro_admin', 'Alerta de novo cadastro (admin)', `🆕 Novo cliente cadastrado no portal!

👤 Nome: {nome}
🔑 Login: {login}
📅 Data: {data}

Acesse o painel admin para mais detalhes.`);

tplStmt.run('fatura_paga', 'Confirmação de pagamento', `✅ *Pagamento confirmado!*

Olá {nome}, recebemos seu pagamento com sucesso! 🎉

💰 Valor: *R$ {valor}*
📅 Data: *{data}*
💳 Forma: *{forma}*

Obrigado por manter sua conta em dia! Isso gera pontos no *Lemon Club* 🍋⭐

Acesse o portal para acompanhar seus pontos: {portal_url}`);

// Migra template legado que ainda tem "PIX via Mercado Pago" hardcoded
try {
  sqliteDb.prepare(
    `UPDATE notif_templates
     SET mensagem = replace(mensagem, '💳 Forma: *PIX via Mercado Pago*', '💳 Forma: *{forma}*'),
         updated_at = datetime('now')
     WHERE chave = 'fatura_paga'
       AND mensagem LIKE '%💳 Forma: *PIX via Mercado Pago*%'`
  ).run();
} catch (_) {}

tplStmt.run('resgate_pontos', 'Confirmação de resgate de pontos', `🎁 *Resgate confirmado no Lemon Club!*

Olá {nome}, seu resgate foi processado com sucesso! 🍋

🏆 Benefício: *{beneficio}*
💎 Pontos utilizados: *{pontos_usados} pts*
💰 Pontos restantes: *{pontos_restantes} pts*
📅 Data: *{data}*

Nossa equipe foi notificada e irá processar seu benefício em breve.

Continue acumulando pontos e resgatando mais vantagens: {portal_url}`);

tplStmt.run('fatura_vencimento', 'Lembrete de vencimento (WhatsApp)', `⚠️ *Lembrete de fatura — Lemon Technology*

Olá {nome}! 👋

Sua fatura *{situacao}*.

💰 Valor: *R$ {valor}*
📅 Vencimento: *{datavenc}*

Acesse o portal para consultar detalhes e pagar:
🔗 {portal_url}

Para deixar de receber estes lembretes, acesse *Notificações* no portal e desative "Lembrete de fatura por WhatsApp".`);

tplStmt.run('boas_vindas_cadastro', 'Boas-vindas após cadastro', `🍋 *Bem-vindo(a) à Lemon Technology, {nome}!*

Seu cadastro foi recebido com sucesso! ✅

Nossa equipe irá analisar e ativar sua conta em breve. Você receberá uma confirmação assim que estiver tudo pronto.

Enquanto isso, acesse nosso portal e conheça o *Lemon Club* — nosso programa de pontos e recompensas:
🔗 {portal_url}

🏅 Com o Lemon Club você:
• Ganha pontos a cada pagamento em dia
• Resgata descontos, upgrades e muito mais
• Acumula bônus por indicar amigos

Qualquer dúvida, é só chamar! 😊`);

/** Migra portal-avisos.json → SQLite (uma vez); remove o ficheiro legado. */
(function migrarPortalAvisosJson() {
  const jsonPath = path.join(DATA_DIR, 'portal-avisos.json');
  if (!fs.existsSync(jsonPath)) return;
  const rowCount = sqliteDb.prepare('SELECT COUNT(*) as n FROM portal_avisos').get().n;
  if (rowCount > 0) {
    try {
      fs.unlinkSync(jsonPath);
    } catch (_) {}
    return;
  }
  let arr;
  try {
    arr = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (_) {
    return;
  }
  if (!Array.isArray(arr)) {
    try {
      fs.unlinkSync(jsonPath);
    } catch (_) {}
    return;
  }
  const insert = sqliteDb.prepare(`
    INSERT INTO portal_avisos (ordem, mensagem, tipo, link_text, link_href)
    VALUES (?, ?, ?, ?, ?)
  `);
  const run = sqliteDb.transaction((items) => {
    items.forEach((raw, i) => {
      const mensagem = String(raw?.mensagem || '').trim().slice(0, 2000);
      if (!mensagem) return;
      const tipo = ['info', 'success', 'warning'].includes(raw?.tipo) ? raw.tipo : 'info';
      let linkText = String(raw?.linkText || '').trim().slice(0, 120);
      let linkHref = String(raw?.linkHref || '').trim().slice(0, 500);
      if (!/^https?:\/\//i.test(linkHref)) {
        linkHref = '';
        linkText = '';
      }
      insert.run(i, mensagem, tipo, linkText || null, linkHref || null);
    });
  });
  run(arr.slice(0, 20));
  try {
    fs.unlinkSync(jsonPath);
    console.log('✅ Avisos do portal: dados em portal-avisos.json migrados para SQLite (lemon.db).');
  } catch (e) {
    console.warn('⚠️  Migração avisos: não foi possível remover portal-avisos.json:', e.message);
  }
})();

/** Um aviso de demonstração (só se ainda não existir esta mensagem). */
(function seedPortalAvisoExemplo() {
  const msg =
    'Este é um aviso de exemplo: aparece aqui abaixo do próximo vencimento. Edita ou remove no Admin (Dashboard → Avisos no portal do cliente).';
  try {
    const dup = sqliteDb.prepare('SELECT 1 FROM portal_avisos WHERE mensagem = ?').get(msg);
    if (dup) return;
    const ordem =
      (sqliteDb.prepare('SELECT COALESCE(MAX(ordem), -1) AS m FROM portal_avisos').get().m || -1) + 1;
    sqliteDb
      .prepare(
        `INSERT INTO portal_avisos (ordem, mensagem, tipo, link_text, link_href) VALUES (?,?,?,?,?)`
      )
      .run(ordem, msg, 'info', 'Lemon Technology', 'https://lemontechnology.com.br');
  } catch (_) {}
})();

(function migrarJson() {
  const jsonFile = path.join(DATA_DIR, 'referrals.json');
  if (!fs.existsSync(jsonFile)) return;
  try {
    const count = sqliteDb.prepare('SELECT COUNT(*) as n FROM clients').get();
    if (count.n > 0) return;
    const json = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    const insert = sqliteDb.prepare(`
      INSERT OR IGNORE INTO clients
        (login, points, total_earned, streak, completed_missions, awarded_invoices,
         referrals, redeemed, log, speedtests, login_history, visited_sections, club_fatura_desconto)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    const run = sqliteDb.transaction((entries) => {
      for (const [login, c] of entries) {
        insert.run(
          login,
          c.points || 0,
          c.totalEarned || c.points || 0,
          c.streak || 0,
          JSON.stringify(c.completedMissions || []),
          JSON.stringify(c.awardedInvoices || []),
          JSON.stringify(c.referrals || []),
          JSON.stringify(c.redeemed || []),
          JSON.stringify(c.log || []),
          JSON.stringify(c.speedtests || []),
          JSON.stringify(c.loginHistory || []),
          JSON.stringify(c.visitedSections || []),
          JSON.stringify(c.clubFaturaDesconto || { pendente: null, aplicados: [] }),
        );
      }
    });
    run(Object.entries(json));
    console.log(`✅ Migração: ${Object.keys(json).length} clientes importados do JSON para SQLite`);
  } catch (e) {
    console.warn('⚠️  Migração JSON falhou:', e.message);
  }
})();

module.exports = { sqliteDb, DATA_DIR };
