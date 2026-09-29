# Turns the layered source art in /assets into the web images in /dist/assets.
# Needs Pillow, NumPy and SciPy:  pip install pillow numpy scipy  then  python tools/build-assets.py
import sys; sys.stdout.reconfigure(line_buffering=True)
from PIL import Image
import numpy as np
from scipy import ndimage as nd
import pathlib
ROOT=pathlib.Path(__file__).resolve().parent.parent
SRC=str(ROOT/'assets')+'/'
OUT=str(ROOT/'dist'/'assets')+'/'
import os; os.makedirs(OUT,exist_ok=True)

# --- background + front layer with screen hole
bg=Image.open(SRC+'bg.PNG').convert('RGB')
bg.save(OUT+'bg.webp',quality=86,method=4)
a=np.array(bg).astype(int); r,g,b=a[...,0],a[...,1],a[...,2]
cream=(r>150)&(g>135)&(b>100)&(abs(r-g)<55)&(r-b<90)
rect=np.zeros_like(cream); rect[112:604,160:1072]=True
m=cream&rect
m=nd.binary_closing(m,iterations=3)
lab,n=nd.label(m); sizes=nd.sum(m,lab,range(1,n+1)); m=lab==(1+int(np.argmax(sizes)))
m=nd.binary_fill_holes(m)
ys,xs=np.where(m); print('hole bbox',xs.min(),ys.min(),xs.max(),ys.max(),'size',bg.size)
alpha=np.where(m,0,255).astype(np.uint8)
alpha=np.array(Image.fromarray(alpha).filter(__import__('PIL.ImageFilter',fromlist=['x']).GaussianBlur(0.8)))
front=bg.copy(); front.putalpha(Image.fromarray(alpha))
# crop the front layer to the part that matters (screen region incl. head) to save bytes
front.save(OUT+'bg-front.webp',quality=86,method=4)

# --- reels
R=Image.open(SRC+'reels.PNG').convert('RGBA')
cuts=[0,303,611,925,1241,R.size[1]]
names=['singing','painting','craft','fashion','brewing']
for i,nm in enumerate(names):
    part=R.crop((0,cuts[i],R.size[0],cuts[i+1]))
    al=np.array(part)[...,3]
    ys,xs=np.where(al>8); box=(xs.min(),ys.min(),xs.max()+1,ys.max()+1)
    part=part.crop(box); print(nm,part.size)
    part.save(OUT+f'reel-{nm}.webp',quality=88,method=4)

# --- camera: remove baked checkerboard via flood fill from borders
C=Image.open(SRC+'camera.PNG').convert('RGB'); c=np.array(C).astype(int)
mx=c.max(2); mn=c.min(2)
bgish=(mn>185)&(mx-mn<22)
lab,n=nd.label(bgish)
edge=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))-{0}
mask=np.isin(lab,list(edge))
mask=nd.binary_opening(mask,iterations=1)
mask=nd.binary_dilation(mask,iterations=1)
al=np.where(mask,0,255).astype(np.uint8)
from PIL import ImageFilter
al=np.array(Image.fromarray(al).filter(ImageFilter.GaussianBlur(0.7)))
cam=C.convert('RGBA'); cam.putalpha(Image.fromarray(al))
ys,xs=np.where(al>20); cam=cam.crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1)); print('camera',cam.size,(xs.min(),ys.min()))
cam.save(OUT+'camera.webp',quality=88,method=4)

# --- title
T=Image.open(SRC+'text.PNG').convert('RGBA')
al=np.array(T)[...,3]; ys,xs=np.where(al>8); T=T.crop((xs.min(),ys.min(),xs.max()+1,ys.max()+1)); print('title',T.size)
T.save(OUT+'title.webp',quality=90,method=4)
