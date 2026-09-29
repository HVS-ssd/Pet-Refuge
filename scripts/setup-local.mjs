import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {hashPassword} from '../src/security.js';

await mkdir('.local',{recursive:true});
let credentials;
try { credentials=JSON.parse(await readFile('.local/accounts.json','utf8')); }
catch { credentials=['ADMIN_ONG','VETERINARIO','VOLUNTARIO'].map((rol,i)=>({id:`demo-${rol.toLowerCase()}`,nombre:['Administración Demo','Veterinaria Demo','Voluntariado Demo'][i],correo:['admin@petrefuge.test','vet@petrefuge.test','voluntario@petrefuge.test'][i],password:randomBytes(15).toString('base64url'),rol}));await writeFile('.local/accounts.json',JSON.stringify(credentials,null,2)); }
try { await access('.dev.vars'); } catch { await writeFile('.dev.vars',`ENVIRONMENT="development"\nDATA_KEY="${randomBytes(32).toString('base64')}"\nBOOTSTRAP_TOKEN="${randomBytes(32).toString('base64url')}"\n`); }
const run=args=>{const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1)};
run(['d1','migrations','apply','DB','--local']);
const quote=s=>`'${String(s).replaceAll("'","''")}'`;
const sql=[];
for(const u of credentials){sql.push(`INSERT OR IGNORE INTO usuario(id,nombre,correo,clave_hash) VALUES(${[u.id,u.nombre,u.correo,await hashPassword(u.password)].map(quote).join(',')});`);sql.push(`INSERT OR IGNORE INTO usuario_rol VALUES(${quote(u.id)},${quote(u.rol)});`)}
const animals=[['luna','Luna','Perro',24,'Curiosa, cariñosa y siempre lista para un paseo. Busca un hogar que comparta su alegría.'],['milo','Milo','Gato',12,'Un pequeño observador que disfruta las ventanas soleadas y las tardes tranquilas.'],['bruno','Bruno','Perro',36,'Leal y juguetón. Su plan favorito es una caminata y una siesta cerca de ti.'],['nala','Nala','Gato',18,'Dulce e independiente, con una gran debilidad por los rincones cómodos.'],['toby','Toby','Perro',8,'Toda la energía y ternura de un cachorro. Necesita paciencia, juegos y compañía.'],['kiara','Kiara','Gato',30,'Una compañera serena que se toma su tiempo para confiar y luego no se separa.']];
for(const [key,name,species,age,description] of animals)sql.push(`INSERT OR IGNORE INTO animal(id,nombre,especie,edad_meses,foto_ref,descripcion,estado,fecha_ingreso,lugar_rescate,registrador_id) VALUES(${[key,name,species,age,`/images/${key}.jpg`,description,'DISPONIBLE','2026-09-01','Datos ficticios para demostración','demo-admin_ong'].map(quote).join(',')});`);
await writeFile('.local/seed.sql',sql.join('\n'));
run(['d1','execute','DB','--local','--file','.local/seed.sql']);
console.log('Entorno local listo. Credenciales privadas: .local/accounts.json. Ejecuta npm run dev.');
