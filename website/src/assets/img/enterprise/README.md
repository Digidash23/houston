# /enterprise photographs

One series: a single plain object against a plain ground (mostly sky), so
each tile reads at a glance and the set reads as one. Every photo is from
Unsplash under the Unsplash License (free for commercial use, no attribution
required), cropped and given the same light grade:

```
ffmpeg -i <photo> -vf "scale=W:H:force_original_aspect_ratio=increase,crop=W:H,\
eq=saturation=0.9:contrast=1.03,noise=alls=3:allf=t" ...
```

then WebP at quality 78: `industries/` at 1080x810, `problem/` at 960x960.

| file | source (images.unsplash.com) |
| --- | --- |
| industries/logistics | photo-1650809989861-6821ab606df3 (blue container) |
| industries/real-estate | photo-1548990044-11586bc151f2 (white balconies) |
| industries/retail | photo-1561365452-adb940139ffa (shirts on hangers) |
| industries/banking | photo-1574655110881-40726d522a07 (lone tower) |
| industries/insurance | photo-1504308037423-9695786c6d43 (orange umbrella) |
| industries/manufacturing | photo-1583343158973-04f223f09d48 (three chimneys) |
| problem/owns | photo-1590945213328-ab2d0bbd1e88 (empty office chair) |
| problem/build | photo-1762248576542-f98e883f3fbd (bare scaffolding) |
| problem/connected | photo-1569925457326-59b1c3611227 (bridge that does not meet) |
| problem/followthrough | photo-1663687060181-13c7292c8d8e (stairs that end in the air) |

`logos/` are the customer marks as supplied; `logos-light/` is generated
from them by `scripts/make-light-logos.sh`.
