from PIL import Image, ImageDraw, ImageFont
import random, math
random.seed(7)
S="/System/Library/Fonts/"
# (a) slide 1568x882
im=Image.new("RGB",(1568,882),"white"); d=ImageDraw.Draw(im)
d.rectangle([0,0,1568,110],fill=(20,60,120))
d.text((50,25),"Beta-Blocker Dosing Review",font=ImageFont.truetype(S+"Helvetica.ttc",58),fill="white")
f=ImageFont.truetype(S+"Helvetica.ttc",40); fb=ImageFont.truetype(S+"Helvetica.ttc",40,index=1)
rows=[("Drug","Usual dose","Max/day"),("Veloprol","12.5 mg BID","50 mg"),("Zantrexal","0.25 mg QD","1.5 mg"),("Corbimide","5 mg TID","30 mg")]
y=170
for i,r in enumerate(rows):
    x=60
    for w,c in zip((500,500,400),r):
        d.text((x,y),c,font=fb if i==0 else f,fill="black"); x+=w
    d.line([50,y+60,1500,y+60],fill=(120,120,120),width=2 if i else 4); y+=80
g=ImageFont.truetype(S+"Helvetica.ttc",34)
d.text((60,560),"Contraindicated in sick sinus syndrome; titrate q2 weeks.",font=g,fill="black")
d.text((60,620),"Monitor heart rate < 55 bpm and K+ 3.5-5.0 mEq/L.",font=g,fill="black")
im.save("images/slide.png")
# (b) handwriting-like
lines=["Pt: 68 yo, wt 72.5 kg","Dose = 0.4 mg/kg q8h","Hold if HR < 55","Renal: CrCl 45.5 mL/min"]
W,H=1400,900
im=Image.new("RGB",(W,H),(252,250,240)); d=ImageDraw.Draw(im)
for yy in range(120,H,90): d.line([40,yy,W-40,yy],fill=(190,205,230),width=2)
fh=ImageFont.truetype(S+"Supplemental/Bradley Hand Bold.ttf",62)
y=60
for ln in lines:
    x=70
    for ch in ln:
        lay=Image.new("RGBA",(120,140),(0,0,0,0)); ld=ImageDraw.Draw(lay)
        ld.text((20,30),ch,font=fh,fill=(25,35,110,255))
        lay=lay.rotate(random.uniform(-5,5),resample=Image.BICUBIC)
        im.paste(lay,(int(x-20),int(y-30+random.uniform(-5,5))),lay)
        x+=d.textlength(ch,font=fh)+random.uniform(-1,3)
    y+=110
im.save("images/handwritten.png")
# (c) big.png (not committed, 7.8 MB) for limit testing
import os
from PIL import ImageFilter
n=Image.frombytes("RGB",(500,333),os.urandom(500*333*3)).resize((3000,2000),Image.BICUBIC).filter(ImageFilter.GaussianBlur(3))
d=ImageDraw.Draw(n); d.rectangle([200,800,2800,1200],fill="white")
d.text((250,850),"BIG PAGE CODE: ZEBRA-4417",font=ImageFont.truetype(S+"Helvetica.ttc",150),fill="black")
n.save("images/big.png")
