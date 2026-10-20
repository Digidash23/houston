// English copy for /enterprise. Imported by ../en.js as its `enterprise` key,
// so scripts/check-locales.mjs holds es and pt to this exact tree. Same rules
// as the landing copy: no em dashes, structure lives in _data/enterprise.js,
// and arrays here zip by index with the arrays there.

export default {
  meta: {
    title: "Houston Enterprise: the platform and engineers to implement AI",
    description:
      "Deploy AI agents at scale with full control over models, data, and governance. A no-code agent builder, custom integrations, and forward deployed engineers who work next to your team.",
  },

  nav: {
    industries: "Industries",
    trust: "Customers",
    problem: "The problem",
    solution: "How we solve it",
    cta: "Book a discovery call",
  },

  hero: {
    // The headline is set as lines: each one is its own block, so the
    // break lands where the copy means it in every language.
    h1Lines: ["Put AI to work", "in your company."],
    sub: "The platform and the engineers to run AI agents across your operations.",
    ctaDemo: "Book a discovery call",
    ctaHow: "See how it works",
    industriesLabel: "Where we put AI to work.",
    industriesPhrases: [
      "Most AI never leaves the pilot.",
      "Ours runs the daily work of six industries.",
    ],
    industries: [
      {
        name: "Logistics",
        alt: "A freight truck on a curving highway",
      },
      {
        name: "Real Estate",
        alt: "A hand holding the keys to a new home",
      },
      {
        name: "Retail",
        alt: "The counter of a clothing boutique",
      },
      {
        name: "Banking",
        alt: "The brass wheel of a bank vault door",
      },
      {
        name: "Insurance",
        alt: "An inspector with a clipboard checking a window",
      },
      {
        name: "Manufacturing",
        alt: "A welder at work, sparks flying",
      },
    ],
  },

  trust: {
    value: "+10,000",
    label:
      "AI agents already at work, for more than 5,000 people in over 50 countries.",
    logosLabel: "People at these organizations use Houston",
  },

  problem: {
    title: "Buying AI is easy. Making it work isn't.",
    phrases: [
      "Every company is buying AI tools.",
      "Almost none have the team to make them work.",
    ],
    art: { inbox: "INBOX", target: "TARGET" },
    cards: [
      {
        title: "No one owns it",
      },
      {
        title: "No one to build it",
      },
      {
        title: "Nothing is connected",
      },
      {
        title: "Nobody follows through",
      },
    ],
  },

  solution: {
    title: "From first call to value in 1 month.",
    lead: "The same four steps we follow with every company.",
    prev: "Previous",
    next: "Next",
    // The last slide's way forward: the round chevron becomes this pill.
    bookCall: "Book a discovery call",
    // The process slider: the title and lead are its first slide, then
    // one slide per phase: `head` is the big title, `rest` the line under it.
    phases: [
      {
        head: "A discovery call with your team.",
        rest: "We meet your team, map the best opportunities for AI and get a clear view of where it adds the most value.",
      },
      {
        head: "A 4-week paid pilot.",
        rest: "We pick one use case with one team, build the agents with them and deliver value in 1 month.",
      },
      {
        head: "Your systems and data, connected.",
        rest: "During the pilot we connect your systems and your data, so the agents work on the real thing from day one.",
      },
      {
        head: "We measure the value, then expand.",
        rest: "We review the results with you and roll the agents out to the rest of the company, team by team.",
      },
    ],
  },

  contact: {
    title: "Let's build this together.",
    lead: "Book a discovery call with our team. We look at your operation with you and tell you where AI pays off first.",
    cta: "Book a discovery call",
    mailSubject: "Houston discovery call",
    peopleLabel: "The team you will talk to",
    linesLabel: "Write or call us",
  },
};
