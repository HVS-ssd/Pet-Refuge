import {id,b64,digest,hashPassword,verifyPassword,encrypt,decrypt,encryptBytes,decryptBytes,HttpError,requireThat,string,integer,date,oneOf,pdf} from './security.js';

const now=()=>new Date().toISOString();
const roles=['ADMIN_ONG','VETERINARIO','VOLUNTARIO'];
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const stmt=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const first=(env,sql,...args)=>stmt(env,sql,...args).first();
const all=async(env,sql,...args)=>(await stmt(env,sql,...args).all()).results;
const audit=(env,user,action,entity)=>stmt(env,'INSERT INTO auditoria(usuario_id,accion,entidad_id) VALUES(?,?,?)',user?.id||null,action,entity);
function permit(user,...allowed) { requireThat(user,'Inicia sesión para continuar.',401); requireThat(allowed.some(r=>user.roles.includes(r)),'Tu rol no tiene permiso para esta operación.',403); }
async function body(request) { try { return await request.json(); } catch { throw new HttpError(400,'El cuerpo de la solicitud no es JSON válido.'); } }
async function formBody(request) { try { return await request.formData(); } catch { throw new HttpError(400,'El formulario no tiene un formato válido.'); } }
async function rateLimit(env,key,max,seconds) {
  const time=Math.floor(Date.now()/1000);
  const r=await first(env,`INSERT INTO limite_acceso(clave,intentos,expira) VALUES(?,1,?) ON CONFLICT(clave) DO UPDATE SET intentos=CASE WHEN expira<=? THEN 1 ELSE intentos+1 END, expira=CASE WHEN expira<=? THEN excluded.expira ELSE expira END RETURNING intentos`,key,time+seconds,time,time);
  requireThat(r.intentos<=max,'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',429);
}
async function session(request,env) {
  const token=request.headers.get('Cookie')?.match(/(?:^|;\s*)pr_session=([^;]+)/)?.[1];
  if(!token) return null;
  const u=await first(env,'SELECT u.id,u.nombre,u.correo FROM sesion s JOIN usuario u ON u.id=s.usuario_id WHERE s.token_hash=? AND s.expira>? AND u.activo=1',await digest(token),now());
  if(u) u.roles=(await all(env,'SELECT rol FROM usuario_rol WHERE usuario_id=?',u.id)).map(r=>r.rol);
  return u;
}
function cookie(token,request,maxAge=28800) { return `pr_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`; }
function animalData(b) {
  const photo=string(b.foto_ref,'Foto',500);
  requireThat(photo.startsWith('/images/') || /^https:\/\/[^\s]+$/.test(photo),'La foto debe ser una URL HTTPS o una imagen del proyecto.');
  return [string(b.nombre,'Nombre',60),oneOf(b.especie,['Perro','Gato','Otro'],'Especie'),integer(b.edad_meses,'Edad en meses',0,1200),photo,string(b.descripcion,'Descripción',1500),oneOf(b.estado,['EN_ATENCION','DISPONIBLE'],'Estado'),date(b.fecha_ingreso,'Fecha de ingreso').slice(0,10),string(b.lugar_rescate||'Sin especificar','Lugar',200)];
}
const businessErrors={ANIMAL_NO_DISPONIBLE:'El animal ya no está disponible.',TRANSICION_INVALIDA:'La transición solicitada no está permitida.',SOLICITUD_NO_APROBADA:'Primero debe aprobarse la solicitud.',REVISION_PENDIENTE:'Falta la revisión clínica del veterinario.',VACUNA_CRITICA_PENDIENTE:'Hay vacunas críticas pendientes. No se puede formalizar.',CUPO_AGOTADO:'Este turno ya no tiene cupos.',TURNO_SOLAPADO:'El turno se cruza con otra asignación tuya.',CORRECCION_INVALIDA:'La atención anterior no corresponde a este animal.',ADOPCION_ACTIVA:'El animal ya tiene una adopción activa.',REQUIERE_FORMALIZACION:'Usa el proceso de formalización de adopción.',HISTORIAL_INMUTABLE:'Las correcciones deben crear una nueva versión.'};

async function api(request,env,ctx) {
  const url=new URL(request.url), path=url.pathname, method=request.method;
  if(method!=='GET' && method!=='HEAD') {
    requireThat(!request.headers.get('Origin') || request.headers.get('Origin')===url.origin,'Origen de solicitud no permitido.',403);
    requireThat(Number(request.headers.get('Content-Length')||0)<=6*1024*1024,'La solicitud es demasiado grande.',413);
  }
  if(path==='/api/health') { await first(env,'SELECT id FROM configuracion'); return json({ok:true,service:'Pet Refuge'}); }
  if(path==='/api/setup' && method==='POST') {
    requireThat(env.BOOTSTRAP_TOKEN && request.headers.get('Authorization')===`Bearer ${env.BOOTSTRAP_TOKEN}`,'Configuración no autorizada.',403);
    requireThat(!await first(env,'SELECT id FROM usuario LIMIT 1'),'El administrador inicial ya fue creado.',409);
    const b=await body(request), uid=id(), password=string(b.password,'Contraseña',128,12), email=string(b.correo,'Correo',150).toLowerCase();
    requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Correo inválido.');
    await env.DB.batch([
      stmt(env,'INSERT INTO usuario(id,nombre,correo,clave_hash) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM usuario)',uid,string(b.nombre,'Nombre',100),email,await hashPassword(password)),
      stmt(env,"INSERT INTO usuario_rol(usuario_id,rol) VALUES(?,'ADMIN_ONG')",uid),audit(env,null,'CREAR_ADMIN_INICIAL',uid)
    ]);
    return json({ok:true},201);
  }
  if(path==='/api/auth/login' && method==='POST') {
    const b=await body(request), email=string(b.correo,'Correo',150).toLowerCase(), password=string(b.password,'Contraseña',128);
    await rateLimit(env,`login-ip:${await digest(request.headers.get('CF-Connecting-IP')||'local')}`,30,900);
    await rateLimit(env,`login:${await digest(email)}`,10,900);
    const u=await first(env,'SELECT * FROM usuario WHERE correo=? AND activo=1',email);
    const valid=await verifyPassword(password,u?.clave_hash||'pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    requireThat(u && valid,'Correo o contraseña incorrectos.',401);
    const token=b64(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.batch([stmt(env,'DELETE FROM sesion WHERE expira<=?',now()),stmt(env,'DELETE FROM limite_acceso WHERE expira<?',Math.floor(Date.now()/1000)),stmt(env,'INSERT INTO sesion VALUES(?,?,?)',await digest(token),u.id,new Date(Date.now()+8*3600000).toISOString()),audit(env,u,'INICIAR_SESION',u.id)]);
    return json({ok:true},200,{'Set-Cookie':cookie(token,request)});
  }
  if(path==='/api/auth/logout' && method==='POST') {
    const token=request.headers.get('Cookie')?.match(/(?:^|;\s*)pr_session=([^;]+)/)?.[1];
    if(token) await stmt(env,'DELETE FROM sesion WHERE token_hash=?',await digest(token)).run();
    return json({ok:true},200,{'Set-Cookie':cookie('',request,0)});
  }
  if(path==='/api/catalog' && method==='GET') {
    const page=integer(url.searchParams.get('page')||1,'Página',1,100000), species=url.searchParams.get('especie')||'', q=(url.searchParams.get('q')||'').slice(0,60);
    if(species) oneOf(species,['Perro','Gato','Otro'],'Especie');
    const version=(await first(env,'SELECT catalogo_version FROM configuracion WHERE id=1')).catalogo_version;
    const key=new Request(`${url.origin}/__catalog_cache?v=${version}&page=${page}&especie=${encodeURIComponent(species)}&q=${encodeURIComponent(q)}`);
    const cache=globalThis.caches?.default;
    if(cache && env.CATALOG_CACHE!=='off') {
      try { const hit=await cache.match(key); if(hit) { const r=new Response(hit.body,hit); r.headers.set('X-Catalog-Cache','HIT'); r.headers.set('Cache-Control','no-store'); return r; } } catch { /* Database fallback. */ }
    }
    const where="estado='DISPONIBLE' AND (?='' OR especie=?) AND (?='' OR nombre LIKE ? ESCAPE '\\')";
    const term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
    const items=await all(env,`SELECT id,nombre,especie,edad_meses,foto_ref,descripcion FROM animal WHERE ${where} ORDER BY nombre,id LIMIT 9 OFFSET ?`,species,species,q,term,(page-1)*9);
    const {total}=await first(env,`SELECT count(*) total FROM animal WHERE ${where}`,species,species,q,term);
    const response=json({items,total,page,pages:Math.max(1,Math.ceil(total/9))},200,{'X-Catalog-Cache':'MISS'});
    if(cache && env.CATALOG_CACHE!=='off') { const stored=response.clone(); stored.headers.set('Cache-Control','public,max-age=60'); ctx.waitUntil(cache.put(key,stored).catch(()=>{})); }
    return response;
  }
  if(path==='/api/applications' && method==='POST') {
    await rateLimit(env,`apply:${await digest(request.headers.get('CF-Connecting-IP')||'local')}`,env.ENVIRONMENT==='test'?100000:12,3600);
    const f=await formBody(request), get=n=>f.get(n), animalId=string(get('animal_id'),'Animal',50);
    requireThat(get('consentimiento')==='on','Debes aceptar el aviso de privacidad.');
    const personal={nombre:string(get('nombre'),'Nombre',100),correo:string(get('correo'),'Correo',150),telefono:string(get('telefono'),'Teléfono',30),direccion:string(get('direccion'),'Dirección',300),identificacion:string(get('identificacion'),'Identificación',50)};
    requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personal.correo),'Correo inválido.');
    const care={vivienda:oneOf(get('vivienda'),['Casa','Departamento','Otro'],'Vivienda'),horas:integer(get('horas'),'Horas de cuidado',1,24),plan:string(get('plan'),'Plan de cuidado',1500)};
    const attachment=get('archivo'); let upload=null;
    if(attachment?.size) { const bytes=await pdf(attachment); upload={id:id(),key:`applications/${id()}`,bytes,name:attachment.name.slice(0,150)}; }
    const applicant=id(), application=id();
    if(upload) await env.DOCUMENTS.put(upload.key,await encryptBytes(upload.bytes,env),{httpMetadata:{contentType:'application/octet-stream'}});
    try {
      const batch=[stmt(env,'INSERT INTO adoptante VALUES(?,?)',applicant,await encrypt(personal,env)),stmt(env,'INSERT INTO solicitud_adopcion(id,animal_id,adoptante_id,fecha,cuidado_cifrado,aviso_aceptado) VALUES(?,?,?,?,?,1)',application,animalId,applicant,now(),await encrypt(care,env)),audit(env,null,'ENVIAR_SOLICITUD',application)];
      if(upload) batch.push(stmt(env,'INSERT INTO documento_solicitud VALUES(?,?,?,?,?)',upload.id,application,upload.name,upload.key,upload.bytes.length));
      await env.DB.batch(batch);
    } catch(error) { if(upload) await env.DOCUMENTS.delete(upload.key); throw error; }
    return json({id:application,mensaje:'Solicitud recibida. La ONG evaluará tu postulación; aún no confirma una adopción.'},201);
  }
  const user=await session(request,env);
  if(path==='/api/auth/me') return json({user});
  if(path==='/api/animals' && method==='GET') { permit(user,'ADMIN_ONG','VETERINARIO'); return json({items:await all(env,'SELECT * FROM animal ORDER BY fecha_ingreso DESC,nombre LIMIT 1000')}); }
  if(path==='/api/animals' && method==='POST') {
    permit(user,'ADMIN_ONG'); const b=await body(request), aid=id();
    await env.DB.batch([stmt(env,'INSERT INTO animal(id,nombre,especie,edad_meses,foto_ref,descripcion,estado,fecha_ingreso,lugar_rescate,registrador_id) VALUES(?,?,?,?,?,?,?,?,?,?)',aid,...animalData(b),user.id),audit(env,user,'REGISTRAR_ANIMAL',aid)]); return json({id:aid},201);
  }
  let match=path.match(/^\/api\/animals\/([^/]+)$/);
  if(match && method==='PUT') {
    permit(user,'ADMIN_ONG'); const aid=match[1], b=await body(request);
    requireThat(await first(env,'SELECT id FROM animal WHERE id=?',aid),'Animal no encontrado.',404);
    await env.DB.batch([stmt(env,'UPDATE animal SET nombre=?,especie=?,edad_meses=?,foto_ref=?,descripcion=?,estado=?,fecha_ingreso=?,lugar_rescate=? WHERE id=?',...animalData(b),aid),audit(env,user,'EDITAR_ANIMAL',aid)]); return json({ok:true});
  }
  if(path==='/api/applications' && method==='GET') {
    permit(user,'ADMIN_ONG'); const records=await all(env,'SELECT s.id,s.animal_id,s.fecha,s.estado,a.nombre animal FROM solicitud_adopcion s JOIN animal a ON a.id=s.animal_id ORDER BY s.fecha DESC LIMIT 500');
    return json({items:records});
  }
  match=path.match(/^\/api\/applications\/([^/]+)$/);
  if(match && method==='GET') {
    permit(user,'ADMIN_ONG'); const s=await first(env,'SELECT s.*,a.datos_cifrados,n.nombre animal FROM solicitud_adopcion s JOIN adoptante a ON a.id=s.adoptante_id JOIN animal n ON n.id=s.animal_id WHERE s.id=?',match[1]);
    requireThat(s,'Solicitud no encontrada.',404);
    const personal=await decrypt(s.datos_cifrados,env), cuidado=await decrypt(s.cuidado_cifrado,env);
    delete s.datos_cifrados; delete s.cuidado_cifrado;
    const changes=await all(env,'SELECT c.*,u.nombre responsable FROM cambio_estado c JOIN usuario u ON u.id=c.responsable_id WHERE solicitud_id=? ORDER BY fecha',s.id);
    for(const c of changes) { c.motivo=await decrypt(c.motivo_cifrado,env); delete c.motivo_cifrado; }
    await audit(env,user,'CONSULTAR_SOLICITUD',s.id).run();
    return json({...s,personal,cuidado,changes,documents:await all(env,'SELECT id,nombre_archivo FROM documento_solicitud WHERE solicitud_id=?',s.id),adopcion:await first(env,'SELECT id,fecha_entrega FROM adopcion WHERE solicitud_id=?',s.id)});
  }
  match=path.match(/^\/api\/applications\/([^/]+)\/transition$/);
  if(match && method==='POST') {
    permit(user,'ADMIN_ONG'); const b=await body(request), s=await first(env,'SELECT * FROM solicitud_adopcion WHERE id=?',match[1]); requireThat(s,'Solicitud no encontrada.',404);
    const allowed={RECIBIDA:['EN_EVALUACION'],EN_EVALUACION:['PRUEBA_COMPATIBILIDAD'],PRUEBA_COMPATIBILIDAD:['APROBADO','RECHAZADO']};
    requireThat(allowed[s.estado]?.includes(b.estado),'La transición solicitada no está permitida.',409);
    const reason=string(b.motivo,'Motivo / evidencia',1500), result=b.estado==='APROBADO'?'FAVORABLE':b.estado==='RECHAZADO'?'DESFAVORABLE':'POR_VERIFICAR';
    const batch=await env.DB.batch([stmt(env,'UPDATE solicitud_adopcion SET estado=?,resultado_compatibilidad=?,evaluador_id=? WHERE id=? AND estado=?',b.estado,result,user.id,s.id,s.estado),stmt(env,'INSERT INTO cambio_estado SELECT ?,?,?,?,?,?,? WHERE changes()=1',id(),s.id,s.estado,b.estado,now(),await encrypt(reason,env),user.id)]);
    requireThat(batch[0].meta.changes===1,'Otra persona actualizó la solicitud. Vuelve a abrirla.',409); return json({ok:true});
  }
  match=path.match(/^\/api\/applications\/([^/]+)\/formalize$/);
  if(match && method==='POST') {
    permit(user,'ADMIN_ONG'); const b=await body(request); requireThat(b.confirmacion===true,'Confirma la entrega del animal.');
    const s=await first(env,'SELECT animal_id FROM solicitud_adopcion WHERE id=?',match[1]); requireThat(s,'Solicitud no encontrada.',404);
    const adoption=id(); await env.DB.batch([stmt(env,'INSERT INTO adopcion(id,solicitud_id,animal_id,fecha_entrega,responsable_id) VALUES(?,?,?,?,?)',adoption,match[1],s.animal_id,now(),user.id),audit(env,user,'FORMALIZAR_ADOPCION',adoption)]); return json({id:adoption},201);
  }
  match=path.match(/^\/api\/animals\/([^/]+)\/medical$/);
  if(match) {
    permit(user,'ADMIN_ONG','VETERINARIO'); const aid=match[1];
    requireThat(await first(env,'SELECT id FROM animal WHERE id=?',aid),'Animal no encontrado.',404);
    if(method==='GET') return json({records:await all(env,'SELECT r.*,u.nombre veterinario FROM registro_medico r JOIN usuario u ON u.id=r.veterinario_id WHERE animal_id=? ORDER BY fecha_atencion,fecha_registro',aid),documents:await all(env,'SELECT d.id,d.registro_id,d.nombre_archivo FROM documento_medico d JOIN registro_medico r ON r.id=d.registro_id WHERE r.animal_id=?',aid),vaccines:await all(env,'SELECT v.*,c.nombre FROM vacuna_animal v JOIN vacuna c ON c.id=v.vacuna_id WHERE animal_id=? ORDER BY c.nombre,dosis',aid)});
    if(method==='POST') {
      permit(user,'VETERINARIO'); const f=await formBody(request), rid=id(), previous=f.get('anterior_id')||null;
      const consultation=string(f.get('consulta'),'Consulta',1000), diagnosis=string(f.get('diagnostico'),'Diagnóstico',1000), attention=date(f.get('fecha_atencion'),'Fecha de atención'), reason=previous?string(f.get('motivo_correccion'),'Motivo de corrección',500):null;
      const file=f.get('archivo'); let upload=null;
      if(file?.size) { const bytes=await pdf(file); upload={key:`medical/${id()}`,bytes,name:file.name.slice(0,150)}; await env.DOCUMENTS.put(upload.key,await encryptBytes(bytes,env)); }
      try {
        const batch=[stmt(env,'INSERT INTO registro_medico VALUES(?,?,?,?,?,?,?,?,?)',rid,aid,user.id,attention,now(),consultation,diagnosis,previous,reason),audit(env,user,'REGISTRAR_ATENCION',rid)];
        if(upload) batch.push(stmt(env,'INSERT INTO documento_medico VALUES(?,?,?,?,?,?)',id(),rid,upload.name,upload.key,'application/pdf',upload.bytes.length));
        await env.DB.batch(batch);
      } catch(error) { if(upload) await env.DOCUMENTS.delete(upload.key); throw error; }
      return json({id:rid},201);
    }
  }
  match=path.match(/^\/api\/animals\/([^/]+)\/review$/);
  if(match && method==='POST') {
    permit(user,'VETERINARIO'); const b=await body(request); requireThat(typeof b.revision==='boolean','Revisión inválida.');
    requireThat(await first(env,'SELECT id FROM registro_medico WHERE animal_id=? LIMIT 1',match[1]),'Registra una atención antes de confirmar la revisión.',409);
    await env.DB.batch([stmt(env,'UPDATE animal SET revision_clinica=? WHERE id=?',b.revision?1:0,match[1]),audit(env,user,b.revision?'CONFIRMAR_REVISION':'REVOCAR_REVISION',match[1])]); return json({ok:true});
  }
  match=path.match(/^\/api\/animals\/([^/]+)\/vaccines$/);
  if(match && method==='POST') {
    permit(user,'VETERINARIO'); const b=await body(request), vid=id(), name=string(b.nombre,'Vacuna',100), dose=integer(b.dosis,'Dosis',1,100);
    requireThat(typeof b.es_critica==='boolean','Indica si la vacuna es crítica.');
    await env.DB.batch([stmt(env,'INSERT INTO vacuna(id,nombre) VALUES(?,?) ON CONFLICT(nombre) DO NOTHING',vid,name),stmt(env,"INSERT INTO vacuna_animal(id,animal_id,vacuna_id,dosis,es_critica,estado) SELECT ?,?,id,?,?,'PENDIENTE' FROM vacuna WHERE nombre=?",id(),match[1],dose,b.es_critica?1:0,name),stmt(env,'UPDATE animal SET revision_clinica=0 WHERE id=?',match[1]),audit(env,user,'PLANIFICAR_VACUNA',match[1])]); return json({ok:true},201);
  }
  match=path.match(/^\/api\/vaccines\/([^/]+)\/apply$/);
  if(match && method==='POST') {
    permit(user,'VETERINARIO'); const b=await body(request), vaccination=date(b.fecha_aplicacion,'Fecha de aplicación').slice(0,10);
    const r=await env.DB.batch([stmt(env,"UPDATE vacuna_animal SET estado='APLICADA',fecha_aplicacion=?,veterinario_id=? WHERE id=? AND estado='PENDIENTE'",vaccination,user.id,match[1]),audit(env,user,'APLICAR_VACUNA',match[1])]);
    requireThat(r[0].meta.changes===1,'Vacuna no encontrada o ya aplicada.',409); return json({ok:true});
  }
  match=path.match(/^\/api\/documents\/(medical|application)\/([^/]+)$/);
  if(match && method==='GET') {
    permit(user,...(match[1]==='medical'?['ADMIN_ONG','VETERINARIO']:['ADMIN_ONG']));
    const table=match[1]==='medical'?'documento_medico':'documento_solicitud', d=await first(env,`SELECT * FROM ${table} WHERE id=?`,match[2]); requireThat(d,'Documento no encontrado.',404);
    const object=await env.DOCUMENTS.get(d.ruta_privada); requireThat(object,'Archivo no encontrado.',404);
    await audit(env,user,'DESCARGAR_DOCUMENTO',d.id).run();
    return new Response(await decryptBytes(await object.arrayBuffer(),env),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(d.nombre_archivo)}`,'Cache-Control':'no-store'}});
  }
  if(path==='/api/shifts') {
    permit(user,'ADMIN_ONG','VOLUNTARIO');
    if(method==='GET') return json({items:await all(env,`SELECT t.*, (SELECT count(*) FROM asignacion_turno a WHERE a.turno_id=t.id AND a.estado='ACTIVA') ocupados, (SELECT estado FROM asignacion_turno a WHERE a.turno_id=t.id AND a.voluntario_id=?) mi_estado FROM turno t ORDER BY inicio DESC LIMIT 300`,user.id)});
    if(method==='POST') {
      permit(user,'ADMIN_ONG'); const b=await body(request), tid=id(), start=date(b.inicio,'Inicio',{future:true}), end=date(b.fin,'Fin',{future:true}); requireThat(end>start && Date.parse(start)>Date.now(),'El turno debe comenzar en el futuro y terminar después del inicio.');
      await env.DB.batch([stmt(env,'INSERT INTO turno VALUES(?,?,?,?,?,?)',tid,string(b.titulo,'Actividad',100),start,end,integer(b.cupo,'Cupo',1,1000),user.id),audit(env,user,'CREAR_TURNO',tid)]); return json({id:tid},201);
    }
  }
  match=path.match(/^\/api\/shifts\/([^/]+)\/(join|cancel|members)$/);
  if(match) {
    if(match[2]==='members' && method==='GET') { permit(user,'ADMIN_ONG'); return json({items:await all(env,'SELECT a.estado,a.fecha_postulacion,a.motivo_cancelacion,u.nombre,u.correo FROM asignacion_turno a JOIN usuario u ON u.id=a.voluntario_id WHERE turno_id=?',match[1])}); }
    permit(user,'VOLUNTARIO'); requireThat(method==='POST','Método no permitido.',405);
    const t=await first(env,'SELECT * FROM turno WHERE id=?',match[1]); requireThat(t,'Turno no encontrado.',404); requireThat(Date.parse(t.inicio)>Date.now(),'Este turno ya comenzó.',409);
    if(match[2]==='join') {
      const existing=await first(env,'SELECT estado FROM asignacion_turno WHERE turno_id=? AND voluntario_id=?',t.id,user.id);
      if(existing?.estado==='ACTIVA') return json({ok:true,mensaje:'Ya estás inscrito.'});
      await env.DB.batch([existing?stmt(env,"UPDATE asignacion_turno SET estado='ACTIVA',fecha_postulacion=?,motivo_cancelacion=NULL,fecha_cancelacion=NULL,cancelador_id=NULL WHERE turno_id=? AND voluntario_id=?",now(),t.id,user.id):stmt(env,"INSERT INTO asignacion_turno(id,turno_id,voluntario_id,estado,fecha_postulacion) VALUES(?,?,?,'ACTIVA',?)",id(),t.id,user.id,now()),audit(env,user,'POSTULAR_TURNO',t.id)]);
    } else {
      const b=await body(request); const r=await env.DB.batch([stmt(env,"UPDATE asignacion_turno SET estado='CANCELADA',motivo_cancelacion=?,fecha_cancelacion=?,cancelador_id=? WHERE turno_id=? AND voluntario_id=? AND estado='ACTIVA'",string(b.motivo,'Motivo',500),now(),user.id,t.id,user.id),audit(env,user,'CANCELAR_TURNO',t.id)]); requireThat(r[0].meta.changes===1,'No tienes una asignación activa.',409);
    }
    return json({ok:true});
  }
  if(path==='/api/users') {
    permit(user,'ADMIN_ONG');
    if(method==='GET') return json({items:await all(env,"SELECT u.id,u.nombre,u.correo,u.activo,group_concat(r.rol) roles FROM usuario u LEFT JOIN usuario_rol r ON r.usuario_id=u.id GROUP BY u.id ORDER BY u.nombre")});
    if(method==='POST') {
      const b=await body(request), uid=id(), email=string(b.correo,'Correo',150).toLowerCase(); requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Correo inválido.'); requireThat(Array.isArray(b.roles) && b.roles.length>0 && b.roles.length<=3 && new Set(b.roles).size===b.roles.length && b.roles.every(r=>roles.includes(r)),'Selecciona al menos un rol válido.');
      await env.DB.batch([stmt(env,'INSERT INTO usuario(id,nombre,correo,clave_hash) VALUES(?,?,?,?)',uid,string(b.nombre,'Nombre',100),email,await hashPassword(string(b.password,'Contraseña',128,12))),...b.roles.map(r=>stmt(env,'INSERT INTO usuario_rol VALUES(?,?)',uid,r)),audit(env,user,'CREAR_USUARIO',uid)]); return json({id:uid},201);
    }
  }
  if(path==='/api/audit' && method==='GET') { permit(user,'ADMIN_ONG'); return json({items:await all(env,'SELECT a.*,u.nombre responsable FROM auditoria a LEFT JOIN usuario u ON u.id=a.usuario_id ORDER BY a.id DESC LIMIT 100')}); }
  throw new HttpError(404,'Ruta no encontrada.');
}

export default {
  async fetch(request,env,ctx) {
    let response;
    try { response=new URL(request.url).pathname.startsWith('/api/')?await api(request,env,ctx):await env.ASSETS.fetch(request); }
    catch(error) {
      const message=String(error.message), code=Object.keys(businessErrors).find(k=>message.includes(k));
      if(error instanceof HttpError) response=json({error:error.message},error.status);
      else if(code) response=json({error:businessErrors[code]},409);
      else if(message.includes('UNIQUE constraint')) response=json({error:'El registro ya existe o la operación ya fue completada.'},409);
      else if(message.includes('FOREIGN KEY') || message.includes('CHECK constraint')) response=json({error:'Los datos no cumplen las reglas del registro.'},400);
      else { console.error('REQUEST_FAILED',error.name,env.ENVIRONMENT==='test'?error.stack:code||'internal'); response=json({error:'No se pudo completar la operación. Comprueba la configuración del servicio.'},500); }
    }
    const secured=new Response(response.body,response);
    secured.headers.set('X-Content-Type-Options','nosniff');
    secured.headers.set('Referrer-Policy','strict-origin-when-cross-origin');
    secured.headers.set('X-Frame-Options','DENY');
    secured.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    secured.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if(new URL(request.url).protocol==='https:') secured.headers.set('Strict-Transport-Security','max-age=31536000');
    return secured;
  }
};

