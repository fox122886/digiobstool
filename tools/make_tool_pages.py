# 由 index.html 產生各工具的入口頁（utc/、atc/、dtc/、itc/）
# 修改 index.html 後請重新執行：python3 tools/make_tool_pages.py
import pathlib, re
ROOT = pathlib.Path(__file__).resolve().parent.parent
TOOLS = {
    'UTC': ('通用時間線標記', '用自訂按鈕記錄教學行為的起訖與次數，課後自動算出時間分配。'),
    'ATC': ('軼事記錄時間線標記', '隨時寫下觀察，每則自動標上開始與送出的課堂時間。'),
    'DTC': ('質量雙元時間線標記', '代碼按鈕與文字記錄並用，同時掌握時間分配與質性觀察。'),
    'ITC': ('間隔時間線標記', '時間抽樣：輪流觀察每位學生是否在工作中，可用座位表、標記教學活動。'),
    'PTC': ('教師移動路徑標記', '在教室圖上點出老師的移動路線與師生討論，分析巡視的空間與時間分布。'),
}
src = (ROOT / 'index.html').read_text(encoding='utf-8')
for tool, (name, desc) in TOOLS.items():
    s = src.replace('<html lang="zh-Hant-TW">', f'<html lang="zh-Hant-TW" data-tool="{tool}">', 1)
    # 讓頁面上所有相對路徑（css、js、圖示、manifest）都指回上一層
    s = s.replace('<meta charset="utf-8">\n', '<meta charset="utf-8">\n<base href="../">\n', 1)
    s = re.sub(r'<title>.*?</title>', f'<title>{tool} {name}｜數位觀課工具</title>', s, count=1)
    s = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{tool} {name}：{desc}可離線使用、自動保存。">', s, count=1)
    out = ROOT / tool.lower() / 'index.html'
    out.parent.mkdir(exist_ok=True)
    out.write_text(s, encoding='utf-8')
    print('wrote', out.relative_to(ROOT))
