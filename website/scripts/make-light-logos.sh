#!/bin/sh
# Builds the light logo set for the /enterprise proof band, which sits on
# black. Every source mark (src/assets/img/enterprise/logos/) is dark
# monochrome artwork on transparency; a CSS knock-out (brightness 0, invert)
# flattened their second tones and frayed their edges. Instead each pixel
# becomes white, and how dark it was becomes how opaque it is: the darkest
# strokes turn solid white, lighter grays turn partly see-through white, and
# anti-aliased edges keep their softness. Anything darker than about #373737
# counts as full strength (the /200).
#
# Needs ffmpeg. Run from website/ after adding or changing a logo:
#   sh scripts/make-light-logos.sh
set -eu
src=src/assets/img/enterprise/logos
out=src/assets/img/enterprise/logos-light
mkdir -p "$out"
for f in "$src"/*.png; do
  ffmpeg -loglevel error -y -i "$f" -vf \
    "format=rgba,geq=r='255':g='255':b='255':a='min(255,alpha(X,Y)*(255-(0.299*r(X,Y)+0.587*g(X,Y)+0.114*b(X,Y)))/200)'" \
    "$out/$(basename "$f")"
done
echo "light logos: $(ls "$out" | wc -l)"
