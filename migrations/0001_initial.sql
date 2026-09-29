PRAGMA foreign_keys = ON;
CREATE TABLE usuario (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, correo TEXT NOT NULL UNIQUE COLLATE NOCASE, clave_hash TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN(0,1)));
CREATE TABLE rol (codigo TEXT PRIMARY KEY CHECK(codigo IN('ADMIN_ONG','VETERINARIO','VOLUNTARIO')));
INSERT INTO rol VALUES ('ADMIN_ONG'),('VETERINARIO'),('VOLUNTARIO');
CREATE TABLE usuario_rol (usuario_id TEXT REFERENCES usuario(id), rol TEXT REFERENCES rol(codigo), PRIMARY KEY(usuario_id,rol));
CREATE TABLE sesion (token_hash TEXT PRIMARY KEY, usuario_id TEXT NOT NULL REFERENCES usuario(id), expira TEXT NOT NULL);
CREATE TABLE limite_acceso (clave TEXT PRIMARY KEY, intentos INTEGER NOT NULL, expira INTEGER NOT NULL);
CREATE TABLE configuracion (id INTEGER PRIMARY KEY CHECK(id=1), catalogo_version INTEGER NOT NULL DEFAULT 1);
INSERT INTO configuracion VALUES (1,1);
CREATE TABLE animal (
 id TEXT PRIMARY KEY, nombre TEXT NOT NULL CHECK(length(trim(nombre)) BETWEEN 1 AND 60), especie TEXT NOT NULL CHECK(especie IN('Perro','Gato','Otro')),
 edad_meses INTEGER NOT NULL CHECK(edad_meses BETWEEN 0 AND 1200), foto_ref TEXT NOT NULL CHECK(length(foto_ref)>0),
 descripcion TEXT NOT NULL, estado TEXT NOT NULL CHECK(estado IN('EN_ATENCION','DISPONIBLE','ADOPTADO')),
 fecha_ingreso TEXT NOT NULL, lugar_rescate TEXT NOT NULL DEFAULT '', revision_clinica INTEGER NOT NULL DEFAULT 0 CHECK(revision_clinica IN(0,1)), registrador_id TEXT NOT NULL REFERENCES usuario(id)
);
CREATE TABLE adoptante (id TEXT PRIMARY KEY, datos_cifrados TEXT NOT NULL);
CREATE TABLE solicitud_adopcion (
 id TEXT PRIMARY KEY, animal_id TEXT NOT NULL REFERENCES animal(id), adoptante_id TEXT NOT NULL REFERENCES adoptante(id),
 fecha TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'RECIBIDA' CHECK(estado IN('RECIBIDA','EN_EVALUACION','PRUEBA_COMPATIBILIDAD','APROBADO','RECHAZADO')),
 cuidado_cifrado TEXT NOT NULL, aviso_aceptado INTEGER NOT NULL CHECK(aviso_aceptado=1),
 resultado_compatibilidad TEXT CHECK(resultado_compatibilidad IN('FAVORABLE','DESFAVORABLE','POR_VERIFICAR')),
 evaluador_id TEXT REFERENCES usuario(id), UNIQUE(id,animal_id)
);
CREATE TABLE cambio_estado (id TEXT PRIMARY KEY, solicitud_id TEXT NOT NULL REFERENCES solicitud_adopcion(id), origen TEXT NOT NULL, destino TEXT NOT NULL, fecha TEXT NOT NULL, motivo_cifrado TEXT NOT NULL, responsable_id TEXT NOT NULL REFERENCES usuario(id));
CREATE TABLE adopcion (id TEXT PRIMARY KEY, solicitud_id TEXT NOT NULL UNIQUE, animal_id TEXT NOT NULL, fecha_entrega TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'ACTIVA' CHECK(estado IN('ACTIVA','CERRADA')), responsable_id TEXT NOT NULL REFERENCES usuario(id), FOREIGN KEY(solicitud_id,animal_id) REFERENCES solicitud_adopcion(id,animal_id));
CREATE UNIQUE INDEX uq_adopcion_activa ON adopcion(animal_id) WHERE estado='ACTIVA';
CREATE TABLE registro_medico (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL REFERENCES animal(id), veterinario_id TEXT NOT NULL REFERENCES usuario(id), fecha_atencion TEXT NOT NULL, fecha_registro TEXT NOT NULL, consulta TEXT NOT NULL, diagnostico TEXT NOT NULL, anterior_id TEXT REFERENCES registro_medico(id), motivo_correccion TEXT, CHECK((anterior_id IS NULL AND motivo_correccion IS NULL) OR (anterior_id IS NOT NULL AND length(trim(motivo_correccion))>0)));
CREATE TABLE documento_medico (id TEXT PRIMARY KEY, registro_id TEXT NOT NULL REFERENCES registro_medico(id), nombre_archivo TEXT NOT NULL, ruta_privada TEXT NOT NULL UNIQUE, tipo_mime TEXT NOT NULL CHECK(tipo_mime='application/pdf'), tamano_bytes INTEGER NOT NULL CHECK(tamano_bytes BETWEEN 1 AND 5242880));
CREATE TABLE documento_solicitud (id TEXT PRIMARY KEY, solicitud_id TEXT NOT NULL REFERENCES solicitud_adopcion(id), nombre_archivo TEXT NOT NULL, ruta_privada TEXT NOT NULL UNIQUE, tamano_bytes INTEGER NOT NULL CHECK(tamano_bytes BETWEEN 1 AND 5242880));
CREATE TABLE vacuna (id TEXT PRIMARY KEY, nombre TEXT NOT NULL UNIQUE, descripcion TEXT);
CREATE TABLE vacuna_animal (id TEXT PRIMARY KEY, animal_id TEXT NOT NULL REFERENCES animal(id), vacuna_id TEXT NOT NULL REFERENCES vacuna(id), dosis INTEGER NOT NULL CHECK(dosis>0), es_critica INTEGER NOT NULL CHECK(es_critica IN(0,1)), estado TEXT NOT NULL CHECK(estado IN('PENDIENTE','APLICADA')), fecha_aplicacion TEXT, veterinario_id TEXT REFERENCES usuario(id), UNIQUE(animal_id,vacuna_id,dosis), CHECK((estado='PENDIENTE' AND fecha_aplicacion IS NULL AND veterinario_id IS NULL) OR (estado='APLICADA' AND fecha_aplicacion IS NOT NULL AND veterinario_id IS NOT NULL)));
CREATE TABLE turno (id TEXT PRIMARY KEY, titulo TEXT NOT NULL, inicio TEXT NOT NULL, fin TEXT NOT NULL CHECK(fin>inicio), cupo INTEGER NOT NULL CHECK(cupo BETWEEN 1 AND 1000), creador_id TEXT NOT NULL REFERENCES usuario(id));
CREATE TABLE asignacion_turno (id TEXT PRIMARY KEY, turno_id TEXT NOT NULL REFERENCES turno(id), voluntario_id TEXT NOT NULL REFERENCES usuario(id), estado TEXT NOT NULL CHECK(estado IN('ACTIVA','CANCELADA')), fecha_postulacion TEXT NOT NULL, motivo_cancelacion TEXT, fecha_cancelacion TEXT, cancelador_id TEXT REFERENCES usuario(id), UNIQUE(turno_id,voluntario_id));
CREATE TABLE auditoria (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id TEXT REFERENCES usuario(id), accion TEXT NOT NULL, entidad_id TEXT NOT NULL, fecha TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
CREATE INDEX ix_catalogo ON animal(estado,especie);
CREATE INDEX ix_medico ON registro_medico(animal_id,fecha_atencion);
CREATE INDEX ix_solicitud ON solicitud_adopcion(animal_id,estado);
CREATE INDEX ix_asignaciones ON asignacion_turno(voluntario_id,estado);
CREATE INDEX ix_sesion_expira ON sesion(expira);
CREATE TRIGGER catalogo_insert AFTER INSERT ON animal BEGIN UPDATE configuracion SET catalogo_version=catalogo_version+1 WHERE id=1; END;
CREATE TRIGGER catalogo_update AFTER UPDATE ON animal BEGIN UPDATE configuracion SET catalogo_version=catalogo_version+1 WHERE id=1; END;
CREATE TRIGGER catalogo_delete AFTER DELETE ON animal BEGIN UPDATE configuracion SET catalogo_version=catalogo_version+1 WHERE id=1; END;
CREATE TRIGGER solicitud_disponible BEFORE INSERT ON solicitud_adopcion BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM animal WHERE id=NEW.animal_id AND estado='DISPONIBLE') THEN RAISE(ABORT,'ANIMAL_NO_DISPONIBLE') END;
END;
CREATE TRIGGER solicitud_transicion BEFORE UPDATE OF estado ON solicitud_adopcion WHEN NEW.estado<>OLD.estado BEGIN
 SELECT CASE WHEN NOT ((OLD.estado='RECIBIDA' AND NEW.estado='EN_EVALUACION') OR (OLD.estado='EN_EVALUACION' AND NEW.estado='PRUEBA_COMPATIBILIDAD') OR (OLD.estado='PRUEBA_COMPATIBILIDAD' AND NEW.estado='APROBADO' AND NEW.resultado_compatibilidad='FAVORABLE') OR (OLD.estado='PRUEBA_COMPATIBILIDAD' AND NEW.estado='RECHAZADO' AND NEW.resultado_compatibilidad='DESFAVORABLE')) THEN RAISE(ABORT,'TRANSICION_INVALIDA') END;
END;
CREATE TRIGGER adopcion_validar BEFORE INSERT ON adopcion BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM usuario_rol WHERE usuario_id=NEW.responsable_id AND rol='ADMIN_ONG') THEN RAISE(ABORT,'ROL_INVALIDO') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM solicitud_adopcion WHERE id=NEW.solicitud_id AND animal_id=NEW.animal_id AND estado='APROBADO') THEN RAISE(ABORT,'SOLICITUD_NO_APROBADA') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM animal WHERE id=NEW.animal_id AND estado='DISPONIBLE') THEN RAISE(ABORT,'ANIMAL_NO_DISPONIBLE') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM animal WHERE id=NEW.animal_id AND revision_clinica=1) THEN RAISE(ABORT,'REVISION_PENDIENTE') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM vacuna_animal WHERE animal_id=NEW.animal_id AND es_critica=1 AND estado='PENDIENTE') THEN RAISE(ABORT,'VACUNA_CRITICA_PENDIENTE') END;
END;
CREATE TRIGGER adopcion_confirmar AFTER INSERT ON adopcion BEGIN UPDATE animal SET estado='ADOPTADO' WHERE id=NEW.animal_id; END;
CREATE TRIGGER animal_adoptado BEFORE UPDATE OF estado ON animal BEGIN
 SELECT CASE WHEN NEW.estado='ADOPTADO' AND NOT EXISTS(SELECT 1 FROM adopcion WHERE animal_id=NEW.id AND estado='ACTIVA') THEN RAISE(ABORT,'REQUIERE_FORMALIZACION') END;
 SELECT CASE WHEN OLD.estado='ADOPTADO' AND NEW.estado<>'ADOPTADO' THEN RAISE(ABORT,'ADOPCION_ACTIVA') END;
END;
CREATE TRIGGER medico_autor BEFORE INSERT ON registro_medico BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM usuario_rol WHERE usuario_id=NEW.veterinario_id AND rol='VETERINARIO') THEN RAISE(ABORT,'ROL_INVALIDO') END;
 SELECT CASE WHEN NEW.anterior_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM registro_medico WHERE id=NEW.anterior_id AND animal_id=NEW.animal_id) THEN RAISE(ABORT,'CORRECCION_INVALIDA') END;
END;
CREATE TRIGGER medico_inmutable BEFORE UPDATE ON registro_medico BEGIN SELECT RAISE(ABORT,'HISTORIAL_INMUTABLE'); END;
CREATE TRIGGER medico_no_borrar BEFORE DELETE ON registro_medico BEGIN SELECT RAISE(ABORT,'HISTORIAL_INMUTABLE'); END;
CREATE TRIGGER asignacion_validar BEFORE INSERT ON asignacion_turno WHEN NEW.estado='ACTIVA' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM usuario_rol WHERE usuario_id=NEW.voluntario_id AND rol='VOLUNTARIO') THEN RAISE(ABORT,'ROL_INVALIDO') END;
 SELECT CASE WHEN (SELECT count(*) FROM asignacion_turno WHERE turno_id=NEW.turno_id AND estado='ACTIVA') >= (SELECT cupo FROM turno WHERE id=NEW.turno_id) THEN RAISE(ABORT,'CUPO_AGOTADO') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM asignacion_turno a JOIN turno t ON t.id=a.turno_id JOIN turno n ON n.id=NEW.turno_id WHERE a.voluntario_id=NEW.voluntario_id AND a.estado='ACTIVA' AND t.inicio<n.fin AND t.fin>n.inicio) THEN RAISE(ABORT,'TURNO_SOLAPADO') END;
END;
CREATE TRIGGER asignacion_reactivar BEFORE UPDATE OF estado ON asignacion_turno WHEN NEW.estado='ACTIVA' AND OLD.estado='CANCELADA' BEGIN
 SELECT CASE WHEN (SELECT count(*) FROM asignacion_turno WHERE turno_id=NEW.turno_id AND estado='ACTIVA') >= (SELECT cupo FROM turno WHERE id=NEW.turno_id) THEN RAISE(ABORT,'CUPO_AGOTADO') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM asignacion_turno a JOIN turno t ON t.id=a.turno_id JOIN turno n ON n.id=NEW.turno_id WHERE a.voluntario_id=NEW.voluntario_id AND a.estado='ACTIVA' AND t.inicio<n.fin AND t.fin>n.inicio) THEN RAISE(ABORT,'TURNO_SOLAPADO') END;
END;
