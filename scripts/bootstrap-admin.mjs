import readline from 'node:readline';
import {Writable} from 'node:stream';
const url=process.argv[2];
if(!url || !url.startsWith('https://'))throw Error('Uso: node scripts/bootstrap-admin.mjs https://pet-refuge.TU-SUBDOMINIO.workers.dev');
let muted=false;
const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk);callback()}});
const rl=readline.createInterface({input:process.stdin,output,terminal:true});
const ask=(question,secret=false)=>new Promise(resolve=>{process.stdout.write(question);muted=secret;rl.question('',answer=>{muted=false;if(secret)process.stdout.write('\n');resolve(answer)})});
try{
 const token=await ask('BOOTSTRAP_TOKEN (oculto): ',true),nombre=await ask('Nombre del administrador: '),correo=await ask('Correo: '),password=await ask('Contraseña (mínimo 12 caracteres, oculta): ',true);
 if(password.length<12)throw Error('Contraseña demasiado corta.');
 const response=await fetch(new URL('/api/setup',url),{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({nombre,correo,password})});
 const data=await response.json();if(!response.ok)throw Error(data.error);console.log('Administrador creado. Ya puedes entrar desde Acceso al equipo. Elimina BOOTSTRAP_TOKEN en Cloudflare.');
}finally{rl.close()}
