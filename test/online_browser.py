# 로컬 서버(npx wrangler dev --port 8788)에 브라우저 둘로 붙어 온라인 대국을 끝까지
#   python3 test/online_browser.py [스크린샷 폴더]
import sys, os, re
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
BASE = os.environ.get('BASE', 'http://127.0.0.1:8788')
html = open(ROOT + '/index.html', encoding='utf8').read()
html = re.sub(r'const SERVER = "[^"]*";', f'const SERVER = "{BASE}";', html)
TEST = OUT + '/omok-online.html'
open(TEST, 'w', encoding='utf8').write(html)
URL = 'file://' + TEST
errors = []

def cell(page, i):
    return page.evaluate("""(i) => { const svg = document.getElementById('board'); const W = svg.viewBox.baseVal.width; const r = svg.getBoundingClientRect();
      const m = +svg.querySelector('line').getAttribute('x1'); const n = Math.round((W - 2*m)/40) + 1;
      const k = r.width / W; return { x: r.left + (m + (i % n) * 40) * k, y: r.top + (m + Math.floor(i / n) * 40) * k }; }""", i)

def click(page, i):
    p = cell(page, i); page.mouse.click(p['x'], p['y'])

def room(page): return page.evaluate('window.__omok.room')

def best(page, level='low'):
    return page.evaluate("""(lv) => { const o = window.__omok; const g = OM.newGame(o.rules); for (const i of o.moves) OM.play(g, i);
      return OMAI.think({ board: g.board, n: g.n, rules: g.rules, color: g.turn, level: lv, time: 80 }).move; }""", level)

def mover(A, B):
    r = room(A)
    turn = A.evaluate('window.__omok.turn')
    return A if r['colors'][A.evaluate('window.__omok.seat')] == turn else B

def wait_moves(page, n, ms=6000):
    page.wait_for_function(f"() => window.__omok.room && window.__omok.room.game && (window.__omok.room.game.moves.length >= {n} || window.__omok.room.status !== 'playing')", timeout=ms)

with sync_playwright() as p:
    b = p.chromium.launch()
    ca = b.new_context(viewport={'width': 1200, 'height': 820})
    cb = b.new_context(viewport={'width': 390, 'height': 844}, color_scheme='dark', has_touch=True, is_mobile=True)
    A, B = ca.new_page(), cb.new_page()
    for pg in (A, B):
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.on('console', lambda m: m.type == 'error' and 'TUNNEL' not in m.text and errors.append(m.text))
    # A: 방 만들기
    A.goto(URL)
    A.click('#modes button >> nth=2')
    A.fill('#myName', '주원')
    A.click('#btnCreate')
    A.wait_for_selector('#room:not([hidden])')
    code = A.inner_text('#roomCode')
    print('방 만듦', code)
    # B: 초대 링크로 → 이름 적고 들어가기
    B.goto(URL + '#' + code)
    B.wait_for_timeout(300)
    assert '초대받은 방' in B.inner_text('#onMsg'), B.inner_text('#onMsg')
    B.fill('#myName', '지우')
    if B.get_attribute('#tl-confirm + button', 'aria-pressed') == 'true': B.click('#tl-confirm + button')
    B.click('#btnJoin')
    B.wait_for_selector('#room:not([hidden])')
    A.wait_for_function("() => document.querySelectorAll('#seats .seat:not(.empty)').length === 2")
    A.screenshot(path=OUT + '/room-host.png', full_page=True)
    B.screenshot(path=OUT + '/room-guest.png', full_page=True)
    # 방장 설정: 일반룰, 제한 시간 60초, 방장 흑
    A.click('#roomRules .rc-preset button >> nth=1')
    A.click('#exTime button >> nth=3')
    A.click('#exColor button >> nth=1')
    B.wait_for_function("() => window.__omok.room.settings.preset === 'normal' && window.__omok.room.settings.turnSec === 60 && window.__omok.room.settings.color === 'black'")
    assert '일반룰' in B.inner_text('#roomRules')
    print('방장 설정이 손님 화면에 보임')
    A.click('#btnRoomStart')
    for pg in (A, B): pg.wait_for_selector('#play:not([hidden])')
    assert A.evaluate('window.__omok.me') == 1
    # 몇 수 두기
    for k in range(6):
        pg = mover(A, B)
        click(pg, best(pg))
        wait_moves(A, k + 1); wait_moves(B, k + 1)
    print('6수 둠, 양쪽 수 같음:', A.evaluate('window.__omok.moves') == B.evaluate('window.__omok.moves'))
    # 말하기
    A.click('#btnHint'); A.click('#says button >> nth=2')
    B.wait_for_selector('.bubble', timeout=3000)
    print('말하기 →', B.inner_text('.bubble'))
    # 무르기 요청 → 들어주기
    pg = mover(A, B); other = B if pg is A else A
    # 차례가 아닌 쪽(방금 둔 쪽)이 요청
    other.click('#btnUndo')
    pg.wait_for_selector('#ask:not([hidden])')
    pg.screenshot(path=OUT + '/ask.png')
    pg.click('#askYes')
    A.wait_for_function("() => window.__omok.room.game.moves.length === 5")
    print('무르기 들어줌 → 5수')
    # B 새로고침 → 같은 자리로 복귀
    B.reload()
    B.wait_for_selector('#play:not([hidden])', timeout=8000)
    B.wait_for_function("() => window.__omok.room && window.__omok.room.game.moves.length === 5")
    print('새로고침 후 복귀:', B.evaluate('window.__omok.seat'))
    # 끝까지
    for k in range(300):
        if room(A)['status'] != 'playing': break
        n = len(A.evaluate('window.__omok.moves'))
        pg = mover(A, B)
        click(pg, best(pg, 'mid'))
        wait_moves(A, n + 1)
    A.wait_for_selector('#result .card'); B.wait_for_selector('#result .card')
    print('결과: A', A.inner_text('#result h2'), '/ B', B.inner_text('#result h2'))
    A.screenshot(path=OUT + '/online-end-a.png'); B.screenshot(path=OUT + '/online-end-b.png')
    # 한 판 더 → 색 바뀜
    A.click('#rAgain')
    B.wait_for_selector('text=상대가 한 판 더를 눌렀어요')
    B.click('#rAgain')
    A.wait_for_function("() => window.__omok.room.round === 2 && window.__omok.room.status === 'playing'")
    assert A.evaluate('window.__omok.me') == 2, '색이 안 바뀜'
    print('한 판 더: 색 바뀜 (A 백)')
    # 기권 (두 번 눌러야)
    B.click('#btnResign'); B.wait_for_timeout(100)
    assert room(A)['status'] == 'playing'
    B.click('#btnResign')
    A.wait_for_selector('#result .card')
    print('기권 →', A.inner_text('#result h2'), A.inner_text('#result .card p >> nth=1'))
    # B 나가기 → A는 새 상대 기다리기
    B.click('#rLeave')
    B.wait_for_selector('#setup:not([hidden])')
    A.wait_for_selector('#rWait')
    A.click('#rWait')
    A.wait_for_selector('#room:not([hidden])')
    print('상대 나감 → 대기실')
    A.screenshot(path=OUT + '/online-wait.png', full_page=True)
    for pg in (A, B):
        assert pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), '가로 넘침'
    b.close()
print('오류:', errors if errors else '없음')
sys.exit(1 if errors else 0)
