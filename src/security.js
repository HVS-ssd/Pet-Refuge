const enc = new TextEncoder();
export const id = () => crypto.randomUUID();
export const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
export async function digest(text) { return b64(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
export async function hashPassword(password, salt = b64(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:unb64(salt), iterations:100000}, key, 256);
  return `pbkdf2-sha256$100000$${salt}$${b64(hash)}`;
}
export async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  return parts.length === 4 && await digest(await hashPassword(password, parts[2])) === await digest(stored);
}
async function encryptionKey(env) {
  if (!env.DATA_KEY) throw new Error('DATA_KEY_NOT_CONFIGURED');
  return crypto.subtle.importKey('raw', unb64(env.DATA_KEY), 'AES-GCM', false, ['encrypt','decrypt']);
}
export async function encryptBytes(bytes, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv}, await encryptionKey(env), bytes));
  const result = new Uint8Array(12+ciphertext.length); result.set(iv); result.set(ciphertext,12); return result;
}
export async function decryptBytes(bytes, env) {
  const data = new Uint8Array(bytes);
  return crypto.subtle.decrypt({name:'AES-GCM',iv:data.slice(0,12)}, await encryptionKey(env), data.slice(12));
}
export async function encrypt(value, env) { return b64(await encryptBytes(enc.encode(JSON.stringify(value)), env)); }
export async function decrypt(value, env) { return JSON.parse(new TextDecoder().decode(await decryptBytes(unb64(value), env))); }
export class HttpError extends Error { constructor(status,message) { super(message); this.status=status; } }
export function requireThat(condition,message,status=400) { if(!condition) throw new HttpError(status,message); }
export function string(value,label,max=500,min=1) { requireThat(typeof value==='string' && value.trim().length>=min && value.trim().length<=max,`${label}: ingresa entre ${min} y ${max} caracteres.`); return value.trim(); }
export function integer(value,label,min,max) { const n=Number(value); requireThat(value!=='' && value!==null && Number.isInteger(n) && n>=min && n<=max,`${label}: valor inválido.`); return n; }
export function date(value,label,{future=false}={}) { requireThat(typeof value==='string' && /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) && Number.isFinite(Date.parse(value)),`${label}: fecha inválida.`); const result=new Date(value).toISOString(); requireThat(future || Date.parse(result)<=Date.now(),`${label}: no puede ser futura.`); return result; }
export function oneOf(value,values,label) { requireThat(values.includes(value),`${label}: opción inválida.`); return value; }
export async function pdf(file) {
  requireThat(file && typeof file.arrayBuffer==='function' && file.size>0 && file.size<=5*1024*1024,'Adjunta un PDF de hasta 5 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  requireThat(file.name.toLowerCase().endsWith('.pdf') && (!file.type || file.type==='application/pdf') && new TextDecoder().decode(bytes.slice(0,5))==='%PDF-','El archivo no es un PDF válido.');
  return bytes;
}
