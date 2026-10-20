// The /enterprise page's tone flow, the way mercury.com moves: one page, one
// ground. Every section after the hero says which tone it is (data-tone);
// whichever section holds the middle of the screen sets the tone of the
// whole page, and the ground, the type, the cards and the nav all fade to it
// together (enterprise-flow.css), instead of hard black and white bands.
//
// The flip reuses the sections' own dark dress: every flowing section wears
// .is-dark while the page is dark and drops it while the page is light, so
// a section half on screen when the tone turns still reads. The hero keeps
// its own film, and the logo band (data-tone-fixed) and the footer keep
// theirs.
//
// Also: Lenis smooth scrolling, the same feel and setting as the landing's
// hero (assets/hero-motion.js), with in-page anchors going through it.
// Reduced motion keeps native scrolling, and the flip happens without fades.
// No JS, or no IntersectionObserver: the page stands in its authored bands.

(() => {
  const html = document.documentElement;
  const zones = Array.from(document.querySelectorAll("main [data-tone]"));
  if (!zones.length || !("IntersectionObserver" in window)) return;
  const flowing = zones.filter(
    (zone) =>
      zone.classList.contains("section") &&
      !zone.hasAttribute("data-tone-fixed"),
  );

  let tone = "";
  const apply = (next) => {
    if (!next || next === tone) return;
    tone = next;
    const dark = next === "dark";
    html.classList.toggle("ent-tone-dark", dark);
    for (const zone of flowing) zone.classList.toggle("is-dark", dark);
    document.dispatchEvent(new CustomEvent("ent:tone", { detail: next }));
  };

  html.classList.add("ent-flow");
  // A zero-height line across the middle of the screen: the section it
  // crosses is the one the visitor is reading.
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) apply(entry.target.getAttribute("data-tone"));
      }
    },
    { rootMargin: "-50% 0px -50% 0px" },
  );
  for (const zone of zones) io.observe(zone);

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || typeof window.Lenis !== "function") return;
  const lenis = new window.Lenis({
    lerp: 0.11,
    smoothWheel: true,
    anchors: true,
    autoRaf: true,
  });
  window.lenis = lenis;
})();
