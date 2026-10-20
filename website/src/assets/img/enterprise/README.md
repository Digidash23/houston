# /enterprise photographs

One series: everything seen from straight above, the way Houston (mission
control) sees the world's work. Every photo is from Unsplash under the
Unsplash License (free for commercial use, no attribution required), cropped
and given the same grade so they read as one set:

```
ffmpeg -i <photo> -vf "scale=W:H:force_original_aspect_ratio=increase,crop=W:H,\
eq=saturation=0.78:contrast=1.05:gamma=0.97,\
colorbalance=rs=0.03:bs=-0.03:rm=0.02:bm=-0.02,noise=alls=5:allf=t" ...
```

then WebP at quality 76: `industries/` at 1080x810, `problem/` at 960x720.

| file | Unsplash photo |
| --- | --- |
| industries/logistics | 9cCeS9Sg6nU (container yard) |
| industries/real-estate | 4nuCGapo4Zs (cul-de-sac) |
| industries/retail | y8zrMHyw62Y (market canopies) |
| industries/banking | b6i9pe16pAg (city grid at night) |
| industries/insurance | Jt9syHEhrPE (cloverleaf interchange) |
| industries/manufacturing | _EFvjSgbw1c (factory roof) |
| problem/owns | wLEXaqnQY08 (one car, empty lot) |
| problem/build | RzMGvgU13iE (bricks and sand, no builder) |
| problem/connected | p8XyPr3uN_o (roundabout, roads end in sand) |
| problem/followthrough | atX7diX9UNQ (site taken back by the forest) |

Each id opens at `https://unsplash.com/photos/<id>`.

`logos/` are the customer marks as supplied; `logos-light/` is generated
from them by `scripts/make-light-logos.sh`.
