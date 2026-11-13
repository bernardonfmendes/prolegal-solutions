// Web Push (RFC 8291 + RFC 8292) só com WebCrypto. Sem dependências.
const enc = new TextEncoder();
const b64u = {
  dec(s: string) { const t = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(t), (c) => c.charCodeAt(0)); },
  enc(b: ArrayBuffer | Uint8Array) { return btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
};
const junta = (...a: Uint8Array[]) => { const t = a.reduce((n, x) => n + x.length, 0); const o = new Uint8Array(t); let i = 0;
  for (const x of a) { o.set(x, i); i += x.length; } return o; };

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}

// Encripta o conteúdo para um dispositivo (aes128gcm)
export async function cifrar(p256dhB64: string, authB64: string, textoUtf8: string, saltFixo?: Uint8Array, chaveEfemera?: CryptoKeyPair) {
  const uaPub = b64u.dec(p256dhB64);
  const authSecret = b64u.dec(authB64);

  const par = chaveEfemera || await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const segredo = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, par.privateKey, 256));

  const infoChave = junta(enc.encode('WebPush: info'), new Uint8Array([0]), uaPub, asPub);
  const ikm = await hkdf(authSecret, segredo, infoChave, 32);

  const salt = saltFixo || crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, junta(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, junta(enc.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const claro = junta(enc.encode(textoUtf8), new Uint8Array([2]));   // 0x02 = último registo
  const cifra = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, claro));

  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096);
  return junta(salt, rs, new Uint8Array([asPub.length]), asPub, cifra);
}

// Cabeçalho de autorização VAPID
export async function vapid(endpoint: string, jwk: JsonWebKey & { x: string; y: string }, assunto: string) {
  const aud = new URL(endpoint).origin;
  const cab = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = b64u.enc(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: assunto })));
  const k = await crypto.subtle.importKey('jwk', { ...jwk, key_ops: ['sign'], ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, enc.encode(cab + '.' + corpo));
  const pub = b64u.enc(junta(new Uint8Array([4]), b64u.dec(jwk.x), b64u.dec(jwk.y)));
  return `vapid t=${cab}.${corpo}.${b64u.enc(sig)}, k=${pub}`;
}

export { b64u, junta, hkdf };
