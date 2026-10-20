// The /enterprise hero reel: industries in pairs (the industry, then a person in it on a tablet), crossfading
// in order and looping.
//
// Markup (enterprise/hero.njk): #ent-reel holds one muted <video> per clip,
// in playing order, the first marked .is-on.
//
// Only the first clip's metadata loads with the page. Each next clip is asked
// to preload while the current one plays, so the reel costs one clip at a
// time. With reduced motion nothing plays and the first poster stands, which
// is also the JS-off picture.

(() => {
  const reel = document.getElementById("ent-reel");
  if (!reel) return;
  const clips = Array.from(reel.querySelectorAll("video"));
  if (!clips.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let current = 0;
  let onScreen = true;

  // Autoplay can be refused (iOS Low Power Mode, a browser setting). Then the
  // poster of the clip already on screen is the picture, which is fine: there
  // is nothing to report and nothing to retry.
  const play = (clip) => {
    const attempt = clip.play();
    if (attempt) attempt.catch(() => {});
  };

  const show = (index) => {
    clips.forEach((clip, i) => {
      clip.classList.toggle("is-on", i === index);
      if (i !== index) clip.pause();
    });
    current = index;
    const clip = clips[index];
    clip.currentTime = 0;
    if (onScreen && !document.hidden) play(clip);
    clips[(index + 1) % clips.length].preload = "auto";
  };

  // The next clip takes over a little before this one ends, so the crossfade
  // runs over two moving pictures rather than out of a frozen last frame.
  // `ended` stays as the backstop for a clip shorter than the lead.
  const LEAD = 0.9;
  clips.forEach((clip, i) => {
    clip.addEventListener("timeupdate", () => {
      if (i !== current || !clip.duration) return;
      if (clip.duration - clip.currentTime <= LEAD) {
        show((i + 1) % clips.length);
      }
    });
    clip.addEventListener("ended", () => {
      if (i === current) show((i + 1) % clips.length);
    });
  });

  // Nothing plays while the hero is off screen or the tab is hidden.
  const sync = () => {
    const clip = clips[current];
    if (onScreen && !document.hidden) play(clip);
    else clip.pause();
  };
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      onScreen = entries[0].isIntersecting;
      sync();
    }).observe(reel);
  }
  document.addEventListener("visibilitychange", sync);

  show(0);
})();
