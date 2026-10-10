"""公开漫画站点访问核对：只取 HTML，不登录、不下载漫画或执行站点脚本；结果不能代表翻译通过。"""
import argparse
import concurrent.futures
import hashlib
import html
import json
import re
import subprocess
import time
import urllib.error
import urllib.parse
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--catalog', default='src/core/config/mangaSiteCatalog.ts')
parser.add_argument('--artifacts-dir', required=True)
parser.add_argument('--hosts', help='Comma-separated host subset; omission checks the entire requested catalog')
args = parser.parse_args()
output = Path(args.artifacts_dir)
output.mkdir(parents=True, exist_ok=True)
catalog = Path(args.catalog).read_text().split('MANGA_SITE_DOMAINS = `', 1)[1].split('`', 1)[0]
hosts = sorted(set(args.hosts.split(',') if args.hosts else catalog.split()))

def probe(host):
    started = time.time()
    href = 'https://' + host.encode('idna').decode('ascii') + '/'
    result = {'hostname': host, 'requestedUrl': href, 'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    try:
        # 系统 curl 使用系统证书库，避免本地 Python 缺少根证书将所有域名误报为不可达。
        html_file = output / (href.split('/')[2] + '.html')
        response = subprocess.run(['/usr/bin/curl', '--silent', '--show-error', '--location', '--max-redirs', '5',
            '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '8', '--max-time', '18',
            '--max-filesize', '2000000', '--user-agent', 'Mozilla/5.0 FluentReadSiteCompatibilityCheck/1.0',
            '--header', 'Accept: text/html', '--output', str(html_file), '--write-out', '%{http_code}\n%{url_effective}\n%{content_type}', href],
            capture_output=True, text=True, timeout=22)
        if response.returncode:
            raise RuntimeError(response.stderr.strip())
        code, final_url, content_type = response.stdout.split('\n', 2)
        result.update(status=int(code), finalUrl=final_url, contentType=content_type)
        body = html_file.read_bytes()
        text = body.decode('utf-8', errors='replace')
        title = re.search(r'<title[^>]*>([\s\S]*?)</title>', text, re.I)
        result['title'] = html.unescape(re.sub('<[^>]+>', '', title[1])).strip()[:180] if title else ''
        result['state'] = 'challenge' if re.search(r'Just a moment|Verify you are human|Checking your browser|Access Denied', result['title'], re.I) else 'html-accessible'
        if 'text/html' not in result['contentType']:
            result['state'] = 'non-html'
        if result['status'] >= 400:
            result['state'] = 'access-restricted' if result['status'] in (401, 403, 429, 451) else 'http-error'
        result['htmlSha256'] = hashlib.sha256(body).hexdigest()
        links = []
        for candidate in re.findall(r'<a\b[^>]*\bhref=["\']([^"\']+)', text, re.I):
            url = urllib.parse.urljoin(result['finalUrl'], html.unescape(candidate))
            if urllib.parse.urlsplit(url).hostname != urllib.parse.urlsplit(result['finalUrl']).hostname:
                continue
            if re.search(r'chapter|episode|viewer|/read/|/view/|/comic/|/webtoon/', url, re.I) and url not in links:
                links.append(url)
        result['readerLinks'] = links[:12]
        (output / (href.split('/')[2] + '.html')).write_bytes(body)
    except urllib.error.HTTPError as error:
        result.update(status=error.code, state='access-restricted' if error.code in (401, 403, 429, 451) else 'http-error', error=str(error))
    except Exception as error:
        result.update(state='unreachable', error=str(error)[:220])
    result['elapsedSeconds'] = round(time.time()-started, 2)
    return result

results = []
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
    for result in pool.map(probe, hosts):
        results.append(result)
        (output / 'site-probe.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
        print(result['hostname'], result['state'], result.get('status', ''), flush=True)
print(json.dumps({'total': len(results), 'states': {state: sum(r['state'] == state for r in results) for state in sorted(set(r['state'] for r in results))}}))
