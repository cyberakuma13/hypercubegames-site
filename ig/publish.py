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
import json, sys, time, re, datetime, argparse, urllib.request, urllib.parse, os, zoneinfo

HERE = os.path.dirname(os.path.abspath(__file__))
G = 'https://graph.instagram.com/v21.0'
FBG = 'https://graph.facebook.com/v21.0'

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

def fbapi(path, params=None, method='GET'):
    """Call the Facebook Graph API (separate host from the Instagram one)."""
    params = dict(params or {})
    data = urllib.parse.urlencode(params).encode()
    if method == 'GET':
        req = urllib.request.Request(f'{FBG}/{path}?{data.decode()}')
    else:
        req = urllib.request.Request(f'{FBG}/{path}', data=data, method='POST')
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)

def fb_page_token(sys_token, page_id=None):
    """Exchange the never-expiring system-user token for this Page's token."""
    r = fbapi('me/accounts', {'fields': 'id,name,access_token,tasks', 'access_token': sys_token})
    pages = r.get('data', [])
    if not pages:
        raise RuntimeError('system user has no Pages assigned')
    if page_id:
        pages = [p for p in pages if p['id'] == str(page_id)] or pages
    return pages[0]['id'], pages[0]['access_token'], pages[0]['name']

BIO_RE = re.compile(r'[.,:]?\s*(?:Kickstarter )?[Ll]ink in bio\.?')

def fb_caption(caption, campaign_url):
    """Instagram's 'link in bio' means nothing on Facebook, where links are clickable.
    Swap the phrase for the real campaign URL."""
    if not campaign_url or not BIO_RE.search(caption):
        return caption
    return BIO_RE.sub(': ' + campaign_url, caption, count=1)

def fb_publish(post, url, caption):
    """Mirror a post to the Facebook Page. Never fatal: IG is the primary channel."""
    sys_token = os.environ.get('FB_ACCESS_TOKEN')
    if not sys_token:
        print('FB: no FB_ACCESS_TOKEN, skipping'); return None
    try:
        pid, ptok, pname = fb_page_token(sys_token, os.environ.get('FB_PAGE_ID'))
        if post.get('type') == 'reel':
            r = fbapi(f'{pid}/videos', {'file_url': url, 'description': caption,
                                        'access_token': ptok}, 'POST')
            oid = r.get('id')
            link = f'https://www.facebook.com/{pid}/videos/{oid}' if oid else None
        else:
            r = fbapi(f'{pid}/photos', {'url': url, 'caption': caption,
                                        'published': 'true', 'access_token': ptok}, 'POST')
            oid = r.get('post_id') or r.get('id')
            link = f'https://www.facebook.com/{oid}' if oid else None
        print(f'FB: posted to {pname} -> {link}')
        return link
    except Exception as e:
        detail = ''
        if isinstance(e, urllib.error.HTTPError):
            try: detail = e.read().decode()[:500]
            except Exception: pass
        print(f'FB: FAILED ({e}) {detail}')
        return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--refresh', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--id')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--fb-check', action='store_true')
    ap.add_argument('--no-fb', action='store_true')
    ap.add_argument('--fb-only', action='store_true', help='mirror an already-published post to Facebook only')
    a = ap.parse_args()

    cfg = json.load(open(f'{HERE}/config.json')) if os.path.exists(f'{HERE}/config.json') else {}
    cfg.setdefault('ig_user_id', os.environ.get('IG_USER_ID', '17841437953266834'))
    cfg.setdefault('image_base_url', 'https://hypercubegames.com/ig/')
    if os.environ.get('IG_ACCESS_TOKEN'): cfg['access_token'] = os.environ['IG_ACCESS_TOKEN']
    tok, ig = cfg['access_token'], cfg['ig_user_id']

    if a.fb_check:
        st = os.environ.get('FB_ACCESS_TOKEN')
        if not st: raise SystemExit('FB_ACCESS_TOKEN not set')
        pid, ptok, pname = fb_page_token(st, os.environ.get('FB_PAGE_ID'))
        print(f'FB OK: {pname} (id {pid})')
        return
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

    if a.fb_only:
        fb_link = fb_publish(post, url, fb_caption(post['caption'], q.get('campaign_url')))
        if fb_link:
            post['fb_permalink'] = fb_link
            json.dump(q, open(f'{HERE}/queue.json', 'w'), indent=1, ensure_ascii=False)
            print(f"PUBLISHED {post['id']} -> {fb_link}")
        return

    if post.get('type') == 'reel':
        c = api(f'{ig}/media', {'media_type': 'REELS', 'video_url': url, 'caption': post['caption'],
                                 'share_to_feed': 'true', 'access_token': tok}, 'POST')
    else:
        c = api(f'{ig}/media', {'image_url': url, 'caption': post['caption'], 'access_token': tok}, 'POST')
    cid = c['id']
    for _ in range(60):
        st = api(cid, {'fields': 'status_code,status', 'access_token': tok})
        if st.get('status_code') == 'FINISHED': break
        if st.get('status_code') == 'ERROR': raise SystemExit(f'container error: {st}')
        time.sleep(5)
    pub = api(f'{ig}/media_publish', {'creation_id': cid, 'access_token': tok}, 'POST')
    mid = pub['id']
    info = api(mid, {'fields': 'permalink', 'access_token': tok})
    post['status'] = 'published'; post['published_at'] = datetime.datetime.now(tz).isoformat(); post['permalink'] = info.get('permalink')
    if not a.no_fb:
        fb_link = fb_publish(post, url, fb_caption(post['caption'], q.get('campaign_url')))
        if fb_link: post['fb_permalink'] = fb_link
    json.dump(q, open(f'{HERE}/queue.json', 'w'), indent=1, ensure_ascii=False)
    print(f"PUBLISHED {post['id']} -> {info.get('permalink')}")

if __name__ == '__main__':
    main()
