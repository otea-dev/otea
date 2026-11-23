import type { Catalog } from '../i18n.ts';

// El área toca del catálogo en español.
export const toca = {
  // Te toca y Atasco
  'toca.title': 'Te toca',
  'toca.atasco': 'Atasco',
  'toca.sec.atasco': 'Atasco',
  'toca.sec.preguntas': 'Preguntas para ti',
  'toca.sec.revisiones': 'Revisiones',
  'toca.sec.propios': 'Tus propios pasos',
  'toca.sec.encamino': 'En camino',
  'toca.sec.cerrados': 'Cerrados',
  'toca.gloss.encamino': 'con los agentes por ahora',
  'toca.gloss.cerrados': 'hechos y descartados',
  'toca.empty.atasco': 'Nada atascado.',
  'toca.empty.preguntas': 'Ninguna pregunta.',
  'toca.empty.revisiones': 'Nada por revisar.',
  'toca.empty.propios': 'Ningún paso tuyo.',
  'toca.empty.encamino': 'Nada en camino.',
  'toca.empty.cerrados': 'Nada cerrado todavía.',
  'toca.triage': 'Triaje',

  // El dek
  'toca.numbers': 'cero|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece',
  'toca.dek.waiting': {
    one: '{n} cosa espera por ti {since}.',
    other: '{n} cosas esperan por ti; la más antigua, {since}.',
  },
  'toca.dek.none': 'Nada espera por ti.',
  'toca.dek.handed': 'Los agentes entregaron {n} hoy.',
  'toca.dek.handedNone': 'Los agentes no entregaron nada hoy.',
  'toca.since.now': 'desde hace un momento',
  'toca.since.minutes': 'desde hace {minutes} min',
  'toca.since.hours': 'desde hace {hours} h',
  'toca.since.yesterday': 'desde ayer',
  'toca.since.days': { one: 'desde hace {count} día', other: 'desde hace {count} días' },
  'toca.dekStuck.lead': {
    one: '{n} cosa se quedó quieta: ',
    other: '{n} cosas se quedaron quietas: ',
  },
  'toca.dekStuck.agent': '{agent} no da señales desde hace {time}',
  'toca.dekStuck.none': 'Nada parado: los agentes siguen dando señales.',

  // La llamada a actuar de una fila y su línea pequeña
  'toca.act.atasco': 'Retomar o reasignar',
  'toca.act.preguntas': 'Responder',
  'toca.act.revisiones': 'Revisar',
  'toca.act.propios': 'Tu paso',
  'toca.act.encamino': 'Después lo revisas tú',
  'toca.act.waitsOn': 'Espera a {id}',
  'toca.act.agents': 'Sigue con los agentes',
  'toca.act.yours': 'Después te toca a ti',
  'toca.act.closes': 'Se cierra al terminar',
  'toca.act.done': 'Hecho',
  'toca.act.dropped': 'Descartado',
  'toca.sub.holds': 'lo tiene {agent}',
  'toca.sub.asks': 'pregunta {agent}',
  'toca.sub.hands': 'entrega {agent}',
  'toca.sub.yourTurn': 'es tu turno',
  'toca.sub.then': 'después lo hace {agent}',
  'toca.sub.thenAgent': 'después lo toma un agente',
  'toca.sub.thenClose': 'después se cierra',
  'toca.sub.does': 'lo hace {agent}',
  'toca.sub.silent': '{agent} no da señales',
  'toca.sub.waitsFor': 'espera a {agent}',
  'toca.sub.waitsAgent': 'espera a un agente',
  'toca.sub.waitsKids': 'espera a sus hijos',
  'toca.sub.setAside': '{agent} lo dejó para más adelante',
  'toca.sub.didIt': 'lo hizo {agent}',
  'toca.sub.closedBy': 'lo cerró {agent}',
  'toca.sub.closedByYou': 'cerrado por ti',
  'toca.sub.closedRelayed': 'cerrado, relayada por {agent}',
  // La columna de la derecha ya dice «reserva vencida»: aquí, quién y desde cuándo, corto para
  // que la fila no corte el texto.
  'toca.quiet': '{agent} · hace {time}',
  'toca.replied': '{agent} contestó',
  'toca.round': 'ronda {n}',

  // Tras el primer ítem terminado del proyecto: lo que suele venir después (una vez, y se va)
  'next.label': 'Qué hacer ahora',
  'next.title': 'Tu primer ítem está terminado',
  'next.body': 'Buen comienzo. Esto es lo que suele venir ahora:',
  'next.pair': 'Emparejar tu teléfono',
  'next.pairNote': 'Revisa y aprueba desde donde estés.',
  'next.board': 'Crear otro tablero',
  'next.boardNote': 'Una forma de trabajar para otra clase de trabajo.',
  'next.agent': 'Invitar a otro agente',
  'next.agentNote': 'Más manos a la vez, cada una en lo suyo.',
  'next.dismiss': 'Ahora no',
  'next.once': 'No volverá a aparecer en este dispositivo.',

  // Sin agentes conectados
  'toca.noAgents.title': 'Ningún agente conectado',
  'toca.noAgents.waiting': {
    one: 'Un ítem está en turno de un agente y espera a que alguien lo tome. Conecta un agente y empezará por él.',
    other:
      '{count} ítems están en turno de un agente y esperan a que alguien los tome. Conecta un agente y empezará por el más antiguo.',
  },
  'toca.noAgents.nothing':
    'Nada espera a un agente ahora. Conecta un agente y tomará lo que llegue a su turno.',

  // La línea de actividad de un agente (en su ficha)
  'toca.agent.trace': 'Últimas dos horas de {agent}',
  'toca.axis.from': '−2 h',
  'toca.axis.mid': '−1 h',
  'toca.axis.now': 'ahora',
  'toca.connect': 'Conectar un agente',
  'toca.colophon': 'Hoy entregaron {handed}, aprobaste {approved} y devolviste {sent} con notas.',
} satisfies Partial<Catalog>;
