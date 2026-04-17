import { API } from './constants.js';

export { API };

export async function request(method, url, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  let data = {};
  if (ct.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = {};
    }
  } else {
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        text.includes('Cannot POST')
          ? 'API não encontrada — reinicie o Node (npm start) na pasta do Lemon Portal e atualize a página (Ctrl+F5).'
          : (text.slice(0, 200) || 'Erro na requisição'),
      );
    }
    const t = text.trimStart();
    if (t.startsWith('<!DOCTYPE') || t.startsWith('<html')) {
      throw new Error(
        `${method} ${url}: o browser recebeu uma página HTML em vez de JSON. ` +
          'Quem respondeu não foi o Lemon Portal (Node) neste endereço — abre o portal na URL onde o Node serve tudo (ex.: http://localhost:PORT) ou configura o teu servidor para este pedido chegar ao Node.',
      );
    }
    throw new Error('Resposta inválida do servidor');
  }
  if (!res.ok) {
    const message = data.error || 'Erro na requisição';
    const err = new Error(message);
    if (data && data.code) err.code = data.code;
    throw err;
  }
  return data;
}
