// node build.js → index.html (GitHub Pages용 완성본), dist/omok.html (아티팩트)
const fs = require('fs');
const core = fs.readFileSync(__dirname + '/src/engine.js', 'utf8') + '\n' + fs.readFileSync(__dirname + '/src/ai.js', 'utf8');
const ui = fs.readFileSync(__dirname + '/src/ui.html', 'utf8');
const body = ui.replace('<!--CORE-->', () => '<script id="core">\n' + core + '\n</script>');
fs.mkdirSync(__dirname + '/dist', { recursive: true });
fs.writeFileSync(__dirname + '/dist/omok.html', body);
const head = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="컴퓨터(초급·중급·고급)와 두는 오목. 렌주룰·일반룰·자유룰과 금수 표시.">
<meta property="og:title" content="한판 오목">
<meta property="og:description" content="컴퓨터와 한 판. 다섯 알을 먼저 이으면 이겨요.">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);box-sizing:border-box}body{margin:0;font:14px system-ui,sans-serif}[hidden]{display:none!important}</style>
`;
const [titleEnd] = [body.indexOf('</style>') + 8];
fs.writeFileSync(__dirname + '/index.html', head + body.slice(0, titleEnd) + '\n</head>\n<body>\n' + body.slice(titleEnd) + '\n</body>\n</html>\n');
console.log('index.html', fs.statSync(__dirname + '/index.html').size, 'bytes / dist/omok.html', fs.statSync(__dirname + '/dist/omok.html').size, 'bytes');
