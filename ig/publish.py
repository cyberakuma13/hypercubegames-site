"""Publish the next approved Star Squadron post to Instagram via the Graph API.

Usage:
  python3 publish.py --check            # verify token + account, no publish
  python3 publish.py --dry-run          # show what would post today
  python3 publish.py                    # publish today's approved post
  python3 publish.py --id 03_eisenkiesel --force   # publish a specific post now

Env / config (config.json next to this file):
  {"ig_user_id": "...", "access_token": "...", "image_base_url": "https://hypercubegames.com/ig/"}
Images must be publicly reachable JPEGs at image_base_url + post.image.
"""
import json, sys, time, datetime, argparse, urllib.request, urllib.parse, os, zoneinfo

HERE = os.path.dirname(os.path.abspath(__file__))
G = 'https://graph.instagram.com/v21.0'

def api(path, params=None, method='GET'):
    params = dict(params or {})
    data = urllib.parse.urlencode(params).encode()
    if method == 'GET':
        req = urllib.request.Request(f'{G}/{path}?{data.decode()}')
    else:
        req = urllib.request.Request(f'{G}/{path}', data=data, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise SystemExit(f'Graph API error {e.code}: {body}')

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--id')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()

    cfg = json.load(open(f'{HERE}/config.json')) if os.path.exists(f'{HERE}/config.json') else {}
    cfg.setdefault('ig_user_id', os.environ.get('IG_USER_ID', '17841437953266834'))
    cfg.setdefault('image_base_url', 'https://hypercubegames.com/ig/')
    if os.environ.get('IG_ACCESS_TOKEN'): cfg['access_token'] = os.environ['IG_ACCESS_TOKEN']
    tok, ig = cfg['access_token'], cfg['ig_user_id']

    if a.check:
        me = api('me', {'fields': 'username,followers_count,media_count', 'access_token': tok})
        print(f"OK @{me['username']}  followers={me['followers_count']}  posts={me['media_count']}")
        return
    if a.refresh:
        r = api('refresh_access_token', {'grant_type': 'ig_refresh_token', 'access_token': tok})
        print(f"token refreshed, expires in {r['expires_in']//86400} days")
        out = os.environ.get('NEW_TOKEN_FILE')
        if out: open(out, 'w').write(r['access_token'])
        return

    q = json.load(open(f'{HERE}/queue.json'))
    tz = zoneinfo.ZoneInfo(q['timezone'])
    today = datetime.datetime.now(tz).date().isoformat()

    if a.id:
        post = next(p for p in q['posts'] if p['id'] == a.id)
        if post['status'] != 'approved' and not a.force:
            raise SystemExit(f"{a.id} is {post['status']}, not approved (use --force)")
    else:
        due = [p for p in q['posts'] if p['status'] == 'approved' and p['date'] <= today]
        if not due:
            print(f'Nothing approved and due on {today}.'); return
        post = due[0]

    url = cfg['image_base_url'].rstrip('/') + '/' + post['image']
    print(f"Post {post['id']} ({post['date']}) image={url}")
    if a.dry_run:
        print(post['caption']); return

    c = api(f'{ig}/media', {'image_url': url, 'caption': post['caption'], 'access_token': tok}, 'POST')
    cid = c['id']
    for _ in range(20):
        st = api(cid, {'fields': 'status_code,status', 'access_token': tok})
        if st.get('status_code') == 'FINISHED': break
        if st.get('status_code') == 'ERROR': raise SystemExit(f'container error: {st}')
        time.sleep(3)
    pub = api(f'{ig}/media_publish', {'creation_id': cid, 'access_token': tok}, 'POST')
    mid = pub['id']
    info = api(mid, {'fields': 'permalink', 'access_token': tok})
    post['status'] = 'published'; post['published_at'] = datetime.datetime.now(tz).isoformat(); post['permalink'] = info.get('permalink')
    json.dump(q, open(f'{HERE}/queue.json', 'w'), indent=1, ensure_ascii=False)
    print(f"PUBLISHED {post['id']} -> {info.get('permalink')}")

if __name__ == '__main__':
    main()
