// Spanish (LatAm neutral, tú) copy for /enterprise. Mirrors ./en.js exactly.

export default {
  meta: {
    title:
      "Houston Enterprise: la plataforma y los ingenieros para implementar IA",
    description:
      "Despliega agentes de IA a escala con control total sobre modelos, datos y gobernanza. Un creador de agentes sin código, integraciones a medida e ingenieros que trabajan junto a tu equipo.",
  },

  nav: {
    industries: "Industrias",
    trust: "Clientes",
    problem: "El problema",
    solution: "Cómo lo resolvemos",
    cta: "Agenda una llamada de descubrimiento",
  },

  hero: {
    // The headline is set as lines: each one is its own block, so the
    // break lands where the copy means it in every language.
    h1Lines: ["Pon la IA a trabajar", "en tu empresa."],
    sub: "La plataforma y los ingenieros para operar agentes de IA en toda tu empresa.",
    ctaDemo: "Agenda una llamada de descubrimiento",
    ctaHow: "Mira cómo funciona",
    industriesLabel: "Donde ponemos la IA a trabajar.",
    industriesPhrases: [
      "La mayoría de la IA nunca sale del piloto.",
      "La nuestra hace el trabajo diario de seis industrias.",
    ],
    industries: [
      {
        name: "Logística",
        alt: "Un camión de carga en una carretera con curvas",
      },
      {
        name: "Bienes raíces",
        alt: "Una mano que sostiene las llaves de una casa nueva",
      },
      {
        name: "Retail",
        alt: "El mostrador de una boutique de ropa",
      },
      {
        name: "Banca",
        alt: "La rueda de bronce de la puerta de una bóveda bancaria",
      },
      {
        name: "Seguros",
        alt: "Un inspector con una tabla de apuntes revisando una ventana",
      },
      {
        name: "Manufactura",
        alt: "Un soldador trabajando entre chispas",
      },
    ],
  },

  trust: {
    value: "+10.000",
    label:
      "agentes de IA ya trabajando, para más de 5.000 personas en más de 50 países.",
    logosLabel: "Personas de estas organizaciones usan Houston",
  },

  problem: {
    title: "Comprar IA es fácil. Hacerla funcionar, no.",
    phrases: [
      "Todas las empresas están comprando herramientas de IA.",
      "Casi ninguna tiene el equipo para hacerlas funcionar.",
    ],
    art: { inbox: "CORREO", target: "META" },
    cards: [
      {
        title: "Nadie es dueño",
      },
      {
        title: "Nadie la construye",
      },
      {
        title: "Nada está conectado",
      },
      {
        title: "Nadie le da seguimiento",
      },
    ],
  },

  solution: {
    title: "De la primera llamada a resultados en 1 mes.",
    lead: "Los mismos cuatro pasos que seguimos con cada empresa.",
    prev: "Anterior",
    next: "Siguiente",
    // The last slide's way forward: the round chevron becomes this pill.
    bookCall: "Agenda una llamada de descubrimiento",
    // The process slider: the title and lead are its first slide, then
    // one slide per phase: `head` is the big title, `rest` the line under it.
    phases: [
      {
        head: "Una llamada de descubrimiento con tu equipo.",
        rest: "Conocemos a tu equipo, mapeamos las mejores oportunidades para la IA y obtenemos una visión clara de dónde aporta más valor.",
      },
      {
        head: "Un piloto pagado de 4 semanas.",
        rest: "Elegimos un caso de uso con un equipo, construimos los agentes con ellos y entregamos valor en 1 mes.",
      },
      {
        head: "Tus sistemas y tus datos, conectados.",
        rest: "Durante el piloto conectamos tus sistemas y tus datos, para que los agentes trabajen sobre lo real desde el primer día.",
      },
      {
        head: "Medimos el valor y expandimos.",
        rest: "Revisamos los resultados contigo y llevamos los agentes al resto de la empresa, equipo por equipo.",
      },
    ],
  },

  contact: {
    title: "Construyamos esto juntos.",
    lead: "Agenda una llamada de descubrimiento con nuestro equipo. Revisamos tu operación contigo y te decimos dónde la IA rinde primero.",
    cta: "Agenda una llamada de descubrimiento",
    mailSubject: "Llamada de descubrimiento con Houston",
    peopleLabel: "El equipo con el que vas a hablar",
    linesLabel: "Escríbenos o llámanos",
  },
};
