"""Extract voter records (with box positions) from the Telugu GP voter-roll PDF.
Usage: python extract.py input.pdf out_dir"""
import sys, json, re, os, unicodedata
import pymupdf as fitz

def clean(t):
    t = unicodedata.normalize('NFC', t)
    # PyMuPDF sometimes duplicates Telugu vowel signs (e.g. శ్రీీ) - collapse repeats
    t = re.sub(r'([\u0C3E-\u0C56])\1+', r'\1', t)
    return re.sub(r'\s+', ' ', t).strip()

def page_words(page):
    out = []
    for b in page.get_text('dict')['blocks']:
        for l in b.get('lines', []):
            if abs(l['dir'][1]) > 0.1: continue          # rotated watermark
            for s in l['spans']:
                if s['size'] > 20 or not s['text'].strip(): continue
                x0, y0, x1, y1 = s['bbox']
                out.append((x0, y0, x1, y1, s['text']))
    return out

def lines_in(page, rect, cache={}):
    key = id(page)
    if key not in cache: cache.clear(); cache[key] = page_words(page)
    words = [w for w in cache[key] if fitz.Rect(w[:4]).intersects(rect)
             and rect.contains(fitz.Point((w[0]+w[2])/2, (w[1]+w[3])/2))]
    words.sort(key=lambda w: ((w[1]+w[3])/2, w[0]))
    lines, cur, cy = [], [], None
    for w in words:
        y = (w[1]+w[3])/2
        if cy is None or abs(y-cy) > 3.5:
            if cur: lines.append(cur)
            cur, cy = [w], y
        else:
            cur.append(w)
    if cur: lines.append(cur)
    return [clean(' '.join(x[4] for x in sorted(l, key=lambda w: w[0]))) for l in lines]

def val(s):
    return s.split(':', 1)[1].strip() if ':' in s else ''

def main(src, out):
    doc = fitz.open(src)
    recs = []
    pages = []
    for pi, page in enumerate(doc):
        W, H = page.rect.width, page.rect.height
        pages.append({'w': W, 'h': H})
        head = page.get_text('text', clip=fitz.Rect(400, 60, W, 102))
        m = re.search(r':\s*([0-9]+)', head)
        ward = m.group(1) if m else ''
        boxes = [d['rect'] for d in page.get_drawings()
                 if 150 < d['rect'].width < 200 and 55 < d['rect'].height < 100]
        seen = set()
        for r in sorted(boxes, key=lambda r: (round(r.y0), r.x0)):
            k = (round(r.x0), round(r.y0))
            if k in seen: continue
            seen.add(k)
            L = lines_in(page, r)
            txt = '\n'.join(L)
            if 'ఓటరు' not in txt: continue
            rec = {'page': pi + 1, 'ward': ward,
                   'box': [round(r.x0/W, 4), round(r.y0/H, 4), round(r.width/W, 4), round(r.height/H, 4)]}
            L = [re.sub(r'\s*\.\s*', '.', x) for x in L]
            j = ' | '.join(L)
            m = re.search(r'జా\.వ\.సం\.\s*([0-9]+)\s*అ', j); rec['sl'] = int(m.group(1)) if m else None
            m = re.search(r'అ\.ఓ\.జా\.వ\.సం\.\s*([0-9]+\s*-\s*[0-9]+\s*-\s*[0-9]+)', j)
            rec['ac'] = re.sub(r'\s', '', m.group(1)) if m else ''
            # name / relation: walk the lines between "ఓటరు పేరు" and "వయస్సు"
            name, rel, rtype, mode = [], [], '', None
            for x in L:
                if x.startswith('వయస్సు'): break
                if x.startswith('ఓటరు పేరు') or x.startswith('ఓటరుపేరు'):
                    mode = 'n'; x = re.sub(r'^ఓటరు\s*పేరు', '', x)
                elif mode == 'n' and (re.match(r'^(తండ్రి|భర్త|తల్లి|ఇతర|ఇతరులు)', x) or x.startswith(':')):
                    mode = 'r'
                    mm = re.match(r'^(తండ్రి|భర్త|తల్లి|ఇతర\S*)', x)
                    rtype = {'తండ్రి': 'F', 'భర్త': 'H', 'తల్లి': 'M'}.get(mm.group(1) if mm else '', 'O')
                    x = re.sub(r'^\S*\s*పేరు', '', x)
                if mode == 'n': name.append(x)
                elif mode == 'r': rel.append(x)
            rec['name'] = clean(' '.join(name).replace(':', ''))
            rec['rel'] = clean(' '.join(rel).replace(':', ''))
            rec['rtype'] = rtype
            m = re.search(r'వయస్సు\s*:?\s*([0-9]+)', j); rec['age'] = int(m.group(1)) if m else None
            m = re.search(r'లింగము\s*:\s*([^|]+)', j); g = m.group(1) if m else ''
            rec['g'] = 'F' if 'స్త్ర' in g or g.strip().startswith('స్') else ('M' if 'పు' in g else '')
            m = re.search(r'ఇంటి\s*సంఖ్య\s*:\s*([^|]+)', j); rec['house'] = clean(m.group(1)) if m else ''
            m = re.search(r'\b([A-Z]{2,4}[0-9]{6,8})\b', j); rec['epic'] = m.group(1) if m else ''
            # strip stray watermark fragments (uppercase letters) from Telugu fields
            for k in ('name', 'rel'):
                rec[k] = clean(re.sub(r'\b[A-Z]{1,6}\b', '', rec[k]).replace(':', ''))
            recs.append(rec)
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, 'voters.json'), 'w', encoding='utf-8') as f:
        json.dump({'pages': pages, 'voters': recs}, f, ensure_ascii=False, separators=(',', ':'))
    print('voters', len(recs))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
