# 作戦地図データ（docs/data/map.json）を生成する。射程帯は大圏距離を 500km ごとに切り上げた値。
# 使い方: python3 tools/mapgen.py
import json, math
BAND_KM = 500
areas = [
 # id, name, kind, owner, base, lon, lat
 ("KYU","九州","base","blue","hub",130.5,32.5),
 ("AMA","奄美","base","blue","spoke",129.5,28.3),
 ("OKI","沖縄","base","blue","hub",127.8,26.4),
 ("SAK","先島","base","blue","spoke",124.5,24.5),
 ("OGA","小笠原・硫黄島","base","blue","spoke",141.8,26.0),
 ("LUZ","ルソン北部","base","neutral","spoke",121.2,17.5),
 ("ECC","華東沿岸","base","red","hub",121.0,29.5),
 ("SCC","華南沿岸","base","red","hub",114.5,23.0),
 ("HAI","海南島","base","red","hub",109.8,19.2),
 ("SPR","南沙諸島","base","red","spoke",114.5,10.0),
 ("ECS","東シナ海","contested",None,None,125.5,30.5),
 ("TWS","台湾海峡","contested",None,None,119.8,24.5),
 ("TWE","台湾東方海域","contested",None,None,123.5,22.5),
 ("BAS","バシー海峡","contested",None,None,121.0,20.5),
 ("PHS","フィリピン海","contested",None,None,130.0,21.0),
 ("SCN","南シナ海北部","contested",None,None,115.5,18.0),
 ("SCS","南シナ海南部","contested",None,None,112.5,14.0),
]
boxes = [
 # id, name, side, role, lon, lat (射程計算の基準点)
 ("B-REAR","後方航空基地（グアム・第二列島線）","blue","rear",144.8,13.5),
 ("B-HOME","本土後方（本州）","blue","rear",136.0,35.0),
 ("B-STO","スタンドオフ打撃（青）","blue","standoff",133.0,24.0),
 ("R-REAR","内陸後方基地","red","rear",114.0,28.0),
 ("R-STO","スタンドオフ打撃（赤）","red","standoff",117.5,26.5),
]
def km(a,b):
    R=6371; p1,p2=math.radians(a[1]),math.radians(b[1]); dl=math.radians(b[0]-a[0]); dp=p2-p1
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(h))
def band(d): return 0 if d<1 else max(1, math.ceil(d/BAND_KM))
xy=lambda lon,lat:(round((lon-105)*20+20),round((35-lat)*20+20))
pts={a[0]:(a[5],a[6]) for a in areas}; pts.update({b[0]:(b[4],b[5]) for b in boxes})
ids=list(pts)
out={"version":2,
 "note":"射程帯（band）は2点間の大圏距離を500kmごとに区切った値。x,y は試作用の画面座標（viewBox 0 0 860 560、経緯度の簡易投影）。マップ外ボックスは地図に描かないが、射程計算の基準点を持つ。",
 "bandKm":BAND_KM,
 "areas":[dict(id=a[0],name=a[1],kind=a[2],**({"owner":a[3],"base":a[4]} if a[2]=="base" else {}),lon=a[5],lat=a[6],x=xy(a[5],a[6])[0],y=xy(a[5],a[6])[1]) for a in areas],
 "offMapBoxes":[dict(id=b[0],name=b[1],side=b[2],role=b[3],lon=b[4],lat=b[5]) for b in boxes],
 "bands":{i:{j:band(km(pts[i],pts[j])) for j in ids} for i in ids}}
import os
DST=os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","docs","data","map.json")
json.dump(out,open(DST,"w"),ensure_ascii=False,indent=1)
for i in ["KYU","OKI","SAK","OGA","ECC","SCC","B-REAR","B-STO","R-STO","R-REAR"]:
    print(i, {j:out["bands"][i][j] for j in ["ECS","TWS","TWE","BAS","PHS","SCN","SCS","OKI","KYU","ECC","SCC","B-REAR"]})
print(json.dumps({a["id"]:[a["x"],a["y"]] for a in out["areas"]},ensure_ascii=False))
