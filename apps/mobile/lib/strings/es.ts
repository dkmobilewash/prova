import type { EN } from "./en";

/**
 * The field screens in Spanish — Mexican usage, because that is who is
 * on these crews in the Southwest.
 *
 * WORDS WORTH A NATIVE SPEAKER'S EYE, flagged rather than buried. A
 * foreman correcting any of them is a one-line change to this file:
 *
 *   punch list      "lista de pendientes". Also heard as "lista de
 *                   detalles" on Mexican jobs; "detalle" for one item is
 *                   common and is what I would change to if your crews
 *                   use it.
 *   job / site      "obra", not "trabajo" — "trabajo" is the work, "obra"
 *                   is the place with an address.
 *   toolbox talk    "plática de seguridad". "Charla" is the Spain usage;
 *                   "plática" is Mexico.
 *   cost code       "código de costo", left close to the English because
 *                   the codes themselves are English on the paperwork.
 *   T&M             left as "T&M" wherever it appears — it is what the GC
 *                   writes on the ticket, and translating it would make
 *                   the phone disagree with the paper.
 *   the server      "el sistema". Nobody outside this building calls it a
 *                   server, and "el servidor" reads as a machine somebody
 *                   should go and find.
 *
 * Safety and incident wording is deliberately plain and short: this is
 * the one place where a clever translation could change what somebody
 * believes they are reporting.
 */
export const ES: Record<keyof typeof EN, string> = {
  "common.pendingSync": "Pendientes por enviar: {count}",
  "common.syncing": "Enviando…",
  "common.tryAgain": "Reintentar",
  "common.dismiss": "Descartar",
  "common.optional": "Opcional",
  "common.notSaved.one": "1 cambio no se guardó",
  "common.notSaved.many": "{count} cambios no se guardaron",
  "common.date": "Fecha",
  "common.note": "Nota",
  "common.required": "Obligatorio.",

  "punch.status.open": "Abierto",
  "punch.status.ready": "Listo para revisión",
  "punch.status.verified": "Verificado",
  "punch.markReady": "Marcar como listo para revisión",
  "punch.markOpen": "Marcar como abierto otra vez",
  "punch.verifiedOnWeb": "Los pendientes verificados se reabren en la computadora, con un motivo.",
  "punch.noPhoto": "Sin foto del arreglo — agrega una",
  "punch.empty.title": "No hay pendientes en esta obra.",
  "punch.empty.body": "Toca «Agregar pendiente» para anotar lo que falta arreglar.",
  "punch.add": "Agregar pendiente",
  "punch.sheet.title": "Agregar pendiente",
  "punch.sheet.save": "Guardar",
  "punch.field.what": "Qué hay que arreglar",
  "punch.field.whatHint": "ej. Plafón fuera de nivel",
  "punch.field.where": "Dónde (opcional)",
  "punch.field.whereHint": "ej. Pasillo del nivel 3",
  "punch.due": "para el {date}",

  "outbox.waiting": "Por enviar",
  "outbox.needsAttention": "Necesita atención",
  "outbox.needsAttention.body": "El sistema los leyó y los rechazó. No se van a enviar solos.",
  "outbox.serverSaid": "El sistema dijo: «{error}»",
  "outbox.putBack": "Volver a intentarlos",
  "outbox.letGo": "Descartarlos",
  "outbox.sendNow": "Enviar ahora",
  "outbox.sending": "Enviando…",
  "outbox.remove": "Quitar",
  "outbox.empty.title": "Todo lo de este teléfono ya llegó a la oficina.",
  "outbox.empty.body":
    "Lo que guardes sin señal espera aquí hasta que se pueda enviar, y esta pantalla te dice qué es.",
  "outbox.stillOffline": "Sigue sin conexión. Todo esto se guarda hasta que haya.",
  "outbox.signInAgain": "La sesión expiró — abre cualquier pantalla para entrar otra vez, y luego envía.",
  "outbox.waitingForSignal": "Esperando señal",
  "outbox.tried.one": "Se intentó una vez — el sistema dijo «{error}». Se vuelve a intentar {when}.",
  "outbox.tried.many": "Se intentó {count} veces — el sistema dijo «{error}». Se vuelve a intentar {when}.",
  "outbox.when.seconds": "en {seconds}s",
  "outbox.when.next": "cuando haya señal",
  "outbox.triesLeft.one": "Un intento más y pasa a Necesita atención.",
  "outbox.triesLeft.many": "{count} intentos más y pasa a Necesita atención.",

  "time.log": "Registrar horas",
  "time.sheet.title": "Registrar horas",
  "time.sheet.save": "Guardar",
  "time.signDay": "Firmar el día",
  "time.sign.title": "Firmar el día",
  "time.sign.primary": "Firmar y cerrar",
  "time.field.hoursAll": "Horas para todos",
  "time.field.hoursDifferent": "Horas (si son distintas)",
  "time.field.hoursHint": "ej. 8 u 8.5",
  "time.field.noteHint": "Opcional — se aplica a todos los registros",
  "time.field.yourName": "Tu nombre",
  "time.field.yourNameHint": "Se imprime debajo de la firma",
  "time.who": "Quién",
  "time.me": "Yo",
  "time.craft": "Oficio",
  "time.costCode": "Código de costo",
  "time.noLine": "Sin partida específica",
  "time.payType": "Tipo de pago",
  "time.signature": "Firma",
  "time.clockIn": "Marcar entrada",
  "time.clockOut": "Marcar salida",
  "time.notOnClock": "Sin turno iniciado",
  "time.checkingClock": "Revisando el turno…",
  "time.ratioWarning": "Proporción de aprendices — excedida hoy",
  "time.empty.title": "Sin horas registradas",
  "time.empty.body": "Toca «Registrar horas» para anotar las horas del día.",

  "photos.take": "Tomar foto",
  "photos.pick": "Elegir de la galería",
  "photos.sheet.title": "Guardar foto",
  "photos.sheet.save": "Guardar foto",
  "photos.caption": "Descripción",
  "photos.tags": "Etiquetas",
  "photos.attachTo": "Adjuntar a",
  "photos.onReport": "Al reporte del día",
  "photos.onPunchItem": "A un pendiente",
  "photos.stamped": "La hora y el lugar quedan marcados en la foto al guardarla.",
  "photos.empty.title": "Todavía no hay fotos",
  "photos.empty.body":
    "Toca «Tomar foto». Cada una queda marcada con la hora y el lugar, y se envía cuando haya señal.",

  "safety.talks": "Pláticas de seguridad",
  "safety.incidents": "Incidentes",
  "safety.addTalk": "Agregar plática",
  "safety.addIncident": "Agregar incidente",
  "safety.talk.title": "Agregar plática de seguridad",
  "safety.talk.save": "Guardar plática",
  "safety.incident.title": "Agregar incidente",
  "safety.incident.save": "Guardar incidente",
  "safety.field.topic": "Tema",
  "safety.field.topicHint": "ej. Protección contra caídas",
  "safety.field.employee": "Nombre del trabajador",
  "safety.field.description": "Descripción",
  "safety.field.descriptionHint": "Qué pasó",
  "safety.classification": "Clasificación",
  "safety.outcome": "Resultado",
  "safety.noTalks": "Sin pláticas registradas",
  "safety.noIncidents": "Sin incidentes",

  "offline.stale": "Mostrando lo último que cargó este teléfono, {age} — sin conexión",
  "offline.nothing":
    "No se puede cargar ahora, y este teléfono no lo ha cargado antes. Lo que agregues se guarda y se envía cuando vuelvas a tener señal.",
  "offline.cantLoad": "No se puede cargar {thing} ahora.",
  "offline.cantLoad.body":
    "Sin conexión, y este teléfono no lo ha cargado antes. Lo que agregues se guarda y se envía cuando vuelvas a tener señal.",

  "materials.empty.title": "Sin pedidos",
  "materials.empty.body": "Toca «Agregar pedido» para anotar una entrega de material.",
  "reports.empty.title": "Todavía no hay reportes",
  "reports.empty.body":
    "Toca «Nuevo reporte» para registrar el trabajo del día. La cuadrilla y el clima se llenan solos.",
  "tickets.empty.title": "Sin tickets de T&M",
  "tickets.empty.body": "Toca «Nuevo ticket» para documentar y firmar el trabajo extra del día.",
  "drawings.empty.title": "No hay juegos de planos en esta obra.",
  "drawings.empty.body": "Los juegos y sus revisiones se registran en la computadora, desde el transmittal.",
  "schedule.empty.title": "Nadie está programado en esta obra.",
  "schedule.empty.body": "Los días se programan en la computadora, en Deployment.",
  "jobs.empty.title": "Todavía no hay obras",
  "jobs.empty.body": "Las obras aparecen aquí cuando se crean en la oficina.",

  "age.justNow": "hace un momento",
  "age.minutes": "hace {count} min",
  "age.hour": "hace una hora",
  "age.hours": "hace {count} horas",
  "age.yesterday": "ayer",
  "age.days": "hace {count} días",
  "age.earlier": "antes",

  "thing.punchList": "la lista de pendientes",
  "thing.time": "las horas",
  "thing.photos": "las fotos",
  "thing.safety.talks": "las pláticas de seguridad",
  "thing.safety.incidents": "los incidentes",
  "thing.materials": "los pedidos de material",
  "thing.reports": "los reportes diarios",
  "thing.tickets": "los tickets de T&M",
  "thing.drawings": "los planos",
  "thing.schedule": "el programa de trabajo",
  "thing.jobs": "la lista de obras",

  "settings.language": "Idioma",
  "settings.language.auto": "Seguir el teléfono",
  "settings.language.en": "English",
  "settings.language.es": "Español",
  "settings.language.note":
    "Cambia solo este teléfono. La oficina lo ve todo en inglés de cualquier forma.",
};
