# Datos de demostración

Colección solicitada para recorrer todos los módulos de Pet Refuge. Todos sus datos son ficticios y se identifican con `DEMO`, nombres de ejemplo y correos `.test`. Las imágenes son las fotografías de demostración incluidas en el proyecto y se reutilizan entre fichas de la misma especie.

| Módulo | Registros añadidos |
|---|---:|
| Animales | 28: 20 disponibles, 4 en atención y 4 adoptados |
| Postulantes y solicitudes | 20 de cada uno |
| Atenciones clínicas | 60, incluidas 4 correcciones que conservan la versión anterior |
| Vacunas del catálogo | 4 ejemplos ficticios |
| Vacunas por animal | 56, aplicadas y pendientes |
| Adopciones formalizadas | 4 |
| Integrantes del equipo | 10: 2 veterinarios y 8 voluntarios |
| Turnos | 12, con cupos libres y agotados |
| Asignaciones | 28: 24 activas y 4 canceladas |
| Documentos privados | 8 PDF: 4 clínicos y 4 de postulación |

Las solicitudes incluyen todas las etapas de evaluación. Las cuatro entregas cumplen las reglas de revisión clínica y vacunas. Las cancelaciones conservan motivo, fecha y responsable. Los PDF indican que no tienen validez clínica ni legal y se guardan cifrados en R2.

La cuenta administradora existente se conserva. Las contraseñas aleatorias del nuevo equipo solo se guardan en `.local/demo-accounts.json`, excluido de Git. Los datos personales ficticios se cifran con la clave del entorno antes de importarse a D1.

`scripts/seed-demo.mjs --apply` prepara y valida la colección en SQLite, sube los adjuntos cifrados y después importa los registros. Usa identificadores con prefijo `demo-t7-` y se detiene si detecta animales de la colección, para no duplicarla ni reemplazar modificaciones posteriores. Su importación D1 es atómica; las imágenes no requieren un nuevo despliegue.

Se comprobó la integridad del conjunto. Esto no es una prueba de carga.
