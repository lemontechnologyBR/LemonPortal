const axios = require('axios');
const { MK_URL, MK_ID, MK_SECRET } = require('./config');

async function getJWT() {
  const credentials = Buffer.from(`${MK_ID}:${MK_SECRET}`).toString('base64');
  const res = await axios.get(`${MK_URL}/`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  return res.data.token || res.data.access_token || res.data;
}

async function mkGet(path) {
  const token = await getJWT();
  const r = await axios.get(`${MK_URL}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.data;
}

async function mkPost(path, body) {
  const token = await getJWT();
  const r = await axios.post(`${MK_URL}/${path}`, body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.data;
}

async function mkPut(path, body) {
  const token = await getJWT();
  const r = await axios.put(`${MK_URL}/${path}`, body, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.data;
}

async function mkDelete(path) {
  const token = await getJWT();
  const r = await axios.delete(`${MK_URL}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.data;
}

module.exports = { getJWT, mkGet, mkPost, mkPut, mkDelete };
