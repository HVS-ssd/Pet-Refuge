# Adaptación del modelo Oracle a D1

La adaptación a D1 fue autorizada por el propietario del proyecto. Se conservan las entidades del SQL original: USUARIO, ROL, USUARIO_ROL, ANIMAL, ADOPTANTE, SOLICITUD_ADOPCION, CAMBIO_ESTADO, ADOPCION, REGISTRO_MEDICO, DOCUMENTO_MEDICO, VACUNA, VACUNA_ANIMAL, TURNO y ASIGNACION_TURNO.

Los identificadores usan UUID en columnas TEXT; los números y booleanos usan INTEGER y las fechas usan texto ISO 8601. Las restricciones se declaran dentro de CREATE TABLE porque SQLite no ofrece las mismas operaciones ALTER TABLE de Oracle. El índice de una adopción activa se implementa como índice único parcial.

Los nombres, teléfonos, direcciones e identificaciones cifrados de ADOPTANTE se agrupan en `datos_cifrados`, un objeto JSON cifrado con AES-GCM. El plan de cuidado usa `cuidado_cifrado`. Se añaden correo, vivienda y horas del formulario anterior. No se guarda el objeto personal en texto claro.

Se incorporan SESION, LIMITE_ACCESO, CONFIGURACION, AUDITORIA y DOCUMENTO_SOLICITUD para autenticación, limitación de solicitudes, versión del catálogo, trazabilidad y adjuntos de postulación. Los archivos se guardan cifrados en R2 y sus referencias privadas en D1. Las fotografías del catálogo usan rutas de assets o URL HTTPS.

Los disparadores de D1 validan la formalización, la disponibilidad al postular, las transiciones, la autoría clínica, las correcciones del mismo animal, la inmutabilidad del historial, el cupo y el solapamiento de turnos. D1 batch confirma o revierte conjuntamente las operaciones dependientes. La formalización modifica el estado del animal mediante un disparador de la misma transacción.

La lista de vacunas críticas es definida por el veterinario para cada animal. No se deduce de un historial vacío. La revisión clínica requiere al menos una atención y vuelve a quedar pendiente si se añade una vacuna.

El documento de la Tarea 7 se utilizó como especificación funcional. Sus planes de reuniones, revisiones humanas, tablero y entrega académica no se interpretaron como evidencia de actividades ejecutadas.
