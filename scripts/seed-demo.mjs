// Adds an isolated, explicitly fictional dataset. Never replaces existing rows.
// Usage: node scripts/seed-demo.mjs --apply
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {encrypt,encryptBytes,hashPassword} from '../src/security.js';

const prefix='demo-t7-';
const base='https://pet-refuge.enriquezcolquidanielabraham.workers.dev';
const apply=process.argv.includes('--apply');
const secrets=JSON.parse(await readFile('.local/cloud-secrets.json','utf8'));
const admin=JSON.parse(await readFile('.local/production-admin.json','utf8'));
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({correo:admin.correo,password:admin.password})});
if(!login.ok)throw Error('No se pudo autenticar al administrador.');
const cookie=login.headers.get('set-cookie').split(';')[0];
const get=async path=>{const r=await fetch(base+'/api'+path,{headers:{Cookie:cookie}});if(!r.ok)throw Error('No se pudo consultar '+path);return r.json()};
const {user}=await get('/auth/me');
const existing=(await get('/animals')).items.filter(a=>a.id.startsWith(prefix));
await fetch(base+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie}});
if(existing.length){console.log(`La colección ya tiene ${existing.length} animales. No se modificó ni duplicó ningún registro.`);process.exit(0)}

await mkdir('.local/demo-documents',{recursive:true});
let accounts;
try{accounts=JSON.parse(await readFile('.local/demo-accounts.json','utf8'))}
catch{accounts=Array.from({length:10},(_,i)=>({id:prefix+'user-'+i,nombre:(i<2?'Veterinario':'Voluntario')+' Demo '+(i<2?i+1:i-1),correo:(i<2?'vet'+(i+1):'vol'+(i-1))+'@demo.petrefuge.test',password:randomBytes(18).toString('base64url'),rol:i<2?'VETERINARIO':'VOLUNTARIO'}));await writeFile('.local/demo-accounts.json',JSON.stringify(accounts,null,2))}
const sql=[];
const q=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
const insert=(table,fields,values)=>sql.push(`INSERT INTO ${table} (${fields}) VALUES (${values.map(q).join(',')});`);
const ago=days=>new Date(Date.now()-days*86400000).toISOString();
const day=days=>ago(days).slice(0,10);
const audit=(action,entity)=>insert('auditoria','usuario_id,accion,entidad_id,fecha',[user.id,action,entity,new Date().toISOString()]);

for(const a of accounts) {
 insert('usuario','id,nombre,correo,clave_hash,activo',[a.id,a.nombre,a.correo,await hashPassword(a.password),1]);
 insert('usuario_rol','usuario_id,rol',[a.id,a.rol]);
}

const dogs=['Luna','Bruno','Toby','Rocky','Max','Coco','Simba','Nina','Thor','Kira','Bobby','Duna','Balto','Maya'];
const cats=['Milo','Nala','Kiara','Oliver','Cleo','Leo','Misha','Felix','Lola','Oreo','Chispa','Sombra','Pelusa','Mochi'];
const stories=['Disfruta de paseos tranquilos y de la compañía de las personas.','Curioso y juguetón; necesita actividades y una adaptación paciente.','De carácter sereno, prefiere espacios tranquilos para descansar.','Sociable y cariñoso, disfruta compartir tiempo con su familia.','Le encantan los juegos de exploración y los rincones cómodos.','Busca una familia que respete su ritmo y acompañe su adaptación.'];
const animals=[];
for(let i=0;i<28;i++) {
 const dog=i%2===0,idx=Math.floor(i/2),name=(dog?dogs:cats)[idx];
 const a={id:prefix+'animal-'+String(i+1).padStart(2,'0'),name,species:dog?'Perro':'Gato',photo:(dog?['luna','bruno','toby']:['milo','nala','kiara'])[idx%3],state:i>=24?'ADOPTADO':i>=20?'EN_ATENCION':'DISPONIBLE'};animals.push(a);
 insert('animal','id,nombre,especie,edad_meses,foto_ref,descripcion,estado,fecha_ingreso,lugar_rescate,revision_clinica,registrador_id',[a.id,name,a.species,[8,12,18,24,30,36,48,60][i%8],'/images/'+a.photo+'.jpg','DEMO · Animal ficticio para la presentación académica. '+stories[i%6],a.state==='ADOPTADO'?'DISPONIBLE':a.state,day(30+i),'DEMO · Sector ficticio '+(i%7+1),i>=24||i%3!==0?1:0,user.id]);
 const vet=accounts[i%2].id;
 for(let visit=0;visit<2;visit++)insert('registro_medico','id,animal_id,veterinario_id,fecha_atencion,fecha_registro,consulta,diagnostico,anterior_id,motivo_correccion',[a.id+'-medical-'+visit,a.id,vet,ago(25-visit*7),ago(25-visit*7),'DEMO · '+(visit?'Seguimiento de adaptación':'Revisión de ingreso'),'Registro clínico ficticio para demostración. '+(visit?'Se documenta un seguimiento de ejemplo.':'Se registra la evaluación inicial de ejemplo. No constituye un informe clínico real.'),null,null]);
 if(i<4)insert('registro_medico','id,animal_id,veterinario_id,fecha_atencion,fecha_registro,consulta,diagnostico,anterior_id,motivo_correccion',[a.id+'-medical-correction',a.id,vet,ago(18),ago(17),'DEMO · Ampliación del seguimiento','Corrección ficticia: se amplía la observación de adaptación sin eliminar el registro anterior.',a.id+'-medical-1','DEMO · Ampliación documental del seguimiento.']);
 audit('IMPORTAR_ANIMAL_DEMO',a.id);
}

for(const [i,name] of ['Esquema canino A','Esquema canino B','Esquema felino A','Esquema felino B'].entries())insert('vacuna','id,nombre,descripcion',[prefix+'vaccine-'+i,name+' (DEMO)','Vacuna ficticia para demostrar estados; no es una recomendación veterinaria.']);
for(const [i,a] of animals.entries())for(let dose=0;dose<2;dose++){
 const applied=i>=24 || (i%3!==0 && dose===0) || i%4===1;
 insert('vacuna_animal','id,animal_id,vacuna_id,dosis,es_critica,estado,fecha_aplicacion,veterinario_id',[a.id+'-vaccine-'+dose,a.id,prefix+'vaccine-'+((i%2)*2+dose),1,dose===0?1:0,applied?'APLICADA':'PENDIENTE',applied?day(12-dose*2):null,applied?accounts[i%2].id:null]);
}

const requests=[];
const endStates=['RECIBIDA','EN_EVALUACION','PRUEBA_COMPATIBILIDAD','APROBADO','RECHAZADO'];
for(let i=0;i<20;i++) {
 const animal=animals[i<16?i:i+8],appId=prefix+'application-'+String(i+1).padStart(2,'0'),personId=prefix+'applicant-'+i;
 const personal={nombre:'Postulante Ficticio '+(i+1),correo:'postulante'+(i+1)+'@example.test',telefono:'000-000-'+String(i+1).padStart(3,'0'),direccion:'DEMO · Calle de Ejemplo '+(i+1)+', domicilio inexistente',identificacion:'DEMO-NO-VALIDO-'+String(i+1).padStart(3,'0')};
 insert('adoptante','id,datos_cifrados',[personId,await encrypt(personal,secrets)]);
 insert('solicitud_adopcion','id,animal_id,adoptante_id,fecha,estado,cuidado_cifrado,aviso_aceptado,resultado_compatibilidad,evaluador_id',[appId,animal.id,personId,ago(7),'RECIBIDA',await encrypt({vivienda:i%2?'Departamento':'Casa',horas:4+i%9,plan:'DEMO · Plan de cuidado ficticio con acompañamiento, alimentación y actividades. No corresponde a una postulación real.'},secrets),1,'POR_VERIFICAR',null]);
 const target=i>=16?'APROBADO':endStates[i%5];
 let previous='RECIBIDA';
 const sequence=target==='RECIBIDA'?[]:target==='EN_EVALUACION'?['EN_EVALUACION']:target==='PRUEBA_COMPATIBILIDAD'?['EN_EVALUACION','PRUEBA_COMPATIBILIDAD']:['EN_EVALUACION','PRUEBA_COMPATIBILIDAD',target];
 for(const [j,next] of sequence.entries()){
  const result=next==='APROBADO'?'FAVORABLE':next==='RECHAZADO'?'DESFAVORABLE':'POR_VERIFICAR';
  sql.push(`UPDATE solicitud_adopcion SET estado=${q(next)},resultado_compatibilidad=${q(result)},evaluador_id=${q(user.id)} WHERE id=${q(appId)};`);
  insert('cambio_estado','id,solicitud_id,origen,destino,fecha,motivo_cifrado,responsable_id',[appId+'-step-'+j,appId,previous,next,ago(6-j),await encrypt('DEMO · Etapa simulada '+next+'. '+(next==='RECHAZADO'?'El caso ficticio no cumple las condiciones de compatibilidad del ejemplo.':'Evidencia ficticia para recorrer el proceso de adopción.'),secrets),user.id]);previous=next;
 }
 if(i>=16)insert('adopcion','id,solicitud_id,animal_id,fecha_entrega,estado,responsable_id',[prefix+'adoption-'+i,appId,animal.id,ago(1),'ACTIVA',user.id]);
 requests.push(appId);audit('IMPORTAR_SOLICITUD_DEMO',appId);
}

const activities=['Paseos y compañía','Apoyo en alimentación','Limpieza y bienestar','Enriquecimiento y juegos','Apoyo en recepción','Jornada de socialización'];
const start=new Date();start.setUTCDate(start.getUTCDate()+1);start.setUTCHours(14,0,0,0);
for(let i=0;i<12;i++) {
 const tid=prefix+'shift-'+i,begin=new Date(start.getTime()+Math.floor(i/2)*86400000+(i%2)*3*3600000).toISOString(),end=new Date(Date.parse(begin)+2*3600000).toISOString();
 insert('turno','id,titulo,inicio,fin,cupo,creador_id',[tid,'DEMO · '+activities[i%6],begin,end,i%3===0?2:4,user.id]);
 for(let j=0;j<2;j++)insert('asignacion_turno','id,turno_id,voluntario_id,estado,fecha_postulacion,motivo_cancelacion,fecha_cancelacion,cancelador_id',[tid+'-member-'+j,tid,accounts[2+(i*2+j)%8].id,'ACTIVA',ago(0),null,null,null]);
 if(i<4)insert('asignacion_turno','id,turno_id,voluntario_id,estado,fecha_postulacion,motivo_cancelacion,fecha_cancelacion,cancelador_id',[tid+'-cancelled',tid,accounts[2+(i*2+4)%8].id,'CANCELADA',ago(2),'DEMO · Cambio de disponibilidad del voluntario.',ago(1),accounts[2+(i*2+4)%8].id]);
 audit('IMPORTAR_TURNO_DEMO',tid);
}

function pdf(lines){
 const text=lines.map((l,i)=>`${i?'0 -24 Td ':''}(${l.replace(/[\\()]/g,'\\$&')}) Tj`).join('\n');
 const stream=`BT /F1 13 Tf 50 780 Td ${text} ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
 let data='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(data));data+=`${i+1} 0 obj\n${o}\nendobj\n`});const xref=Buffer.byteLength(data);data+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(data);
}
const uploads=[];
for(let i=0;i<8;i++){
 const medical=i<4,index=i%4,docId=prefix+'document-'+i,key='demo-t7/'+docId+'.bin';
 const bytes=pdf(['PET REFUGE - DOCUMENTO FICTICIO','DEMO - SIN VALIDEZ CLINICA NI LEGAL',medical?'Informe de ejemplo para historial veterinario.':'Respaldo de ejemplo para solicitud de adopcion.',`Registro de demostracion ${index+1}.`,'Este documento no contiene datos de una persona real.']);
 const path='.local/demo-documents/'+docId+'.bin';await writeFile(path,await encryptBytes(bytes,secrets));uploads.push({key,path});
 if(medical)insert('documento_medico','id,registro_id,nombre_archivo,ruta_privada,tipo_mime,tamano_bytes',[docId,animals[index].id+'-medical-0','DEMO-informe-'+(index+1)+'.pdf',key,'application/pdf',bytes.length]);
 else insert('documento_solicitud','id,solicitud_id,nombre_archivo,ruta_privada,tamano_bytes',[docId,requests[index],'DEMO-respaldo-'+(index+1)+'.pdf',key,bytes.length]);
}
audit('IMPORTAR_COLECCION_DEMO',prefix+'collection-v1');
const script=sql.join('\n')+'\n';
// Check the entire dataset against the same constraints before writing to the cloud.
const local=new DatabaseSync(':memory:');local.exec(await readFile('migrations/0001_initial.sql','utf8'));
local.prepare('INSERT INTO usuario VALUES(?,?,?,?,1)').run(user.id,user.nombre,user.correo,'not-used-for-login');local.prepare("INSERT INTO usuario_rol VALUES(?,'ADMIN_ONG')").run(user.id);local.exec(script);
const violations=local.prepare('PRAGMA foreign_key_check').all();if(violations.length)throw Error('Referencias inválidas en el conjunto.');
const counts={};for(const table of ['animal','solicitud_adopcion','registro_medico','vacuna_animal','adopcion','turno','asignacion_turno','documento_medico','documento_solicitud'])counts[table]=local.prepare(`SELECT count(*) n FROM ${table}`).get().n;
local.close();await writeFile('.local/demo-data.sql',script);await writeFile('.local/demo-summary.json',JSON.stringify(counts,null,2));console.log('Datos verificados:',JSON.stringify(counts));
const run=args=>{const r=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js',...args],{stdio:'inherit'});if(r.status!==0)throw Error('Wrangler no pudo completar la operación.');};
if(apply){for(const file of uploads)run(['r2','object','put','pet-refuge-documentos/'+file.key,'--remote','--file',file.path,'--content-type','application/octet-stream']);run(['d1','execute','DB','--remote','--file','.local/demo-data.sql']);console.log('Colección cargada. Credenciales demo guardadas en .local/demo-accounts.json.');}
else console.log('Solo preparación. Usa --apply para cargar D1 y R2.');
