# python3 test/browser.py  — index.html을 열어 실제로 눌러 가며 두어 봄
import sys, os, json
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = 'file://' + ROOT + '/index.html'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
errors = []

def click_cell(page, i):
    # 판 좌표 → 화면 좌표
    pos = page.evaluate("""(i) => { const svg = document.getElementById('board'); const vb = svg.viewBox.baseVal; const r = svg.getBoundingClientRect();
      const n = Math.round((vb.width - 2*(vb.width>700? 54:34)) / 40) + 1; return null; }""", i)
    box = page.evaluate("""(i) => { const svg = document.getElementById('board'); const W = svg.viewBox.baseVal.width; const r = svg.getBoundingClientRect();
      const lines = svg.querySelectorAll('line'); const m = +lines[0].getAttribute('x1'); const n = Math.round((W - 2*m)/40) + 1;
      const k = r.width / W; return { x: r.left + (m + (i % n) * 40) * k, y: r.top + (m + Math.floor(i / n) * 40) * k, n }; }""", i)
    page.mouse.click(box['x'], box['y'])

def state(page):
    return page.evaluate("JSON.parse(localStorage.getItem('omok-v1')||'{}')")

def my_move(page, color, n, rules, level='mid'):
    return page.evaluate("""([c, rules, level]) => { const st = JSON.parse(localStorage.getItem('omok-v1')); const g = OM.newGame(rules); for (const i of st.game.moves) OM.play(g, i);
      return OMAI.think({ board: g.board, n: g.n, rules: g.rules, color: c, level, time: 200 }).move; }""", [color, rules, level])

def play_full(page, me, rules, level):
    for step in range(200):
        page.wait_for_function("() => !document.querySelector('.pl.thinking') || !document.getElementById('result').hidden", timeout=20000)
        if not page.is_hidden('#result'):
            return page.inner_text('#result h2')
        st = state(page)
        mv = my_move(page, me, rules['size'], rules, level)
        click_cell(page, mv)
        page.wait_for_timeout(60)
    return 'timeout'

with sync_playwright() as p:
    b = p.chromium.launch()
    for scheme, vp, name in [('light', {'width': 1280, 'height': 820}, 'pc'), ('dark', {'width': 390, 'height': 844}, 'phone')]:
        ctx = b.new_context(viewport=vp, color_scheme=scheme, has_touch=(name == 'phone'), is_mobile=(name == 'phone'))
        page = ctx.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
        page.goto(URL)
        page.wait_for_timeout(300)
        page.screenshot(path=f'{OUT}/setup-{name}.png', full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '가로 넘침(설정)'
        if name == 'phone':
            # 휴대폰: 한 번 더 눌러 놓기 켜짐 → 끄고 시작
            page.click('#tl-confirm + button')
        # 초급, 흑, 렌주
        page.click('.lv >> nth=0')
        page.click('#btnStart')
        page.wait_for_timeout(300)
        rules = {'preset': 'renju', 'size': 15}
        r = play_full(page, 1, rules, 'high')
        print(name, '초급 상대 결과:', r, '/ 수:', page.evaluate("document.querySelectorAll('#board g circle').length"))
        page.screenshot(path=f'{OUT}/end-{name}.png')
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '가로 넘침(대국)'
        # 판 다시 보기 → 무르기 → 계속 두기
        page.click('#rLook')
        page.click('#btnUndo')
        page.wait_for_timeout(200)
        assert page.is_hidden('#result'), '무르기 뒤 결과창'
        print(name, '무르기 후 상태:', page.inner_text('#status').replace('\n', ' '))
        # 힌트
        page.click('#btnHint')
        page.wait_for_selector('.hintpulse', timeout=8000)
        print(name, '힌트 표시 됨')
        # 처음으로 → 이어서 두기
        page.click('#btnMenu')
        assert page.is_visible('#btnResume'), '이어서 두기 버튼'
        page.reload()
        page.wait_for_timeout(300)
        page.click('#btnResume')
        page.wait_for_timeout(300)
        n1 = len(state(page)['game']['moves'])
        print(name, '새로고침 후 이어서:', n1, '수')
        # 기권
        page.click('#btnResign'); page.click('#btnResign')
        page.wait_for_selector('#result .card')
        print(name, '기권 →', page.inner_text('#result h2'))
        page.click('#rMenu')
        ctx.close()

    # 고급 컴퓨터가 흑(나는 백), 19줄 일반룰, 금수/수 번호/좌표 켬
    ctx = b.new_context(viewport={'width': 1100, 'height': 760})
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.click('.lv >> nth=2')
    page.click('#segSide button >> nth=1')
    page.click('#setupRules .rc-preset button >> nth=1')
    page.click('#setupRules .rc-size button >> nth=1')
    page.click('#tl-showNum + button'); page.click('#tl-coords + button')
    page.click('#btnStart')
    r = play_full(page, 2, {'preset': 'normal', 'size': 19}, 'mid')
    print('19줄 고급(흑) 대 나(백·중급 실력):', r)
    page.screenshot(path=f'{OUT}/end-19.png')
    ctx.close()

    # 둘이서 (한 기기): 이름 넣고 끝까지, 무르기 한 수
    ctx = b.new_context(viewport={'width': 400, 'height': 860})
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(URL)
    page.click('#modes button >> nth=1')
    page.fill('#nameB', '아빠'); page.fill('#nameW', '지우')
    page.click('#tl-confirm + button') if page.get_attribute('#tl-confirm + button', 'aria-pressed') == 'true' else None
    page.click('#btnStart')
    page.wait_for_timeout(200)
    assert '아빠 차례' in page.inner_text('#status'), page.inner_text('#status')
    for step in range(300):
        if not page.is_hidden('#result'): break
        mv = page.evaluate("() => { const o = window.__omok; const g = OM.newGame(o.rules); for (const i of o.moves) OM.play(g, i); return OMAI.think({ board: g.board, n: g.n, rules: g.rules, color: g.turn, level: 'mid', time: 100 }).move; }")
        if step == 6:
            page.click('#btnUndo'); page.wait_for_timeout(50)
            assert len(page.evaluate('window.__omok.moves')) == 5, '둘이서 무르기는 한 수만'
            continue
        click_cell(page, mv)
        page.wait_for_timeout(30)
    page.wait_for_selector('#result .card')
    print('둘이서:', page.inner_text('#result h2'), '/', page.inner_text('#status').split(chr(10))[0])
    page.screenshot(path=f'{OUT}/local-end.png')
    ctx.close()
    b.close()

print('오류:', errors if errors else '없음')
sys.exit(1 if errors else 0)
