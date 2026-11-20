# Whether two renders draw the same line shapes (ignoring points in the middle of straight runs):
# python3 same-shape.py old.svg new.svg [old2.svg new2.svg ...]
import re, sys
def norm(d):
    pts=[(float(a),float(b)) for a,b in re.findall(r'[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)', d)]
    out=[]
    for p in pts:
        if out and abs(out[-1][0]-p[0])<0.02 and abs(out[-1][1]-p[1])<0.02: continue
        if len(out)>=2:
            a,b=out[-2],out[-1]
            if (abs(a[0]-b[0])<0.02 and abs(b[0]-p[0])<0.02) or (abs(a[1]-b[1])<0.02 and abs(b[1]-p[1])<0.02):
                out[-1]=p; continue
        out.append(p)
    return out
for old,new in zip(sys.argv[1::2], sys.argv[2::2]):
    A=open(old).read(); B=open(new).read()
    pa=re.findall(r'data-id="edge-(s\d+)"[^>]*>\s*<path d="([^"]+)"',A); pb=dict(re.findall(r'data-id="edge-(s\d+)"[^>]*>\s*<path d="([^"]+)"',B))
    shape=[k for k,d in pa if norm(d)!=norm(pb.get(k,''))]
    hops=[k for k,d in pa if d.count('A')!=pb.get(k,'').count('A')]
    rest = re.sub(r'<path d="[^"]*"','',A)==re.sub(r'<path d="[^"]*"','',B)
    print(old.split('/')[-1], 'shape-diff', shape, 'hop-diff', hops, 'rest-same', rest)
