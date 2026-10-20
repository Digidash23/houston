# /enterprise hero reel

Eight clips, played in the order of `reel` in `src/_data/enterprise.js` and
looped: industries in pairs, the industry and then a person in it working
on a tablet. Each `<id>.mp4` is a 3.8 s muted H.264 cut (1280x720, CRF 27,
faststart) and `<id>.webp` is its first frame, used as the poster. The ids
are where each clip came from, not where it plays.

All clips are Mixkit stock under the Mixkit Stock Video Free License
(free for commercial use, no attribution required; do not redistribute the
files as stock): https://mixkit.co/license/#videoFree

| clip | Mixkit clip | cut |
| --- | --- | --- |
| logistics-1 | 31011 "Shanghai container port and cranes working" | 0-3.8 s |
| factory-tablet | 23398 "Man using a tablet in an industrial environment" | 4-7.8 s |
| energy-windfarm | 34101 "Flying over a wind farm on a sunny day" | 4-7.8 s |
| field-tablet | 24129 "Woman using a tablet in a wind turbine field" | 2-5.8 s |
| retail-shelves | 6102 "Grocery store products on shelves" | 0-3.8 s |
| grocery-tablet | 5929 "Grocery store staff with a tablet" | 2-5.8 s |
| warehouse-dock | 31664 "Cargo trucks in the warehouse parking lot" | 0-3.8 s |
| inspectors-tablet | 33291 "Quality inspectors reviewing reports on a tablet" | 2-5.8 s |

Re-cut one with:

```sh
ffmpeg -ss <start> -t 3.8 -i <mixkit-720.mp4> -an \
  -vf "scale=1280:720,eq=saturation=0.78:contrast=1.06" \
  -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p -movflags +faststart <id>.mp4
ffmpeg -i <id>.mp4 -frames:v 1 -c:v libwebp -quality 72 <id>.webp
```

The shared grade (a little less saturation, a little more contrast) is what
makes eight different shoots read as one reel under the hero's scrim.
