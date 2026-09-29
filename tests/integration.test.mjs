import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {randomBytes} from 'node:crypto';

test('Pet Refuge: privacidad, adopción, documentos, vacunas y concurrencia',async t=>{
 const mf=new Miniflare({modules:true,modulesRules:[{type:"ESModule",include:["**/*.js"]}],scriptPath:'src/worker.js',compatibilityDate:'2026-07-01',d1Databases:['DB'],r2Buckets:['DOCUMENTS'],bindings:{DATA_KEY:randomBytes(32).toString('base64'),BOOTSTRAP_TOKEN:'test-bootstrap-secret',ENVIRONMENT:'test',CATALOG_CACHE:'on'}});
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 const sql=(await readFile('migrations/0001_initial.sql','utf8')).replace(/^\uFEFF/,'');
 for(const statement of sql.split(/;\s*(?=(?:CREATE|INSERT|PRAGMA)\b)/).filter(x=>x.trim()))await db.prepare(statement).run();
 const call=async(path,{method='GET',body,cookie,headers={}}={})=>{
  const native=new Request(`https://pet.test/api${path}`,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body && !(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...headers},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
  const r=await mf.dispatchFetch(native.url,{method,headers:Object.fromEntries(native.headers),body:body?await native.arrayBuffer():undefined});
  const content=await r.text();let data;try{data=JSON.parse(content)}catch{data=content}return {status:r.status,data,headers:r.headers};
 };
 const password='Test-password-very-long-27';
 const setup=await call('/setup',{method:'POST',headers:{Authorization:'Bearer test-bootstrap-secret'},body:{nombre:'Admin de prueba',correo:'admin@example.test',password}});assert.equal(setup.status,201,JSON.stringify(setup));
 const login=async correo=>{const r=await call('/auth/login',{method:'POST',body:{correo,password}});assert.equal(r.status,200,JSON.stringify(r));assert.match(r.headers.get('set-cookie'),/HttpOnly/);return r.headers.get('set-cookie').split(';')[0]};
 const admin=await login('admin@example.test');
 for(const [name,role] of [['vet','VETERINARIO'],['vol','VOLUNTARIO'],['vol2','VOLUNTARIO']])assert.equal((await call('/users',{method:'POST',cookie:admin,body:{nombre:name,correo:`${name}@example.test`,password,roles:[role]}})).status,201);
 const vet=await login('vet@example.test'),vol=await login('vol@example.test'),vol2=await login('vol2@example.test');
 let animalId,applicationId,documentId;
 await t.test('roles, permisos y protección contra origen ajeno',async()=>{
  assert.equal((await call('/applications')).status,401);
  assert.equal((await call('/applications',{cookie:vol})).status,403);
  assert.equal((await call('/applications',{cookie:vet})).status,403);
  assert.equal((await call('/users',{cookie:vol})).status,403);
  assert.equal((await call('/animals',{method:'POST',cookie:vol,body:{}})).status,403);
  assert.equal((await call('/animals',{method:'POST',cookie:admin,headers:{Origin:'https://evil.test'},body:{}})).status,403);
 });
 const animal={nombre:'Luna',especie:'Perro',edad_meses:24,foto_ref:'/images/luna.jpg',descripcion:'Animal ficticio',estado:'DISPONIBLE',fecha_ingreso:'2026-01-01',lugar_rescate:'Prueba'};
 await t.test('registro válido y rechazo de edad negativa o foto ausente',async()=>{
  for(const b of [{...animal,edad_meses:-1},{...animal,foto_ref:''}])assert.equal((await call('/animals',{method:'POST',cookie:admin,body:b})).status,400);
  const r=await call('/animals',{method:'POST',cookie:admin,body:animal});assert.equal(r.status,201,JSON.stringify(r));animalId=r.data.id;
  const c=await call('/catalog');assert.equal(c.data.items.length,1);assert.deepEqual(Object.keys(c.data.items[0]).sort(),['id','nombre','especie','edad_meses','foto_ref','descripcion'].sort());
 });
 const application=()=>{const f=new FormData();for(const [k,v] of Object.entries({animal_id:animalId,nombre:'Persona Ficticia',correo:'persona@example.test',telefono:'999111222',direccion:'Domicilio ficticio',identificacion:'DOC-FICTICIO',vivienda:'Casa',horas:8,plan:'Paseos y cuidado veterinario',consentimiento:'on'}))f.set(k,v);return f};
 await t.test('postulación cifrada, confirmación mínima y documentos privados',async()=>{
  const invalid=application();invalid.delete('direccion');assert.equal((await call('/applications',{method:'POST',body:invalid})).status,400);
  const f=application();f.set('archivo',new File(['%PDF-1.4\nPrueba ficticia\n%%EOF'], 'respaldo.pdf',{type:'application/pdf'}));
  const r=await call('/applications',{method:'POST',body:f});assert.equal(r.status,201,JSON.stringify(r));applicationId=r.data.id;assert.deepEqual(Object.keys(r.data).sort(),['id','mensaje']);
  const stored=await db.prepare('SELECT datos_cifrados FROM adoptante').first();assert.ok(!stored.datos_cifrados.includes('Persona'));
  const detail=await call(`/applications/${applicationId}`,{cookie:admin});assert.equal(detail.data.personal.nombre,'Persona Ficticia');documentId=detail.data.documents[0].id;
  assert.equal((await call(`/applications/${applicationId}`,{cookie:vol})).status,403);
  assert.equal((await call(`/documents/application/${documentId}`,{cookie:vet})).status,403);
  assert.equal((await call(`/documents/application/${documentId}`)).status,401);
  const doc=await call(`/documents/application/${documentId}`,{cookie:admin});assert.equal(doc.status,200);assert.match(doc.data,/^%PDF-/);assert.equal(doc.headers.get('cache-control'),'no-store');
 });
 await t.test('transiciones secuenciales y motivos obligatorios',async()=>{
  assert.equal((await call(`/applications/${applicationId}/transition`,{method:'POST',cookie:admin,body:{estado:'APROBADO',motivo:'No válido'}})).status,409);
  for(const estado of ['EN_EVALUACION','PRUEBA_COMPATIBILIDAD','APROBADO'])assert.equal((await call(`/applications/${applicationId}/transition`,{method:'POST',cookie:admin,body:{estado,motivo:'Evidencia ficticia de compatibilidad'}})).status,200);
  const s=await call(`/applications/${applicationId}`,{cookie:admin});assert.equal(s.data.changes.length,3);assert.equal(s.data.resultado_compatibilidad,'FAVORABLE');
 });
 await t.test('historial, corrección y bloqueo por revisión y vacuna crítica',async()=>{
  assert.equal((await call(`/applications/${applicationId}/formalize`,{method:'POST',cookie:admin,body:{confirmacion:true}})).status,409);
  const medical=()=>{const f=new FormData();f.set('fecha_atencion','2026-01-02');f.set('consulta','Control');f.set('diagnostico','Evaluación ficticia');return f};
  const invalid=medical();invalid.set('archivo',new File(['not pdf'],'falso.pdf',{type:'application/pdf'}));assert.equal((await call(`/animals/${animalId}/medical`,{method:'POST',cookie:vet,body:invalid})).status,400);
  assert.equal((await call(`/animals/${animalId}/medical`,{method:'POST',cookie:admin,body:medical()})).status,403);
  const f=medical();f.set('archivo',new File(['%PDF-1.4\nInforme\n%%EOF'],'clinica.pdf',{type:'application/pdf'}));const m=await call(`/animals/${animalId}/medical`,{method:'POST',cookie:vet,body:f});assert.equal(m.status,201,JSON.stringify(m));
  const correction=medical();correction.set('anterior_id',m.data.id);correction.set('motivo_correccion','Ampliación del diagnóstico');assert.equal((await call(`/animals/${animalId}/medical`,{method:'POST',cookie:vet,body:correction})).status,201);
  let history=await call(`/animals/${animalId}/medical`,{cookie:vet});assert.equal(history.data.records.length,2);assert.equal((await call(`/documents/medical/${history.data.documents[0].id}`,{cookie:vol})).status,403);
  assert.equal((await call(`/animals/${animalId}/vaccines`,{method:'POST',cookie:vet,body:{nombre:'Antirrábica ficticia',dosis:1,es_critica:true}})).status,201);
  assert.equal((await call(`/animals/${animalId}/review`,{method:'POST',cookie:vet,body:{revision:true}})).status,200);
  const blocked=await call(`/applications/${applicationId}/formalize`,{method:'POST',cookie:admin,body:{confirmacion:true}});assert.equal(blocked.status,409);assert.match(blocked.data.error,/vacunas críticas/);
  history=await call(`/animals/${animalId}/medical`,{cookie:vet});assert.equal((await call(`/vaccines/${history.data.vaccines[0].id}/apply`,{method:'POST',cookie:vet,body:{fecha_aplicacion:'2026-01-03'}})).status,200);
 });
 await t.test('dos formalizaciones simultáneas: una entrega y caché invalidada',async()=>{
  const before=await call('/catalog');assert.equal(before.data.total,1);
  const responses=await Promise.all([1,2].map(()=>call(`/applications/${applicationId}/formalize`,{method:'POST',cookie:admin,body:{confirmacion:true}})));assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  assert.equal((await db.prepare('SELECT count(*) n FROM adopcion').first()).n,1);assert.equal((await call('/catalog')).data.total,0);
  assert.equal((await call('/applications',{method:'POST',body:application()})).status,409);
  assert.equal((await db.prepare('SELECT count(*) n FROM adoptante').first()).n,1,'failed application rolls back applicant');
 });
 await t.test('turnos: sobrecupo, solapamiento, contigüidad y cancelación',async()=>{
  const base=Date.now()+86400000;
  const create=async(start,end,cupo=1)=>{const r=await call('/shifts',{method:'POST',cookie:admin,body:{titulo:'Cuidado ficticio',inicio:new Date(base+start*3600000).toISOString(),fin:new Date(base+end*3600000).toISOString(),cupo}});assert.equal(r.status,201,JSON.stringify(r));return r.data.id};
  const a=await create(0,2),b=await create(1,3),c=await create(2,4);
  const result=await Promise.all([vol,vol2].map(cookie=>call(`/shifts/${a}/join`,{method:'POST',cookie})));assert.deepEqual(result.map(r=>r.status).sort(),[200,409]);const winner=result[0].status===200?vol:vol2;
  assert.equal((await call(`/shifts/${a}/join`,{method:'POST',cookie:winner})).status,200);
  assert.equal((await call(`/shifts/${b}/join`,{method:'POST',cookie:winner})).status,409);
  assert.equal((await call(`/shifts/${c}/join`,{method:'POST',cookie:winner})).status,200);
  assert.equal((await call(`/shifts/${a}/cancel`,{method:'POST',cookie:winner,body:{motivo:'Imprevisto ficticio'}})).status,200);
  const loser=winner===vol?vol2:vol;assert.equal((await call(`/shifts/${a}/join`,{method:'POST',cookie:loser})).status,200);
  const row=await db.prepare("SELECT * FROM asignacion_turno WHERE estado='CANCELADA'").first();assert.ok(row.fecha_cancelacion && row.cancelador_id && row.motivo_cancelacion);
 });
 await t.test('cierre de sesión invalida cookie en servidor',async()=>{
  assert.equal((await call('/auth/logout',{method:'POST',cookie:vol})).status,200);assert.equal((await call('/shifts',{cookie:vol})).status,401);
 });
});

