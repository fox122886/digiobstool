#!/usr/bin/env python3
"""資安自我檢查：在每個畫面塞入惡意字串，確認只會顯示成文字、不會變成 HTML 或執行；並測試匯入被竄改的備份檔會被擋下。

用法（在專案根目錄）：
  pip install playwright && playwright install chromium
  python tools/security_check.py
全部通過時最後一行是「通過」，結束代碼為 0。
"""
import subprocess, time, sys, json, os, tempfile
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get('PORT', '8835'))
BASE = f'http://127.0.0.1:{PORT}/index.html'
TMP = tempfile.mkdtemp()
CHECK = """() => {
  const bad = [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on/i.test(a.name)) || (e.tagName==='IMG' && e.getAttribute('src')==='x') || e.tagName==='IFRAME' || (e.tagName==='SCRIPT' && !e.src) || e.tagName.toLowerCase()==='xss');
  const shown = (document.body.innerText.match(/XSS測試/g)||[]).length;
  return { bad: bad.map(e=>e.outerHTML.slice(0,120)), shown, pwn: window.__pwn||0 };
}"""
results=[]
def chk(pg, where):
  r=pg.evaluate(CHECK); results.append((where,r)); print(f"{where:28s} 注入元素 {len(r['bad'])}  顯示惡意字串 {r['shown']:3d}  執行 {r['pwn']}", r['bad'][:2])
def xss_test(p):
  b=p.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':900}); errs=[]; csp=[]
  pg.on('pageerror', lambda e: errs.append(str(e)))
  pg.on('console', lambda m: csp.append(m.text) if 'Content Security Policy' in m.text else None)
  pg.goto(BASE); pg.wait_for_timeout(1200)
  pg.evaluate("""async()=>{
    const M=await import('./js/model.js');const P=await import('./js/ptcmodel.js');const {store}=await import('./js/store.js');
    const PAY='XSS測試"><img src=x onerror="window.__pwn=1"><xss>\\' onmouseover=\\'window.__pwn=2\\' <script>window.__pwn=3</script>&amp;';
    const KEYS=new Set(['label','text','act','title','school','className','subject','teacher','observer','note','focus','name']);
    const poison=(o,parent)=>{ if(Array.isArray(o)) return o.map((x)=>typeof x==='string' && parent==='acts' ? PAY+x : poison(x,parent));
      if(o&&typeof o==='object'){ for(const k in o){ const v=o[k];
        if(typeof v==='string' && (KEYS.has(k) || parent==='analysis')) o[k]=PAY+v; else o[k]=poison(v,k);} } return o; };
    for (const m of ['UTC','ATC','DTC','ITC','PTC']){
      const s=m==='PTC'?P.samplePTC():M.sampleSession(m); delete s.sample; s.meta.focus='焦點'; poison(s,'');
      s.id='x'+m; await store.put(s);
      const r=structuredClone(s); r.id='r'+m; r.status='recording'; r.clock.endedAt=null; await store.put(r);
    }}""")
  pg.reload(); pg.wait_for_timeout(1200); chk(pg,'首頁')
  for m in ['UTC','ATC','DTC','ITC','PTC']:
    pg.click(f'[data-act=open][data-id=x{m}]'); pg.wait_for_timeout(700); chk(pg,f'{m} 結果頁')
    for d in pg.query_selector_all('details'): d.evaluate('e=>e.open=true')
    pg.wait_for_timeout(200); chk(pg,f'{m} 結果頁（全部展開）')
    if pg.query_selector('[data-act=report]'):
      pg.click('[data-act=report]'); pg.wait_for_timeout(600); chk(pg,f'{m} 觀課重點摘要'); pg.click('[data-act=report-back]'); pg.wait_for_timeout(400)
    pg.click('[data-act=home]') if pg.query_selector('[data-act=home]') else pg.goto(BASE); pg.wait_for_timeout(600)
    el=pg.query_selector(f'[data-act=open][data-id=r{m}]')
    if el: el.click(); pg.wait_for_timeout(700); chk(pg,f'{m} 記錄中畫面')
    pg.goto(BASE); pg.wait_for_timeout(800)
  # 設定頁：手動輸入惡意代碼名稱
  pg.click('[data-act=new][data-mode=UTC]'); pg.wait_for_timeout(500)
  inp=pg.query_selector('[data-field=label]')
  if inp: inp.fill('XSS測試"><img src=x onerror="window.__pwn=9">'); pg.wait_for_timeout(300); pg.keyboard.press('Tab'); pg.wait_for_timeout(300)
  chk(pg,'UTC 設定頁（輸入代碼名稱）')
  b.close()
  return results, csp, errs

def import_test(p):
  msgs=[]
  b=p.chromium.launch(); pg=b.new_page(); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
  pg.goto(BASE); pg.wait_for_timeout(1000)
  good=pg.evaluate("""async()=>{const M=await import('./js/model.js');const P=await import('./js/ptcmodel.js');
    const ss=['UTC','ATC','DTC','ITC','PTC'].map(m=>m==='PTC'?P.samplePTC():M.sampleSession(m));
    ss.forEach(s=>{delete s.sample; s.meta.focus='焦點<b>'; s.meta.title+=' <i>斜體</i> & "引號"';}); return JSON.parse(JSON.stringify(ss));}""")
  bad=json.loads(json.dumps(good))
  bad[0]['codes'][0]['color']='red;}</style><img src=x onerror=alert(1)>'
  bad[1]['id']='"><img src=x onerror=alert(1)>'
  bad[2]['events'][0]['code']='x" onmouseover="alert(1)'
  bad[3]['itc']['layout']='<svg onload=alert(1)>'
  bad[4]['ptc']['room']['items'][0]['id']='a"b'
  json.dump(good,open(os.path.join(TMP,'good.json'),'w',encoding='utf-8'),ensure_ascii=False); json.dump(bad,open(os.path.join(TMP,'bad.json'),'w',encoding='utf-8'),ensure_ascii=False)
  for f in [os.path.join(TMP,'good.json'), os.path.join(TMP,'bad.json')]:
    pg.set_input_files('#imp', f); pg.wait_for_timeout(1200)
    msgs.append(pg.inner_text('#toast')); print(os.path.basename(f), '→', pg.inner_text('#toast'))
  n=pg.evaluate("async()=>{const {store}=await import('./js/store.js'); return (await store.all()).length}")
  print('資料庫內場次:', n, ' 錯誤:', errs)

  b.close()
  return msgs, n

srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
  with sync_playwright() as p:
    results, csp, errs = xss_test(p)
    msgs, n = import_test(p)
finally:
  srv.terminate()
injected = sum(len(r['bad']) for _, r in results)
ran = max(r['pwn'] for _, r in results)
ok = injected == 0 and ran == 0 and not errs and n == 5 and '沒有匯入' in msgs[1]
print(f"\n注入元素 {injected}、程式被執行 {ran}、CSP 攔截 {len(csp)}、頁面錯誤 {len(errs)}、正常備份匯入 {n}/5、竄改備份：{msgs[1]}")
print('通過' if ok else '未通過')
sys.exit(0 if ok else 1)
